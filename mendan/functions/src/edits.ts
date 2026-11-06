import { HttpsError, onCall } from "firebase-functions/v2/https";
import {
  CHECK_ITEM_MASTER,
  CHECK_STATUSES,
  DOC_STATUSES,
  EMPTY_ANALYSIS,
  P,
  applyAnalysis,
  type AnalysisOutput,
  type CaseDoc,
  type CaseState,
  type CheckItem,
  type CheckStatus,
  type DocStatus,
  type DocumentRequirement,
  type Entity,
  type ReviewItem,
  type TranscriptSegment,
} from "@mendan/shared";
import { optStr, requireCase, requireUser, str, type Actor } from "./auth.js";
import { REGION } from "./config.js";
import { audit, db, deathDateOf, historyEntry, loadCaseState, loadMasters, newId, nowIso, todayJst } from "./db.js";

/**
 * 担当者による手動修正。すべて操作履歴（AuditLogs）と各データの修正履歴に残す。
 * 手動で確定・修正したものは lockedByUser=true となり、以後 AI は変更しない。
 */

type Tx = FirebaseFirestore.Transaction;

async function writeResult(tx: Tx, caseId: string, r: ReturnType<typeof applyAnalysis>) {
  for (const e of r.entities) tx.set(db.doc(`${P.entities(caseId)}/${e.id}`), e);
  for (const c of r.checkItems) tx.set(db.doc(`${P.checkItems(caseId)}/${c.id}`), c);
  for (const d of r.documents) tx.set(db.doc(`${P.documents(caseId)}/${d.id}`), d);
  for (const ri of r.reviewItems) {
    const ref = db.collection(P.reviewItems(caseId)).doc();
    tx.set(ref, { ...ri, id: ref.id });
  }
}

/** 実体の変更後に、ルールエンジンで必要資料・追加確認項目を再判定する */
async function recompute(tx: Tx, caseDoc: CaseDoc, state: CaseState, actor: Actor, analysis: AnalysisOutput = EMPTY_ANALYSIS, segmentSeq = new Map<string, number>(), meetingId: string | null = null) {
  const masters = await loadMasters();
  const r = applyAnalysis(state, analysis, {
    caseId: caseDoc.id,
    meetingId,
    actor: `user:${actor.uid}`,
    now: nowIso(),
    today: todayJst(),
    segmentSeq,
    rules: masters.rules,
    documentMaster: masters.docs,
    checkMaster: CHECK_ITEM_MASTER,
    settings: masters.settings,
    deathDate: deathDateOf(caseDoc, state.entities),
    newId,
    mode: "reanalysis_approved",
  });
  await writeResult(tx, caseDoc.id, r);
  return r;
}

function replace<T extends { id: string }>(list: T[], item: T): T[] {
  return list.map((x) => (x.id === item.id ? item : x));
}

