import { P, type AppSettings } from "@mendan/shared";
import type { ClaudeUsage } from "./claude.js";
import { GEMINI_USD_PER_AUDIO_HOUR, pricing } from "./config.js";
import { FieldValue, db, monthJst, nowIso } from "./db.js";

/** API使用量の記録（CostLogs）と月次集計・予算チェック */

export function claudeCostUsd(u: ClaudeUsage): number {
  const p = pricing(u.servedModel) ?? pricing(u.model);
  if (!p) return 0;
  return (u.inputTokens * p.input + u.outputTokens * p.output + u.cacheReadTokens * p.cacheRead + u.cacheWriteTokens * p.cacheWrite) / 1_000_000;
}

const keyOf = (model: string) => model.replace(/[./]/g, "_");

/** 相続モードは caseId、顧問モードは clientId（caseId は空）で記録する */
export async function recordClaudeUsage(ref: { caseId: string; clientId?: string; meetingId: string | null; jobId: string; kind: string }, u: ClaudeUsage) {
  const usd = claudeCostUsd(u);
  const month = monthJst();
  const batch = db.batch();
  batch.set(db.collection(P.costLogs()).doc(), {
    ...ref,
    provider: "anthropic",
    model: u.servedModel || u.model,
    inputTokens: u.inputTokens,
    outputTokens: u.outputTokens,
    cacheReadTokens: u.cacheReadTokens,
    cacheWriteTokens: u.cacheWriteTokens,
    fallbackUsed: u.fallbackUsed,
    usd,
    month,
    at: nowIso(),
  });
  const m = keyOf(u.servedModel || u.model);
  batch.set(
    db.doc(P.costSummary(month)),
    {
      month,
      totalUsd: FieldValue.increment(usd),
      claudeCalls: FieldValue.increment(1),
      [`byModel.${m}.usd`]: FieldValue.increment(usd),
      [`byModel.${m}.inputTokens`]: FieldValue.increment(u.inputTokens),
      [`byModel.${m}.outputTokens`]: FieldValue.increment(u.outputTokens),
      [`byModel.${m}.cacheReadTokens`]: FieldValue.increment(u.cacheReadTokens),
      [`byModel.${m}.calls`]: FieldValue.increment(1),
      updatedAt: nowIso(),
    },
    { merge: true },
  );
  if (ref.caseId && ref.meetingId) {
    batch.set(
      db.doc(P.meeting(ref.caseId, ref.meetingId)),
      {
        usage: {
          claudeInputTokens: FieldValue.increment(u.inputTokens),
          claudeOutputTokens: FieldValue.increment(u.outputTokens),
          claudeCacheReadTokens: FieldValue.increment(u.cacheReadTokens),
          claudeCalls: FieldValue.increment(1),
          usd: FieldValue.increment(usd),
        },
      },
      { merge: true },
    );
  }
  await batch.commit();
  return usd;
}

export async function recordAudioUsage(ref: { caseId: string; meetingId: string }, seconds: number) {
  const perHour = Number(GEMINI_USD_PER_AUDIO_HOUR.value()) || 0;
  const usd = (seconds / 3600) * perHour;
  const month = monthJst();
  const batch = db.batch();
  batch.set(db.collection(P.costLogs()).doc(), { ...ref, provider: "google", model: "gemini-live", audioSeconds: seconds, usd, month, at: nowIso(), kind: "transcription" });
  batch.set(
    db.doc(P.costSummary(month)),
    { month, totalUsd: FieldValue.increment(usd), geminiAudioSeconds: FieldValue.increment(seconds), "byModel.gemini-live.usd": FieldValue.increment(usd), updatedAt: nowIso() },
    { merge: true },
  );
  batch.set(db.doc(P.meeting(ref.caseId, ref.meetingId)), { usage: { audioSeconds: FieldValue.increment(seconds), usd: FieldValue.increment(usd) } }, { merge: true });
  await batch.commit();
}

/**
 * 予算チェック。
 *  - 警告ライン超過: 管理者向け通知を1回作成（解析は継続）
 *  - 上限超過: 新しいAI解析を停止（文字起こし・発言保存は継続し、後で再解析できる）
 */
export async function budgetStatus(settings: AppSettings): Promise<{ state: "ok" | "warn" | "over"; spent: number; budget: number }> {
  const month = monthJst();
  const snap = await db.doc(P.costSummary(month)).get();
  const spent = (snap.data()?.totalUsd as number) ?? 0;
  const budget = settings.monthlyBudgetUsd;
  if (!budget || budget <= 0) return { state: "ok", spent, budget };
  const state = spent >= budget ? "over" : spent >= budget * settings.budgetWarnRatio ? "warn" : "ok";
  if (state !== "ok") {
    const id = `budget_${month}_${state}`;
    const ref = db.collection(P.notifications()).doc(id);
    const n = await ref.get();
    if (!n.exists) {
      await ref.set({
        id,
        audience: "admin",
        level: state === "over" ? "error" : "warning",
        title: state === "over" ? "API料金が月間上限に達しました（AI解析を停止中）" : "API料金が月間上限に近づいています",
        body: `今月の概算料金 $${spent.toFixed(2)} / 上限 $${budget}。${state === "over" ? "文字起こしと発言の保存は継続しています。設定画面で上限を変更すると解析を再開できます。" : ""}`,
        createdAt: nowIso(),
        read: false,
      });
    }
  }
  return { state, spent, budget };
}
