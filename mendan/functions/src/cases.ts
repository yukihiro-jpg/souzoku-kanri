import { HttpsError, onCall } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { getStorage } from "firebase-admin/storage";
import { CHECK_ITEM_MASTER, P, completionStats, initialCheckItems, type CaseDoc, type CheckItem, type Consent, type Meeting, type Role } from "@mendan/shared";
import { assertEmailAllowed, csvList, optStr, requireCase, requireRole, requireUser, str } from "./auth.js";
import { ADMIN_EMAILS, REGION } from "./config.js";
import { FieldValue, audit, db, nowIso } from "./db.js";

/**
 * ログイン直後に呼ぶ。許可された Google Workspace ドメイン（ALLOWED_EMAILS を設定していればそのアドレス）のアカウントだけを登録する。
 * users/{uid} が作られて active=true でない限り、Firestore も関数も利用できない。
 */
export const ensureUser = onCall({ region: REGION }, async (req) => {
  const a = req.auth;
  if (!a) throw new HttpsError("unauthenticated", "ログインしてください。");
  const email = assertEmailAllowed(a.token);

  const ref = db.doc(P.user(a.uid));
  const snap = await ref.get();
  if (snap.exists) {
    await ref.update({ lastLoginAt: nowIso() });
    return snap.data();
  }
  const role: Role = csvList(ADMIN_EMAILS.value()).includes(email) ? "admin" : "staff";
  const user = { uid: a.uid, email, displayName: String(a.token.name ?? email), role, active: true, createdAt: nowIso(), lastLoginAt: nowIso() };
  await ref.set(user);
  return user;
});

export const createCase = onCall({ region: REGION }, async (req) => {
  const actor = await requireUser(req);
  requireRole(actor, ["admin", "staff"]);
  const d = (req.data ?? {}) as { name?: string; decedentName?: string; inheritanceStartDate?: string };
  const name = str(d.name, "案件名", 100);
  const decedentName = str(d.decedentName, "被相続人名", 100);
  const date = optStr(d.inheritanceStartDate, 10);
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpsError("invalid-argument", "相続開始日は YYYY-MM-DD 形式で入力してください。");
  const ref = db.collection(P.cases()).doc();
  const now = nowIso();
  const c: CaseDoc = {
    id: ref.id,
    name,
    decedentName,
    inheritanceStartDate: date,
    memberIds: [actor.uid],
    members: { [actor.uid]: actor.role === "viewer" ? "viewer" : "staff" },
    consent: null,
    status: "active",
    createdAt: now,
    createdBy: actor.uid,
    updatedAt: now,
  };
  const batch = db.batch();
  batch.set(ref, c);
  for (const item of initialCheckItems(ref.id, CHECK_ITEM_MASTER, now)) batch.set(db.doc(`${P.checkItems(ref.id)}/${item.id}`), item);
  audit(batch, ref.id, { actor: actor.uid, action: "case_created", target: ref.id });
  await batch.commit();
  return { caseId: ref.id };
});

export const updateCase = onCall({ region: REGION }, async (req) => {
  const actor = await requireUser(req);
  const d = (req.data ?? {}) as { caseId: string; name?: string; decedentName?: string; inheritanceStartDate?: string | null; addMemberEmail?: string; memberRole?: Role };
  await requireCase(actor, d.caseId, true);
  const patch: Record<string, unknown> = { updatedAt: nowIso() };
  if (d.name !== undefined) patch.name = str(d.name, "案件名", 100);
  if (d.decedentName !== undefined) patch.decedentName = str(d.decedentName, "被相続人名", 100);
  if (d.inheritanceStartDate !== undefined) {
    const v = optStr(d.inheritanceStartDate, 10);
    if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new HttpsError("invalid-argument", "相続開始日の形式が不正です。");
    patch.inheritanceStartDate = v;
  }
  if (d.addMemberEmail) {
    const u = await db.collection("users").where("email", "==", d.addMemberEmail.toLowerCase()).limit(1).get();
    if (u.empty) throw new HttpsError("not-found", "そのメールアドレスのユーザーはまだログインしていません。");
    const uid = u.docs[0].id;
    const role: Role = d.memberRole === "viewer" ? "viewer" : "staff";
    patch.memberIds = FieldValue.arrayUnion(uid);
    patch[`members.${uid}`] = role;
  }
  const batch = db.batch();
  batch.update(db.doc(P.case(d.caseId)), patch);
  audit(batch, d.caseId, { actor: actor.uid, action: "case_updated", target: d.caseId, detail: { fields: Object.keys(patch) } });
  await batch.commit();
  return { ok: true };
});

