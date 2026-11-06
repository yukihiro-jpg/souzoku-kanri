import type { CategoryId } from "../types.js";

/**
 * 資料マスタ
 *
 * 資料の名称・取得先・取得方法は、ここ（または Firestore の documentMaster）に
 * 登録した内容だけを使う。AIに取得方法を作らせない（指示書 10.）。
 * name の {target} は対象の金融機関名・所在地などに置き換わる。
 */
export interface DocumentMaster {
  id: string;
  name: string;
  category: CategoryId;
  /** Google Drive の保存先フォルダ（Phase 3 で使用） */
  driveFolder: string;
  source: string;
  howTo: string;
  defaultSubmitter: string;
  /** true: 財産ごとではなく案件に1つだけ必要な資料（複数の財産から判定されても1件にまとめる） */
  perCase?: boolean;
}

export const DOCUMENT_MASTER: DocumentMaster[] = [
  // 基本
  { id: "koseki_decedent", name: "被相続人の出生から死亡までの戸籍謄本等", category: "basic", driveFolder: "02_相続人関係", source: "本籍地の市区町村役場", howTo: "窓口または郵送で請求。最寄りの役場で他市区町村分もまとめて請求できる場合があります（広域交付）。", defaultSubmitter: "相続人代表" },
  { id: "joseki_decedent", name: "被相続人の住民票の除票（本籍地記載）", category: "basic", driveFolder: "02_相続人関係", source: "最後の住所地の市区町村役場", howTo: "窓口または郵送で請求。", defaultSubmitter: "相続人代表" },
  { id: "koseki_heirs", name: "相続人全員の戸籍謄本", category: "basic", driveFolder: "02_相続人関係", source: "各相続人の本籍地の市区町村役場", howTo: "相続開始日以後に取得したものをご用意ください。", defaultSubmitter: "各相続人" },
  { id: "juminhyo_heirs", name: "相続人全員の住民票", category: "basic", driveFolder: "02_相続人関係", source: "各相続人の住所地の市区町村役場", howTo: "窓口・郵送またはコンビニ交付（マイナンバーカード）。", defaultSubmitter: "各相続人" },
  { id: "inkan_heirs", name: "相続人全員の印鑑登録証明書", category: "basic", driveFolder: "02_相続人関係", source: "各相続人の住所地の市区町村役場", howTo: "遺産分割協議書・各種手続に使用します。", defaultSubmitter: "各相続人" },
  { id: "mynumber_heirs", name: "相続人全員のマイナンバー確認書類・本人確認書類（写し）", category: "basic", driveFolder: "02_相続人関係", source: "各相続人", howTo: "マイナンバーカード両面の写し等。", defaultSubmitter: "各相続人" },

  // 預貯金
  { id: "bank_balance", name: "{target}の残高証明書（相続開始日時点）", category: "deposits", driveFolder: "03_預貯金", source: "{target}（取引店または相続センター）", howTo: "相続人が金融機関所定の依頼書で請求。定期預金がある場合は既経過利息の記載も依頼してください。", defaultSubmitter: "相続人代表" },
  { id: "bank_history", name: "{target}の取引履歴（入出金明細）", category: "deposits", driveFolder: "03_預貯金", source: "{target}（取引店または相続センター）", howTo: "金融機関所定の依頼書で請求（手数料がかかる場合があります）。通帳がそろっている期間は通帳の写しで代替できる場合があります。", defaultSubmitter: "相続人代表" },
  { id: "bank_passbook", name: "{target}の通帳・証書（写し）", category: "deposits", driveFolder: "03_預貯金", source: "ご自宅で保管しているもの", howTo: "最終記帳ページまでの写しをご用意ください。", defaultSubmitter: "相続人代表" },
  { id: "bank_accrued_interest", name: "{target}の定期預金の既経過利息計算書", category: "deposits", driveFolder: "03_預貯金", source: "{target}", howTo: "残高証明書の請求時にあわせて依頼してください。", defaultSubmitter: "相続人代表" },

  // 不動産
  { id: "re_registry", name: "{target}の登記事項証明書（全部事項証明書）", category: "real_estate", driveFolder: "04_不動産", source: "法務局（全国どこの法務局でも取得可）", howTo: "法務局窓口・郵送またはオンライン請求。", defaultSubmitter: "事務所で取得可" },
  { id: "re_nayose", name: "{target}所在の市区町村の固定資産税名寄帳", category: "real_estate", driveFolder: "04_不動産", source: "不動産所在地の市区町村役場（資産税課等）", howTo: "相続人であることがわかる戸籍等を添えて請求。", defaultSubmitter: "相続人代表" },
  { id: "re_valuation", name: "{target}の固定資産評価証明書", category: "real_estate", driveFolder: "04_不動産", source: "不動産所在地の市区町村役場（資産税課等）", howTo: "相続開始年度のものを請求。", defaultSubmitter: "相続人代表" },
  { id: "re_tax_notice", name: "{target}の固定資産税 課税明細書（納税通知書）", category: "real_estate", driveFolder: "04_不動産", source: "ご自宅で保管しているもの", howTo: "相続開始年度の通知書の写しをご用意ください。", defaultSubmitter: "相続人代表" },
  { id: "re_maps", name: "{target}の公図・地積測量図等の評価資料", category: "real_estate", driveFolder: "04_不動産", source: "法務局", howTo: "事務所で取得できます。", defaultSubmitter: "事務所で取得可" },
  { id: "re_lease", name: "{target}の賃貸借契約書・地代家賃の収支資料", category: "real_estate", driveFolder: "04_不動産", source: "ご自宅で保管しているもの／管理会社", howTo: "賃借人ごとの契約書、敷金の預り状況がわかる資料。", defaultSubmitter: "相続人代表" },
  { id: "re_lease_land", name: "{target}の土地賃貸借契約書（借地）", category: "real_estate", driveFolder: "04_不動産", source: "ご自宅で保管しているもの", howTo: "地代の支払状況がわかる資料もあわせてご用意ください。", defaultSubmitter: "相続人代表" },

  // 有価証券
  { id: "sec_balance", name: "{target}の残高証明書（相続開始日時点）", category: "securities", driveFolder: "05_有価証券", source: "{target}", howTo: "相続人が証券会社所定の依頼書で請求。", defaultSubmitter: "相続人代表" },
  { id: "sec_reports", name: "{target}の取引残高報告書・取引報告書", category: "securities", driveFolder: "05_有価証券", source: "{target}／ご自宅で保管しているもの", howTo: "直近の報告書をご用意ください。", defaultSubmitter: "相続人代表" },

  // 非上場株式
  { id: "unlisted_financials", name: "{target}の決算書・法人税申告書（直近3期分）", category: "unlisted", driveFolder: "05_有価証券", source: "{target}（会社）／顧問税理士", howTo: "勘定科目内訳書・別表を含む一式。", defaultSubmitter: "会社担当者" },
  { id: "unlisted_shareholders", name: "{target}の株主名簿", category: "unlisted", driveFolder: "05_有価証券", source: "{target}（会社）", howTo: "相続開始日時点のもの。", defaultSubmitter: "会社担当者" },

  // 生命保険・退職金
  { id: "ins_payment", name: "{target}の死亡保険金支払通知書", category: "insurance", driveFolder: "06_生命保険", source: "{target}", howTo: "保険金請求後に保険会社から送付されます。", defaultSubmitter: "保険金受取人" },
  { id: "ins_policy", name: "{target}の保険証券（写し）", category: "insurance", driveFolder: "06_生命保険", source: "ご自宅で保管しているもの", howTo: "契約者・被保険者・受取人がわかるページ。", defaultSubmitter: "相続人代表" },
  { id: "ins_surrender_value", name: "{target}の解約返戻金相当額証明書", category: "insurance", driveFolder: "06_生命保険", source: "{target}", howTo: "被相続人が契約者（保険料負担者）の場合に保険会社へ請求。", defaultSubmitter: "契約を引き継ぐ方" },
  { id: "retirement_notice", name: "{target}の死亡退職金・弔慰金の支払通知書", category: "insurance", driveFolder: "06_生命保険", source: "{target}（勤務先）", howTo: "支給額・支給日がわかる資料。", defaultSubmitter: "受取人" },

  // 債務・葬式費用
  { id: "debt_balance", name: "{target}の借入金残高証明書（相続開始日時点）", category: "debts", driveFolder: "07_債務・葬式費用", source: "{target}", howTo: "金融機関所定の依頼書で請求。", defaultSubmitter: "相続人代表" },
  { id: "debt_contract", name: "{target}の金銭消費貸借契約書・返済予定表", category: "debts", driveFolder: "07_債務・葬式費用", source: "ご自宅で保管しているもの", howTo: "団体信用生命保険の有無がわかる資料もあわせて。", defaultSubmitter: "相続人代表" },
  { id: "unpaid_tax_notices", name: "相続開始後に届いた税金・医療費等の請求書・領収書", category: "debts", driveFolder: "07_債務・葬式費用", source: "ご自宅で保管しているもの", howTo: "住民税・固定資産税・入院費・施設費など。", defaultSubmitter: "相続人代表" },
  { id: "funeral_receipts", name: "葬儀費用の領収書・請求書", category: "funeral", driveFolder: "07_債務・葬式費用", source: "葬儀社など", howTo: "飲食・返礼品・火葬料等を含めてご用意ください。", defaultSubmitter: "喪主", perCase: true },
  { id: "funeral_memo", name: "領収書のない葬儀関連支出のメモ（お布施・心付け等）", category: "funeral", driveFolder: "07_債務・葬式費用", source: "喪主の方の記録", howTo: "日付・支払先・金額をメモでご用意ください。", defaultSubmitter: "喪主", perCase: true },

  // 生前贈与・名義預金
  { id: "gift_returns", name: "贈与税の申告書（控え）", category: "gifts", driveFolder: "08_贈与関係", source: "受贈者が保管しているもの", howTo: "見当たらない場合は税務署で開示請求できます。", defaultSubmitter: "受贈者", perCase: true },
  { id: "gift_evidence", name: "{target}に関する贈与契約書・振込記録", category: "gifts", driveFolder: "08_贈与関係", source: "受贈者が保管しているもの", howTo: "通帳の写しなど、贈与の時期と金額がわかる資料。", defaultSubmitter: "受贈者" },
  { id: "seisan_notice", name: "相続時精算課税選択届出書（控え）", category: "gifts", driveFolder: "08_贈与関係", source: "受贈者が保管しているもの", howTo: "見当たらない場合は税務署へ確認します。", defaultSubmitter: "受贈者", perCase: true },
  { id: "nominee_passbook", name: "{target}（家族名義口座）の通帳写し・取引履歴", category: "nominee", driveFolder: "03_預貯金", source: "名義人ご本人／金融機関", howTo: "口座開設時期・入金元がわかる資料。", defaultSubmitter: "口座名義人" },

  // 遺言
  { id: "will_copy", name: "遺言書（写し）・検認済証明書", category: "will", driveFolder: "09_その他", source: "ご自宅／公証役場／法務局（自筆証書遺言保管制度）", howTo: "自筆証書遺言は家庭裁判所の検認が必要な場合があります（保管制度利用分を除く）。", defaultSubmitter: "相続人代表", perCase: true },

  // その他
  { id: "other_asset_eval", name: "{target}の内容・価額がわかる資料", category: "other_assets", driveFolder: "09_その他", source: "ご自宅で保管しているもの", howTo: "車検証・査定書・契約書・通知書など。", defaultSubmitter: "相続人代表" },
  { id: "income_tax_docs", name: "準確定申告用資料（源泉徴収票・年金の源泉徴収票・収支資料）", category: "basic", driveFolder: "09_その他", source: "勤務先・年金事務所・ご自宅", howTo: "亡くなった年の1月1日から死亡日までの分。", defaultSubmitter: "相続人代表", perCase: true },
];

export const DOCUMENT_MASTER_BY_ID = new Map(DOCUMENT_MASTER.map((d) => [d.id, d]));
