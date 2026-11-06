import { HttpsError, onCall } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import {
  CHECK_ITEM_MASTER,
  P,
  applyAnalysis,
  buildSystemPrompt,
  buildUserPrompt,
  mockAnalyze,
  type AnalysisOutput,
  type Meeting,
  type SuggestedQuestion,
  type TranscriptSegment,
} from "@mendan/shared";
import { requireCase, requireRole, requireUser } from "./auth.js";
import { AnalyzerError, analyzeRealtime, claudeConfigured, type ClaudeUsage } from "./claude.js";
import { AI_MODE, ANTHROPIC_API_KEY, REGION } from "./config.js";
import { budgetStatus, recordClaudeUsage } from "./cost.js";
import { audit, db, deathDateOf, loadCaseState, loadMasters, newId, nowIso, todayJst } from "./db.js";

const SYSTEM_PROMPT = buildSystemPrompt(CHECK_ITEM_MASTER);
const CONTEXT_SEGMENTS = 12;
const MAX_SEGMENTS_PER_CALL = 20;

/**
 * リアルタイム解析（確定した発言 → Claude → ルールエンジン → Firestore）
 *
 * 入力は発言IDのみ。発言本文はサーバーが Firestore から読む（改ざん防止）。
 * 送信するのは「新しい発言 + 直近の会話 + 案件の抽出済み情報」で、全文は送らない。
 */
