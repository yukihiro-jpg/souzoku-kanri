import type { AnalysisOutput, CheckItemOp, EntityOp } from "./analysisSchema.js";
import type { CheckItemMaster } from "./masters/checkItems.js";
import type { DocumentMaster } from "./masters/documents.js";
import type { DocumentRule } from "./masters/rules.js";
import { entityKey, normalizeText } from "./normalize.js";
import { evaluateRules, isActiveEntity } from "./ruleEngine.js";
import type {
  AppSettings,
  AttributeValue,
  CheckItem,
  DocumentRequirement,
  Entity,
  HistoryEntry,
  ReviewItem,
  SuggestedQuestion,
} from "./types.js";
import { AUTO_MANAGED_DOC_STATUSES, ENTITY_TYPE_LABELS } from "./types.js";

/**
 * AI解析結果を案件データへ統合する純粋関数。
 *
 * 守るべき原則（指示書 5. 7.）
 *  - 根拠発言IDのない事実は登録しない
 *  - AIは「確認済み」「該当なし」「必要確定」を設定しない（担当者のみ）
 *  - 担当者が承認・手動確定した情報（lockedByUser）は変更しない。差分は「追加確認候補」にする
 *  - 訂正は古い情報を削除せず、撤回状態＋履歴として残す
 *  - 発言seqの比較により、古い解析結果が新しい情報を上書きしない（処理順序の逆転対策）
 *  - 必要資料はルールエンジンで決定し、重複追加しない
 */

export interface CaseState {
  entities: Entity[];
  checkItems: CheckItem[];
  documents: DocumentRequirement[];
}

export interface MergeContext {
  caseId: string;
  meetingId: string | null;
  actor: string; // 例: "ai:job_xxx" / "user:uid"
  now: string; // ISO
  today: string; // YYYY-MM-DD
  /** 解析対象として渡した発言ID → seq */
  segmentSeq: Map<string, number>;
  rules: DocumentRule[];
  documentMaster: Map<string, DocumentMaster>;
  checkMaster: CheckItemMaster[];
  settings: AppSettings;
  deathDate: string | null;
  newId: (prefix: string) => string;
  /** reanalysis_approved: 担当者が承認した再解析提案の適用（AI扱いだが担当者承認済み） */
  mode: "realtime" | "reanalysis_approved";
}

export type NewReviewItem = Omit<ReviewItem, "id">;

export interface Rejection {
  kind: "entity" | "check_item" | "contradiction" | "question";
  reason:
    | "no_valid_evidence"
    | "unknown_check_item"
    | "stale_result"
    | "retract_target_not_found"
    | "absent_without_target"
    | "locked_by_user";
  detail: string;
}

export interface MergeResult {
  entities: Entity[];
  checkItems: CheckItem[];
  documents: DocumentRequirement[];
  reviewItems: NewReviewItem[];
  questions: Omit<SuggestedQuestion, "id">[];
  rejected: Rejection[];
  warnings: string[];
  maxSeq: number;
}

const HISTORY_LIMIT = 60;

