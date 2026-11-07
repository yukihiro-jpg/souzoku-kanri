import type { CategoryId, EntityType, PeriodSpec, Priority } from "../types.js";

/**
 * 資料判定ルール
 *
 * 必要資料は AI ではなく、このルールに基づいて決定する（指示書 6.）。
 * 将来は管理画面（Firestore の documentRules）から税理士が変更できる。
 */
/** contains_any: value を「|」で区切ったいずれかを含む */
export type ConditionOp = "exists" | "not_exists" | "equals" | "contains" | "not_contains" | "contains_any";

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

/** ルール定義の簡略記法（既定値: version 1・未承認・有効・2024-01-01 から有効） */
function rule(r: Omit<DocumentRule, "version" | "approval" | "enabled" | "effectiveFrom" | "conditions" | "exceptions"> & Partial<DocumentRule>): DocumentRule {
  return { version: 1, approval: pending, enabled: true, effectiveFrom: "2024-01-01", conditions: [], exceptions: [], ...r };
}
const has = (attr: string, value: string): Condition => ({ attr, op: "contains_any", value });
const entity = (entityType: EntityType) => ({ kind: "entity" as const, entityType });

/** その他の財産の種類（kind 属性）→ 資料 */
const OTHER_KINDS: { id: string; title: string; any: string; docs: string[]; reason: string; importance: Priority }[] = [
  { id: "CAR", title: "自動車", any: "自動車|車|バイク", docs: ["car_docs"], reason: "{target}（自動車等）があると発言があったため", importance: "low" },
  { id: "MEMBER", title: "ゴルフ・リゾート会員権", any: "ゴルフ|リゾート|会員権", docs: ["membership_docs"], reason: "{target}があると発言があったため", importance: "medium" },
  { id: "LOAN", title: "貸付金・前払金", any: "貸付|貸したお金|前払", docs: ["loan_receivable"], reason: "{target}があると発言があったため（貸付金債権）", importance: "medium" },
  { id: "VALUABLE", title: "貴金属・書画・骨董", any: "貴金属|宝石|書画|骨董|美術|絵画", docs: ["valuables_docs"], reason: "{target}があると発言があったため", importance: "low" },
  { id: "RECEIVABLE", title: "未収金・還付金", any: "未収|還付|高額療養|未払の給与|未払いの給与", docs: ["receivable_docs"], reason: "{target}があると発言があったため（未収金・還付金）", importance: "medium" },
  { id: "CRYPTO", title: "暗号資産", any: "暗号|仮想通貨|ビットコイン|イーサリアム", docs: ["crypto_docs"], reason: "{target}（暗号資産）があると発言があったため", importance: "high" },
  { id: "EMONEY", title: "電子マネー・スマホ決済・ポイント", any: "電子マネー|スマホ決済|ペイ|ポイント|プリペイド", docs: ["emoney_docs"], reason: "{target}の残高があると発言があったため", importance: "low" },
  { id: "GOLD", title: "金地金・純金積立", any: "金地金|純金|プラチナ|金貨|金の延べ棒", docs: ["gold_docs"], reason: "{target}があると発言があったため", importance: "medium" },
  { id: "FOREIGN", title: "国外財産", any: "国外|海外|外国|外貨", docs: ["foreign_assets"], reason: "{target}（国外財産）があると発言があったため", importance: "high" },
  { id: "HOUSEHOLD", title: "家庭用財産", any: "家財|家庭用", docs: ["household_docs"], reason: "家財について発言があったため", importance: "low" },
  { id: "BUSINESS", title: "事業用資産", any: "事業|店舗|在庫|売掛", docs: ["business_docs"], reason: "被相続人の事業に関する財産について発言があったため", importance: "high" },
  { id: "SOLAR", title: "太陽光発電設備", any: "太陽光", docs: ["solar_docs"], reason: "{target}（太陽光発電設備）があると発言があったため", importance: "medium" },
  { id: "SAFE", title: "貸金庫", any: "貸金庫", docs: ["safe_box"], reason: "{target}の貸金庫があると発言があったため", importance: "medium" },
];

