import type { CategoryId, EntityType, PeriodSpec, Priority } from "../types.js";

/**
 * 資料判定ルール
 *
 * 必要資料は AI ではなく、このルールに基づいて決定する（指示書 6.）。
 * 将来は管理画面（Firestore の documentRules）から税理士が変更できる。
 */
export type ConditionOp = "exists" | "not_exists" | "equals" | "contains" | "not_contains";

export interface Condition {
  /** 属性名（例: deposit_types） */
  attr: string;
  op: ConditionOp;
  value?: string;
}

export interface FollowUpTemplate {
  templateId: string;
  question: string;
  prompt: string;
  priority: Priority;
  /** この属性が埋まっていれば「AI確認候補」とみなす */
  answeredByAttr?: string;
}

export interface DocumentRule {
  id: string;
  version: number;
  category: CategoryId;
  title: string;
  /** 適用条件: 案件全体（always）または特定種類の財産 */
  appliesTo: { kind: "case" } | { kind: "entity"; entityType: EntityType };
  /** すべて満たすと適用 */
  conditions: Condition[];
  /** いずれかを満たすと適用しない */
  exceptions: Condition[];
  documentIds: string[];
  reason: string; // {target} 置換可
  period: PeriodSpec;
  importance: Priority;
  /** 財産が出てきたときに登録する追加確認項目 */
  followUps?: FollowUpTemplate[];
  effectiveFrom: string; // YYYY-MM-DD
  approval: { status: "approved" | "pending_review" | "rejected"; by: string | null; at: string | null };
  enabled: boolean;
}

const pending = { status: "pending_review" as const, by: null, at: null };