function pushHistory(target: { history: HistoryEntry[] }, h: HistoryEntry) {
  target.history = [...(target.history ?? []), h].slice(-HISTORY_LIMIT);
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function union(a: string[], b: string[]): string[] {
  return [...new Set([...(a ?? []), ...(b ?? [])])];
}

/** 初回: 確認事項マスタから案件の確認事項を作る */
export function initialCheckItems(caseId: string, master: CheckItemMaster[], now: string): CheckItem[] {
  return master.map((m) => ({
    id: m.id,
    caseId,
    category: m.category,
    question: m.question,
    prompt: m.prompt,
    priority: m.priority,
    status: "unconfirmed",
    answer: null,
    aiProposal: null,
    confidence: null,
    evidenceSegmentIds: [],
    entityId: null,
    templateId: null,
    source: "master",
    autoDerived: false,
    obsolete: false,
    lockedByUser: false,
    manualBy: null,
    updatedSeq: 0,
    updatedAt: now,
    history: [],
  }));
}

/** 確認事項の自動候補化の条件（any: いずれかを含む / notAny: いずれも含まない / どちらもなし: 属性がある） */
function matchAuto(e: Entity, a: { attr: string; any?: string; notAny?: string }): boolean {
  const raw = e.attributes[a.attr]?.value;
  const v = raw ? normalizeText(raw) : "";
  const words = (x: string) => x.split("|").map(normalizeText).filter(Boolean);
  if (a.any) return !!v && words(a.any).some((w) => v.includes(w));
  if (a.notAny) return !words(a.notAny).some((w) => v.includes(w));
  return !!v;
}

export function applyAnalysis(state: CaseState, analysis: AnalysisOutput, ctx: MergeContext): MergeResult {
  const entities = new Map(state.entities.map((e) => [e.id, structuredClone(e)]));
  const checkItems = new Map(state.checkItems.map((c) => [c.id, structuredClone(c)]));
  const documents = new Map(state.documents.map((d) => [d.id, structuredClone(d)]));
  const changedE = new Set<string>();
  const changedC = new Set<string>();
  const changedD = new Set<string>();
  const reviewItems: NewReviewItem[] = [];
  const rejected: Rejection[] = [];
  const questions: Omit<SuggestedQuestion, "id">[] = [];
  const warnings: string[] = [];
  const maxSeq = Math.max(0, ...ctx.segmentSeq.values());

  const validEvidence = (ids: string[]) => (ids ?? []).filter((id) => ctx.segmentSeq.has(id));
  const seqOf = (ids: string[]) => Math.max(0, ...ids.map((id) => ctx.segmentSeq.get(id) ?? 0));
  const review = (r: Omit<NewReviewItem, "caseId" | "meetingId" | "status" | "createdAt" | "source">) =>
    reviewItems.push({
      ...r,
      caseId: ctx.caseId,
      meetingId: ctx.meetingId,
      status: "open",
      createdAt: ctx.now,
      source: ctx.mode === "realtime" ? "realtime" : "reanalysis",
    });

  const findByKey = (type: Entity["type"], key: string): Entity | undefined => {
    let fallback: Entity | undefined;
    for (const e of entities.values()) {
      if (e.type !== type || e.key !== key) continue;
      if (e.status !== "retracted" && e.status !== "rejected") return e;
      fallback ??= e;
    }
    return fallback;
  };

  // ---------------- 1. 実体（財産・人物） ----------------
  for (const op of analysis.entities) applyEntityOp(op);

  function applyEntityOp(op: EntityOp) {
    const ev = validEvidence(op.evidence_segment_ids);
    if (ev.length === 0) {
      rejected.push({ kind: "entity", reason: "no_valid_evidence", detail: `${op.entity_type}:${op.label}` });
      return;
    }
    const opSeq = seqOf(ev);
    const attrs: Record<string, string> = {};
    for (const a of op.attributes ?? []) {
      const k = (a.key ?? "").trim();
      const v = (a.value ?? "").trim();
      if (k && v) attrs[k] = v;
    }
    const conf = clamp01(op.confidence);

    let target: Entity | undefined;
    if (op.entity_id) {
      const t = entities.get(op.entity_id);
      if (t && t.type === op.entity_type) target = t;
    }
    const key = entityKey(op.entity_type, attrs, op.label);
    if (!target) target = findByKey(op.entity_type, key);

    // 訂正元
    let corrected: Entity | undefined;
    if (op.corrects_entity_id) {
      const old = entities.get(op.corrects_entity_id);
      if (old && old !== target) corrected = old;
    }

    // 撤回
    if (op.assertion === "retracted") {
      const t = target ?? corrected;
      if (!t) {
        rejected.push({ kind: "entity", reason: "retract_target_not_found", detail: op.label });
        return;
      }
      if (t.lockedByUser) {
        review({
          kind: "correction_on_locked",
          title: `承認済みの「${t.label}」について訂正・撤回の発言があります`,
          detail: op.note ?? "AIは承認済み情報を変更していません。内容を確認してください。",
          evidenceSegmentIds: ev,
          proposal: { entities: [op] },
        });
        rejected.push({ kind: "entity", reason: "locked_by_user", detail: t.label });
        return;
      }
      if (t.updatedSeq > opSeq) {
        rejected.push({ kind: "entity", reason: "stale_result", detail: t.label });
        return;
      }
      pushHistory(t, { at: ctx.now, by: ctx.actor, action: "retracted", before: t.status, after: "retracted", evidenceSegmentIds: ev, note: op.note ?? undefined });
      t.status = "retracted";
      t.assertion = "retracted";
      t.evidenceSegmentIds = union(t.evidenceSegmentIds, ev);
      t.updatedSeq = Math.max(t.updatedSeq, opSeq);
      t.updatedAt = ctx.now;
      changedE.add(t.id);
      return;
    }

    if (op.assertion === "absent" && !target) {
      // 「〜はありません」は確認事項側で扱う（実体は作らない）
      rejected.push({ kind: "entity", reason: "absent_without_target", detail: op.label });
      return;
    }

    if (target?.lockedByUser) {
      const diffs = Object.entries(attrs).filter(([k, v]) => target!.attributes[k]?.value !== v);
      if (diffs.length > 0 || (op.assertion !== target.assertion && op.assertion !== "unknown")) {
        review({
          kind: "ai_update_on_locked",
          title: `承認済みの「${target.label}」と異なる発言があります`,
          detail: diffs.map(([k, v]) => `${k}: 「${target!.attributes[k]?.value ?? "（なし）"}」→「${v}」`).join(" / ") || `状態: ${op.assertion}`,
          evidenceSegmentIds: ev,
          proposal: { entities: [{ ...op, entity_id: target.id }] },
        });
      }
      rejected.push({ kind: "entity", reason: "locked_by_user", detail: target.label });
      handleCorrection(corrected, target, op, ev, opSeq);
      return;
    }

    if (target) {
      if (target.updatedSeq > opSeq && (target.status === "retracted" || target.status === "rejected")) {
        rejected.push({ kind: "entity", reason: "stale_result", detail: target.label });
        return;
      }
      if (target.status === "rejected") {
        // 担当者が却下した実体はAIが復活させない（追加確認候補にする）
        review({
          kind: "ai_update_on_locked",
          title: `却下済みの「${target.label}」について再び発言があります`,
          detail: "内容を確認してください。",
          evidenceSegmentIds: ev,
          proposal: { entities: [op] },
        });
        return;
      }
      const t = target;
      if (t.status === "retracted") {
        pushHistory(t, { at: ctx.now, by: ctx.actor, action: "reasserted", before: "retracted", after: "ai_candidate", evidenceSegmentIds: ev });
        t.status = "ai_candidate";
        t.supersededBy = null;
      }
      for (const [k, v] of Object.entries(attrs)) mergeAttr(t, k, v, ev, opSeq);
      // assertion: 新しい発言のみ反映。「可能性」発言で「ある」を弱めない
      if (opSeq >= t.updatedSeq) {
        if (!(t.assertion === "present" && op.assertion === "unknown")) {
          if (t.assertion !== op.assertion) pushHistory(t, { at: ctx.now, by: ctx.actor, action: "assertion", before: t.assertion, after: op.assertion, evidenceSegmentIds: ev });
          t.assertion = op.assertion;
        }
        t.confidence = conf;
        if (op.label && op.label !== t.label) t.label = op.label;
        if (op.note) t.note = op.note;
      }
      t.evidenceSegmentIds = union(t.evidenceSegmentIds, ev);
      t.updatedSeq = Math.max(t.updatedSeq, opSeq);
      t.updatedAt = ctx.now;
      if (ctx.meetingId && !t.meetingIds.includes(ctx.meetingId)) t.meetingIds.push(ctx.meetingId);
      const newKey = entityKey(t.type, Object.fromEntries(Object.entries(t.attributes).map(([k, a]) => [k, a.value])), t.label);
      if (newKey !== t.key && !findByKeyOther(t.type, newKey, t.id)) t.key = newKey;
      changedE.add(t.id);
      handleCorrection(corrected, t, op, ev, opSeq);
      return;
    }

    // 新規
    const id = ctx.newId("ent");
    const e: Entity = {
      id,
      caseId: ctx.caseId,
      type: op.entity_type,
      key,
      label: op.label || ENTITY_TYPE_LABELS[op.entity_type],
      assertion: op.assertion,
      attributes: {},
      status: "ai_candidate",
      confidence: conf,
      evidenceSegmentIds: ev,
      lockedByUser: false,
      confirmedBy: null,
      supersedes: null,
      supersededBy: null,
      contradiction: false,
      note: op.note ?? null,
      meetingIds: ctx.meetingId ? [ctx.meetingId] : [],
      updatedSeq: opSeq,
      createdAt: ctx.now,
      updatedAt: ctx.now,
      history: [{ at: ctx.now, by: ctx.actor, action: "created", evidenceSegmentIds: ev }],
    };
    for (const [k, v] of Object.entries(attrs)) mergeAttr(e, k, v, ev, opSeq);
    entities.set(id, e);
    changedE.add(id);
    handleCorrection(corrected, e, op, ev, opSeq);
  }

  function findByKeyOther(type: Entity["type"], key: string, selfId: string) {
    for (const e of entities.values()) if (e.id !== selfId && e.type === type && e.key === key && e.status !== "retracted") return e;
    return undefined;
  }

  function mergeAttr(e: Entity, k: string, v: string, ev: string[], seq: number) {
    const cur: AttributeValue | undefined = e.attributes[k];
    if (!cur) {
      e.attributes[k] = { value: v, evidenceSegmentIds: ev, updatedSeq: seq, source: "ai", history: [] };
      return;
    }
    if (cur.source === "user") return; // 手動入力値は変更しない
    if (cur.updatedSeq > seq) return; // 古い結果
    if (cur.value === v) {
      cur.evidenceSegmentIds = union(cur.evidenceSegmentIds, ev);
      cur.updatedSeq = Math.max(cur.updatedSeq, seq);
      return;
    }
    // 値の訂正：旧値を履歴に残す
    cur.history = [...(cur.history ?? []), { value: cur.value, evidenceSegmentIds: cur.evidenceSegmentIds, at: ctx.now, by: ctx.actor }].slice(-20);
    cur.value = v;
    cur.evidenceSegmentIds = ev;
    cur.updatedSeq = seq;
  }

  function handleCorrection(old: Entity | undefined, replacement: Entity, op: EntityOp, ev: string[], opSeq: number) {
    if (!old) return;
    if (old.lockedByUser) {
      review({
        kind: "correction_on_locked",
        title: `承認済みの「${old.label}」が「${replacement.label}」に訂正された可能性があります`,
        detail: "AIは承認済み情報を変更していません。訂正を反映する場合は承認済み情報を手動で修正してください。",
        evidenceSegmentIds: ev,
        proposal: { entities: [op] },
      });
      return;
    }
    if (old.updatedSeq > opSeq) {
      rejected.push({ kind: "entity", reason: "stale_result", detail: `訂正: ${old.label}` });
      return;
    }
    pushHistory(old, {
      at: ctx.now,
      by: ctx.actor,
      action: "corrected",
      before: old.label,
      after: replacement.label,
      evidenceSegmentIds: ev,
      note: `「${replacement.label}」に訂正`,
    });
    old.status = "retracted";
    old.assertion = "retracted";
    old.supersededBy = replacement.id;
    old.updatedSeq = Math.max(old.updatedSeq, opSeq);
    old.updatedAt = ctx.now;
    replacement.supersedes = old.id;
    changedE.add(old.id);
    changedE.add(replacement.id);
  }

  // ---------------- 2. 確認事項 ----------------
  for (const op of analysis.check_items) applyCheckOp(op);

  function applyCheckOp(op: CheckItemOp) {
    const item = checkItems.get(op.check_item_id);
    if (!item) {
      rejected.push({ kind: "check_item", reason: "unknown_check_item", detail: op.check_item_id });
      return;
    }
    const ev = validEvidence(op.evidence_segment_ids);
    if (ev.length === 0) {
      rejected.push({ kind: "check_item", reason: "no_valid_evidence", detail: op.check_item_id });
      return;
    }
    const opSeq = seqOf(ev);
    if (item.lockedByUser) {
      const statusDiff = op.status === "contradiction" || op.status === "unknown_answer" || (op.status === "not_applicable" && item.status !== "not_applicable");
      if (statusDiff || (op.answer && item.answer && op.answer !== item.answer && op.status !== "answered")) {
        review({
          kind: "ai_update_on_locked",
          title: `確認済みの「${item.question}」と異なる発言があります`,
          detail: `担当者の確認内容: ${item.answer ?? "（記載なし）"} / 発言: ${op.answer}`,
          evidenceSegmentIds: ev,
          proposal: { check_items: [op] },
        });
      }
      rejected.push({ kind: "check_item", reason: "locked_by_user", detail: item.id });
      return;
    }
    if (item.updatedSeq > opSeq) {
      rejected.push({ kind: "check_item", reason: "stale_result", detail: item.id });
      return;
    }
    const before = { status: item.status, answer: item.answer };
    switch (op.status) {
      case "answered":
        item.status = "ai_candidate";
        item.aiProposal = "answered";
        break;
      case "not_applicable":
        item.status = "ai_candidate"; // 「該当なし」の確定は担当者
        item.aiProposal = "not_applicable";
        break;
      case "unknown_answer":
        item.status = "needs_followup";
        item.aiProposal = "unknown_answer";
        break;
      case "needs_followup":
        item.status = "needs_followup";
        break;
      case "contradiction":
        item.status = "contradiction";
        break;
    }
    item.answer = op.answer || item.answer;
    item.confidence = clamp01(op.confidence);
    item.evidenceSegmentIds = union(item.evidenceSegmentIds, ev);
    item.updatedSeq = opSeq;
    item.updatedAt = ctx.now;
    item.autoDerived = false;
    pushHistory(item, { at: ctx.now, by: ctx.actor, action: "ai_update", before, after: { status: item.status, answer: item.answer }, evidenceSegmentIds: ev });
    changedC.add(item.id);
  }

  // ---------------- 3. 矛盾・誤認識候補 ----------------
  for (const c of analysis.contradictions) {
    const ev = validEvidence(c.evidence_segment_ids);
    if (ev.length === 0) {
      rejected.push({ kind: "contradiction", reason: "no_valid_evidence", detail: c.description });
      continue;
    }
    review({ kind: "contradiction", title: "前後で矛盾する可能性のある発言", detail: c.description, evidenceSegmentIds: ev, proposal: { contradiction: c } });
    for (const id of c.entity_ids) {
      const e = entities.get(id);
      if (e && !e.lockedByUser && !e.contradiction) {
        e.contradiction = true;
        e.updatedAt = ctx.now;
        changedE.add(id);
      }
    }
    for (const id of c.check_item_ids) {
      const it = checkItems.get(id);
      if (it && !it.lockedByUser && it.status !== "contradiction") {
        pushHistory(it, { at: ctx.now, by: ctx.actor, action: "contradiction", before: it.status, after: "contradiction", evidenceSegmentIds: ev, note: c.description });
        it.status = "contradiction";
        it.evidenceSegmentIds = union(it.evidenceSegmentIds, ev);
        it.updatedAt = ctx.now;
        changedC.add(id);
      }
    }
  }
  for (const t of analysis.possible_transcription_errors) {
    if (!ctx.segmentSeq.has(t.segment_id)) continue;
    review({
      kind: "possible_transcription_error",
      title: `誤認識の可能性:「${t.suspected}」→「${t.likely}」？`,
      detail: "録音を聞き直して確認してください。",
      evidenceSegmentIds: [t.segment_id],
    });
  }

  // ---------------- 4. 財産の存在から確認事項を自動候補化 ----------------
  const all = [...entities.values()];
  for (const m of ctx.checkMaster) {
    if (!m.autoFromEntityTypes?.length && !m.autoFrom?.length) continue;
    const item = checkItems.get(m.id);
    if (!item || item.lockedByUser) continue;
    const related = all.filter((e) => isActiveEntity(e) && e.assertion === "present" && (m.autoFromEntityTypes?.includes(e.type) || (m.autoFrom ?? []).some((a) => a.type === e.type && matchAuto(e, a))));
    if (related.length === 0) {
      if (item.autoDerived && item.status === "ai_candidate") {
        // 根拠となる財産がすべて撤回された
        pushHistory(item, { at: ctx.now, by: "rule", action: "auto_reverted", before: item.status, after: "unconfirmed" });
        item.status = "unconfirmed";
        item.answer = null;
        item.autoDerived = false;
        item.evidenceSegmentIds = [];
        item.updatedAt = ctx.now;
        changedC.add(item.id);
      }
      continue;
    }
    if (item.status !== "unconfirmed" && !(item.autoDerived && item.status === "ai_candidate")) continue;
    const answer = related.map((e) => e.label).join("、");
    const ev = union([], related.flatMap((e) => e.evidenceSegmentIds));
    if (item.status === "ai_candidate" && item.answer === answer) continue;
    pushHistory(item, { at: ctx.now, by: "rule", action: "auto_from_entities", before: { status: item.status, answer: item.answer }, after: { status: "ai_candidate", answer } });
    item.status = "ai_candidate";
    item.aiProposal = "answered";
    item.answer = answer;
    item.autoDerived = true;
    item.evidenceSegmentIds = ev;
    item.updatedSeq = Math.max(item.updatedSeq, maxSeq);
    item.updatedAt = ctx.now;
    changedC.add(item.id);
  }

  // ---------------- 5. ルールエンジンで必要資料・追加確認項目を判定 ----------------
  const ruleOut = evaluateRules({
    entities: all,
    rules: ctx.rules,
    documents: ctx.documentMaster,
    settings: ctx.settings,
    deathDate: ctx.deathDate,
    today: ctx.today,
  });
  warnings.push(...ruleOut.warnings);

  const desiredFu = new Map(ruleOut.followUps.map((f) => [`fu__${f.id}`, f]));
  for (const [id, f] of desiredFu) {
    const cur = checkItems.get(id);
    if (!cur) {
      checkItems.set(id, {
        id,
        caseId: ctx.caseId,
        category: f.category,
        question: f.question,
        prompt: f.prompt,
        priority: f.priority,
        status: f.answered ? "ai_candidate" : "unconfirmed",
        answer: f.answer,
        aiProposal: f.answered ? "answered" : null,
        confidence: null,
        evidenceSegmentIds: f.evidenceSegmentIds,
        entityId: f.entityId,
        templateId: f.templateId,
        source: "rule",
        autoDerived: f.answered,
        obsolete: false,
        lockedByUser: false,
        manualBy: null,
        updatedSeq: maxSeq,
        updatedAt: ctx.now,
        history: [{ at: ctx.now, by: "rule", action: "created" }],
      });
      changedC.add(id);
      continue;
    }
    if (cur.lockedByUser) continue;
    let changed = false;
    if (cur.obsolete) {
      cur.obsolete = false;
      changed = true;
    }
    if (cur.question !== f.question) {
      cur.question = f.question;
      cur.prompt = f.prompt;
      changed = true;
    }
    if (f.answered && (cur.status === "unconfirmed" || (cur.autoDerived && cur.answer !== f.answer))) {
      cur.status = "ai_candidate";
      cur.aiProposal = "answered";
      cur.answer = f.answer;
      cur.autoDerived = true;
      cur.evidenceSegmentIds = union(cur.evidenceSegmentIds, f.evidenceSegmentIds);
      changed = true;
    }
    if (changed) {
      cur.updatedAt = ctx.now;
      changedC.add(id);
    }
  }
  for (const cur of checkItems.values()) {
    if (cur.source !== "rule" || desiredFu.has(cur.id) || cur.obsolete || cur.lockedByUser) continue;
    cur.obsolete = true;
    cur.updatedAt = ctx.now;
    pushHistory(cur, { at: ctx.now, by: "rule", action: "obsolete", note: "対象の財産が訂正・撤回されたため" });
    changedC.add(cur.id);
  }

  const desiredDocs = new Map(ruleOut.documents.map((d) => [d.id, d]));
  for (const [id, d] of desiredDocs) {
    const cur = documents.get(id);
    if (!cur) {
      documents.set(id, {
        id,
        caseId: ctx.caseId,
        documentId: d.documentId,
        name: d.name,
        category: d.category,
        target: d.target,
        reasons: d.reasons,
        ruleIds: d.ruleIds,
        ruleVersions: d.ruleVersions,
        fromUnapprovedRule: d.fromUnapprovedRule,
        entityId: d.entityId,
        period: d.period,
        periodSpec: d.periodSpec,
        submitter: d.submitter,
        dueDate: null,
        status: "candidate",
        decidedBy: "rule",
        evidenceSegmentIds: d.evidenceSegmentIds,
        importance: d.importance,
        remarks: d.tentative ? "可能性ベースの候補（要確認）" : null,
        source: d.source,
        howTo: d.howTo,
        lockedByUser: false,
        needsReview: false,
        createdAt: ctx.now,
        updatedAt: ctx.now,
        history: [{ at: ctx.now, by: "rule", action: "created", evidenceSegmentIds: d.evidenceSegmentIds, note: d.ruleIds.join(",") }],
      });
      changedD.add(id);
      continue;
    }
    if (cur.lockedByUser || !AUTO_MANAGED_DOC_STATUSES.includes(cur.status)) continue;
    let changed = false;
    if (cur.status === "removal_candidate") {
      pushHistory(cur, { at: ctx.now, by: "rule", action: "restored", before: "removal_candidate", after: "candidate" });
      cur.status = "candidate";
      changed = true;
    }
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    if (cur.name !== d.name || cur.target !== d.target || !same(cur.reasons, d.reasons) || !same(cur.ruleIds, d.ruleIds) || cur.period !== d.period || !same(cur.evidenceSegmentIds, d.evidenceSegmentIds)) {
      cur.name = d.name;
      cur.target = d.target;
      cur.reasons = d.reasons;
      cur.ruleIds = d.ruleIds;
      cur.ruleVersions = d.ruleVersions;
      cur.period = d.period;
      cur.periodSpec = d.periodSpec;
      cur.evidenceSegmentIds = d.evidenceSegmentIds;
      cur.importance = d.importance;
      cur.fromUnapprovedRule = d.fromUnapprovedRule;
      cur.source = d.source;
      cur.remarks = d.tentative ? "可能性ベースの候補（要確認）" : null;
      changed = true;
    }
    if (changed) {
      cur.updatedAt = ctx.now;
      changedD.add(id);
    }
  }
  for (const cur of documents.values()) {
    if (desiredDocs.has(cur.id)) continue;
    if (cur.status === "candidate" && !cur.lockedByUser) {
      pushHistory(cur, { at: ctx.now, by: "rule", action: "removal_candidate", before: "candidate", after: "removal_candidate", note: "根拠となる発言が訂正・撤回されたため" });
      cur.status = "removal_candidate";
      cur.updatedAt = ctx.now;
      changedD.add(cur.id);
    } else if ((cur.lockedByUser || !AUTO_MANAGED_DOC_STATUSES.includes(cur.status)) && !cur.needsReview && cur.entityId) {
      // 承認済み資料は変更せず、確認を促す
      cur.needsReview = true;
      cur.updatedAt = ctx.now;
      changedD.add(cur.id);
      review({
        kind: "correction_on_locked",
        title: `「${cur.name}」の根拠が訂正・撤回されました`,
        detail: "この資料は担当者が確定済みのため、AIは変更していません。要否を確認してください。",
        evidenceSegmentIds: [],
      });
    }
  }

  // ---------------- 6. 次の質問（AI提案） ----------------
  for (const q of analysis.suggested_questions) {
    if (!q.question?.trim()) continue;
    if (q.check_item_id && !checkItems.has(q.check_item_id)) q.check_item_id = null;
    questions.push({
      question: q.question.trim(),
      checkItemId: q.check_item_id,
      priority: q.priority,
      reason: q.reason,
      source: "ai",
      status: "open",
      createdSeq: maxSeq,
      updatedAt: ctx.now,
    });
  }

  return {
    entities: [...changedE].map((id) => entities.get(id)!),
    checkItems: [...changedC].map((id) => checkItems.get(id)!),
    documents: [...changedD].map((id) => documents.get(id)!),
    reviewItems,
    questions,
    rejected,
    warnings,
    maxSeq,
  };
}