export const updateCheckItem = onCall({ region: REGION }, async (req) => {
  const actor = await requireUser(req);
  const d = (req.data ?? {}) as { caseId: string; itemId: string; status?: CheckStatus; answer?: string | null; unlock?: boolean };
  await requireCase(actor, d.caseId, true);
  if (d.status && !CHECK_STATUSES.includes(d.status)) throw new HttpsError("invalid-argument", "状態が不正です。");
  const ref = db.doc(`${P.checkItems(d.caseId)}/${str(d.itemId, "itemId", 200)}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "確認事項が見つかりません。");
    const item = snap.data() as CheckItem;
    const before = { status: item.status, answer: item.answer, lockedByUser: item.lockedByUser };
    if (d.unlock) {
      item.lockedByUser = false;
    } else {
      if (d.status) item.status = d.status;
      if (d.answer !== undefined) item.answer = optStr(d.answer, 1000);
      item.lockedByUser = true;
      item.manualBy = actor.uid;
      item.autoDerived = false;
      item.source = item.source === "master" || item.source === "rule" ? item.source : "user";
    }
    item.updatedAt = nowIso();
    item.history = [...(item.history ?? []), historyEntry(`user:${actor.uid}`, d.unlock ? "unlock" : "manual_update", before, { status: item.status, answer: item.answer })].slice(-60);
    tx.set(ref, item);
    audit(tx, d.caseId, { actor: actor.uid, action: "check_item_updated", target: item.id, detail: { before: before.status, after: item.status } });
  });
  return { ok: true };
});

export const updateDocument = onCall({ region: REGION }, async (req) => {
  const actor = await requireUser(req);
  const d = (req.data ?? {}) as {
    caseId: string;
    docId: string;
    status?: DocStatus;
    dueDate?: string | null;
    submitter?: string | null;
    remarks?: string | null;
    clearReview?: boolean;
  };
  await requireCase(actor, d.caseId, true);
  if (d.status && !DOC_STATUSES.includes(d.status)) throw new HttpsError("invalid-argument", "状態が不正です。");
  const ref = db.doc(`${P.documents(d.caseId)}/${str(d.docId, "docId", 300)}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "資料が見つかりません。");
    const doc = snap.data() as DocumentRequirement;
    const before = { status: doc.status, dueDate: doc.dueDate, submitter: doc.submitter };
    if (d.status) {
      doc.status = d.status;
      doc.decidedBy = "user";
      doc.lockedByUser = true; // 担当者が判断した資料はAIが変更しない
    }
    if (d.dueDate !== undefined) doc.dueDate = optStr(d.dueDate, 10);
    if (d.submitter !== undefined) doc.submitter = optStr(d.submitter, 100);
    if (d.remarks !== undefined) doc.remarks = optStr(d.remarks, 1000);
    if (d.clearReview) doc.needsReview = false;
    doc.updatedAt = nowIso();
    doc.history = [...(doc.history ?? []), historyEntry(`user:${actor.uid}`, "manual_update", before, { status: doc.status, dueDate: doc.dueDate, submitter: doc.submitter })].slice(-60);
    tx.set(ref, doc);
    audit(tx, d.caseId, { actor: actor.uid, action: "document_updated", target: doc.id, detail: { before: before.status, after: doc.status } });
  });
  return { ok: true };
});

/** 資料マスタから手動で資料を追加 */
export const addDocument = onCall({ region: REGION }, async (req) => {
  const actor = await requireUser(req);
  const d = (req.data ?? {}) as { caseId: string; documentId: string; target?: string; reason?: string };
  await requireCase(actor, d.caseId, true);
  const masters = await loadMasters();
  const m = masters.docs.get(str(d.documentId, "documentId", 100));
  if (!m) throw new HttpsError("not-found", "資料マスタにありません。");
  const target = optStr(d.target, 100);
  const id = `${m.id}__manual_${newId("m").slice(-8)}`;
  const now = nowIso();
  const fill = (s: string) => s.replace(/\{target\}/g, target ?? "");
  const doc: DocumentRequirement = {
    id,
    caseId: d.caseId,
    documentId: m.id,
    name: fill(m.name),
    category: m.category,
    target,
    reasons: [optStr(d.reason, 300) ?? "担当者が追加"],
    ruleIds: [],
    ruleVersions: {},
    fromUnapprovedRule: false,
    entityId: null,
    period: null,
    periodSpec: null,
    submitter: m.defaultSubmitter,
    dueDate: null,
    status: "required",
    decidedBy: "user",
    evidenceSegmentIds: [],
    importance: "medium",
    remarks: null,
    source: fill(m.source),
    howTo: m.howTo,
    lockedByUser: true,
    createdAt: now,
    updatedAt: now,
    history: [historyEntry(`user:${actor.uid}`, "manual_create", null, "required")],
  };
  const batch = db.batch();
  batch.set(db.doc(`${P.documents(d.caseId)}/${id}`), doc);
  audit(batch, d.caseId, { actor: actor.uid, action: "document_added", target: id });
  await batch.commit();
  return { id };
});

