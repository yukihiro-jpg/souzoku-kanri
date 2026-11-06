/**
 * 相続税申告 AI面談システム 共通型定義
 *
 * Firestore に保存するデータ構造と、サーバー/ブラウザ間で共有する型。
 * 「AIが判断したもの」と「担当者が承認したもの」を常に区別できるよう、
 * すべての判定に source / lockedByUser / evidenceSegmentIds を持たせる。
 */

export type Role = "admin" | "staff" | "viewer";

/** 確認事項の状態 */
export const CHECK_STATUSES = [
  "unconfirmed", // 未確認
  "ai_candidate", // AI確認候補（担当者の確認待ち）
  "confirmed", // 確認済み（担当者のみ設定可）
  "needs_followup", // 要追加確認
  "not_applicable", // 該当なし（担当者のみ設定可）
  "contradiction", // 矛盾あり
] as const;
export type CheckStatus = (typeof CHECK_STATUSES)[number];

export const CHECK_STATUS_LABELS: Record<CheckStatus, string> = {
  unconfirmed: "未確認",
  ai_candidate: "AI確認候補",
  confirmed: "確認済み",
  needs_followup: "要追加確認",
  not_applicable: "該当なし",
  contradiction: "矛盾あり",
};

/** 必要資料の状態 */
export const DOC_STATUSES = [
  "candidate", // 必要候補（AI/ルールが提案）
  "required", // 必要確定（担当者が承認）
  "requested", // 依頼済み
  "partial", // 一部提出
  "submitted", // 提出済み
  "verified", // 内容確認済み
  "insufficient", // 不足・再取得
  "not_needed", // 不要確定
  "removal_candidate", // 削除候補（訂正等で根拠がなくなった候補）
] as const;
export type DocStatus = (typeof DOC_STATUSES)[number];

export const DOC_STATUS_LABELS: Record<DocStatus, string> = {
  candidate: "必要候補",
  required: "必要確定",
  requested: "依頼済み",
  partial: "一部提出",
  submitted: "提出済み",
  verified: "内容確認済み",
  insufficient: "不足・再取得",
  not_needed: "不要確定",
  removal_candidate: "削除候補",
};

/** AI/ルールが自動で変更してよい資料状態（これ以外は担当者の判断なので触らない） */
export const AUTO_MANAGED_DOC_STATUSES: DocStatus[] = ["candidate", "removal_candidate"];