async function assertNoLiveMeeting(caseId: string, what: string) {
  const live = await db.collection(P.meetings(caseId)).where("status", "==", "in_progress").limit(1).get();
  if (!live.empty) throw new HttpsError("failed-precondition", `面談中のため${what}できません。先に面談を終了してください。`);
}

/** 案件の完了／進行中に戻す。完了した案件はトップ画面（進行中）から「完了」の一覧へ移る */
export const setCaseStatus = onCall({ region: REGION }, async (req) => {
  const actor = await requireUser(req);
  requireRole(actor, ["admin", "staff"]);
  const d = (req.data ?? {}) as { caseId: string; status: "active" | "closed" };
  if (d.status !== "active" && d.status !== "closed") throw new HttpsError("invalid-argument", "status は active か closed です。");
  await requireCase(actor, d.caseId, true);
  if (d.status === "closed") await assertNoLiveMeeting(d.caseId, "完了に");
  const now = nowIso();
  const batch = db.batch();
  batch.update(db.doc(P.case(d.caseId)), {
    status: d.status,
    closedAt: d.status === "closed" ? now : null,
    closedBy: d.status === "closed" ? actor.uid : null,
    updatedAt: now,
  });
  audit(batch, d.caseId, { actor: actor.uid, action: d.status === "closed" ? "case_closed" : "case_reopened", target: d.caseId });
  await batch.commit();
  return { ok: true };
});

/**
 * 案件の削除（管理者のみ・元に戻せない）
 * 案件・面談・発言・資料・確認事項・操作記録などの配下データと、録音ファイルをすべて削除する。
 * 誤操作防止のため、案件名の入力（confirmName）が一致した場合だけ実行する。
 * 料金の記録（costLogs）は月の集計のため残し、削除した事実（案件名・削除者・日時）だけを deletedCases に残す。
 */
export const deleteCase = onCall({ region: REGION, timeoutSeconds: 300 }, async (req) => {
  const actor = await requireUser(req);
  requireRole(actor, ["admin"]);
  const d = (req.data ?? {}) as { caseId: string; confirmName: string };
  const c = await requireCase(actor, d.caseId, true);
  if (typeof d.confirmName !== "string" || d.confirmName.trim() !== c.name.trim()) {
    throw new HttpsError("invalid-argument", "入力された案件名が一致しないため、削除しませんでした。");
  }
  await assertNoLiveMeeting(d.caseId, "削除");
  try {
    await getStorage().bucket().deleteFiles({ prefix: `audio/${d.caseId}/` });
  } catch (e) {
    logger.error("audio delete failed", { caseId: d.caseId, message: (e as Error).message });
    throw new HttpsError("internal", "録音ファイルの削除に失敗したため、案件の削除を中止しました。時間をおいて再度お試しください。");
  }
  await db.recursiveDelete(db.doc(P.case(d.caseId)));
  await db.collection(P.deletedCases()).doc(d.caseId).set({ caseId: d.caseId, name: c.name, deletedBy: actor.uid, deletedByEmail: actor.email, deletedAt: nowIso() });
  return { ok: true };
});