/** 抽出情報（財産・人物）の承認・却下・修正 */
export const updateEntity = onCall({ region: REGION }, async (req) => {
  const actor = await requireUser(req);
  const d = (req.data ?? {}) as { caseId: string; entityId: string; action: "confirm" | "reject" | "unlock" | "edit"; attributes?: Record<string, string>; label?: string };
  const caseDoc = await requireCase(actor, d.caseId, true);
  await db.runTransaction(async (tx) => {
    const state = await loadCaseState(d.caseId, tx);
    const e = state.entities.find((x) => x.id === d.entityId);
    if (!e) throw new HttpsError("not-found", "抽出情報が見つかりません。");
    const before = { status: e.status, label: e.label, attributes: Object.fromEntries(Object.entries(e.attributes).map(([k, v]) => [k, v.value])) };
    const now = nowIso();
    switch (d.action) {
      case "confirm":
        e.status = "confirmed";
        e.lockedByUser = true;
        e.confirmedBy = actor.uid;
        break;
      case "reject":
        e.status = "rejected";
        e.lockedByUser = true;
        e.confirmedBy = actor.uid;
        break;
      case "unlock":
        e.lockedByUser = false;
        if (e.status === "confirmed" || e.status === "rejected") e.status = "ai_candidate";
        break;
      case "edit":
        if (d.label) e.label = str(d.label, "label", 100);
        for (const [k, v] of Object.entries(d.attributes ?? {})) {
          const cur = e.attributes[k];
          const value = String(v ?? "").slice(0, 200);
          e.attributes[k] = {
            value,
            evidenceSegmentIds: cur?.evidenceSegmentIds ?? [],
            updatedSeq: cur?.updatedSeq ?? 0,
            source: "user",
            history: cur ? [...(cur.history ?? []), { value: cur.value, evidenceSegmentIds: cur.evidenceSegmentIds, at: now, by: `user:${actor.uid}` }] : [],
          };
        }
        e.lockedByUser = true;
        e.status = "confirmed";
        e.confirmedBy = actor.uid;
        break;
      default:
        throw new HttpsError("invalid-argument", "action が不正です。");
    }
    e.updatedAt = now;
    e.history = [...(e.history ?? []), historyEntry(`user:${actor.uid}`, d.action, before, { status: e.status, label: e.label })].slice(-60);
    const newState = { ...state, entities: replace(state.entities, e as Entity) };
    tx.set(db.doc(`${P.entities(d.caseId)}/${e.id}`), e);
    await recompute(tx, caseDoc, newState, actor);
    audit(tx, d.caseId, { actor: actor.uid, action: `entity_${d.action}`, target: e.id });
  });
  return { ok: true };
});

/** 話者の修正（不確実な話者識別をユーザーが直す） */
export const setSegmentSpeaker = onCall({ region: REGION }, async (req) => {
  const actor = await requireUser(req);
  const d = (req.data ?? {}) as { caseId: string; meetingId: string; segmentId: string; speaker: TranscriptSegment["speaker"]; applyToLabel?: boolean };
  await requireCase(actor, d.caseId, true);
  if (!["staff", "client", "other", "unknown"].includes(d.speaker)) throw new HttpsError("invalid-argument", "話者が不正です。");
  const ref = db.doc(P.segment(d.caseId, d.meetingId, d.segmentId));
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "発言が見つかりません。");
  const seg = snap.data() as TranscriptSegment;
  const batch = db.batch();
  batch.update(ref, { speaker: d.speaker, speakerConfirmed: true });
  if (d.applyToLabel && seg.speakerLabel) {
    const same = await db.collection(P.segments(d.caseId, d.meetingId)).where("speakerLabel", "==", seg.speakerLabel).get();
    for (const s of same.docs) if (!(s.data() as TranscriptSegment).speakerConfirmed) batch.update(s.ref, { speaker: d.speaker, speakerConfirmed: true });
    batch.set(db.doc(P.meeting(d.caseId, d.meetingId)), { speakerMap: { [seg.speakerLabel]: d.speaker } }, { merge: true });
  }
  audit(batch, d.caseId, { actor: actor.uid, action: "speaker_updated", target: d.segmentId, detail: { speaker: d.speaker } });
  await batch.commit();
  return { ok: true };
});

