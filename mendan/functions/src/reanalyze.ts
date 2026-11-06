import { HttpsError, onCall } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import {
  CHECK_ITEM_MASTER,
  CHECK_ITEM_MASTER_BY_ID,
  ENTITY_TYPE_LABELS,
  P,
  buildReanalysisPrompt,
  buildSystemPrompt,
  entityKey,
  mockAnalyze,
  type ReanalysisOutput,
  type ReviewItem,
  type TranscriptSegment,
} from "@mendan/shared";
import { requireCase, requireRole, requireUser } from "./auth.js";
import { AnalyzerError, analyzeFullTranscript, claudeConfigured, type ClaudeUsage } from "./claude.js";
import { AI_MODE, ANTHROPIC_API_KEY, REGION } from "./config.js";
import { budgetStatus, recordClaudeUsage } from "./cost.js";
import { audit, db, loadCaseState, loadMasters, newId, nowIso } from "./db.js";

const SYSTEM_PROMPT = buildSystemPrompt(CHECK_ITEM_MASTER);

/**
 * 面談後の全体再解析（指示書 7-4）
 * 文字起こし全文を Claude で読み直し、リアルタイム解析との差分を「追加確認候補」として登録する。
 * 自動では反映せず、担当者が承認したものだけを反映する。
 */
