import type { EntityType } from "../types.js";

/**
 * 実体ごとの推奨属性キー。
 * AIはこのキーで値を返す。ルールの conditions はこのキーを参照する。
 * keyAttr は重複判定（同じ財産を二重登録しない）に使う属性。
 */
export interface EntitySpec {
  keyAttrs: string[];
  attributes: Record<string, string>;
}

/** 属性キーの日本語名（画面・Word 出力用。説明のかっこ書きは除く） */
export function attrLabel(type: EntityType, key: string): string {
  const d = ENTITY_SPECS[type]?.attributes[key];
  return d ? d.replace(/[（(].*$/, "") : key;
}

export const ENTITY_SPECS: Record<EntityType, EntitySpec> = {
  decedent: {
    keyAttrs: [],
    attributes: {
      name: "氏名",
      death_date: "死亡日（YYYY-MM-DD。曖昧なら発言どおり）",
      address: "最後の住所",
      birth_date: "生年月日",
      income: "所得の種類（年金・事業・不動産・給与など。なければ「なし」）",
      occupation: "職業",
    },
  },
  heir: {
    keyAttrs: ["name", "relationship"],
    attributes: {
      name: "氏名",
      relationship: "続柄（配偶者・長男・長女など）",
      address: "住所",
      cohabited: "被相続人との同居（同居・別居）",
      notes: "未成年・障害・相続放棄予定など",
    },
  },
  bank_account: {
    keyAttrs: ["institution"],
    attributes: {
      institution: "金融機関名（正式名称）",
      branch: "支店名",
      deposit_types: "預金の種類（普通預金・定期預金など。複数は「、」区切り）",
      account_holder: "名義人",
      balance: "残高（発言どおり。例: 約300万円）",
      passbook: "通帳の有無・保管状況",
    },
  },
  real_estate: {
    keyAttrs: ["location", "usage"],
    attributes: {
      location: "所在地（市区町村まで）",
      address_detail: "地番・住居表示などの詳細",
      kinds: "種類（土地・建物・マンションなど。複数は「、」区切り）",
      usage: "利用状況（自宅・二世帯住宅・一部賃貸・貸家・アパート・貸地・駐車場・店舗/事業用・空き家・農地・小作など。複数は「、」区切り）",
      ownership: "所有関係（単独・共有と持分、名義人）",
      residents: "居住者・同居人",
      land_right: "土地の権利（所有地・借地・底地）",
      area: "面積",
    },
  },
  listed_security: {
    keyAttrs: ["institution"],
    attributes: {
      institution: "証券会社・販売金融機関",
      products: "商品（株式・投資信託・国債・社債・外国株式・外貨建て商品・NISA口座など。複数は「、」区切り）",
      issues: "銘柄名",
      value: "評価額（発言どおり）",
    },
  },
  unlisted_share: {
    keyAttrs: ["company"],
    attributes: {
      company: "会社名",
      shares: "株数・持株割合",
      role: "被相続人の役職",
      loans: "会社との貸借",
    },
  },
  life_insurance: {
    keyAttrs: ["insurer"],
    attributes: {
      insurer: "保険会社",
      insurance_type: "保険の種類（終身・定期・養老・医療・個人年金・年金保険・JA共済・県民共済・かんぽ など）",
      beneficiary: "受取人",
      amount: "保険金額（発言どおり）",
      premium_payer: "保険料負担者",
      policy_role: "被相続人の立場（被保険者／契約者のみ など）",
    },
  },
  retirement_allowance: {
    keyAttrs: ["payer"],
    attributes: { payer: "支給者（勤務先、iDeCo・企業型確定拠出年金の運営機関、小規模企業共済など）", kind: "種類（死亡退職金・弔慰金・確定拠出年金の死亡一時金・小規模企業共済の共済金など）", amount: "金額", recipient: "受取人" },
  },
  other_asset: {
    keyAttrs: ["kind", "description"],
    attributes: {
      kind: "種類（次から選ぶ: 自動車 / 電話加入権 / ゴルフ会員権・リゾート会員権 / 貸付金・前払金 / 貴金属・書画・骨董 / 未収金・還付金 / 暗号資産 / 電子マネー・スマホ決済・ポイント / 金地金・純金積立 / 国外財産 / 家財 / 事業用資産 / 著作権・特許権 / 太陽光発電設備 / 貸金庫 / その他）",
      description: "財産の内容（例: トヨタ・プリウス、ビットコイン、PayPay残高、所得税の還付金）",
      value: "金額・価値（発言どおり）",
      notes: "補足",
    },
  },
  debt: {
    keyAttrs: ["creditor", "description"],
    attributes: {
      creditor: "債権者（借入先・未払先）",
      description: "内容（住宅ローン・アパートローン・個人からの借入・未納の住民税/固定資産税・未払の国民健康保険料/介護保険料・未払の入院費/施設費・公共料金・クレジットカードの未払 など）",
      amount: "金額",
      group_insurance: "団体信用生命保険の有無",
    },
  },
  funeral_expense: {
    keyAttrs: ["payee"],
    attributes: { payee: "支払先（葬儀社・寺院など）", amount: "金額", receipt: "領収書の有無", payer: "負担者" },
  },
  lifetime_gift: {
    keyAttrs: ["recipient"],
    attributes: {
      recipient: "受贈者（氏名・続柄）",
      date: "贈与の時期（発言どおり。曖昧なら曖昧なまま）",
      amount: "金額（発言どおり）",
      asset: "贈与財産の内容",
      taxation: "課税方式（暦年課税・相続時精算課税・非課税特例）",
      returns: "贈与税申告の有無",
    },
  },
  nominee_deposit: {
    keyAttrs: ["holder", "institution"],
    attributes: {
      holder: "名義人",
      asset: "財産の種類（預金・不動産・株式・保険など。預金以外の場合に記入）",
      institution: "金融機関",
      funding: "資金の出し手",
      custody: "通帳・印鑑の管理者",
      amount: "金額",
    },
  },
  will: {
    keyAttrs: [],
    attributes: { exists: "遺言書の有無（あり・なし・不明）", type: "種類（公正証書・自筆・保管制度利用）", custody: "保管場所", contents: "内容の概要" },
  },
  situation: {
    keyAttrs: ["kind", "person"],
    attributes: {
      kind: "種類（次から選ぶ: 老人ホーム等への入居 / 家なき子（持ち家のない別居の相続人） / 障害者の相続人 / 未成年の相続人 / 過去10年以内の相続 / 相続放棄 / 代襲相続 / 海外居住の相続人 / 養子縁組 / 確定申告をしていた / 二次相続の検討 / その他）",
      person: "対象の人（続柄・氏名）",
      detail: "内容（施設名・入居時期・障害の等級など発言どおり）",
    },
  },
  other_fact: {
    keyAttrs: ["topic"],
    attributes: { topic: "論点", detail: "内容" },
  },
};
