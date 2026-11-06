import type { Condition, DocumentRule, FollowUpTemplate } from "./masters/rules.js";
import type { DocumentMaster } from "./masters/documents.js";
import { canonicalName, fillTemplate, normalizeText } from "./normalize.js";
import { describePeriod } from "./period.js";
import type { AppSettings, CategoryId, Entity, PeriodSpec, Priority } from "./types.js";
import { PRIORITY_ORDER } from "./types.js";

/**
 * 必要資料判定エンジン（決定的・AI非依存）
 *
 * 入力: 案件の実体（AIが抽出し、根拠発言のあるもの） + ルールマスタ + 資料マスタ
 * 出力: 必要と判定された資料の一覧（documentId × 対象実体 で一意 → 重複追加しない）
 */

export interface DesiredDocument {
  id: string;
  documentId: string;
  name: string;
  category: CategoryId;
  target: string | null;
  entityId: string | null;
  reasons: string[];
  ruleIds: string[];
  ruleVersions: Record<string, number>;
  fromUnapprovedRule: boolean;
  importance: Priority;
  periodSpec: PeriodSpec | null;
  period: string | null;
  evidenceSegmentIds: string[];
  source: string;
  howTo: string;
  submitter: string;
  /** 可能性ベース（unknown）の実体から出た候補 */
  tentative: boolean;
}

export interface DesiredFollowUp {
  id: string;
  templateId: string;
  entityId: string;
  question: string;
  prompt: string;
  priority: Priority;
  category: CategoryId;
  answered: boolean;
  evidenceSegmentIds: string[];
  answer: string | null;
}

export function entityAttr(e: Entity, attr: string): string | undefined {
  const v = e.attributes[attr]?.value;
  return v === undefined || v === null || v === "" ? undefined : v;
}

export function entityTarget(e: Entity): string {
  const a = (k: string) => entityAttr(e, k);
  switch (e.type) {
    case "bank_account":
    case "listed_security":
      return canonicalName(a("institution") ?? e.label);
    case "real_estate": {
      const loc = a("address_detail") ?? a("location") ?? e.label;
      const usage = a("usage");
      return usage ? `${loc}（${usage}）` : loc;
    }
    case "unlisted_share":
      return a("company") ?? e.label;
    case "life_insurance":
      return a("insurer") ?? e.label;
    case "retirement_allowance":
      return a("payer") ?? e.label;
    case "debt":
      return [a("creditor"), a("description")].filter(Boolean).join(" ") || e.label;
    case "lifetime_gift":
      return a("recipient") ?? e.label;
    case "nominee_deposit":
      return [a("holder"), a("institution")].filter(Boolean).join(" ") || e.label;
    case "other_asset":
      return a("description") ?? e.label;
    default:
      return e.label;
  }
}

export function matchCondition(e: Entity, c: Condition): boolean {
  const raw = entityAttr(e, c.attr);
  const v = raw === undefined ? undefined : normalizeText(raw);
  const target = normalizeText(c.value ?? "");
  switch (c.op) {
    case "exists":
      return v !== undefined;
    case "not_exists":
      return v === undefined;
    case "equals":
      return v !== undefined && v === target;
    case "contains":
      return v !== undefined && v.includes(target);
    case "not_contains":
      return v === undefined || !v.includes(target);
    default:
      return false;
  }
}

/** 実体がルール判定の対象になるか（根拠があり、撤回・却下されていないこと） */
export function isActiveEntity(e: Entity): boolean {
  if (e.status === "retracted" || e.status === "rejected") return false;
  if (e.assertion !== "present" && e.assertion !== "unknown") return false;
  return e.evidenceSegmentIds.length > 0 || e.lockedByUser;
}

export function ruleIsEffective(rule: DocumentRule, settings: AppSettings, today: string): boolean {
  if (!rule.enabled) return false;
  if (rule.approval.status === "rejected") return false;
  if (settings.requireApprovedRules && rule.approval.status !== "approved") return false;
  return rule.effectiveFrom <= today;
}

export interface RuleEngineInput {
  entities: Entity[];
  rules: DocumentRule[];
  documents: Map<string, DocumentMaster>;
  settings: AppSettings;
  deathDate: string | null;
  today: string; // YYYY-MM-DD
}