/**
 * 追加確認候補の承認・却下。
 * 承認時は提案内容を担当者承認済みとして適用する（承認済み情報の変更も、ここでのみ可能）。
 */
export const resolveReviewItem = onCall({ region: REGION }, async (req) => {
  const actor = await requireUser(req);
  const d = (req.data ?? {}) as { caseId: string; reviewItemId: string; decision: "approve" | "reject" | "dismiss" };
  const caseDoc = await requireCase(actor, d.caseId, true);
  const ref = db.doc(`${P.reviewItems(d.caseId)}/${d.reviewItemId}`);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "追加確認候補が見つかりません。");
    const item = snap.data() as ReviewItem;
    if (item.status !== "open") throw new HttpsError("failed-precondition", "処理済みです。");
    let applied = 0;
    if (d.decision === "approve" && item.proposal && typeof item.proposal === "object") {
      const p = item.proposal as Partial<AnalysisOutput>;
      const analysis: AnalysisOutput = { ...EMPTY_ANALYSIS, entities: p.entities ?? [], check_items: p.check_items ?? [] };
      // 根拠の発言を読む
      const evIds = [...new Set([...analysis.entities.flatMap((e) => e.evidence_segment_ids), ...analysis.check_items.flatMap((c) => c.evidence_segment_ids)])];
      const segmentSeq = new Map<string, number>();
      if (item.meetingId && evIds.length) {
        const segs = await tx.getAll(...evIds.map((id) => db.doc(P.segment(d.caseId, item.meetingId!, id))));
        for (const s of segs) if (s.exists) segmentSeq.set(s.id, (s.data() as TranscriptSegment).seq);
      }
      const state = await loadCaseState(d.caseId, tx);
      // 担当者が承認したので、対象のロックを一時的に外して適用し、適用後は承認済みとしてロックする
      const touched = new Set<string>(analysis.entities.flatMap((e) => [e.entity_id, e.corrects_entity_id]).filter((x): x is string => !!x));
      const touchedChecks = new Set(analysis.check_items.map((c) => c.check_item_id));
      const unlocked: CaseState = {
        ...state,
        entities: state.entities.map((e) => (touched.has(e.id) ? { ...e, lockedByUser: false, status: e.status === "confirmed" ? "ai_candidate" : e.status } : e)),
        checkItems: state.checkItems.map((c) => (touchedChecks.has(c.id) ? { ...c, lockedByUser: false, updatedSeq: 0 } : c)),
      };
      const before = new Set(state.entities.map((e) => e.id));
      const r = await recompute(tx, caseDoc, unlocked, actor, analysis, segmentSeq, item.meetingId);
      for (const e of r.entities) {
        if (touched.has(e.id) || !before.has(e.id)) {
          if (e.status !== "retracted") e.status = "confirmed";
          e.lockedByUser = true;
          e.confirmedBy = actor.uid;
          tx.set(db.doc(`${P.entities(d.caseId)}/${e.id}`), e);
        }
      }
      for (const c of r.checkItems) {
        if (touchedChecks.has(c.id)) {
          c.lockedByUser = true;
          c.manualBy = actor.uid;
          tx.set(db.doc(`${P.checkItems(d.caseId)}/${c.id}`), c);
        }
      }
      applied = r.entities.length + r.checkItems.length + r.documents.length;
    }
    tx.update(ref, { status: d.decision === "approve" ? "approved" : "rejected", resolvedBy: actor.uid, resolvedAt: nowIso() });
    audit(tx, d.caseId, { actor: actor.uid, action: `review_${d.decision}`, target: d.reviewItemId, detail: { kind: item.kind, applied } });
    return { ok: true, applied };
  });
});