export const reanalyzeMeeting = onCall(
  { region: REGION, secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 540, memory: "1GiB" },
  async (req) => {
    const actor = await requireUser(req);
    requireRole(actor, ["admin", "staff"]);
    const { caseId, meetingId } = (req.data ?? {}) as { caseId: string; meetingId: string };
    const c = await requireCase(actor, caseId, true);
    if (!c.consent?.aiAnalysis) throw new HttpsError("failed-precondition", "AI解析への同意が記録されていません。");
    const masters = await loadMasters();
    const budget = await budgetStatus(masters.settings);
    if (budget.state === "over") throw new HttpsError("resource-exhausted", "今月のAPI料金が上限に達しているため再解析できません。");

    const meetingRef = db.doc(P.meeting(caseId, meetingId));
    const jobId = newId("job");
    const jobRef = db.collection(P.aiJobs(caseId)).doc(jobId);
    const segs = (await db.collection(P.segments(caseId, meetingId)).orderBy("seq").get()).docs
      .map((d) => d.data() as TranscriptSegment)
      .filter((s) => s.kind === "speech" && !s.suspectedDuplicateOf);
    if (segs.length === 0) throw new HttpsError("failed-precondition", "発言がありません。");
    const state = await loadCaseState(caseId);
    await meetingRef.update({ reanalysis: { status: "running", jobId, at: nowIso() } });
    await jobRef.set({ id: jobId, kind: "reanalysis", caseId, meetingId, status: "running", segmentCount: segs.length, createdBy: actor.uid, createdAt: nowIso(), timings: { serverReceivedAt: Date.now() } });

    const useMock = AI_MODE.value() === "mock";
    if (!useMock && !claudeConfigured()) {
      await meetingRef.update({ reanalysis: { status: "error", jobId, at: nowIso() } });
      throw new HttpsError("failed-precondition", "Claude API キーが設定されていません。");
    }
    const t0 = Date.now();
    let out: ReanalysisOutput;
    let usage: ClaudeUsage | null = null;
    try {
      if (useMock) {
        const a = mockAnalyze({ newSegments: segs, contextSegments: [], entities: state.entities });
        const known = new Set(state.entities.map((e) => e.key));
        out = {
          missing_entities: a.entities.filter((e) => !known.has(entityKey(e.entity_type, Object.fromEntries(e.attributes.map((x) => [x.key, x.value])), e.label))),
          missing_check_items: [],
          contradictions: a.contradictions,
          unasked_topics: [],
          insufficient_items: [],
          possible_transcription_errors: [],
        };
      } else {
        const r = await analyzeFullTranscript(
          SYSTEM_PROMPT,
          buildReanalysisPrompt({ caseInfo: { decedentName: c.decedentName, inheritanceStartDate: c.inheritanceStartDate }, entities: state.entities, checkItems: state.checkItems, segments: segs }),
        );
        out = r.output;
        usage = r.usage;
      }
    } catch (e) {
      const u = (e as { usage?: ClaudeUsage }).usage;
      if (u) await recordClaudeUsage({ caseId, meetingId, jobId, kind: "reanalysis" }, u);
      logger.error("reanalysis failed", { caseId, jobId, message: (e as Error).message });
      await meetingRef.update({ reanalysis: { status: "error", jobId, at: nowIso() } });
      await jobRef.update({ status: "error", error: (e as Error).message });
      throw new HttpsError("internal", e instanceof AnalyzerError ? e.message : "再解析に失敗しました。");
    }

    const valid = new Set(segs.map((s) => s.id));
    const ev = (ids: string[]) => (ids ?? []).filter((id) => valid.has(id));
    const items: Omit<ReviewItem, "id">[] = [];
    const base = { caseId, meetingId, status: "open" as const, createdAt: nowIso(), source: "reanalysis" as const };
    for (const e of out.missing_entities) {
      const evidence = ev(e.evidence_segment_ids);
      if (!evidence.length) continue;
      const attrs = e.attributes.map((a) => `${a.key}=${a.value}`).join("、");
      items.push({ ...base, kind: "reanalysis_missing_entity", title: `抽出漏れの可能性: ${ENTITY_TYPE_LABELS[e.entity_type]}「${e.label}」`, detail: attrs || (e.note ?? ""), evidenceSegmentIds: evidence, proposal: { entities: [e] } });
    }
    for (const ci of out.missing_check_items) {
      const evidence = ev(ci.evidence_segment_ids);
      if (!evidence.length) continue;
      const q = state.checkItems.find((x) => x.id === ci.check_item_id)?.question ?? ci.check_item_id;
      items.push({ ...base, kind: "reanalysis_missing_check", title: `確認事項の反映漏れ: ${q}`, detail: ci.answer, evidenceSegmentIds: evidence, proposal: { check_items: [ci] } });
    }
    for (const x of out.contradictions) {
      const evidence = ev(x.evidence_segment_ids);
      if (!evidence.length) continue;
      items.push({ ...base, kind: "contradiction", title: "前後で矛盾する発言", detail: x.description, evidenceSegmentIds: evidence });
    }
    for (const u of out.unasked_topics) {
      const q = CHECK_ITEM_MASTER_BY_ID.get(u.check_item_id)?.question ?? state.checkItems.find((x) => x.id === u.check_item_id)?.question;
      if (!q) continue;
      items.push({ ...base, kind: "reanalysis_issue", title: `質問されなかった事項: ${q}`, detail: u.reason, evidenceSegmentIds: [] });
    }
    for (const x of out.insufficient_items) {
      items.push({ ...base, kind: "reanalysis_issue", title: "確認が不十分・不整合の可能性", detail: x.issue, evidenceSegmentIds: ev(x.evidence_segment_ids) });
    }
    for (const t of out.possible_transcription_errors) {
      if (!valid.has(t.segment_id)) continue;
      items.push({ ...base, kind: "possible_transcription_error", title: `誤認識の可能性:「${t.suspected}」→「${t.likely}」？`, detail: "録音を聞き直して確認してください。", evidenceSegmentIds: [t.segment_id] });
    }

    const batch = db.batch();
    for (const it of items) {
      const ref = db.collection(P.reviewItems(caseId)).doc();
      batch.set(ref, { ...it, id: ref.id });
    }
    batch.update(meetingRef, { reanalysis: { status: "done", jobId, at: nowIso(), count: items.length } });
    batch.update(jobRef, { status: "done", model: usage?.servedModel ?? "mock", usage, counts: { reviewItems: items.length }, "timings.aiMs": Date.now() - t0 });
    audit(batch, caseId, { actor: actor.uid, action: "reanalysis_done", target: meetingId, detail: { reviewItems: items.length } });
    await batch.commit();
    if (usage) await recordClaudeUsage({ caseId, meetingId, jobId, kind: "reanalysis" }, usage);
    return { jobId, reviewItems: items.length };
  },
);
