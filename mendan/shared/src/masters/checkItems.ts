import type { CategoryId, EntityType, Priority } from "../types.js";

/**
 * 確認事項マスタ（初期値）
 *
 * question: 確認すべき事項 / prompt: 担当者が実際に聞く質問文の例
 * autoFromEntityTypes: その種類の財産が会話に出てきた時点で「AI確認候補」にする
 */
export interface CheckItemMaster {
  id: string;
  category: CategoryId;
  question: string;
  prompt: string;
  priority: Priority;
  autoFromEntityTypes?: EntityType[];
  /** 属性の内容で自動候補化（any: 「|」区切りのいずれかを含む、notAny: いずれも含まない。両方なし: 属性があれば） */
  autoFrom?: { type: EntityType; attr: string; any?: string; notAny?: string }[];
}

export const CHECK_ITEM_MASTER: CheckItemMaster[] = [
  // 1. 基本情報
  { id: "basic.decedent_name", category: "basic", question: "被相続人の氏名", prompt: "亡くなられた方のお名前を正確に教えてください。", priority: "high" },
  { id: "basic.death_date", category: "basic", question: "相続開始日（死亡日）", prompt: "お亡くなりになった日はいつですか？", priority: "high" },
  { id: "basic.decedent_address", category: "basic", question: "被相続人の最後の住所", prompt: "亡くなる直前のご住所はどちらでしたか？", priority: "high" },
  { id: "basic.decedent_birth", category: "basic", question: "被相続人の生年月日・本籍地", prompt: "生年月日と本籍地を教えてください。", priority: "medium" },
  { id: "basic.heirs", category: "basic", question: "相続人の構成（配偶者・子・その他）", prompt: "相続人になる方は、どなたとどなたですか？", priority: "high", autoFromEntityTypes: ["heir"] },
  { id: "basic.heir_contacts", category: "basic", question: "相続人の住所・連絡先", prompt: "相続人の皆さまのご住所と連絡先を教えてください。", priority: "medium" },
  { id: "basic.adoption", category: "basic", question: "養子縁組の有無", prompt: "養子縁組をされている方はいらっしゃいますか？", priority: "medium", autoFrom: [{ type: "situation", attr: "kind", any: "養子" }] },
  { id: "basic.predeceased", category: "basic", question: "先に亡くなった子など（代襲相続）の有無", prompt: "お子さまの中で、先に亡くなられた方はいらっしゃいますか？", priority: "medium", autoFrom: [{ type: "situation", attr: "kind", any: "代襲|先に亡くな" }] },
  { id: "basic.minor_disabled", category: "basic", question: "未成年者・障害者の相続人の有無", prompt: "相続人に未成年の方や障害者手帳をお持ちの方はいますか？", priority: "medium", autoFrom: [{ type: "situation", attr: "kind", any: "障害|未成年" }] },
  { id: "basic.renunciation", category: "basic", question: "相続放棄の予定", prompt: "相続放棄を考えている方はいらっしゃいますか？", priority: "medium", autoFrom: [{ type: "situation", attr: "kind", any: "放棄" }] },
  { id: "basic.prior_inheritance", category: "basic", question: "10年以内の相次相続の有無", prompt: "亡くなった方が、10年以内に別の相続で財産を取得したことはありますか？", priority: "low", autoFrom: [{ type: "situation", attr: "kind", any: "過去の相続|前回の相続|相次|前の相続" }] },
  { id: "basic.final_income_tax", category: "basic", question: "準確定申告の要否（事業・不動産所得・年金等）", prompt: "亡くなった方に、事業や不動産の収入、年金収入はありましたか？確定申告はしていましたか？", priority: "medium", autoFrom: [{ type: "decedent", attr: "income", notAny: "なし" }, { type: "situation", attr: "kind", any: "確定申告" }] },

  // 2. 預貯金
  { id: "deposits.institutions", category: "deposits", question: "取引金融機関（銀行・信用金庫・ゆうちょ等）", prompt: "亡くなった方が口座をお持ちだった金融機関をすべて教えてください。", priority: "high", autoFromEntityTypes: ["bank_account"] },
  { id: "deposits.other_institutions", category: "deposits", question: "他の金融機関の口座の有無（ネット銀行含む）", prompt: "ほかにも口座をお持ちの金融機関はありますか？ネット銀行やゆうちょはいかがですか？", priority: "high" },
  { id: "deposits.online", category: "deposits", question: "ネット銀行・ネット証券の口座の有無（スマホのアプリやメールも確認）", prompt: "ネット銀行やネット証券は使っていましたか？スマホのアプリや届いているメールで確認できることがあります。", priority: "high" },
  { id: "deposits.time_deposits", category: "deposits", question: "定期預金・定期積金の有無", prompt: "定期預金や積立はありましたか？", priority: "medium" },
  { id: "deposits.cash", category: "deposits", question: "手元現金・貸金庫の有無", prompt: "ご自宅に現金はありましたか？貸金庫の契約はありますか？", priority: "high", autoFrom: [{ type: "other_asset", attr: "kind", any: "貸金庫|現金" }] },
  { id: "deposits.withdrawals", category: "deposits", question: "死亡前後の預金引出しの有無", prompt: "亡くなる前後に、口座からまとまったお金を引き出したことはありますか？", priority: "high" },

  // 3. 土地・建物
  { id: "real_estate.owned", category: "real_estate", question: "所有不動産の有無・所在地", prompt: "亡くなった方名義の土地や建物はどちらにありますか？", priority: "high", autoFromEntityTypes: ["real_estate"] },
  { id: "real_estate.other_regions", category: "real_estate", question: "他の市町村・遠方の不動産の有無", prompt: "ほかの市町村や遠方にお持ちの土地・建物はありますか？", priority: "high" },
  { id: "real_estate.rental", category: "real_estate", question: "貸地・貸家・アパート・駐車場等の有無", prompt: "人に貸している土地や建物、駐車場はありますか？", priority: "high" },
  { id: "real_estate.co_ownership", category: "real_estate", question: "共有持分の有無", prompt: "ほかの方と共有になっている不動産はありますか？", priority: "medium" },
  { id: "real_estate.farmland_forest", category: "real_estate", question: "農地・山林の有無", prompt: "田畑や山林はお持ちでしたか？", priority: "medium" },
  { id: "real_estate.leasehold", category: "real_estate", question: "借地（借地権）・底地の有無", prompt: "地代を払って借りている土地の上に建物はありますか？", priority: "medium" },

  // 4. 上場株式・投資信託
  { id: "securities.accounts", category: "securities", question: "証券会社の口座・上場株式の有無", prompt: "株式や投資信託をお持ちでしたか？証券会社はどちらですか？", priority: "high", autoFromEntityTypes: ["listed_security"] },
  { id: "securities.funds_bonds", category: "securities", question: "投資信託・債券（銀行窓口販売分を含む）の有無", prompt: "銀行の窓口で購入した投資信託や国債はありますか？", priority: "medium", autoFrom: [{ type: "listed_security", attr: "products", any: "投資信託|投信|国債|社債|債券|ファンド" }] },
  { id: "securities.unpaid_dividends", category: "securities", question: "未受領の配当金の有無", prompt: "受け取っていない配当金の通知は届いていますか？", priority: "low" },

  // 5. 非上場株式
  { id: "unlisted.shares", category: "unlisted", question: "同族会社・非上場株式の有無", prompt: "ご家族の会社など、上場していない会社の株式はお持ちでしたか？", priority: "high", autoFromEntityTypes: ["unlisted_share"] },
  { id: "unlisted.loans", category: "unlisted", question: "会社への貸付金・会社からの借入の有無", prompt: "その会社にお金を貸していたり、借りていたりしましたか？", priority: "medium" },

  // 6. 生命保険・死亡退職金
  { id: "insurance.death_benefit", category: "insurance", question: "死亡保険金の有無（保険会社・受取人。JA共済・県民共済・かんぽ生命を含む）", prompt: "亡くなったことで受け取る生命保険や共済はありますか？保険会社と受取人を教えてください。", priority: "high", autoFromEntityTypes: ["life_insurance"] },
  { id: "insurance.owned_policies", category: "insurance", question: "被相続人が契約者で他の人が被保険者の保険（解約返戻金）", prompt: "亡くなった方が保険料を払っていた、ご家族が被保険者の保険はありますか？", priority: "high" },
  { id: "insurance.retirement", category: "insurance", question: "死亡退職金・弔慰金の有無", prompt: "勤務先などから退職金や弔慰金は出ますか？", priority: "medium", autoFromEntityTypes: ["retirement_allowance"] },
  { id: "insurance.dc_kyosai", category: "insurance", question: "確定拠出年金（iDeCo・企業型）・小規模企業共済の有無", prompt: "iDeCo（個人型確定拠出年金）や会社の確定拠出年金、小規模企業共済に加入していましたか？", priority: "medium", autoFrom: [{ type: "retirement_allowance", attr: "payer", any: "確定拠出|iDeCo|イデコ|小規模企業共済" }, { type: "retirement_allowance", attr: "kind", any: "確定拠出|iDeCo|イデコ|小規模企業共済" }] },
  { id: "insurance.annuity", category: "insurance", question: "個人年金保険・年金保険の有無", prompt: "個人年金保険など、年金で受け取る保険はありましたか？", priority: "medium", autoFrom: [{ type: "life_insurance", attr: "insurance_type", any: "年金" }] },
  { id: "insurance.fire", category: "insurance", question: "火災保険・地震保険（積立型）の有無と契約者", prompt: "建物の火災保険は、どなたが契約していますか？積立型ですか？", priority: "low" },
  { id: "insurance.pension", category: "insurance", question: "未支給年金の有無", prompt: "年金の未支給分の手続きはされましたか？", priority: "low" },

  // 7. その他の財産
  { id: "other_assets.receivables", category: "other_assets", question: "貸付金・未収金（家賃・給与等）の有無", prompt: "人に貸しているお金や、まだ受け取っていない家賃・給与はありますか？", priority: "medium", autoFrom: [{ type: "other_asset", attr: "kind", any: "貸付|貸したお金|前払|未収|未払の給与|未払いの給与" }] },
  { id: "other_assets.vehicles", category: "other_assets", question: "自動車・バイク等の有無", prompt: "亡くなった方名義の車はありますか？", priority: "low", autoFrom: [{ type: "other_asset", attr: "kind", any: "自動車|車|バイク" }] },
  { id: "other_assets.valuables", category: "other_assets", question: "貴金属・美術品・骨董品の有無", prompt: "貴金属や美術品、骨董品などはお持ちでしたか？", priority: "low", autoFrom: [{ type: "other_asset", attr: "kind", any: "貴金属|宝石|書画|骨董|美術|絵画" }] },
  { id: "other_assets.memberships", category: "other_assets", question: "ゴルフ会員権・リゾート会員権の有無", prompt: "ゴルフ会員権などはお持ちでしたか？", priority: "low", autoFrom: [{ type: "other_asset", attr: "kind", any: "ゴルフ|リゾート|会員権" }] },
  { id: "other_assets.business", category: "other_assets", question: "事業用資産（個人事業）の有無", prompt: "個人で事業（お店・農業・不動産賃貸など）をされていましたか？", priority: "medium", autoFrom: [{ type: "other_asset", attr: "kind", any: "事業|店舗|在庫|売掛" }] },
  { id: "other_assets.digital", category: "other_assets", question: "暗号資産（ビットコイン等）の有無", prompt: "ビットコインなどの暗号資産を持っていましたか？", priority: "medium", autoFrom: [{ type: "other_asset", attr: "kind", any: "暗号|仮想通貨|ビットコイン|イーサリアム" }] },
  { id: "other_assets.emoney", category: "other_assets", question: "電子マネー・スマホ決済（○○ペイ）・ポイントの残高", prompt: "スマホ決済や電子マネーに、まとまった残高はありましたか？", priority: "low", autoFrom: [{ type: "other_asset", attr: "kind", any: "電子マネー|スマホ決済|ペイ|ポイント|プリペイド" }] },
  { id: "other_assets.gold", category: "other_assets", question: "金地金・純金積立・金貨の有無", prompt: "金の延べ棒や純金積立、金貨などはお持ちでしたか？", priority: "low", autoFrom: [{ type: "other_asset", attr: "kind", any: "金地金|純金|プラチナ|金貨|金の延べ棒" }] },
  { id: "other_assets.phone", category: "other_assets", question: "電話加入権（固定電話）の有無", prompt: "ご自宅に固定電話はありましたか？", priority: "low", autoFrom: [{ type: "other_asset", attr: "kind", any: "電話加入権|固定電話" }] },
  { id: "other_assets.solar", category: "other_assets", question: "太陽光発電設備の有無", prompt: "ご自宅などに太陽光発電を付けていましたか？", priority: "low", autoFrom: [{ type: "other_asset", attr: "kind", any: "太陽光" }] },
  { id: "other_assets.ip", category: "other_assets", question: "著作権・特許権など収入のある権利", prompt: "印税や特許など、権利による収入はありましたか？", priority: "low", autoFrom: [{ type: "other_asset", attr: "kind", any: "著作権|特許|印税|商標" }] },
  { id: "other_assets.refunds", category: "other_assets", question: "還付金（所得税・医療費・介護保険料等）の有無", prompt: "税金や介護保険料などの還付通知、高額療養費の通知は届いていますか？", priority: "low", autoFrom: [{ type: "other_asset", attr: "kind", any: "還付|高額療養" }] },

  // 8. 借入金・未払金
  { id: "debts.loans", category: "debts", question: "借入金（住宅ローン・アパートローン等）の有無", prompt: "亡くなった方に借入金やローンはありましたか？", priority: "high", autoFrom: [{ type: "debt", attr: "description", notAny: "税|保険料|医療|入院|施設|介護|公共料金|電気|水道|ガス|クレジット|カード|後払い" }] },
  { id: "debts.unpaid_taxes", category: "debts", question: "未納の税金（住民税・固定資産税等）", prompt: "亡くなった後に届いた住民税や固定資産税、保険料の通知はありますか？", priority: "high", autoFrom: [{ type: "debt", attr: "description", any: "税|保険料" }] },
  { id: "debts.medical", category: "debts", question: "未払の医療費・介護費・施設費", prompt: "亡くなった後に支払った入院費や施設の費用、公共料金はありますか？", priority: "medium", autoFrom: [{ type: "debt", attr: "description", any: "医療|入院|施設|介護|公共料金|電気|水道|ガス" }] },
  { id: "debts.credit", category: "debts", question: "クレジットカード・後払い決済の未払", prompt: "クレジットカードの引き落としで、亡くなった後に支払ったものはありますか？", priority: "low", autoFrom: [{ type: "debt", attr: "description", any: "クレジット|カード|後払い" }] },
  { id: "debts.guarantee", category: "debts", question: "連帯保証債務の有無", prompt: "どなたかの借入の保証人になっていましたか？", priority: "medium" },
  { id: "debts.deposits_received", category: "debts", question: "預り敷金・保証金の有無", prompt: "賃借人から預かっている敷金はありますか？", priority: "low" },

  // 9. 葬式費用
  { id: "funeral.costs", category: "funeral", question: "葬儀費用（葬儀社・飲食・返礼品等）", prompt: "葬儀社への支払いなど、葬儀の費用の領収書はありますか？", priority: "high", autoFromEntityTypes: ["funeral_expense"] },
  { id: "funeral.unreceipted", category: "funeral", question: "お布施・戒名料など領収書のない支出", prompt: "お寺へのお布施など、領収書のない支払いはありましたか？", priority: "medium" },

  // 10. 生前贈与
  { id: "gifts.calendar", category: "gifts", question: "過去の贈与（受贈者・時期・金額）", prompt: "過去に、亡くなった方からお金や財産をもらった方はいますか？いつ頃、いくらですか？", priority: "high", autoFromEntityTypes: ["lifetime_gift"] },
  { id: "gifts.seisan", category: "gifts", question: "相続時精算課税の選択・贈与", prompt: "相続時精算課税の届出をして贈与を受けた方はいますか？", priority: "high", autoFrom: [{ type: "lifetime_gift", attr: "taxation", any: "精算" }] },
  { id: "gifts.special", category: "gifts", question: "住宅取得・教育・結婚子育て資金の非課税贈与", prompt: "住宅資金や教育資金、結婚・子育て資金の贈与の特例を使ったことはありますか？", priority: "medium", autoFrom: [{ type: "lifetime_gift", attr: "taxation", any: "住宅|教育資金|結婚|子育て" }] },
  { id: "gifts.returns", category: "gifts", question: "贈与税申告の有無", prompt: "贈与税の申告をしたことはありますか？", priority: "medium" },
  { id: "gifts.insurance_premiums", category: "gifts", question: "被相続人が負担した家族の保険料・家族への資金移動", prompt: "ご家族名義の保険料を、亡くなった方が払っていたことはありますか？", priority: "medium" },

  // 11. 名義預金
  { id: "nominee.family_accounts", category: "nominee", question: "家族名義の預金・財産で被相続人が資金を出したもの", prompt: "ご家族名義の口座で、実際には亡くなった方のお金で積み立てていたものはありますか？", priority: "high", autoFromEntityTypes: ["nominee_deposit"] },
  { id: "nominee.custody", category: "nominee", question: "家族名義の通帳・印鑑の管理者", prompt: "その通帳や印鑑は、どなたが管理していましたか？", priority: "medium" },

  // 12. 遺言・遺産分割
  { id: "will.exists", category: "will", question: "遺言書の有無と種類（公正証書・自筆）", prompt: "遺言書はありますか？公正証書ですか、手書きですか？", priority: "high", autoFromEntityTypes: ["will"] },
  { id: "will.division_plan", category: "will", question: "遺産分割の方針・話合いの状況", prompt: "財産の分け方について、ご家族で話はされていますか？", priority: "medium" },
  { id: "will.disputes", category: "will", question: "相続人間で意見が分かれる可能性", prompt: "分け方について、意見が分かれそうな点はありますか？", priority: "low" },

  // 13. 特例・控除
  { id: "special.home_resident", category: "special", question: "自宅に亡くなる直前まで住んでいた人（小規模宅地等の特例の確認）", prompt: "ご自宅に、亡くなる直前まで住んでいたのはどなたですか？", priority: "high" },
  { id: "special.cohabitation", category: "special", question: "同居親族・生計を一にする親族の状況", prompt: "亡くなった方と同居していたご家族や、生活費を一緒にしていたご家族はいますか？", priority: "high" },
  { id: "special.nursing_home", category: "special", question: "老人ホーム・施設への入居の有無", prompt: "亡くなる前に老人ホームや施設に入っていましたか？", priority: "high", autoFrom: [{ type: "situation", attr: "kind", any: "老人ホーム|施設|サービス付き|グループホーム|介護付" }] },
  { id: "special.ienaki", category: "special", question: "別居の相続人の住まい（持ち家の有無・いわゆる家なき子）", prompt: "亡くなった方と別に暮らしていたお子さまは、持ち家にお住まいですか？賃貸ですか？", priority: "medium", autoFrom: [{ type: "situation", attr: "kind", any: "家なき子|持ち家なし|持ち家がない|賃貸住まい" }] },
  { id: "special.spouse_relief", category: "special", question: "配偶者の取得見込み（配偶者の税額軽減の検討）", prompt: "配偶者の方が取得される財産について、お考えはありますか？", priority: "medium" },
  { id: "special.business_land", category: "special", question: "被相続人等の事業・貸付に使っていた土地", prompt: "お店や事業、貸付に使っていた土地はありますか？", priority: "medium" },

  // 14. その他
  { id: "misc.overseas", category: "misc", question: "海外財産・海外在住の相続人の有無", prompt: "海外の財産（外国の預金・株式など）や、海外にお住まいの相続人はいますか？", priority: "medium", autoFrom: [{ type: "situation", attr: "kind", any: "海外居住|海外在住|海外に住|非居住" }, { type: "other_asset", attr: "kind", any: "国外|海外|外国|外貨" }, { type: "listed_security", attr: "products", any: "外国|米国|外貨|海外" }] },
  { id: "misc.prior_filings", category: "misc", question: "過去の確定申告・関与税理士", prompt: "亡くなった方は確定申告をしていましたか？税理士さんはいましたか？", priority: "low" },
  { id: "misc.documents_location", category: "misc", question: "通帳・証書・郵便物などの保管状況", prompt: "通帳や保険証券、郵便物はどなたが保管していますか？", priority: "medium" },
];

export const CHECK_ITEM_MASTER_BY_ID = new Map(CHECK_ITEM_MASTER.map((c) => [c.id, c]));