/** 特記事項（situation の kind 属性）→ 資料 */
const SITUATIONS: { id: string; title: string; any: string; docs: string[]; reason: string; importance: Priority }[] = [
  { id: "NURSING", title: "老人ホーム等への入居", any: "老人ホーム|施設|サービス付き|グループホーム|介護付", docs: ["nursing_home_docs", "care_insurance", "fuhyo_decedent"], reason: "被相続人が老人ホーム等に入居していたと発言があったため（小規模宅地等の特例の確認）", importance: "high" },
  { id: "IENAKI", title: "家なき子", any: "家なき子|持ち家なし|持ち家がない|賃貸住まい", docs: ["ienaki_lease", "fuhyo_heirs"], reason: "{target}が持ち家のない相続人（家なき子）に当たる可能性があるため", importance: "high" },
  { id: "DISABLED", title: "障害者の相続人", any: "障害", docs: ["disability_card"], reason: "{target}に障害者手帳があると発言があったため（障害者控除）", importance: "high" },
  { id: "PRIOR", title: "過去10年以内の相続", any: "過去の相続|前回の相続|相次|前の相続", docs: ["prior_inheritance_return"], reason: "被相続人が過去に相続で財産を取得していたと発言があったため（相次相続控除）", importance: "medium" },
  { id: "RENOUNCE", title: "相続放棄", any: "相続放棄|放棄", docs: ["renunciation_cert"], reason: "{target}が相続放棄をした（する予定）と発言があったため", importance: "high" },
  { id: "DAISHU", title: "代襲相続", any: "代襲|先に亡くな", docs: ["predeceased_koseki"], reason: "{target}が先に亡くなっており代襲相続があると発言があったため", importance: "high" },
  { id: "OVERSEAS", title: "海外居住の相続人", any: "海外居住|海外在住|海外に住|非居住", docs: ["overseas_heir_docs"], reason: "{target}が海外に住んでいると発言があったため", importance: "high" },
  { id: "FILING", title: "確定申告をしていた", any: "確定申告", docs: ["income_tax_returns"], reason: "被相続人が確定申告をしていたと発言があったため", importance: "medium" },
  { id: "SECOND", title: "二次相続の検討", any: "二次相続", docs: ["spouse_assets"], reason: "二次相続を考慮した分割の検討について発言があったため", importance: "low" },
];

/** 資料を求めない種類（事務所方針で不要としたもの）。汎用資料も出さない */
const NO_DOC_KINDS = "電話加入権|固定電話|著作権|特許|印税|商標";
const OTHER_ALL = [...OTHER_KINDS.map((k) => k.any), NO_DOC_KINDS].join("|");

