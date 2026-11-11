import type { Role } from "../types.js";
import type { ReadingHint } from "./rulebook.js";
import type { NoteSegment } from "./notes.js";

/** 顧問モードのデータ型（Firestore の clients/{clientId} 配下と一致させる） */

export type AccountingSystem = "kaikei_taisho" | "mf";
export const ACCOUNTING_SYSTEM_LABELS: Record<AccountingSystem, string> = { kaikei_taisho: "会計大将", mf: "マネーフォワード" };

export interface ClientDoc {
  id: string;
  code: string; // 例: 0001
  name: string;
  accountingSystem: AccountingSystem;
  fiscalMonth: number; // 決算月 1〜12
  industryTags: string[];
  memberIds: string[];
  members: Record<string, Role>;
  /** 会計大将：顧問先ごとのルール集（Google ドキュメント） */
  rulebookDocId: string | null;
  rulebookDocName: string | null;
  /** マネーフォワード：MF-kaikei-rules の中のこの顧問先のファイル */
  mfRulesPath: string | null;
  status: "active" | "closed";
  createdAt: string;
  createdBy: string;
  updatedAt: string;
}

export type RuleBucket = "rule" | "question" | "card";
export const RULE_BUCKET_LABELS: Record<RuleBucket, string> = { rule: "ルール集への反映案", question: "確認事項", card: "カード" };

export type RuleTarget = "client_rulebook" | "mf_rules" | "skill";
export const RULE_TARGET_LABELS: Record<RuleTarget, string> = { client_rulebook: "顧問先のルール集", mf_rules: "MF-kaikei-rules", skill: "スキルへの改善メモ" };

export type CardKind = "homework" | "ongoing" | "worry" | "goal" | "metric" | "question";
export const CARD_KIND_LABELS: Record<CardKind, string> = {
  homework: "宿題",
  ongoing: "継続論点",
  worry: "社長の悩み",
  goal: "社長の目標",
  metric: "経営の数字",
  question: "確認事項",
};
export type CardOwner = "client" | "office" | "unknown";
export const CARD_OWNER_LABELS: Record<CardOwner, string> = { client: "顧問先", office: "事務所", unknown: "未定" };

export interface Evidence {
  segmentId: string;
  time: string;
  quote: string;
  /** 引用が発言の本文に実際にあるか（プログラムで確認） */
  found: boolean;
}

export type ItemStatus = "proposed" | "approved" | "rejected" | "written" | "exported";

export interface RuleItemChecks {
  evidence: "ok" | "missing";
  section: "ok" | "unknown" | "n/a";
  before: "ok" | "not_found" | "ambiguous" | "n/a";
  /** 同じ内容がすでにルール集にある可能性 */
  maybeDuplicate: boolean;
}

export interface RuleItem {
  id: string;
  bucket: RuleBucket;
  title: string;
  summary: string;
  evidence: Evidence[];
  corrections: { segmentId: string; heard: string; corrected: string; reason: string }[];
  confidence: number;
  // ルール案
  target: RuleTarget | null;
  sectionHeading: string | null;
  operation: "add" | "modify" | null;
  beforeText: string | null;
  afterText: string | null;
  // 確認事項
  question: string | null;
  suggestedRule: string | null;
  answer: string | null;
  // カード
  cardKind: CardKind | null;
  owner: CardOwner | null;
  due: string | null;
  amount: string | null;
  settlementPolicy: string | null;
  checks: RuleItemChecks;
  status: ItemStatus;
  /** 確認事項に回答してルール案に変えたもの */
  convertedFromQuestion: boolean;
  decidedBy: string | null;
  decidedAt: string | null;
  writtenAt: string | null;
  writeError: string | null;
}

export interface RuleRun {
  id: string;
  clientId: string;
  notesDocId: string;
  notesDocName: string;
  notesRevisionId: string;
  rulebookDocId: string | null;
  rulebookRevisionId: string | null;
  segments: NoteSegment[];
  hints: ReadingHint[];
  status: "analyzing" | "review" | "done" | "error";
  error: string | null;
  model: string | null;
  usd: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ClientCard {
  id: string;
  kind: CardKind;
  title: string;
  detail: string;
  owner: CardOwner;
  due: string | null;
  amount: string | null;
  settlementPolicy: string | null;
  evidence: Evidence[];
  source: { runId: string; itemId: string; notesDocName: string } | null;
  status: "open" | "in_progress" | "done" | "reflected";
  createdAt: string;
  createdBy: string;
  updatedAt: string;
}

export interface RuleChange {
  id: string;
  runId: string;
  itemId: string;
  docId: string;
  sectionHeading: string;
  operation: "add" | "modify";
  beforeText: string | null;
  afterText: string;
  confirmedDate: string;
  revisionBefore: string;
  revisionAfter: string | null;
  by: string;
  at: string;
}