export const DEFAULT_RULES: DocumentRule[] = [
  {
    id: "R-BASIC-001",
    version: 1,
    category: "basic",
    title: "相続人確定のための戸籍等",
    appliesTo: { kind: "case" },
    conditions: [],
    exceptions: [],
    documentIds: ["koseki_decedent", "joseki_decedent", "koseki_heirs", "juminhyo_heirs", "inkan_heirs", "mynumber_heirs"],
    reason: "相続人の確定と申告書の作成に必要",
    period: { kind: "none" },
    importance: "high",
    effectiveFrom: "2024-01-01",
    approval: pending,
    enabled: true,
  },
  {
    id: "R-DEP-001",
    version: 1,
    category: "deposits",
    title: "預貯金の残高・取引履歴",
    appliesTo: { kind: "entity", entityType: "bank_account" },
    conditions: [],
    exceptions: [],
    documentIds: ["bank_balance", "bank_history", "bank_passbook"],
    reason: "{target}の口座があると発言があったため（相続開始日の残高確認と、資金移動・名義預金・生前贈与の確認）",
    period: { kind: "years_before_death" },
    importance: "high",
    followUps: [
      { templateId: "bank.branch", question: "{target}の支店名", prompt: "{target}はどちらの支店ですか？", priority: "medium", answeredByAttr: "branch" },
      { templateId: "bank.deposit_types", question: "{target}の預金の種類（普通・定期など）", prompt: "{target}は普通預金だけですか？定期預金もありますか？", priority: "medium", answeredByAttr: "deposit_types" },
      { templateId: "bank.passbook", question: "{target}の通帳の保管状況", prompt: "{target}の通帳はお手元にありますか？", priority: "low", answeredByAttr: "passbook" },
    ],
    effectiveFrom: "2024-01-01",
    approval: pending,
    enabled: true,
  },
  {
    id: "R-DEP-002",
    version: 1,
    category: "deposits",
    title: "定期預金の既経過利息",
    appliesTo: { kind: "entity", entityType: "bank_account" },
    conditions: [{ attr: "deposit_types", op: "contains", value: "定期" }],
    exceptions: [],
    documentIds: ["bank_accrued_interest"],
    reason: "{target}に定期預金があると発言があったため（既経過利息の計上）",
    period: { kind: "as_of_death" },
    importance: "medium",
    effectiveFrom: "2024-01-01",
    approval: pending,
    enabled: true,
  },
  {
    id: "R-RE-001",
    version: 1,
    category: "real_estate",
    title: "不動産の評価資料",
    appliesTo: { kind: "entity", entityType: "real_estate" },
    conditions: [],
    exceptions: [],
    documentIds: ["re_registry", "re_nayose", "re_valuation", "re_tax_notice", "re_maps"],
    reason: "{target}に不動産があると発言があったため（所有関係の確認と評価）",
    period: { kind: "as_of_death" },
    importance: "high",
    followUps: [
      { templateId: "re.address_detail", question: "{target}の所在地（地番・住居表示）の詳細", prompt: "{target}の詳しい住所（地番）を教えてください。", priority: "high", answeredByAttr: "address_detail" },
      { templateId: "re.ownership", question: "{target}の所有関係（単独・共有、名義人）", prompt: "{target}は亡くなった方の単独名義ですか？", priority: "high", answeredByAttr: "ownership" },
      { templateId: "re.usage", question: "{target}の利用状況（自宅・貸付・事業・空き家）", prompt: "{target}は現在どのように使っていますか？", priority: "high", answeredByAttr: "usage" },
      { templateId: "re.residents", question: "{target}に住んでいた人・同居人", prompt: "{target}にはどなたがお住まいでしたか？", priority: "high", answeredByAttr: "residents" },
    ],
    effectiveFrom: "2024-01-01",
    approval: pending,
    enabled: true,
  },
  {
    id: "R-RE-002",
    version: 1,
    category: "real_estate",
    title: "貸付不動産の賃貸借資料",
    appliesTo: { kind: "entity", entityType: "real_estate" },
    conditions: [{ attr: "usage", op: "contains", value: "貸" }],
    exceptions: [],
    documentIds: ["re_lease"],
    reason: "{target}を貸し付けていると発言があったため（貸家・貸宅地の評価、預り敷金の確認）",
    period: { kind: "as_of_death" },
    importance: "high",
    effectiveFrom: "2024-01-01",
    approval: pending,
    enabled: true,
  },
  {
    id: "R-RE-003",
    version: 1,
    category: "real_estate",
    title: "借地の契約書",
    appliesTo: { kind: "entity", entityType: "real_estate" },
    conditions: [{ attr: "land_right", op: "contains", value: "借地" }],
    exceptions: [],
    documentIds: ["re_lease_land"],
    reason: "{target}が借地であると発言があったため（借地権の評価）",
    period: { kind: "as_of_death" },
    importance: "medium",
    effectiveFrom: "2024-01-01",
    approval: pending,
    enabled: true,
  },
  {
    id: "R-SEC-001",
    version: 1,
    category: "securities",
    title: "上場株式・投資信託の残高",
    appliesTo: { kind: "entity", entityType: "listed_security" },
    conditions: [],
    exceptions: [],
    documentIds: ["sec_balance", "sec_reports"],
    reason: "{target}に証券口座・投資商品があると発言があったため",
    period: { kind: "as_of_death" },
    importance: "high",
    effectiveFrom: "2024-01-01",
    approval: pending,
    enabled: true,
  },
  {
    id: "R-UNL-001",
    version: 1,
    category: "unlisted",
    title: "非上場株式の評価資料",
    appliesTo: { kind: "entity", entityType: "unlisted_share" },
    conditions: [],
    exceptions: [],
    documentIds: ["unlisted_financials", "unlisted_shareholders"],
    reason: "{target}の株式を保有していると発言があったため（株価評価）",
    period: { kind: "fiscal_years", years: 3 },
    importance: "high",
    effectiveFrom: "2024-01-01",
    approval: pending,
    enabled: true,
  },
  {
    id: "R-INS-001",
    version: 1,
    category: "insurance",
    title: "死亡保険金",
    appliesTo: { kind: "entity", entityType: "life_insurance" },
    conditions: [],
    exceptions: [{ attr: "policy_role", op: "contains", value: "契約者" }],
    documentIds: ["ins_payment", "ins_policy"],
    reason: "{target}の生命保険があると発言があったため（みなし相続財産・非課税枠の確認）",
    period: { kind: "as_of_death" },
    importance: "high",
    followUps: [
      { templateId: "ins.beneficiary", question: "{target}の受取人", prompt: "{target}の保険金の受取人はどなたですか？", priority: "high", answeredByAttr: "beneficiary" },
      { templateId: "ins.premium_payer", question: "{target}の保険料負担者・契約者", prompt: "{target}の保険料は、亡くなった方が払っていましたか？", priority: "medium", answeredByAttr: "premium_payer" },
    ],
    effectiveFrom: "2024-01-01",
    approval: pending,
    enabled: true,
  },
  {
    id: "R-INS-002",
    version: 1,
    category: "insurance",
    title: "生命保険契約に関する権利",
    appliesTo: { kind: "entity", entityType: "life_insurance" },
    conditions: [{ attr: "policy_role", op: "contains", value: "契約者" }],
    exceptions: [],
    documentIds: ["ins_policy", "ins_surrender_value"],
    reason: "{target}について被相続人が契約者（保険料負担者）の保険があると発言があったため",
    period: { kind: "as_of_death" },
    importance: "high",
    effectiveFrom: "2024-01-01",
    approval: pending,
    enabled: true,
  },
  {
    id: "R-RET-001",
    version: 1,
    category: "insurance",
    title: "死亡退職金",
    appliesTo: { kind: "entity", entityType: "retirement_allowance" },
    conditions: [],
    exceptions: [],
    documentIds: ["retirement_notice"],
    reason: "{target}から死亡退職金・弔慰金が出ると発言があったため",
    period: { kind: "as_of_death" },
    importance: "medium",
    effectiveFrom: "2024-01-01",
    approval: pending,
    enabled: true,
  },
  {
    id: "R-DEBT-001",
    version: 1,
    category: "debts",
    title: "借入金",
    appliesTo: { kind: "entity", entityType: "debt" },
    conditions: [],
    exceptions: [],
    documentIds: ["debt_balance", "debt_contract"],
    reason: "{target}の借入金・未払金があると発言があったため（債務控除）",
    period: { kind: "as_of_death" },
    importance: "high",
    effectiveFrom: "2024-01-01",
    approval: pending,
    enabled: true,
  },
  {
    id: "R-FUN-001",
    version: 1,
    category: "funeral",
    title: "葬式費用",
    appliesTo: { kind: "entity", entityType: "funeral_expense" },
    conditions: [],
    exceptions: [],
    documentIds: ["funeral_receipts", "funeral_memo"],
    reason: "葬儀の費用について発言があったため（葬式費用の控除）",
    period: { kind: "none" },
    importance: "high",
    effectiveFrom: "2024-01-01",
    approval: pending,
    enabled: true,
  },
  {
    id: "R-GIFT-001",
    version: 1,
    category: "gifts",
    title: "生前贈与",
    appliesTo: { kind: "entity", entityType: "lifetime_gift" },
    conditions: [],
    exceptions: [],
    documentIds: ["gift_evidence", "gift_returns"],
    reason: "{target}への生前贈与について発言があったため（生前贈与加算・贈与税額控除の確認）",
    period: { kind: "none" },
    importance: "high",
    followUps: [
      { templateId: "gift.when", question: "{target}の贈与の時期", prompt: "{target}への贈与はいつ頃でしたか？", priority: "high", answeredByAttr: "date" },
      { templateId: "gift.amount", question: "{target}の贈与の金額", prompt: "{target}への贈与はいくらでしたか？", priority: "high", answeredByAttr: "amount" },
      { templateId: "gift.taxation", question: "{target}の贈与の課税方式（暦年・相続時精算課税）と申告の有無", prompt: "{target}の贈与について、贈与税の申告はしましたか？", priority: "medium", answeredByAttr: "taxation" },
    ],
    effectiveFrom: "2024-01-01",
    approval: pending,
    enabled: true,
  },
  {
    id: "R-GIFT-002",
    version: 1,
    category: "gifts",
    title: "相続時精算課税",
    appliesTo: { kind: "entity", entityType: "lifetime_gift" },
    conditions: [{ attr: "taxation", op: "contains", value: "精算" }],
    exceptions: [],
    documentIds: ["seisan_notice"],
    reason: "{target}について相続時精算課税の贈与があると発言があったため",
    period: { kind: "none" },
    importance: "high",
    effectiveFrom: "2024-01-01",
    approval: pending,
    enabled: true,
  },
  {
    id: "R-NOM-001",
    version: 1,
    category: "nominee",
    title: "名義預金の可能性",
    appliesTo: { kind: "entity", entityType: "nominee_deposit" },
    conditions: [],
    exceptions: [],
    documentIds: ["nominee_passbook"],
    reason: "{target}について、被相続人の資金による家族名義の預金の可能性が話されたため",
    period: { kind: "years_before_death" },
    importance: "high",
    effectiveFrom: "2024-01-01",
    approval: pending,
    enabled: true,
  },
  {
    id: "R-WILL-001",
    version: 1,
    category: "will",
    title: "遺言書",
    appliesTo: { kind: "entity", entityType: "will" },
    conditions: [],
    exceptions: [{ attr: "exists", op: "equals", value: "なし" }],
    documentIds: ["will_copy"],
    reason: "遺言書があると発言があったため",
    period: { kind: "none" },
    importance: "high",
    effectiveFrom: "2024-01-01",
    approval: pending,
    enabled: true,
  },
  {
    id: "R-OTH-001",
    version: 1,
    category: "other_assets",
    title: "その他の財産",
    appliesTo: { kind: "entity", entityType: "other_asset" },
    conditions: [],
    exceptions: [],
    documentIds: ["other_asset_eval"],
    reason: "{target}について発言があったため",
    period: { kind: "as_of_death" },
    importance: "medium",
    effectiveFrom: "2024-01-01",
    approval: pending,
    enabled: true,
  },
  {
    id: "R-DEC-001",
    version: 1,
    category: "basic",
    title: "準確定申告の資料",
    appliesTo: { kind: "entity", entityType: "decedent" },
    conditions: [{ attr: "income", op: "exists" }],
    exceptions: [{ attr: "income", op: "equals", value: "なし" }],
    documentIds: ["income_tax_docs"],
    reason: "被相続人に所得（{income}）があると発言があったため（準確定申告の要否確認）",
    period: { kind: "none" },
    importance: "medium",
    effectiveFrom: "2024-01-01",
    approval: pending,
    enabled: true,
  },
];
