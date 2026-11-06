import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import { getStorage } from "firebase-admin/storage";
import { DEFAULT_RULES, DEFAULT_SETTINGS, ENTITY_TYPES, P, type AppSettings, type DocumentRule, type Role } from "@mendan/shared";
import { requireRole, requireUser, str } from "./auth.js";
import { REGION } from "./config.js";
import { audit, db, invalidateMasters, loadMasters, monthJst, nowIso } from "./db.js";

/** 管理者機能: ルールマスタ・専門用語・設定・ユーザー権限・費用/性能の集計 */

function validateRule(r: DocumentRule, docIds: Set<string>) {
  const errs: string[] = [];
  if (!/^[A-Z0-9-]{3,40}$/.test(r.id ?? "")) errs.push("ルールIDは英大文字・数字・ハイフンで指定してください");
  if (!r.title) errs.push("タイトルが必要です");
  if (!r.appliesTo || (r.appliesTo.kind === "entity" && !ENTITY_TYPES.includes(r.appliesTo.entityType))) errs.push("適用対象（appliesTo）が不正です");
  if (!Array.isArray(r.documentIds) || r.documentIds.length === 0) errs.push("必要資料IDが必要です");
  for (const d of r.documentIds ?? []) if (!docIds.has(d)) errs.push(`資料マスタにない資料ID: ${d}`);
  for (const c of [...(r.conditions ?? []), ...(r.exceptions ?? [])]) if (!c.attr || !["exists", "not_exists", "equals", "contains", "not_contains"].includes(c.op)) errs.push(`条件が不正です: ${JSON.stringify(c)}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.effectiveFrom ?? "")) errs.push("有効開始日は YYYY-MM-DD");
  if (errs.length) throw new HttpsError("invalid-argument", errs.join(" / "));
}

export const saveRule = onCall({ region: REGION }, async (req) => {
  const actor = await requireUser(req);
  requireRole(actor, ["admin"]);
  const { rule } = (req.data ?? {}) as { rule: DocumentRule };
  const masters = await loadMasters(true);
  validateRule(rule, new Set(masters.docs.keys()));
  const prev = masters.rules.find((r) => r.id === rule.id);
  // 内容が変わったら版を上げ、税理士承認をやり直す
  const next: DocumentRule = {
    ...rule,
    version: (prev?.version ?? 0) + 1,
    approval: { status: "pending_review", by: null, at: null },
    conditions: rule.conditions ?? [],
    exceptions: rule.exceptions ?? [],
  };
  const batch = db.batch();
  batch.set(db.doc(`${P.documentRules()}/${rule.id}`), { ...next, updatedAt: nowIso(), updatedBy: actor.uid });
  batch.set(db.collection("ruleHistory").doc(), { ruleId: rule.id, version: next.version, rule: next, at: nowIso(), by: actor.uid });
  await batch.commit();
  invalidateMasters();
  return { version: next.version };
});

/** 税理士承認（承認者の記録を残す） */
export const approveRule = onCall({ region: REGION }, async (req) => {
  const actor = await requireUser(req);
  requireRole(actor, ["admin"]);
  const { ruleId, status } = (req.data ?? {}) as { ruleId: string; status: "approved" | "rejected" | "pending_review" };
  const masters = await loadMasters(true);
  const r = masters.rules.find((x) => x.id === ruleId);
  if (!r) throw new HttpsError("not-found", "ルールが見つかりません。");
  const next = { ...r, approval: { status, by: status === "pending_review" ? null : actor.uid, at: status === "pending_review" ? null : nowIso() } };
  await db.doc(`${P.documentRules()}/${ruleId}`).set({ ...next, updatedAt: nowIso(), updatedBy: actor.uid });
  invalidateMasters();
  return { ok: true };
});

export const resetRule = onCall({ region: REGION }, async (req) => {
  const actor = await requireUser(req);
  requireRole(actor, ["admin"]);
  const { ruleId } = (req.data ?? {}) as { ruleId: string };
  if (!DEFAULT_RULES.some((r) => r.id === ruleId)) throw new HttpsError("not-found", "初期ルールではありません。");
  await db.doc(`${P.documentRules()}/${ruleId}`).delete();
  invalidateMasters();
  return { ok: true };
});

export const saveVocabulary = onCall({ region: REGION }, async (req) => {
  const actor = await requireUser(req);
  requireRole(actor, ["admin"]);
  const { add, remove, seedDefaults } = (req.data ?? {}) as { add?: string[]; remove?: string[]; seedDefaults?: string[] };
  const batch = db.batch();
  const idOf = (t: string) => encodeURIComponent(t).slice(0, 400);
  for (const t of [...(seedDefaults ?? []), ...(add ?? [])]) {
    const term = String(t).trim().slice(0, 50);
    if (term) batch.set(db.doc(`${P.vocabulary()}/${idOf(term)}`), { term, active: true, updatedAt: nowIso(), updatedBy: actor.uid });
  }
  for (const t of remove ?? []) batch.delete(db.doc(`${P.vocabulary()}/${idOf(String(t).trim())}`));
  await batch.commit();
  return { ok: true };
});

export const saveSettings = onCall({ region: REGION }, async (req) => {
  const actor = await requireUser(req);
  requireRole(actor, ["admin"]);
  const s = (req.data ?? {}) as Partial<AppSettings>;
  const next: Partial<AppSettings> = {};
  const num = (v: unknown, min: number, max: number) => (typeof v === "number" && v >= min && v <= max ? v : undefined);
  next.transactionHistoryYears = num(s.transactionHistoryYears, 1, 20);
  next.audioRetentionDays = num(s.audioRetentionDays, 1, 3650);
  next.monthlyBudgetUsd = num(s.monthlyBudgetUsd, 0, 100000);
  next.budgetWarnRatio = num(s.budgetWarnRatio, 0.1, 1);
  next.defaultDueDays = num(s.defaultDueDays, 1, 365);
  if (typeof s.requireApprovedRules === "boolean") next.requireApprovedRules = s.requireApprovedRules;
  if (typeof s.officeName === "string") next.officeName = s.officeName.slice(0, 100);
  if (typeof s.officeContact === "string") next.officeContact = s.officeContact.slice(0, 300);
  const clean = Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined));
  await db.doc(P.settings()).set({ ...DEFAULT_SETTINGS, ...((await db.doc(P.settings()).get()).data() ?? {}), ...clean, updatedAt: nowIso(), updatedBy: actor.uid });
  invalidateMasters();
  return { ok: true };
});

export const setUserRole = onCall({ region: REGION }, async (req) => {
  const actor = await requireUser(req);
  requireRole(actor, ["admin"]);
  const { uid, role, active } = (req.data ?? {}) as { uid: string; role?: Role; active?: boolean };
  const patch: Record<string, unknown> = { updatedAt: nowIso() };
  if (role) {
    if (!["admin", "staff", "viewer"].includes(role)) throw new HttpsError("invalid-argument", "権限が不正です。");
    patch.role = role;
  }
  if (typeof active === "boolean") patch.active = active;
  await db.doc(P.user(str(uid, "uid", 200))).update(patch);
  return { ok: true };
});

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[idx];
}

/** 性能（P50/P95）と費用の集計 */
export const getMetrics = onCall({ region: REGION, timeoutSeconds: 60 }, async (req) => {
  const actor = await requireUser(req);
  requireRole(actor, ["admin"]);
  const { days } = (req.data ?? {}) as { days?: number };
  const since = new Date(Date.now() - (days ?? 30) * 86400_000).toISOString();
  const jobs = await db.collectionGroup("aiJobs").where("createdAt", ">=", since).orderBy("createdAt", "desc").limit(2000).get();
  const series: Record<string, number[]> = { interimMs: [], finalToRequestMs: [], aiMs: [], serverMs: [], finalToAppliedMs: [], finalToDocListMs: [] };
  let realtime = 0;
  let errors = 0;
  for (const d of jobs.docs) {
    const j = d.data();
    if (j.kind !== "realtime") continue;
    realtime++;
    if (j.status === "error") errors++;
    const t = j.timings ?? {};
    const c = j.clientTimings ?? {};
    if (typeof t.aiMs === "number") series.aiMs.push(t.aiMs);
    if (typeof t.serverMs === "number") series.serverMs.push(t.serverMs);
    if (typeof c.speechStartAt === "number" && typeof c.interimShownAt === "number") series.interimMs.push(c.interimShownAt - c.speechStartAt);
    if (typeof c.finalAt === "number" && typeof t.clientRequestedAt === "number") series.finalToRequestMs.push(t.clientRequestedAt - c.finalAt);
    if (typeof c.finalAt === "number" && typeof c.resultReceivedAt === "number") series.finalToAppliedMs.push(c.resultReceivedAt - c.finalAt);
    if (typeof c.finalAt === "number" && typeof c.docListUpdatedAt === "number") series.finalToDocListMs.push(c.docListUpdatedAt - c.finalAt);
  }
  const latency = Object.fromEntries(Object.entries(series).map(([k, v]) => [k, { n: v.length, p50: percentile(v, 50), p95: percentile(v, 95) }]));
  const month = monthJst();
  const [summary, perMeeting] = await Promise.all([
    db.doc(P.costSummary(month)).get(),
    db.collectionGroup("meetings").where("startedAt", ">=", since).orderBy("startedAt", "desc").limit(200).get(),
  ]);
  const meetings = perMeeting.docs.map((d) => {
    const m = d.data();
    return { caseId: m.caseId, meetingId: m.id, no: m.no, startedAt: m.startedAt, interviewer: m.interviewer, usage: m.usage ?? {} };
  });
  const masters = await loadMasters();
  return { latency, realtimeJobs: realtime, errorJobs: errors, month, cost: summary.data() ?? null, meetings, budget: masters.settings.monthlyBudgetUsd };
});

/**
 * 録音データの保存期間を過ぎたものを削除（毎日 3:15 JST）。
 * 保存期間は設定画面の audioRetentionDays。
 */
export const purgeExpiredAudio = onSchedule({ region: REGION, schedule: "15 3 * * *", timeZone: "Asia/Tokyo" }, async () => {
  const masters = await loadMasters(true);
  const cutoff = new Date(Date.now() - masters.settings.audioRetentionDays * 86400_000).toISOString();
  const old = await db.collectionGroup("meetings").where("endedAt", "<", cutoff).limit(200).get();
  const bucket = getStorage().bucket();
  let deleted = 0;
  for (const m of old.docs) {
    const data = m.data();
    if (data.audioPurgedAt) continue;
    try {
      await bucket.deleteFiles({ prefix: `audio/${data.caseId}/${data.id}/` });
      await m.ref.update({ audioPurgedAt: nowIso(), audioParts: [] });
      const b = db.batch();
      audit(b, data.caseId, { actor: "system", action: "audio_purged", target: data.id });
      await b.commit();
      deleted++;
    } catch (e) {
      logger.error("audio purge failed", { meetingId: data.id, message: (e as Error).message });
    }
  }
  logger.info("audio purge", { deleted, cutoff });
});
