import { HttpsError, onCall } from "firebase-functions/v2/https";
import { CHECK_ITEM_MASTER, P, completionStats, initialCheckItems, type CaseDoc, type CheckItem, type Consent, type Meeting, type Role } from "@mendan/shared";
import { optStr, requireCase, requireRole, requireUser, str } from "./auth.js";
import { ADMIN_EMAILS, ALLOWED_EMAIL_DOMAINS, REGION } from "./config.js";
import { FieldValue, audit, db, nowIso } from "./db.js";

const list = (v: string) =>
  v
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

/**
 * ログイン直後に呼ぶ。許可された Google Workspace ドメインのアカウントだけを登録する。
 * users/{uid} が作られて active=true でない限り、Firestore も関数も利用できない。
 */
export const ensureUser = onCall({ region: REGION }, async (req) => {
  const a = req.auth;
  if (!a) throw new HttpsError("unauthenticated", "ログインしてください。");
  const email = String(a.token.email ?? "").toLowerCase();
  const verified = a.token.email_verified === true;
  const domains = list(ALLOWED_EMAIL_DOMAINS.value());
  const domain = email.split("@")[1] ?? "";
  if (!verified || !email) throw new HttpsError("permission-denied", "メールアドレスが確認できないアカウントです。");
  if (domains.length === 0) throw new HttpsError("failed-precondition", "ALLOWED_EMAIL_DOMAINS が未設定のため、ログインを受け付けられません。");
  if (!domains.includes(domain)) throw new HttpsError("permission-denied", `このアカウント（@${domain}）は利用が許可されていません。`);

  const ref = db.doc(P.user(a.uid));
  const snap = await ref.get();
  if (snap.exists) {
    await ref.update({ lastLoginAt: nowIso() });
    return snap.data();
  }
  const role: Role = list(ADMIN_EMAILS.value()).includes(email) ? "admin" : "staff";
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