/** 財産・人物などの「実体」の種類 */
export const ENTITY_TYPES = [
  "decedent", // 被相続人
  "heir", // 相続人
  "bank_account", // 預貯金（金融機関単位）
  "real_estate", // 土地・建物
  "listed_security", // 上場株式・投資信託（証券会社単位）
  "unlisted_share", // 非上場株式
  "life_insurance", // 生命保険
  "retirement_allowance", // 死亡退職金
  "other_asset", // その他の財産
  "debt", // 借入金・未払金
  "funeral_expense", // 葬式費用
  "lifetime_gift", // 生前贈与
  "nominee_deposit", // 名義預金の可能性
  "will", // 遺言
  "other_fact", // その他の確認事項
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const ENTITY_TYPE_LABELS: Record<EntityType, string> = {
  decedent: "被相続人",
  heir: "相続人",
  bank_account: "預貯金",
  real_estate: "土地・建物",
  listed_security: "上場株式・投資信託",
  unlisted_share: "非上場株式",
  life_insurance: "生命保険",
  retirement_allowance: "死亡退職金",
  other_asset: "その他の財産",
  debt: "借入金・未払金",
  funeral_expense: "葬式費用",
  lifetime_gift: "生前贈与",
  nominee_deposit: "名義預金",
  will: "遺言・遺産分割",
  other_fact: "その他",
};

/**
 * 発言上の扱い
 * present: 存在すると発言された / absent: 明確に否定された /
 * unknown: 可能性がある・分からない / retracted: 訂正・撤回された
 */
export const ASSERTIONS = ["present", "absent", "unknown", "retracted"] as const;
export type Assertion = (typeof ASSERTIONS)[number];

/** 確認事項カテゴリー（指示書 6. 初期対象カテゴリー） */
export const CATEGORIES = [
  { id: "basic", no: 1, label: "被相続人・相続人の基本情報" },
  { id: "deposits", no: 2, label: "預貯金" },
  { id: "real_estate", no: 3, label: "土地・建物" },
  { id: "securities", no: 4, label: "上場株式・投資信託" },
  { id: "unlisted", no: 5, label: "非上場株式" },
  { id: "insurance", no: 6, label: "生命保険・死亡退職金" },
  { id: "other_assets", no: 7, label: "その他の財産" },
  { id: "debts", no: 8, label: "借入金・未払金" },
  { id: "funeral", no: 9, label: "葬式費用" },
  { id: "gifts", no: 10, label: "生前贈与" },
  { id: "nominee", no: 11, label: "名義預金" },
  { id: "will", no: 12, label: "遺言・遺産分割" },
  { id: "special", no: 13, label: "相続税の特例・控除" },
  { id: "misc", no: 14, label: "その他の確認事項" },
] as const;
export type CategoryId = (typeof CATEGORIES)[number]["id"];

export type Priority = "high" | "medium" | "low";
export const PRIORITY_ORDER: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

export interface HistoryEntry {
  at: string; // ISO
  by: string; // uid or "ai:<jobId>" or "rule"
  action: string;
  before?: unknown;
  after?: unknown;
  evidenceSegmentIds?: string[];
  note?: string;
}

export interface AttributeValue {
  value: string;
  evidenceSegmentIds: string[];
  /** この値を設定した発言の最大シーケンス番号（古い解析結果による上書きを防ぐ） */
  updatedSeq: number;
  source: "ai" | "user";
  /** 値の訂正履歴 */
  history?: { value: string; evidenceSegmentIds: string[]; at: string; by: string }[];
}

/** 会話から抽出した事実（Facts）。案件単位で保持し、複数回の面談で引き継ぐ。 */
export interface Entity {
  id: string;
  caseId: string;
  type: EntityType;
  /** 重複判定用の正規化キー（例: bank_account:常陽銀行） */
  key: string;
  label: string;
  assertion: Assertion;
  attributes: Record<string, AttributeValue>;
  /** ai_candidate: AI抽出（未承認） / confirmed: 担当者承認 / retracted: 訂正により無効 / rejected: 担当者が却下 */
  status: "ai_candidate" | "confirmed" | "retracted" | "rejected";
  confidence: number;
  evidenceSegmentIds: string[];
  /** 担当者が承認・手動修正した場合 true。AIは以後この実体を変更しない。 */
  lockedByUser: boolean;
  confirmedBy?: string | null;
  supersedes?: string | null;
  supersededBy?: string | null;
  contradiction?: boolean;
  note?: string | null;
  meetingIds: string[];
  updatedSeq: number;
  createdAt: string;
  updatedAt: string;
  history: HistoryEntry[];
}

/** 確認事項（CheckItems） */
export interface CheckItem {
  id: string;
  caseId: string;
  category: CategoryId;
  question: string;
  /** 担当者が読む質問文 */
  prompt: string | null;
  priority: Priority;
  status: CheckStatus;
  answer: string | null;
  /** AIが提案した結論（例: 該当なしの可能性）。確定は担当者。 */
  aiProposal: "answered" | "not_applicable" | "unknown_answer" | null;
  confidence: number | null;
  evidenceSegmentIds: string[];
  /** 実体に紐づく追加確認項目の場合、その実体ID */
  entityId?: string | null;
  templateId?: string | null;
  source: "master" | "rule" | "ai" | "user";
  /** 財産の存在から自動で候補にしたもの（回答文も自動生成） */
  autoDerived?: boolean;
  /** 対象の財産が訂正・撤回され、確認不要になった追加確認項目 */
  obsolete?: boolean;
  lockedByUser: boolean;
  manualBy?: string | null;
  updatedSeq: number;
  updatedAt: string;
  history: HistoryEntry[];
}

export interface PeriodSpec {
  kind: "as_of_death" | "years_before_death" | "fiscal_years" | "none";
  /** years_before_death の年数。未指定なら settings.transactionHistoryYears（事務所の調査方針） */
  years?: number;
}

/** 必要資料（DocumentRequirements） */
export interface DocumentRequirement {
  id: string; // `${documentId}__${entityId|case}`
  caseId: string;
  documentId: string;
  name: string;
  category: CategoryId;
  target: string | null; // 対象金融機関や財産
  reasons: string[];
  ruleIds: string[];
  ruleVersions: Record<string, number>;
  /** 税理士未承認ルールに基づく候補か */
  fromUnapprovedRule: boolean;
  entityId: string | null;
  period: string | null; // 表示用（例: 2021-11-06〜2026-11-05）
  periodSpec: PeriodSpec | null;
  submitter: string | null;
  dueDate: string | null;
  status: DocStatus;
  /** AIルール判定か担当者確定か */
  decidedBy: "rule" | "user";
  evidenceSegmentIds: string[];
  importance: Priority;
  remarks: string | null;
  source: string | null; // 取得先（資料マスタ）
  howTo: string | null; // 取得方法（資料マスタ）
  lockedByUser: boolean;
  /** 承認済み資料の根拠が訂正・撤回され、担当者の確認が必要 */
  needsReview?: boolean;
  /** Phase 4 用の催促管理（初期は空） */
  followUp?: {
    collector?: string | null;
    lastContactAt?: string | null;
    nextReminderAt?: string | null;
    reminders?: { at: string; by: string; note: string }[];
  };
  createdAt: string;
  updatedAt: string;
  history: HistoryEntry[];
}

export interface TranscriptSegment {
  id: string;
  caseId: string;
  meetingId: string;
  seq: number;
  speaker: "staff" | "client" | "other" | "unknown";
  speakerLabel: string | null; // Gemini の話者ラベル（spk_1 等）
  speakerConfirmed: boolean;
  text: string;
  final: true;
  kind: "speech" | "system";
  suspectedDuplicateOf?: string | null;
  analysisStatus: "pending" | "queued" | "analyzing" | "done" | "skipped" | "error";
  analysisJobId?: string | null;
  timings: {
    speechStartAt?: number | null; // epoch ms（クライアント時計）
    interimShownAt?: number | null;
    finalAt: number;
  };
  createdAt: string;
  createdBy: string;
}

export interface SuggestedQuestion {
  id: string;
  question: string;
  checkItemId: string | null;
  priority: Priority;
  reason: string;
  source: "ai" | "rule";
  status: "open" | "asked" | "dismissed" | "resolved";
  createdSeq: number;
  updatedAt: string;
}

export interface ReviewItem {
  id: string;
  caseId: string;
  meetingId: string | null;
  kind:
    | "contradiction"
    | "correction_on_locked"
    | "ai_update_on_locked"
    | "reanalysis_missing_entity"
    | "reanalysis_missing_check"
    | "reanalysis_issue"
    | "possible_transcription_error";
  title: string;
  detail: string;
  evidenceSegmentIds: string[];
  /** 承認時に適用する提案内容（AnalysisOutput の一部） */
  proposal?: unknown;
  status: "open" | "approved" | "rejected";
  resolvedBy?: string | null;
  createdAt: string;
  source: "realtime" | "reanalysis";
}

export interface Consent {
  recording: boolean;
  aiAnalysis: boolean;
  explainedBy: string;
  explainedAt: string;
  method: "verbal" | "written";
  note: string | null;
}

export interface CaseDoc {
  id: string;
  name: string;
  decedentName: string;
  inheritanceStartDate: string | null; // YYYY-MM-DD
  memberIds: string[];
  members: Record<string, Role>;
  consent: Consent | null;
  status: "active" | "closed";
  createdAt: string;
  createdBy: string;
  updatedAt: string;
}

export interface Meeting {
  id: string;
  caseId: string;
  no: number;
  interviewer: string;
  interviewerUid: string;
  status: "in_progress" | "ended";
  startedAt: string;
  endedAt: string | null;
  lastSeq: number;
  /** 「次の質問」を最後に更新した解析の発言seq（古い解析結果で上書きしないため） */
  questionsSeq: number;
  gaps: { from: number; to: number | null; reason: string }[];
  audioParts: string[];
  reanalysis?: { status: "none" | "running" | "done" | "error"; jobId?: string | null; at?: string | null } | null;
  endWarnings?: string[];
}

export interface AppSettings {
  /** 取引履歴の収集期間（事務所の調査方針・年）。生前贈与加算期間とは別概念。 */
  transactionHistoryYears: number;
  audioRetentionDays: number;
  monthlyBudgetUsd: number;
  budgetWarnRatio: number;
  /** true の場合、税理士承認済みルールのみ適用 */
  requireApprovedRules: boolean;
  officeName: string;
  officeContact: string;
  defaultDueDays: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  transactionHistoryYears: 5,
  audioRetentionDays: 365,
  monthlyBudgetUsd: 100,
  budgetWarnRatio: 0.8,
  requireApprovedRules: false,
  officeName: "（事務所名を設定してください）",
  officeContact: "（連絡先を設定してください）",
  defaultDueDays: 30,
};
