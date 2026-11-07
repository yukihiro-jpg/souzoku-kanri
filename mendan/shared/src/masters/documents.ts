import type { CategoryId } from "../types.js";

/**
 * 資料マスタ
 *
 * 事務所の資料収集ガイド（マイドライブ「Chrome から保存/guide.pdf」）の内容をもとに、
 * 説明文は事務所の言葉で書き直し、2026年時点の制度に合わせて更新したもの。
 * 資料の名称・取得先・取得方法は、ここ（または Firestore の documentMaster）に
 * 登録した内容だけを使う。AIに取得方法を作らせない（指示書 10.）。
 * name / source の {target} は対象の金融機関名・所在地などに置き換わる。
 * 事務所による取得代行は行わない方針のため、提出者はすべてお客様側としている（法定相続情報一覧図の作成のみ有料で受託）。
 * 提出者「相続人のどなたか」は、相続人のうちどなたか1人が取得・提出すればよいという意味。
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

const KOSEKI_TIMING = "相続開始日から10日を経過した日以後に発行されたものをご用意ください（申告書に添付するため）。";

export const DOCUMENT_MASTER: DocumentMaster[] = [
  // ===== 1. 本人確認・身分関係（すべての案件で必要） =====
  { id: "mynumber_heirs", name: "相続人全員のマイナンバー確認書類と本人確認書類（写し）", category: "basic", driveFolder: "02_相続人関係", source: "各相続人がお持ちのもの", howTo: "マイナンバーカードがある方は表面・裏面の両方のコピーをご用意ください。カードがない方は、マイナンバーの記載がある書類（通知カード、マイナンバー入りの住民票など）と、運転免許証・パスポート等の顔写真付き書類のコピーをご用意ください。原本はお預かりしません。", defaultSubmitter: "各相続人", perCase: true },
  { id: "koseki_decedent", name: "被相続人の出生から死亡までのすべての戸籍謄本（除籍謄本・改製原戸籍を含む）", category: "basic", driveFolder: "02_相続人関係", source: "本籍地の市区町村役場、または最寄りの市区町村役場（広域交付）", howTo: "相続開始日から10日を経過した日以後に発行されたものをご用意ください（申告書に添付するため）。本籍地を移した・結婚で戸籍が変わった場合は、以前の本籍地の分も必要です。2024年3月から、亡くなった方の配偶者・子・孫・父母・祖父母にあたる方は、最寄りの市区町村役場の窓口でまとめて請求できるようになりました（広域交付）。この方法で請求できるのは窓口に来たご本人だけで、郵送や代理の方による請求はできません。兄弟姉妹・おい・めいにあたる方は、本籍地の市区町村役場に請求してください。コンピューター化されていない古い戸籍も、本籍地の市区町村役場での請求になります。", defaultSubmitter: "相続人のどなたか", perCase: true },
  { id: "joseki_decedent", name: "被相続人の住民票の除票（本籍地の記載があるもの）", category: "basic", driveFolder: "02_相続人関係", source: "最後の住所地の市区町村役場", howTo: "マイナンバーの記載は不要です。郵送でも請求できます。", defaultSubmitter: "相続人のどなたか", perCase: true },
  { id: "koseki_heirs", name: "相続人全員の戸籍謄本", category: "basic", driveFolder: "02_相続人関係", source: "各相続人の本籍地の市区町村役場（広域交付も利用可）", howTo: `${KOSEKI_TIMING}亡くなった方と同じ戸籍に入っている相続人の分は、被相続人の戸籍謄本で確認できるため不要です。`, defaultSubmitter: "各相続人", perCase: true },
  { id: "juminhyo_heirs", name: "相続人全員の住民票（本籍地の記載があるもの）", category: "basic", driveFolder: "02_相続人関係", source: "各相続人の住所地の市区町村役場", howTo: "マイナンバーの記載は不要です。マイナンバーカードがあればコンビニでも取得できます。", defaultSubmitter: "各相続人", perCase: true },
  { id: "inkan_heirs", name: "相続人全員の印鑑登録証明書（お一人1通）", category: "basic", driveFolder: "02_相続人関係", source: "各相続人の住所地の市区町村役場", howTo: "遺産分割協議書とあわせて申告書に添付します。申告書の作成までは、写し（コピー）でのご提出でも構いません。なお、預金や不動産の名義変更の手続きでは原本が必要です（金融機関によっては「発行から3〜6か月以内」などの期限があります）。", defaultSubmitter: "各相続人", perCase: true },
  { id: "houtei_ichiran", name: "法定相続情報一覧図の写し（取得済みの場合のみ）", category: "basic", driveFolder: "02_相続人関係", source: "法務局", howTo: "必須ではありません。すでにお持ちの場合にご提出ください。戸籍一式の代わりに金融機関や登記の手続きで使え、何通でも無料で交付を受けられるため、手続き先が多い場合に便利です。当事務所で作成することもできます（費用2,000円）。申告書に添付する場合は、図の形式で、子が実子か養子かがわかるものが必要です。", defaultSubmitter: "相続人のどなたか", perCase: true },
  { id: "fuhyo_decedent", name: "被相続人の戸籍の附票", category: "basic", driveFolder: "02_相続人関係", source: "被相続人の本籍地の市区町村役場", howTo: "戸籍の附票は、その方の住所がいつからいつまでどこにあったかが記録された書類です。亡くなった方の住所の移り変わりを確認する必要があるときにお願いしています（相続時精算課税で贈与をしていた場合や、老人ホーム等に入居していて自宅の土地に小規模宅地等の特例を使えるか確認する場合）。", defaultSubmitter: "相続人のどなたか", perCase: true },
  { id: "fuhyo_heirs", name: "{target}の戸籍の附票", category: "basic", driveFolder: "02_相続人関係", source: "本人の本籍地の市区町村役場", howTo: "戸籍の附票は、その方の住所がいつからいつまでどこにあったかが記録された書類です。相続時精算課税で贈与を受けた方や、亡くなった方と別に暮らしていた方が持ち家のない相続人（いわゆる「家なき子」）として自宅の土地の特例を使えるか確認する場合に、その方の住所の移り変わりを確認するために必要です。", defaultSubmitter: "該当する相続人" },
  { id: "biography_decedent", name: "被相続人の略歴（記入用紙は事務所からお渡しします）", category: "basic", driveFolder: "01_初回面談", source: "事務所の様式（Excel版もあります）", howTo: "学歴・職歴・住所の移り変わり・主な出来事などを、わかる範囲でご記入ください。財産の把握や申告内容の確認に使います。", defaultSubmitter: "相続人のどなたか", perCase: true },
  { id: "heir_contacts", name: "相続人全員のご職業・電話番号と相続人代表者（記入用紙は事務所からお渡しします）", category: "basic", driveFolder: "01_初回面談", source: "事務所の様式", howTo: "申告書に記載する情報です。電話番号は携帯電話でも構いません。代表者を1名お決めください。", defaultSubmitter: "相続人のどなたか", perCase: true },
  { id: "income_tax_returns", name: "被相続人の確定申告書の控え（過去3年分）", category: "basic", driveFolder: "09_その他", source: "ご自宅で保管しているもの", howTo: "確定申告をしていた場合にご用意ください。すでに準確定申告を済ませている場合は、その控えもご用意ください。財産（不動産収入・配当など）の手がかりにもなります。", defaultSubmitter: "相続人のどなたか", perCase: true },
  { id: "income_tax_docs", name: "準確定申告に必要な資料（亡くなった年の1月1日から死亡日まで）", category: "basic", driveFolder: "09_その他", source: "勤務先・年金事務所・保険会社・ご自宅など", howTo: "年金・給与の源泉徴収票、生命保険料・地震保険料・社会保険料の控除証明書、医療費の領収書、事業や不動産の収入・経費の資料、不動産や株式を売却した場合はその資料など。準確定申告の期限は相続開始を知った日の翌日から4か月以内です。", defaultSubmitter: "相続人のどなたか", perCase: true },

  // ===== 2. 現金・預貯金 =====
  { id: "cash_on_hand", name: "相続開始日時点の手元現金の金額（メモ）", category: "deposits", driveFolder: "03_預貯金", source: "ご家族のメモ", howTo: "ご自宅・財布・貸金庫にあった現金の額をお知らせください。亡くなる前後に預金から引き出した現金がある場合は、その日付・金額・使い道もお知らせください。", defaultSubmitter: "相続人のどなたか", perCase: true },
  { id: "bank_balance", name: "{target}の残高証明書（相続開始日時点）", category: "deposits", driveFolder: "03_預貯金", source: "{target}（お取引店または相続手続きの窓口）", howTo: "「相続開始日時点」「経過利息を含む」残高で依頼してください。通帳がない口座が見つかることもあるため、特定の口座だけでなく被相続人名義のすべての口座（普通・定期・積立・外貨預金など）を記載するよう依頼してください。", defaultSubmitter: "相続人のどなたか" },
  { id: "bank_history", name: "{target}の取引履歴（入出金明細）", category: "deposits", driveFolder: "03_預貯金", source: "{target}（お取引店または相続手続きの窓口）", howTo: "通帳が見当たらない期間のほか、長い間記帳していなかったために複数の取引がまとめて1行で記帳されている（合算記帳）期間についても、取引の中身を確認するために必要です。期間は下記の対象期間をご覧ください。発行には手数料がかかる場合があります。", defaultSubmitter: "相続人のどなたか" },
  { id: "bank_passbook", name: "{target}の通帳・定期預金証書", category: "deposits", driveFolder: "03_預貯金", source: "ご自宅で保管しているもの", howTo: "対象期間の通帳をすべてご用意ください。原本をお預けいただいても構いません。原本をお手元に置いておきたい場合は、最後まで記帳したうえでコピーをご用意ください。亡くなった方の口座からご家族の口座へお金が移っている場合は、受け取ったご家族の通帳（特に配偶者の通帳）もお願いすることがあります。", defaultSubmitter: "相続人のどなたか" },
  { id: "bank_accrued_interest", name: "{target}の定期預金の既経過利息計算書", category: "deposits", driveFolder: "03_預貯金", source: "{target}", howTo: "残高証明書を依頼するときに既経過利息の記載もお願いすれば、別途の取得は不要です。", defaultSubmitter: "相続人のどなたか" },
  { id: "yucho_genson", name: "ゆうちょ銀行の現存調査（貯金の有無の照会）の結果", category: "deposits", driveFolder: "03_預貯金", source: "ゆうちょ銀行または郵便局の貯金窓口（郵送での受付はありません）", howTo: "亡くなった方の名義の貯金が、ほかにないかをゆうちょ銀行全体で調べてもらう手続きです。通帳が見つかっていない口座や、昔の定額貯金・定期貯金が見つかることがあります。窓口で「貯金等照会書」を記入し、亡くなったことと相続人であることがわかる戸籍謄本、窓口に行く方の本人確認書類と印鑑をお持ちください。調査の結果は後日郵送で届きます。現存調査そのものは無料ですが、見つかった口座の残高証明書は1通1,100円、取引履歴は通帳1冊分につき1,100円の手数料がかかります（2026年時点。最新の料金は窓口でご確認ください）。かんぽ生命の契約の有無は、かんぽ生命（郵便局）へ別にご確認ください。", defaultSubmitter: "相続人のどなたか", perCase: true },
  { id: "shinkin_capital", name: "{target}の出資金の証明", category: "deposits", driveFolder: "03_預貯金", source: "{target}", howTo: "信用金庫・信用組合・農協（JA）の組合員だった場合の出資金です。残高証明書を依頼するときに、出資金の記載もお願いしてください。", defaultSubmitter: "相続人のどなたか" },

  // ===== 3. 土地・建物 =====
  { id: "re_tax_notice", name: "{target}の固定資産税・都市計画税の課税明細書（納税通知書）", category: "real_estate", driveFolder: "04_不動産", source: "ご自宅で保管しているもの", howTo: "毎年春ごろに市区町村から届く通知書です。表紙だけでなく、物件ごとの明細が書かれたページもご用意ください。相続開始年度のものが必要です。", defaultSubmitter: "相続人のどなたか" },
  { id: "re_registry", name: "{target}の登記事項証明書（全部事項証明書）", category: "real_estate", driveFolder: "04_不動産", source: "法務局（全国どこの法務局でも請求できます）", howTo: "住所ではなく「地番」「家屋番号」で請求します。地番・家屋番号は、課税明細書や登記識別情報（権利証）で確認できます。窓口のほか、オンラインや郵送でも請求できます。", defaultSubmitter: "相続人のどなたか" },
  { id: "re_maps", name: "{target}の公図・地積測量図", category: "real_estate", driveFolder: "04_不動産", source: "法務局", howTo: "土地の形や位置を確認するための図面です。地積測量図が作られていない土地もあり、その場合は公図のみで構いません。", defaultSubmitter: "相続人のどなたか" },
  { id: "re_valuation", name: "{target}の固定資産評価証明書（相続開始年度）", category: "real_estate", driveFolder: "04_不動産", source: "不動産所在地の市区町村役場（東京23区は都税事務所）", howTo: "相続人が請求する場合は、相続人であることがわかる戸籍と本人確認書類が必要です。名義変更の登記にも使います。", defaultSubmitter: "相続人のどなたか" },
  { id: "re_nayose", name: "{target}所在の市区町村の名寄帳（固定資産課税台帳）", category: "real_estate", driveFolder: "04_不動産", source: "不動産所在地の市区町村役場（東京23区は都税事務所）", howTo: "その市区町村にある被相続人名義の不動産の一覧で、私道など税金がかからない土地も確認できます。共有の不動産は別の名寄帳になることがあるため、あわせて請求してください。不動産のある市区町村ごとに必要です。", defaultSubmitter: "相続人のどなたか" },
  { id: "re_purchase", name: "{target}の売買契約書・間取り図", category: "real_estate", driveFolder: "04_不動産", source: "ご自宅で保管しているもの", howTo: "建物を購入したときの資料です。二世帯住宅の場合や、建物の一部を貸している・事業に使っている場合に、利用区分の確認に使います。", defaultSubmitter: "相続人のどなたか" },
  { id: "re_lease", name: "{target}の賃貸借契約書と賃料・敷金がわかる資料", category: "real_estate", driveFolder: "04_不動産", source: "ご自宅で保管しているもの／管理会社", howTo: "貸地・貸家・駐車場など、借主ごとの契約書をご用意ください。相続開始時点で空室があった場合はその状況もお知らせください。", defaultSubmitter: "相続人のどなたか" },
  { id: "re_lease_land", name: "{target}の土地賃貸借契約書（借地）と地代の支払がわかる資料", category: "real_estate", driveFolder: "04_不動産", source: "ご自宅で保管しているもの", howTo: "他人の土地を借りて建物を建てている場合に必要です。", defaultSubmitter: "相続人のどなたか" },
  { id: "re_farm_committee", name: "{target}の耕作権（小作）に関する農業委員会の証明書", category: "real_estate", driveFolder: "04_不動産", source: "農地のある市町村の農業委員会", howTo: "農地を他人に貸して耕作させている場合、または他人の農地を借りて耕作している場合に必要です。水戸市内の農地の場合：水戸市農業委員会事務局（〒310-8610 水戸市中央1-4-1 水戸市役所本庁舎5階、電話 029-232-9264、平日8時30分〜17時15分）。", defaultSubmitter: "相続人のどなたか" },
  { id: "fire_insurance", name: "{target}の火災保険・地震保険の保険証券（写し）", category: "real_estate", driveFolder: "06_生命保険", source: "ご自宅で保管しているもの", howTo: "亡くなった方が契約者（保険料を負担）の建物の保険です。保険料を何年分かまとめて払った長期の契約や積立型の契約は、解約すると戻ってくるお金（解約返戻金）があり、その額が財産になります。この場合は保険会社に「相続開始日時点の解約返戻金の額」の証明もお願いしてください。1年ごとに更新する掛け捨ての契約は、証券の写しだけで構いません。", defaultSubmitter: "相続人のどなたか" },

  // ===== 4. 上場株式・投資信託 =====
  { id: "sec_balance", name: "{target}の残高証明書（相続開始日時点）", category: "securities", driveFolder: "05_有価証券", source: "{target}", howTo: "相続開始日時点の残高で依頼してください。上場株式は評価に使うため「相続開始日の終値」と「相続開始月・前月・前々月の終値の月平均額」の記載も、投資信託は「解約価額」での記載もお願いしてください。", defaultSubmitter: "相続人のどなたか" },
  { id: "sec_reports", name: "{target}の取引明細（顧客勘定元帳など）", category: "securities", driveFolder: "05_有価証券", source: "{target}", howTo: "対象期間の入出金・売買の履歴です。", defaultSubmitter: "相続人のどなたか" },
  { id: "sec_registry", name: "株主名簿管理人（信託銀行など）の残高証明書", category: "securities", driveFolder: "05_有価証券", source: "保有していた銘柄の株主名簿管理人", howTo: "証券会社の口座に入っていない株式（単元未満株・特別口座の株式）がないかを確認します。株主名簿管理人は、配当金の通知書や各社のホームページで確認できます。", defaultSubmitter: "相続人のどなたか", perCase: true },
  { id: "dividend_notice", name: "相続開始後に届いた配当金の支払通知書", category: "securities", driveFolder: "05_有価証券", source: "ご自宅に届いたもの", howTo: "受け取っていない配当金（未収配当金）の確認に使います。", defaultSubmitter: "相続人のどなたか", perCase: true },
  { id: "fund_details", name: "{target}の投資信託の解約価額・個別元本がわかる資料", category: "securities", driveFolder: "05_有価証券", source: "{target}", howTo: "残高証明書に相続開始日時点の解約価額が記載されていれば不要です。記載がない場合は、信託財産留保額・個別元本がわかる資料をお願いしてください。", defaultSubmitter: "相続人のどなたか" },

  // ===== 5. 非上場株式 =====
  { id: "unlisted_financials", name: "{target}の決算書・税務申告書（過去3期分。勘定科目内訳書等を含む）", category: "unlisted", driveFolder: "05_有価証券", source: "{target}（会社）／顧問税理士", howTo: "法人税・地方税・消費税の申告書と決算書一式をご用意ください。内容を確認したうえで、追加の資料をお願いすることがあります。", defaultSubmitter: "会社のご担当者" },
  { id: "unlisted_shareholders", name: "{target}の株主名簿（相続開始日時点）", category: "unlisted", driveFolder: "05_有価証券", source: "{target}（会社）", howTo: "法人税申告書の別表二でも確認できます。", defaultSubmitter: "会社のご担当者" },

  // ===== 6. 生命保険・退職金など =====
  { id: "ins_payment", name: "{target}の死亡保険金の支払通知書", category: "insurance", driveFolder: "06_生命保険", source: "{target}", howTo: "保険金を請求したあとに保険会社から届きます。受取人ごとにご用意ください。まだ請求していない場合は、受取人の方から保険会社へ連絡して請求の手続きをしてください（死亡診断書の写しなどが必要です。保険金を請求できる期間は原則3年です）。請求前でも、保険証券の写しがあれば申告の準備は進められます。", defaultSubmitter: "保険金受取人" },
  { id: "ins_policy", name: "{target}の保険証券（写し）", category: "insurance", driveFolder: "06_生命保険", source: "ご自宅で保管しているもの", howTo: "契約者・被保険者・受取人・保険料負担者がわかるページをご用意ください。", defaultSubmitter: "相続人のどなたか" },
  { id: "ins_surrender_value", name: "{target}の解約返戻金相当額の証明書（相続開始日時点）", category: "insurance", driveFolder: "06_生命保険", source: "{target}", howTo: "被相続人が保険料を負担していたもので、ご家族が被保険者となっている保険などは、まだ保険金が支払われていなくても財産になります。保険会社に相続開始日時点の解約返戻金の額を照会してください。", defaultSubmitter: "契約を引き継ぐ方" },
  { id: "annuity_docs", name: "{target}の年金証書（写し）と年金受給権の評価のための証明書", category: "insurance", driveFolder: "06_生命保険", source: "契約している保険会社（{target}）", howTo: "個人年金保険などで、亡くなった後もご家族が年金を受け取る場合、その「年金を受け取る権利」が財産になります。年金証書（年金の受取が始まったときに保険会社から届く書類）の写しをご用意ください。あわせて保険会社に、相続税の評価のため「相続開始日時点の解約返戻金相当額・一時金で受け取る場合の金額・予定利率」がわかる証明書を依頼してください。", defaultSubmitter: "年金を受け取る方" },
  { id: "retirement_notice", name: "{target}からの死亡退職金・弔慰金等の支払通知書", category: "insurance", driveFolder: "06_生命保険", source: "{target}", howTo: "勤務先からの死亡退職金・弔慰金のほか、iDeCo・企業型確定拠出年金の死亡一時金、小規模企業共済の共済金なども対象です。支給額と支給日がわかる資料をご用意ください。", defaultSubmitter: "受取人" },

  // ===== 7. その他の財産 =====
  { id: "car_docs", name: "{target}の車検証（写し）と査定額がわかる書類", category: "other_assets", driveFolder: "09_その他", source: "ご自宅で保管しているもの／中古車買取店", howTo: "車の価値は中古車としての売却価格で評価します。車検証の写しのほか、中古車買取店（例：ガリバー、ネクステージなど。無料で査定を受けられます）で査定を受け、査定額がわかる書類をご用意ください。", defaultSubmitter: "相続人のどなたか" },
  { id: "membership_docs", name: "{target}の会員証・預託金証書（写し）", category: "other_assets", driveFolder: "09_その他", source: "ご自宅で保管しているもの", howTo: "ゴルフ会員権・リゾート会員権などです。", defaultSubmitter: "相続人のどなたか" },
  { id: "loan_receivable", name: "{target}の金銭消費貸借契約書と残高がわかる資料", category: "other_assets", driveFolder: "09_その他", source: "ご自宅で保管しているもの", howTo: "被相続人が人や会社にお金を貸していた場合、前払いしていた費用がある場合です。", defaultSubmitter: "相続人のどなたか" },
  { id: "valuables_docs", name: "{target}の品目・数量のメモと鑑定書・査定書", category: "other_assets", driveFolder: "09_その他", source: "ご自宅で保管しているもの", howTo: "貴金属・書画・骨董品など価値があると思われるものです。作者名や購入時の価格がわかればお知らせください。", defaultSubmitter: "相続人のどなたか" },
  { id: "receivable_docs", name: "{target}の支払通知・還付通知", category: "other_assets", driveFolder: "09_その他", source: "ご自宅に届いたもの", howTo: "亡くなった時点で受け取っていなかった給与・地代・家賃や、所得税・介護保険料・後期高齢者医療保険料などの還付金、高額療養費などです。", defaultSubmitter: "相続人のどなたか" },
  { id: "crypto_docs", name: "{target}の暗号資産の残高証明書（相続開始日時点）と取引履歴", category: "other_assets", driveFolder: "09_その他", source: "暗号資産交換業者", howTo: "交換業者の相続手続きの窓口に依頼してください。個人のウォレットで保管していた場合は、その内容がわかる資料をご用意ください。", defaultSubmitter: "相続人のどなたか" },
  { id: "emoney_docs", name: "{target}の電子マネー・スマホ決済・ポイントの残高がわかるもの", category: "other_assets", driveFolder: "09_その他", source: "アプリの画面・運営会社", howTo: "残高が表示された画面の写しなどで構いません。相続手続きの方法は運営会社ごとに異なります。", defaultSubmitter: "相続人のどなたか" },
  { id: "gold_docs", name: "{target}の金・プラチナの保管証・純金積立の残高証明書", category: "other_assets", driveFolder: "09_その他", source: "購入した販売会社", howTo: "現物（地金・金貨）をお持ちの場合は、種類と重さがわかるものをご用意ください。", defaultSubmitter: "相続人のどなたか" },
  { id: "foreign_assets", name: "{target}（国外財産）の残高証明書・取引明細・評価資料", category: "misc", driveFolder: "09_その他", source: "海外の金融機関・証券会社など", howTo: "外国の預金・株式・不動産などです。現地通貨での金額がわかる資料をご用意ください。", defaultSubmitter: "相続人のどなたか" },
  { id: "household_docs", name: "主な家財の内容がわかるメモ", category: "other_assets", driveFolder: "09_その他", source: "ご家族のメモ", howTo: "家具・家電など、まとまった価値があるものの概要をお知らせください。", defaultSubmitter: "相続人のどなたか", perCase: true },
  { id: "business_docs", name: "被相続人の事業の決算書・青色申告決算書（過去3年分）と減価償却資産の明細", category: "other_assets", driveFolder: "09_その他", source: "ご自宅で保管しているもの／顧問税理士", howTo: "個人で事業（店舗・農業・不動産賃貸など）をしていた場合に、事業用の資産や売掛金・在庫の確認に使います。", defaultSubmitter: "相続人のどなたか", perCase: true },
  { id: "solar_docs", name: "{target}の太陽光発電設備の契約書と売電収入の明細", category: "other_assets", driveFolder: "09_その他", source: "ご自宅で保管しているもの", howTo: "設置時の契約書・設置費用がわかる資料と、売電の明細をご用意ください。", defaultSubmitter: "相続人のどなたか" },
  { id: "safe_box", name: "{target}の貸金庫の契約先と収納物の一覧", category: "other_assets", driveFolder: "09_その他", source: "貸金庫のある金融機関", howTo: "貸金庫を開ける際は、開扉の日付と収納物を記録しておいてください。", defaultSubmitter: "相続人のどなたか" },
  { id: "other_asset_eval", name: "{target}（その他の財産）の内容と金額がわかる資料", category: "other_assets", driveFolder: "09_その他", source: "ご自宅で保管しているもの", howTo: "上記のどの種類にも当てはまらない財産について、内容と金額がわかる資料（契約書・明細・通知書など）をご用意ください。資料名の部分には、会話で出てきた財産の名前が入ります。", defaultSubmitter: "相続人のどなたか" },

  // ===== 8. 借入金・未払金 =====
  { id: "debt_balance", name: "{target}の借入金残高証明書（相続開始日時点）と返済予定表", category: "debts", driveFolder: "07_債務・葬式費用", source: "{target}", howTo: "住宅ローンなどで「団体信用生命保険（団信）」に加入していた場合は、亡くなったことでローンが保険から返済されるため、その借入金は債務として差し引くことができません。団信の有無がわかる書類（返済が済んだことの通知など）もあわせてご用意ください。", defaultSubmitter: "相続人のどなたか" },
  { id: "debt_contract", name: "{target}の金銭消費貸借契約書", category: "debts", driveFolder: "07_債務・葬式費用", source: "ご自宅で保管しているもの", howTo: "金融機関以外（個人・会社）からの借入の場合は、残高がわかる資料もご用意ください。", defaultSubmitter: "相続人のどなたか" },
  { id: "unpaid_tax_notices", name: "相続開始後に支払った（支払う）税金・保険料の納税通知書・領収書", category: "debts", driveFolder: "07_債務・葬式費用", source: "ご自宅に届いたもの", howTo: "住民税・固定資産税・事業税・国民健康保険料・介護保険料・後期高齢者医療保険料など、亡くなった方が負担すべきもので亡くなった後に支払ったもの（これから支払うもの）です。", defaultSubmitter: "相続人のどなたか", perCase: true },
  { id: "medical_bills", name: "相続開始後に支払った医療費・施設費・公共料金などの請求書・領収書", category: "debts", driveFolder: "07_債務・葬式費用", source: "ご自宅で保管しているもの", howTo: "入院費・老人ホームの利用料・電気ガス水道料金など、亡くなった方の分で亡くなった後に支払ったもの（これから支払うもの）です。", defaultSubmitter: "相続人のどなたか", perCase: true },
  { id: "card_statement", name: "{target}の利用明細（相続開始日時点の未払分）", category: "debts", driveFolder: "07_債務・葬式費用", source: "カード会社・後払いサービスの運営会社", howTo: "クレジットカードや後払い決済で、亡くなった時点で未払いだったものです。", defaultSubmitter: "相続人のどなたか" },

  // ===== 9. 葬式費用 =====
  { id: "funeral_receipts", name: "葬儀費用の領収書・請求書", category: "funeral", driveFolder: "07_債務・葬式費用", source: "葬儀社・寺院など", howTo: "葬儀社への支払いのほか、通夜・告別式の飲食代、火葬料、納骨費用などもご用意ください。", defaultSubmitter: "喪主", perCase: true },
  { id: "funeral_memo", name: "領収書のない葬儀関連の支出と日程のメモ", category: "funeral", driveFolder: "07_債務・葬式費用", source: "喪主の方の記録", howTo: "お布施・戒名料・心付けなど領収書のない支出は、日付・支払先・金額をメモでお知らせください。あわせて通夜・葬儀・初七日・納骨の日程もお知らせください。", defaultSubmitter: "喪主", perCase: true },

  // ===== 10. 生前贈与 =====
  { id: "gift_evidence", name: "{target}への贈与の贈与契約書・振込記録", category: "gifts", driveFolder: "08_贈与関係", source: "贈与を受けた方が保管しているもの", howTo: "贈与の時期と金額がわかる資料（契約書、通帳の写しなど）をご用意ください。対象期間は下記をご覧ください。", defaultSubmitter: "贈与を受けた方" },
  { id: "gift_returns", name: "贈与税の申告書（控え）", category: "gifts", driveFolder: "08_贈与関係", source: "贈与を受けた方が保管しているもの", howTo: "対象期間に提出した贈与税の申告書をご用意ください。見当たらない場合は税務署で開示請求ができます。", defaultSubmitter: "贈与を受けた方", perCase: true },
  { id: "seisan_notice", name: "相続時精算課税選択届出書（控え）", category: "gifts", driveFolder: "08_贈与関係", source: "贈与を受けた方が保管しているもの", howTo: "見当たらない場合は税務署で開示請求ができます。", defaultSubmitter: "贈与を受けた方", perCase: true },
  { id: "seisan_returns", name: "{target}の相続時精算課税を選択した年以後の贈与税申告書（控え）と贈与契約書", category: "gifts", driveFolder: "08_贈与関係", source: "贈与を受けた方が保管しているもの", howTo: "選択した年以後のすべての贈与が対象です。2024年1月以後の贈与は年110万円の基礎控除があり、その範囲内の年は申告をしていない場合があるため、贈与の記録（通帳など）もご用意ください。", defaultSubmitter: "贈与を受けた方" },
  { id: "housing_gift_docs", name: "{target}の住宅取得等資金の贈与に関する贈与税申告書（控え）", category: "gifts", driveFolder: "08_贈与関係", source: "贈与を受けた方が保管しているもの", howTo: "非課税の特例を受けた年の申告書をご用意ください。", defaultSubmitter: "贈与を受けた方" },
  { id: "edu_gift_docs", name: "{target}の教育資金の一括贈与の非課税申告書と残高・払出しの明細", category: "gifts", driveFolder: "08_贈与関係", source: "契約した金融機関", howTo: "契約期間の途中で贈与者が亡くなった場合、使い残しの額が相続財産になることがあるため、相続開始日時点の残高がわかる資料をご用意ください。", defaultSubmitter: "贈与を受けた方" },
  { id: "marriage_gift_docs", name: "{target}の結婚・子育て資金の一括贈与の非課税申告書と残高・払出しの明細", category: "gifts", driveFolder: "08_贈与関係", source: "契約した金融機関", howTo: "契約期間の途中で贈与者が亡くなった場合、使い残しの額が相続財産になるため、相続開始日時点の残高がわかる資料をご用意ください。", defaultSubmitter: "贈与を受けた方" },

  // ===== 11. 名義預金・名義財産 =====
  { id: "nominee_passbook", name: "{target}（家族名義の口座）の通帳（写し）と取引履歴", category: "nominee", driveFolder: "03_預貯金", source: "名義人ご本人／金融機関", howTo: "名義は家族でも、実際には亡くなった方のお金で作られた預金は相続財産になることがあります。口座を作った時期・入金した人・通帳と印鑑を管理していた人がわかる資料をご用意ください。", defaultSubmitter: "口座の名義人" },
  { id: "nominee_property", name: "{target}（家族名義の財産）の購入資金がわかる資料", category: "nominee", driveFolder: "09_その他", source: "ご自宅で保管しているもの", howTo: "名義は家族でも、亡くなった方がお金を出して購入した不動産・株式などは相続財産になることがあります。購入時の契約書や代金の支払記録をご用意ください。", defaultSubmitter: "名義人" },

  // ===== 12. 遺言・遺産分割 =====
  { id: "will_copy", name: "遺言書（写し）と検認済証明書", category: "will", driveFolder: "09_その他", source: "ご自宅／公証役場／法務局（自筆証書遺言書保管制度）", howTo: "公正証書遺言と、法務局で保管されていた自筆証書遺言は検認不要です。それ以外の自筆の遺言は家庭裁判所の検認が必要なため、検認済証明書もご用意ください（開封せずに検認を受けてください）。", defaultSubmitter: "相続人のどなたか", perCase: true },
  { id: "renunciation_cert", name: "{target}の相続放棄申述受理証明書（または受理通知書）", category: "will", driveFolder: "02_相続人関係", source: "家庭裁判所", howTo: "相続放棄の手続きをした方について必要です。", defaultSubmitter: "放棄した方" },
  { id: "predeceased_koseki", name: "先に亡くなった{target}の出生から死亡までの戸籍謄本", category: "basic", driveFolder: "02_相続人関係", source: "本籍地の市区町村役場（広域交付も利用可）", howTo: "亡くなった方のお子さま（または兄弟姉妹）が、亡くなった方より先に亡くなっている場合は、そのお子さま（孫・おい・めい）が代わりに相続人になります（代襲相続）。代わりに相続人になる方が誰なのかを漏れなく確認するため、先に亡くなった方の生まれてから亡くなるまでの戸籍が必要です。", defaultSubmitter: "代わりに相続人になる方" },
  { id: "overseas_heir_docs", name: "{target}（海外にお住まいの方）の署名証明書（サイン証明）と在留証明書", category: "basic", driveFolder: "02_相続人関係", source: "お住まいの国の日本大使館・総領事館", howTo: "海外にお住まいで日本に住民票がない方は、日本の印鑑登録証明書と住民票を取ることができません。その代わりとして、お住まいの国の日本大使館・総領事館で「署名証明書（サイン証明）」と「在留証明書」を発行してもらいます。署名証明書は遺産分割協議書のサインがご本人のものであることを、在留証明書は現在の住所を証明するために使います。", defaultSubmitter: "該当する相続人" },

  // ===== 13. 特例・控除 =====
  { id: "nursing_home_docs", name: "老人ホーム等の入居契約書・重要事項説明書と退去時の返還金がわかる資料", category: "special", driveFolder: "09_その他", source: "ご自宅で保管しているもの／施設", howTo: "亡くなる前に施設に入居していた場合、自宅の土地に小規模宅地等の特例が使えるかの確認に使います。退去で返金されたお金がある場合は、その金額がわかる資料もご用意ください。", defaultSubmitter: "相続人のどなたか", perCase: true },
  { id: "care_insurance", name: "被相続人の介護保険の被保険者証と要介護・要支援認定の資料（写し）", category: "special", driveFolder: "09_その他", source: "ご自宅で保管しているもの", howTo: "施設入居時の要介護・要支援認定の状況を確認します。", defaultSubmitter: "相続人のどなたか", perCase: true },
  { id: "ienaki_lease", name: "{target}の自宅の賃貸借契約書（いわゆる「家なき子」の確認）", category: "special", driveFolder: "09_その他", source: "ご本人が保管しているもの", howTo: "被相続人と別居していた相続人が持ち家のない「家なき子」として小規模宅地等の特例を検討する場合に、相続開始前3年以内の住まいの状況を確認します。", defaultSubmitter: "該当する相続人" },
  { id: "disability_card", name: "{target}の障害者手帳（写し）", category: "special", driveFolder: "02_相続人関係", source: "ご本人がお持ちのもの", howTo: "相続人に障害のある方がいる場合、相続税額から一定額を差し引ける障害者控除の確認に使います。", defaultSubmitter: "該当する相続人" },
  { id: "prior_inheritance_return", name: "過去の相続税申告書（控え）", category: "special", driveFolder: "09_その他", source: "ご自宅で保管しているもの", howTo: "亡くなった方が過去10年以内に相続で財産を取得し相続税を納めていた場合（相次相続控除）や、過去の相続で障害者控除・未成年者控除を使っていた場合の確認に使います。", defaultSubmitter: "相続人のどなたか", perCase: true },
  { id: "spouse_assets", name: "配偶者ご自身の財産の概算がわかる資料（二次相続の試算をご希望の場合）", category: "special", driveFolder: "09_その他", source: "配偶者の方", howTo: "配偶者の方が将来亡くなったときの相続（二次相続）まで考えた分け方を試算する場合に使います。ご希望の場合のみご用意ください。", defaultSubmitter: "配偶者", perCase: true },
];

export const DOCUMENT_MASTER_BY_ID = new Map(DOCUMENT_MASTER.map((d) => [d.id, d]));