export const DEFAULT_RULES: DocumentRule[] = [
  // ===== 案件共通（すべての案件で必要） =====
  rule({
    id: "R-BASIC-001",
    category: "basic",
    title: "本人確認・相続人確定のための書類",
    appliesTo: { kind: "case" },
    documentIds: ["mynumber_heirs", "koseki_decedent", "joseki_decedent", "koseki_heirs", "juminhyo_heirs", "inkan_heirs"],
    reason: "相続人の確定と申告書の作成に必要",
    period: { kind: "none" },
    importance: "high",
  }),
  rule({
    id: "R-BASIC-002",
    category: "basic",
    title: "事務所様式（略歴・連絡先）",
    appliesTo: { kind: "case" },
    documentIds: ["biography_decedent", "heir_contacts"],
    reason: "申告書の作成と財産の把握に必要",
    period: { kind: "none" },
    importance: "medium",
  }),
  rule({
    id: "R-BASIC-003",
    category: "basic",
    title: "法定相続情報一覧図（取得済みの場合のみ）",
    appliesTo: { kind: "case" },
    documentIds: ["houtei_ichiran"],
    reason: "取得済みであれば戸籍一式の代わりに使えるため（任意）",
    period: { kind: "none" },
    importance: "low",
  }),
  rule({
    id: "R-CASH-001",
    category: "deposits",
    title: "手元現金",
    appliesTo: { kind: "case" },
    documentIds: ["cash_on_hand"],
    reason: "相続開始日時点の現金と、死亡前後の預金引出しの確認に必要",
    period: { kind: "as_of_death" },
    importance: "high",
  }),

  // ===== 被相続人・相続人 =====
  rule({
    id: "R-DEC-001",
    category: "basic",
    title: "確定申告・準確定申告の資料",
    appliesTo: entity("decedent"),
    conditions: [{ attr: "income", op: "exists" }],
    exceptions: [{ attr: "income", op: "equals", value: "なし" }],
    documentIds: ["income_tax_returns", "income_tax_docs"],
    reason: "被相続人に所得（{income}）があると発言があったため（準確定申告の要否確認）",
    period: { kind: "none" },
    importance: "medium",
  }),
  rule({
    id: "R-HEIR-001",
    category: "special",
    title: "配偶者の財産（二次相続の試算用）",
    appliesTo: entity("heir"),
    conditions: [has("relationship", "妻|夫|配偶者")],
    documentIds: ["spouse_assets"],
    reason: "配偶者が相続人のため（二次相続を考慮した分割を試算する場合のみ）",
    period: { kind: "none" },
    importance: "low",
  }),

  // ===== 預貯金 =====
  rule({
    id: "R-DEP-001",
    category: "deposits",
    title: "預貯金の残高・取引履歴",
    appliesTo: entity("bank_account"),
    documentIds: ["bank_balance", "bank_history", "bank_passbook"],
    reason: "{target}の口座があると発言があったため（相続開始日の残高確認と、資金移動・名義預金・生前贈与の確認）",
    period: { kind: "years_before_death" },
    importance: "high",
    followUps: [
      { templateId: "bank.branch", question: "{target}の支店名", prompt: "{target}はどちらの支店ですか？", priority: "medium", answeredByAttr: "branch" },
      { templateId: "bank.deposit_types", question: "{target}の預金の種類（普通・定期・積立など）", prompt: "{target}は普通預金だけですか？定期預金や積立もありますか？", priority: "medium", answeredByAttr: "deposit_types" },
      { templateId: "bank.passbook", question: "{target}の通帳の保管状況（過去分がそろっているか）", prompt: "{target}の通帳は、過去の分もお手元にそろっていますか？", priority: "low", answeredByAttr: "passbook" },
    ],
  }),
  rule({
    id: "R-DEP-002",
    category: "deposits",
    title: "定期預金の既経過利息",
    appliesTo: entity("bank_account"),
    conditions: [{ attr: "deposit_types", op: "contains", value: "定期" }],
    documentIds: ["bank_accrued_interest"],
    reason: "{target}に定期預金があると発言があったため（既経過利息の計上）",
    period: { kind: "as_of_death" },
    importance: "medium",
  }),
  rule({
    id: "R-DEP-003",
    category: "deposits",
    title: "ゆうちょ銀行の現存照会",
    appliesTo: entity("bank_account"),
    conditions: [has("institution", "ゆうちょ|郵便局|郵貯")],
    documentIds: ["yucho_genson"],
    reason: "ゆうちょ銀行の口座があると発言があったため（口座・定額貯金の取りこぼし防止）",
    period: { kind: "as_of_death" },
    importance: "high",
  }),
  rule({
    id: "R-DEP-004",
    category: "deposits",
    title: "信用金庫・信用組合・農協の出資金",
    appliesTo: entity("bank_account"),
    conditions: [has("institution", "信用金庫|信金|信用組合|信組|農協|JA|農業協同組合")],
    documentIds: ["shinkin_capital"],
    reason: "{target}に口座があると発言があったため（出資金の確認）",
    period: { kind: "as_of_death" },
    importance: "medium",
  }),

  // ===== 土地・建物 =====
  rule({
    id: "R-RE-001",
    category: "real_estate",
    title: "不動産の評価資料",
    appliesTo: entity("real_estate"),
    documentIds: ["re_tax_notice", "re_registry", "re_maps", "re_valuation", "re_nayose"],
    reason: "{target}に不動産があると発言があったため（所有関係の確認と評価）",
    period: { kind: "as_of_death" },
    importance: "high",
    followUps: [
      { templateId: "re.address_detail", question: "{target}の所在地（地番・住居表示）の詳細", prompt: "{target}の詳しい住所（地番）を教えてください。", priority: "high", answeredByAttr: "address_detail" },
      { templateId: "re.ownership", question: "{target}の所有関係（単独・共有、名義人）", prompt: "{target}は亡くなった方の単独名義ですか？", priority: "high", answeredByAttr: "ownership" },
      { templateId: "re.usage", question: "{target}の利用状況（自宅・貸付・事業・空き家・農地）", prompt: "{target}は現在どのように使っていますか？", priority: "high", answeredByAttr: "usage" },
      { templateId: "re.residents", question: "{target}に住んでいた人・同居人", prompt: "{target}にはどなたがお住まいでしたか？", priority: "high", answeredByAttr: "residents" },
    ],
  }),
  rule({
    id: "R-RE-002",
    category: "real_estate",
    title: "貸付不動産の賃貸借資料",
    appliesTo: entity("real_estate"),
    conditions: [has("usage", "貸|賃貸|アパート|駐車場")],
    documentIds: ["re_lease"],
    reason: "{target}を貸し付けていると発言があったため（貸家・貸宅地の評価、預り敷金の確認）",
    period: { kind: "as_of_death" },
    importance: "high",
  }),
  rule({
    id: "R-RE-003",
    category: "real_estate",
    title: "借地の契約書",
    appliesTo: entity("real_estate"),
    conditions: [has("land_right", "借地")],
    documentIds: ["re_lease_land"],
    reason: "{target}が借地であると発言があったため（借地権の評価）",
    period: { kind: "as_of_death" },
    importance: "medium",
  }),
  rule({
    id: "R-RE-004",
    category: "real_estate",
    title: "農地の耕作権（小作）",
    appliesTo: entity("real_estate"),
    conditions: [has("usage", "小作|耕作権|農地を貸|貸付農地")],
    documentIds: ["re_farm_committee"],
    reason: "{target}の農地に小作（耕作権）があると発言があったため",
    period: { kind: "as_of_death" },
    importance: "medium",
  }),
  rule({
    id: "R-RE-005",
    category: "real_estate",
    title: "建物の火災保険",
    appliesTo: entity("real_estate"),
    exceptions: [{ attr: "kinds", op: "equals", value: "土地" }],
    documentIds: ["fire_insurance"],
    reason: "{target}に建物があるため（積立型火災保険等の解約返戻金の確認）",
    period: { kind: "as_of_death" },
    importance: "low",
  }),
  rule({
    id: "R-RE-006",
    category: "real_estate",
    title: "二世帯・一部賃貸の建物",
    appliesTo: entity("real_estate"),
    conditions: [has("usage", "二世帯|一部賃貸|一部を貸|店舗|事業")],
    documentIds: ["re_purchase"],
    reason: "{target}が二世帯住宅・一部賃貸・事業用と発言があったため（利用区分の確認）",
    period: { kind: "none" },
    importance: "medium",
  }),

  // ===== 上場株式・投資信託 =====
  rule({
    id: "R-SEC-001",
    category: "securities",
    title: "証券口座の残高・取引明細",
    appliesTo: entity("listed_security"),
    documentIds: ["sec_balance", "sec_reports", "sec_registry", "dividend_notice"],
    reason: "{target}に証券口座・投資商品があると発言があったため",
    period: { kind: "years_before_death" },
    importance: "high",
  }),
  rule({
    id: "R-SEC-002",
    category: "securities",
    title: "投資信託の解約価額",
    appliesTo: entity("listed_security"),
    conditions: [has("products", "投資信託|投信|ファンド")],
    documentIds: ["fund_details"],
    reason: "{target}に投資信託があると発言があったため（解約価額での評価）",
    period: { kind: "as_of_death" },
    importance: "medium",
  }),
  rule({
    id: "R-SEC-003",
    category: "misc",
    title: "外国株式・外貨建て商品",
    appliesTo: entity("listed_security"),
    conditions: [has("products", "外国|米国|外貨|海外")],
    documentIds: ["foreign_assets"],
    reason: "{target}に外国株式・外貨建て商品があると発言があったため",
    period: { kind: "as_of_death" },
    importance: "high",
  }),

  // ===== 非上場株式 =====
  rule({
    id: "R-UNL-001",
    category: "unlisted",
    title: "非上場株式の評価資料",
    appliesTo: entity("unlisted_share"),
    documentIds: ["unlisted_financials", "unlisted_shareholders"],
    reason: "{target}の株式を保有していると発言があったため（株価評価）",
    period: { kind: "fiscal_years", years: 3 },
    importance: "high",
  }),

  // ===== 生命保険・退職金 =====
  rule({
    id: "R-INS-001",
    category: "insurance",
    title: "死亡保険金",
    appliesTo: entity("life_insurance"),
    exceptions: [{ attr: "policy_role", op: "contains", value: "契約者" }],
    documentIds: ["ins_payment", "ins_policy"],
    reason: "{target}の生命保険があると発言があったため（みなし相続財産・非課税枠の確認）",
    period: { kind: "as_of_death" },
    importance: "high",
    followUps: [
      { templateId: "ins.beneficiary", question: "{target}の受取人", prompt: "{target}の保険金の受取人はどなたですか？", priority: "high", answeredByAttr: "beneficiary" },
      { templateId: "ins.premium_payer", question: "{target}の保険料負担者・契約者", prompt: "{target}の保険料は、亡くなった方が払っていましたか？", priority: "medium", answeredByAttr: "premium_payer" },
    ],
  }),
  rule({
    id: "R-INS-002",
    category: "insurance",
    title: "生命保険契約に関する権利",
    appliesTo: entity("life_insurance"),
    conditions: [{ attr: "policy_role", op: "contains", value: "契約者" }],
    documentIds: ["ins_policy", "ins_surrender_value"],
    reason: "{target}について被相続人が契約者（保険料負担者）の保険があると発言があったため",
    period: { kind: "as_of_death" },
    importance: "high",
  }),
  rule({
    id: "R-INS-003",
    category: "insurance",
    title: "個人年金・年金保険",
    appliesTo: entity("life_insurance"),
    conditions: [has("insurance_type", "年金")],
    documentIds: ["annuity_docs"],
    reason: "{target}の個人年金・年金保険があると発言があったため（年金受給権の評価）",
    period: { kind: "as_of_death" },
    importance: "medium",
  }),
  rule({
    id: "R-RET-001",
    category: "insurance",
    title: "死亡退職金・確定拠出年金・共済金",
    appliesTo: entity("retirement_allowance"),
    documentIds: ["retirement_notice"],
    reason: "{target}から死亡退職金・死亡一時金・共済金等が出ると発言があったため",
    period: { kind: "as_of_death" },
    importance: "high",
  }),

  // ===== その他の財産（種類ごと） =====
  ...OTHER_KINDS.map((k) =>
    rule({
      id: `R-OTH-${k.id}`,
      category: k.id === "FOREIGN" ? "misc" : "other_assets",
      title: k.title,
      appliesTo: entity("other_asset"),
      conditions: [has("kind", k.any)],
      documentIds: k.docs,
      reason: k.reason,
      period: { kind: "as_of_death" },
      importance: k.importance,
    }),
  ),
  rule({
    id: "R-OTH-001",
    category: "other_assets",
    title: "その他の財産（種類が上記以外）",
    appliesTo: entity("other_asset"),
    exceptions: [has("kind", OTHER_ALL)],
    documentIds: ["other_asset_eval"],
    reason: "{target}について発言があったため",
    period: { kind: "as_of_death" },
    importance: "medium",
  }),

  // ===== 借入金・未払金 =====
  rule({
    id: "R-DEBT-001",
    category: "debts",
    title: "借入金",
    appliesTo: entity("debt"),
    exceptions: [has("description", "税|保険料|医療|入院|施設|介護|公共料金|電気|水道|ガス|クレジット|カード|後払い")],
    documentIds: ["debt_balance", "debt_contract"],
    reason: "{target}の借入金があると発言があったため（債務控除）",
    period: { kind: "as_of_death" },
    importance: "high",
  }),
  rule({
    id: "R-DEBT-002",
    category: "debts",
    title: "未納の税金・保険料",
    appliesTo: entity("debt"),
    conditions: [has("description", "税|保険料")],
    documentIds: ["unpaid_tax_notices"],
    reason: "未納の税金・保険料があると発言があったため（債務控除）",
    period: { kind: "none" },
    importance: "high",
  }),
  rule({
    id: "R-DEBT-003",
    category: "debts",
    title: "未払の医療費・施設費・公共料金",
    appliesTo: entity("debt"),
    conditions: [has("description", "医療|入院|施設|介護|公共料金|電気|水道|ガス")],
    documentIds: ["medical_bills"],
    reason: "未払の医療費・施設費等があると発言があったため（債務控除）",
    period: { kind: "none" },
    importance: "medium",
  }),
  rule({
    id: "R-DEBT-004",
    category: "debts",
    title: "クレジットカード・後払いの未払",
    appliesTo: entity("debt"),
    conditions: [has("description", "クレジット|カード|後払い")],
    documentIds: ["card_statement"],
    reason: "{target}の未払いがあると発言があったため（債務控除）",
    period: { kind: "as_of_death" },
    importance: "medium",
  }),

  // ===== 葬式費用 =====
  rule({
    id: "R-FUN-001",
    category: "funeral",
    title: "葬式費用",
    appliesTo: entity("funeral_expense"),
    documentIds: ["funeral_receipts", "funeral_memo"],
    reason: "葬儀の費用について発言があったため（葬式費用の控除）",
    period: { kind: "none" },
    importance: "high",
  }),

  // ===== 生前贈与 =====
  rule({
    id: "R-GIFT-001",
    category: "gifts",
    title: "生前贈与（暦年課税）",
    appliesTo: entity("lifetime_gift"),
    documentIds: ["gift_evidence", "gift_returns"],
    reason: "{target}への生前贈与について発言があったため（生前贈与加算・贈与税額控除の確認）",
    period: { kind: "gift_addition" },
    importance: "high",
    followUps: [
      { templateId: "gift.when", question: "{target}の贈与の時期", prompt: "{target}への贈与はいつ頃でしたか？", priority: "high", answeredByAttr: "date" },
      { templateId: "gift.amount", question: "{target}の贈与の金額", prompt: "{target}への贈与はいくらでしたか？", priority: "high", answeredByAttr: "amount" },
      { templateId: "gift.taxation", question: "{target}の贈与の課税方式（暦年・相続時精算課税・非課税特例）と申告の有無", prompt: "{target}の贈与について、贈与税の申告はしましたか？", priority: "medium", answeredByAttr: "taxation" },
    ],
  }),
  rule({
    id: "R-GIFT-002",
    category: "gifts",
    title: "相続時精算課税",
    appliesTo: entity("lifetime_gift"),
    conditions: [has("taxation", "精算")],
    documentIds: ["seisan_notice", "seisan_returns", "fuhyo_decedent", "fuhyo_heirs"],
    reason: "{target}について相続時精算課税の贈与があると発言があったため",
    period: { kind: "none" },
    importance: "high",
  }),
  rule({
    id: "R-GIFT-003",
    category: "gifts",
    title: "住宅取得等資金の贈与",
    appliesTo: entity("lifetime_gift"),
    conditions: [has("taxation", "住宅")],
    documentIds: ["housing_gift_docs"],
    reason: "{target}への住宅取得等資金の贈与について発言があったため",
    period: { kind: "none" },
    importance: "medium",
  }),
  rule({
    id: "R-GIFT-004",
    category: "gifts",
    title: "教育資金の一括贈与",
    appliesTo: entity("lifetime_gift"),
    conditions: [has("taxation", "教育資金")],
    documentIds: ["edu_gift_docs"],
    reason: "{target}への教育資金の一括贈与について発言があったため（管理残額の確認）",
    period: { kind: "as_of_death" },
    importance: "high",
  }),
  rule({
    id: "R-GIFT-005",
    category: "gifts",
    title: "結婚・子育て資金の一括贈与",
    appliesTo: entity("lifetime_gift"),
    conditions: [has("taxation", "結婚|子育て")],
    documentIds: ["marriage_gift_docs"],
    reason: "{target}への結婚・子育て資金の一括贈与について発言があったため（管理残額の確認）",
    period: { kind: "as_of_death" },
    importance: "high",
  }),

  // ===== 名義預金・名義財産 =====
  rule({
    id: "R-NOM-001",
    category: "nominee",
    title: "名義預金の可能性",
    appliesTo: entity("nominee_deposit"),
    exceptions: [has("asset", "不動産|土地|建物|株|保険")],
    documentIds: ["nominee_passbook"],
    reason: "{target}について、被相続人の資金による家族名義の預金の可能性が話されたため",
    period: { kind: "years_before_death" },
    importance: "high",
  }),
  rule({
    id: "R-NOM-002",
    category: "nominee",
    title: "家族名義の不動産・株式など",
    appliesTo: entity("nominee_deposit"),
    conditions: [has("asset", "不動産|土地|建物|株|保険")],
    documentIds: ["nominee_property"],
    reason: "{target}について、被相続人が資金を出した家族名義の財産の可能性が話されたため",
    period: { kind: "none" },
    importance: "high",
  }),

  // ===== 遺言 =====
  rule({
    id: "R-WILL-001",
    category: "will",
    title: "遺言書",
    appliesTo: entity("will"),
    exceptions: [{ attr: "exists", op: "equals", value: "なし" }],
    documentIds: ["will_copy"],
    reason: "遺言書があると発言があったため",
    period: { kind: "none" },
    importance: "high",
  }),

  // ===== 特記事項 =====
  ...SITUATIONS.map((x) =>
    rule({
      id: `R-SIT-${x.id}`,
      category: x.id === "RENOUNCE" ? "will" : x.id === "DAISHU" || x.id === "OVERSEAS" || x.id === "FILING" ? "basic" : "special",
      title: x.title,
      appliesTo: entity("situation"),
      conditions: [has("kind", x.any)],
      documentIds: x.docs,
      reason: x.reason,
      period: { kind: "none" },
      importance: x.importance,
    }),
  ),
];