export function evaluateRules(input: RuleEngineInput): { documents: DesiredDocument[]; followUps: DesiredFollowUp[]; warnings: string[] } {
  const out = new Map<string, DesiredDocument>();
  const followUps = new Map<string, DesiredFollowUp>();
  const warnings: string[] = [];
  const active = input.entities.filter(isActiveEntity);

  const add = (rule: DocumentRule, entity: Entity | null) => {
    const target = entity ? entityTarget(entity) : null;
    const vars: Record<string, string | null> = { target };
    if (entity) for (const [k, v] of Object.entries(entity.attributes)) vars[k] = v.value;
    const tentative = entity?.assertion === "unknown";
    for (const docId of rule.documentIds) {
      const m = input.documents.get(docId);
      if (!m) {
        warnings.push(`ルール ${rule.id} が参照する資料 ${docId} が資料マスタにありません`);
        continue;
      }
      const perCase = !entity || m.perCase === true;
      const id = `${docId}__${perCase ? "case" : entity!.id}`;
      const reason = fillTemplate(rule.reason, vars) + (tentative ? "（可能性あり・要確認）" : "");
      const existing = out.get(id);
      if (existing) {
        if (entity) existing.evidenceSegmentIds = [...new Set([...existing.evidenceSegmentIds, ...entity.evidenceSegmentIds])];
        if (!existing.reasons.includes(reason)) existing.reasons.push(reason);
        existing.tentative = existing.tentative && tentative;
        if (!existing.ruleIds.includes(rule.id)) {
          existing.ruleIds.push(rule.id);
          existing.ruleVersions[rule.id] = rule.version;
          existing.reasons.push(reason);
          if (PRIORITY_ORDER[rule.importance] < PRIORITY_ORDER[existing.importance]) existing.importance = rule.importance;
          existing.fromUnapprovedRule = existing.fromUnapprovedRule && rule.approval.status !== "approved";
        }
        continue;
      }
      out.set(id, {
        id,
        documentId: docId,
        name: fillTemplate(m.name, perCase ? { ...vars, target: null } : vars),
        category: m.category,
        target: perCase ? null : target,
        entityId: perCase ? null : entity!.id,
        reasons: [reason],
        ruleIds: [rule.id],
        ruleVersions: { [rule.id]: rule.version },
        fromUnapprovedRule: rule.approval.status !== "approved",
        importance: rule.importance,
        periodSpec: rule.period,
        period: describePeriod(rule.period, input.deathDate, input.settings.transactionHistoryYears),
        evidenceSegmentIds: entity ? [...entity.evidenceSegmentIds] : [],
        source: fillTemplate(m.source, vars),
        howTo: m.howTo,
        submitter: m.defaultSubmitter,
        tentative,
      });
    }
    if (entity && rule.followUps) for (const f of rule.followUps) addFollowUp(f, rule, entity, vars);
  };

  const addFollowUp = (f: FollowUpTemplate, rule: DocumentRule, entity: Entity, vars: Record<string, string | null>) => {
    const id = `${f.templateId}__${entity.id}`;
    if (followUps.has(id)) return;
    const attr = f.answeredByAttr ? entity.attributes[f.answeredByAttr] : undefined;
    followUps.set(id, {
      id,
      templateId: f.templateId,
      entityId: entity.id,
      question: fillTemplate(f.question, vars),
      prompt: fillTemplate(f.prompt, vars),
      priority: f.priority,
      category: rule.category,
      answered: !!attr?.value,
      evidenceSegmentIds: attr?.evidenceSegmentIds ?? [],
      answer: attr?.value ?? null,
    });
  };

  for (const rule of input.rules) {
    if (!ruleIsEffective(rule, input.settings, input.today)) continue;
    if (rule.appliesTo.kind === "case") {
      add(rule, null);
      continue;
    }
    const type = rule.appliesTo.entityType;
    for (const e of active) {
      if (e.type !== type) continue;
      if (!rule.conditions.every((c) => matchCondition(e, c))) continue;
      if (rule.exceptions.some((c) => matchCondition(e, c))) continue;
      add(rule, e);
    }
  }
  return { documents: [...out.values()], followUps: [...followUps.values()], warnings };
}
