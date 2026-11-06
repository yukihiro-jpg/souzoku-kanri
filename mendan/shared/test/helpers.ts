import {
  CHECK_ITEM_MASTER,
  DEFAULT_RULES,
  DEFAULT_SETTINGS,
  DOCUMENT_MASTER_BY_ID,
  EMPTY_ANALYSIS,
  applyAnalysis,
  initialCheckItems,
  type AnalysisOutput,
  type CaseState,
  type EntityOp,
  type MergeContext,
  type MergeResult,
  type TranscriptSegment,
} from "../src/index.js";

export function seg(seq: number, text: string, speaker: TranscriptSegment["speaker"] = "client"): TranscriptSegment {
  return {
    id: `seg_${String(seq).padStart(4, "0")}`,
    caseId: "case1",
    meetingId: "m1",
    seq,
    speaker,
    speakerLabel: null,
    speakerConfirmed: true,
    text,
    final: true,
    kind: "speech",
    analysisStatus: "pending",
    timings: { finalAt: seq * 1000 },
    createdAt: new Date(seq * 1000).toISOString(),
    createdBy: "u1",
  };
}

export function newState(): CaseState {
  return { entities: [], checkItems: initialCheckItems("case1", CHECK_ITEM_MASTER, "2026-11-06T00:00:00.000Z"), documents: [] };
}

let counter = 0;
export function ctx(segments: TranscriptSegment[], over: Partial<MergeContext> = {}): MergeContext {
  return {
    caseId: "case1",
    meetingId: "m1",
    actor: "ai:test",
    now: "2026-11-06T10:00:00.000Z",
    today: "2026-11-06",
    segmentSeq: new Map(segments.map((s) => [s.id, s.seq])),
    rules: DEFAULT_RULES,
    documentMaster: DOCUMENT_MASTER_BY_ID,
    checkMaster: CHECK_ITEM_MASTER,
    settings: DEFAULT_SETTINGS,
    deathDate: "2026-08-20",
    newId: (p) => `${p}_${++counter}`,
    mode: "realtime",
    ...over,
  };
}

export function analysis(part: Partial<AnalysisOutput>): AnalysisOutput {
  return { ...structuredClone(EMPTY_ANALYSIS), ...part };
}

export function entityOp(o: Partial<EntityOp> & Pick<EntityOp, "entity_type" | "label" | "evidence_segment_ids">): EntityOp {
  return { entity_id: null, assertion: "present", attributes: [], corrects_entity_id: null, confidence: 0.9, note: null, ...o };
}

/** applyAnalysis の結果を state に反映（Firestore 書き込みの代わり） */
export function commit(state: CaseState, r: MergeResult): CaseState {
  const up = <T extends { id: string }>(base: T[], changes: T[]) => {
    const m = new Map(base.map((x) => [x.id, x]));
    for (const c of changes) m.set(c.id, c);
    return [...m.values()];
  };
  return { entities: up(state.entities, r.entities), checkItems: up(state.checkItems, r.checkItems), documents: up(state.documents, r.documents) };
}

export function run(state: CaseState, a: AnalysisOutput, segments: TranscriptSegment[], over: Partial<MergeContext> = {}) {
  const r = applyAnalysis(state, a, ctx(segments, over));
  return { result: r, state: commit(state, r) };
}