/** 面談開始前の録音・AI利用の説明と同意（指示書 14-12） */
export const recordConsent = onCall({ region: REGION }, async (req) => {
  const actor = await requireUser(req);
  const d = (req.data ?? {}) as { caseId: string; recording: boolean; aiAnalysis: boolean; method: "verbal" | "written"; note?: string };
  await requireCase(actor, d.caseId, true);
  const consent: Consent = {
    recording: d.recording === true,
    aiAnalysis: d.aiAnalysis === true,
    explainedBy: actor.uid,
    explainedAt: nowIso(),
    method: d.method === "written" ? "written" : "verbal",
    note: optStr(d.note, 500),
  };
  const batch = db.batch();
  batch.update(db.doc(P.case(d.caseId)), { consent, updatedAt: nowIso() });
  audit(batch, d.caseId, { actor: actor.uid, action: "consent_recorded", target: d.caseId, detail: { recording: consent.recording, aiAnalysis: consent.aiAnalysis, method: consent.method } });
  await batch.commit();
  return { consent };
});

export const startMeeting = onCall({ region: REGION }, async (req) => {
  const actor = await requireUser(req);
  requireRole(actor, ["admin", "staff"]);
  const { caseId } = (req.data ?? {}) as { caseId: string };
  const c = await requireCase(actor, caseId, true);
  if (!c.consent?.recording || !c.consent?.aiAnalysis) throw new HttpsError("failed-precondition", "録音・AI解析の同意を記録してから面談を開始してください。");
  const prev = await db.collection(P.meetings(caseId)).orderBy("no", "desc").limit(1).get();
  const no = prev.empty ? 1 : ((prev.docs[0].data() as Meeting).no ?? 0) + 1;
  const ref = db.collection(P.meetings(caseId)).doc();
  const m: Meeting = {
    id: ref.id,
    caseId,
    no,
    interviewer: actor.name,
    interviewerUid: actor.uid,
    status: "in_progress",
    startedAt: nowIso(),
    endedAt: null,
    lastSeq: 0,
    questionsSeq: 0,
    gaps: [],
    audioParts: [],
    reanalysis: { status: "none" },
  };
  // 確認事項が未作成の案件（マスタ追加後など）は補完する。過去の面談の状態は引き継ぐ。
  const existing = await db.collection(P.checkItems(caseId)).select().get();
  const have = new Set(existing.docs.map((d) => d.id));
  const batch = db.batch();
  batch.set(ref, m);
  for (const item of initialCheckItems(caseId, CHECK_ITEM_MASTER, nowIso())) if (!have.has(item.id)) batch.set(db.doc(`${P.checkItems(caseId)}/${item.id}`), item);
  audit(batch, caseId, { actor: actor.uid, action: "meeting_started", target: ref.id });
  await batch.commit();
  return { meetingId: ref.id, no };
});

/**
 * 面談終了。未確認の重要項目があれば警告を返す（force=true で終了可能）。
 */
export const endMeeting = onCall({ region: REGION }, async (req) => {
  const actor = await requireUser(req);
  const { caseId, meetingId, force } = (req.data ?? {}) as { caseId: string; meetingId: string; force?: boolean };
  await requireCase(actor, caseId, true);
  const items = (await db.collection(P.checkItems(caseId)).get()).docs.map((d) => d.data() as CheckItem);
  const openHigh = items.filter((c) => !c.obsolete && c.priority === "high" && ["unconfirmed", "needs_followup", "contradiction"].includes(c.status));
  const pendingSegs = await db.collection(P.segments(caseId, meetingId)).where("analysisStatus", "in", ["pending", "queued", "analyzing", "error", "skipped"]).get();
  const warnings = [
    ...openHigh.map((c) => `未確認の重要事項: ${c.question}`),
    ...(pendingSegs.empty ? [] : [`AI解析が完了していない発言が ${pendingSegs.size} 件あります（面談後の再解析で補完されます）`]),
  ];
  if (warnings.length > 0 && !force) return { ended: false, warnings, stats: completionStats(items) };
  const batch = db.batch();
  batch.update(db.doc(P.meeting(caseId, meetingId)), { status: "ended", endedAt: nowIso(), endWarnings: warnings });
  audit(batch, caseId, { actor: actor.uid, action: "meeting_ended", target: meetingId, detail: { forced: !!force, warnings: warnings.length } });
  await batch.commit();
  return { ended: true, warnings, stats: completionStats(items) };
});