export const analyzeSegments = onCall(
  { region: REGION, secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 120, memory: "512MiB", concurrency: 20 },
  async (req) => {
    const t0 = Date.now();
    const actor = await requireUser(req);
    requireRole(actor, ["admin", "staff"]);
    const { caseId, meetingId, segmentIds, clientRequestedAt } = (req.data ?? {}) as {
      caseId: string;
      meetingId: string;
      segmentIds: string[];
      clientRequestedAt?: number;
    };
    const caseDoc = await requireCase(actor, caseId, true);
    if (!caseDoc.consent?.aiAnalysis) throw new HttpsError("failed-precondition", "AI解析への同意が記録されていません。");
    if (!Array.isArray(segmentIds) || segmentIds.length === 0) throw new HttpsError("invalid-argument", "segmentIds が必要です。");
    if (segmentIds.length > MAX_SEGMENTS_PER_CALL) throw new HttpsError("invalid-argument", "一度に解析できる発言数を超えています。");

    const meetingRef = db.doc(P.meeting(caseId, meetingId));
    const masters = await loadMasters();
    const jobId = newId("job");
    const jobRef = db.collection(P.aiJobs(caseId)).doc(jobId);

    // 対象発言を読む
    const segSnaps = await db.getAll(...segmentIds.map((id) => db.doc(P.segment(caseId, meetingId, id))));
    const newSegs = segSnaps.filter((s) => s.exists).map((s) => s.data() as TranscriptSegment).filter((s) => s.kind === "speech" && !s.suspectedDuplicateOf);
    if (newSegs.length === 0) return { jobId: null, skipped: "no_segments" };
    newSegs.sort((a, b) => a.seq - b.seq);
    const minSeq = newSegs[0].seq;

    // 予算チェック（上限超過時は解析を止めるが、発言は保存済みなので失われない）
    const budget = await budgetStatus(masters.settings);
    if (budget.state === "over") {
      const b = db.batch();
      for (const s of newSegs) b.update(db.doc(P.segment(caseId, meetingId, s.id)), { analysisStatus: "skipped" });
      await b.commit();
      return { jobId: null, skipped: "budget_exceeded", budget };
    }

    const [ctxSnap, stateBefore] = await Promise.all([
      db.collection(P.segments(caseId, meetingId)).where("seq", "<", minSeq).orderBy("seq", "desc").limit(CONTEXT_SEGMENTS).get(),
      loadCaseState(caseId),
    ]);
    const contextSegs = ctxSnap.docs.map((d) => d.data() as TranscriptSegment).filter((s) => s.kind === "speech").reverse();

    {
      const b = db.batch();
      for (const s of newSegs) b.update(db.doc(P.segment(caseId, meetingId, s.id)), { analysisStatus: "analyzing", analysisJobId: jobId });
      b.set(jobRef, {
        id: jobId,
        kind: "realtime",
        caseId,
        meetingId,
        segmentIds: newSegs.map((s) => s.id),
        maxSeq: newSegs[newSegs.length - 1].seq,
        status: "running",
        mode: AI_MODE.value(),
        createdBy: actor.uid,
        timings: { clientRequestedAt: clientRequestedAt ?? null, serverReceivedAt: t0 },
        createdAt: nowIso(),
      });
      await b.commit();
    }

    // ---- AI 解析 ----
    const mode = AI_MODE.value() === "mock" || !claudeConfigured() ? "mock" : "claude";
    if (mode === "mock" && AI_MODE.value() !== "mock") {
      await markError(jobRef, newSegs, caseId, meetingId, "ANTHROPIC_API_KEY が未設定です（AI_MODE=mock で簡易解析を使えます）");
      throw new HttpsError("failed-precondition", "Claude API キーが設定されていません。");
    }
    const userPrompt = buildUserPrompt({
      caseInfo: { decedentName: caseDoc.decedentName, inheritanceStartDate: caseDoc.inheritanceStartDate },
      entities: stateBefore.entities,
      checkItems: stateBefore.checkItems,
      contextSegments: contextSegs,
      newSegments: newSegs,
    });
    const tAi = Date.now();
    let output: AnalysisOutput;
    let usage: ClaudeUsage | null = null;
    try {
      if (mode === "mock") {
        output = mockAnalyze({ newSegments: newSegs, contextSegments: contextSegs, entities: stateBefore.entities });
      } else {
        const r = await analyzeRealtime(SYSTEM_PROMPT, userPrompt);
        output = r.output;
        usage = r.usage;
      }
    } catch (e) {
      const u = (e as { usage?: ClaudeUsage }).usage;
      if (u) await recordClaudeUsage({ caseId, meetingId, jobId, kind: "realtime" }, u);
      const msg = e instanceof AnalyzerError ? e.message : "AI解析で予期しないエラーが発生しました";
      logger.error("analyze failed", { caseId, meetingId, jobId, code: (e as AnalyzerError).code, message: (e as Error).message });
      await markError(jobRef, newSegs, caseId, meetingId, msg);
      throw new HttpsError(e instanceof AnalyzerError && e.retryable ? "unavailable" : "internal", msg, { retryable: e instanceof AnalyzerError ? e.retryable : true });
    }
    const tAiEnd = Date.now();

    // ---- 統合（トランザクション内で最新状態を読み直してから適用） ----
    const segmentSeq = new Map([...contextSegs, ...newSegs].map((s) => [s.id, s.seq]));
    const result = await db.runTransaction(async (tx) => {
      const state = await loadCaseState(caseId, tx);
      const meetingSnap = await tx.get(meetingRef);
      const meeting = meetingSnap.data() as Meeting;
      const r = applyAnalysis(state, output, {
        caseId,
        meetingId,
        actor: `ai:${jobId}`,
        now: nowIso(),
        today: todayJst(),
        segmentSeq,
        rules: masters.rules,
        documentMaster: masters.docs,
        checkMaster: CHECK_ITEM_MASTER,
        settings: masters.settings,
        deathDate: deathDateOf(caseDoc, state.entities),
        newId,
        mode: "realtime",
      });
      for (const e of r.entities) tx.set(db.doc(`${P.entities(caseId)}/${e.id}`), e);
      for (const c of r.checkItems) tx.set(db.doc(`${P.checkItems(caseId)}/${c.id}`), c);
      for (const d of r.documents) tx.set(db.doc(`${P.documents(caseId)}/${d.id}`), d);
      for (const ri of r.reviewItems) {
        const ref = db.collection(P.reviewItems(caseId)).doc();
        tx.set(ref, { ...ri, id: ref.id });
      }
      // 次の質問: 新しい発言に基づく結果のときだけ置き換える（順序逆転で古い提案に戻らない）
      if (r.questions.length > 0 && r.maxSeq >= (meeting.questionsSeq ?? 0)) {
        const qs: SuggestedQuestion[] = r.questions.map((q, i) => ({ ...q, id: `${jobId}_${i}` }));
        tx.update(meetingRef, { aiQuestions: qs, questionsSeq: r.maxSeq });
      }
      audit(tx, caseId, {
        actor: `ai:${jobId}`,
        action: "ai_analysis_applied",
        target: meetingId,
        detail: {
          entities: r.entities.map((e) => e.id),
          checkItems: r.checkItems.map((c) => c.id),
          documents: r.documents.map((d) => d.id),
          reviewItems: r.reviewItems.length,
          rejected: r.rejected.length,
        },
      });
      return r;
    });
    const tApplied = Date.now();

    const b = db.batch();
    for (const s of newSegs) b.update(db.doc(P.segment(caseId, meetingId, s.id)), { analysisStatus: "done" });
    b.update(jobRef, {
      status: "done",
      model: usage?.servedModel ?? "mock",
      usage: usage ?? null,
      rejected: result.rejected,
      warnings: result.warnings,
      counts: {
        entities: result.entities.length,
        checkItems: result.checkItems.length,
        documents: result.documents.length,
        reviewItems: result.reviewItems.length,
        rawEntities: output.entities.length,
        rawCheckItems: output.check_items.length,
      },
      "timings.aiStartAt": tAi,
      "timings.aiEndAt": tAiEnd,
      "timings.appliedAt": tApplied,
      "timings.aiMs": tAiEnd - tAi,
      "timings.serverMs": tApplied - t0,
    });
    await b.commit();
    if (usage) await recordClaudeUsage({ caseId, meetingId, jobId, kind: "realtime" }, usage);

    logger.info("analyze done", { caseId, jobId, aiMs: tAiEnd - tAi, serverMs: tApplied - t0, rejected: result.rejected.length });
    return {
      jobId,
      mode,
      aiMs: tAiEnd - tAi,
      serverMs: tApplied - t0,
      changed: { entities: result.entities.length, checkItems: result.checkItems.length, documents: result.documents.length },
      rejected: result.rejected.length,
      budget: budget.state,
    };
  },
);

async function markError(jobRef: FirebaseFirestore.DocumentReference, segs: TranscriptSegment[], caseId: string, meetingId: string, message: string) {
  const b = db.batch();
  for (const s of segs) b.update(db.doc(P.segment(caseId, meetingId, s.id)), { analysisStatus: "error" });
  b.update(jobRef, { status: "error", error: message, finishedAt: nowIso() });
  await b.commit();
}
