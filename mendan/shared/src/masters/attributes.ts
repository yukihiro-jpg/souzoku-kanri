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
      usage: "利用状況（自宅・貸家・貸地・駐車場・事業用・空き家・農地など）",
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
      products: "商品（株式・投資信託・国債など）",
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
      insurance_type: "保険の種類（終身・定期・養老・医療など）",
      beneficiary: "受取人",
      amount: "保険金額（発言どおり）",
      premium_payer: "保険料負担者",
      policy_role: "被相続人の立場（被保険者／契約者のみ など）",
    },
  },
  retirement_allowance: {
    keyAttrs: ["payer"],
    attributes: { payer: "支給者（勤務先）", amount: "金額", recipient: "受取人" },
  },
  other_asset: {
    keyAttrs: ["description"],
    attributes: { description: "財産の内容（自動車・貴金属・貸付金・還付金など）", value: "金額・価値", notes: "補足" },
  },
  debt: {
    keyAttrs: ["creditor", "description"],
    attributes: {
      creditor: "債権者（借入先・未払先）",
      description: "内容（住宅ローン・未払医療費・未納税金など）",
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
  other_fact: {
    keyAttrs: ["topic"],
    attributes: { topic: "論点", detail: "内容" },
  },
};
