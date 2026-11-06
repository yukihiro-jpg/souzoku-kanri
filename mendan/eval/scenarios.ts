import type { EntityType } from "@mendan/shared";

/**
 * 精度検証用の架空面談（指示書 16.）。人物・金額・地名の組合せはすべて架空。
 *
 * expect.entities      : 抽出されるべき財産・人物（type と、ラベル/属性に含まれる文字列）
 * expect.documents     : 必要候補に入るべき資料（documentId と対象に含まれる文字列）
 * expect.forbidden     : 追加されてはいけない資料（無関係な資料）
 * expect.retracted     : 訂正・撤回されるべき実体
 * expect.checks        : 確認事項の状態
 * lockAfterLine        : その行まで解析した時点で担当者が承認する実体（承認済み情報の無断変更チェック）
 */
export interface Scenario {
  id: string;
  title: string;
  deathDate: string;
  lines: { speaker: "staff" | "client"; text: string }[];
  lockAfterLine?: { line: number; type: EntityType; match: string };
  /** 再接続で同じ文が2回確定したケース（行番号） */
  duplicateLines?: number[];
  expect: {
    entities: { type: EntityType; match: string }[];
    documents: { documentId: string; target?: string }[];
    forbidden?: { documentId: string; target?: string }[];
    retracted?: { type: EntityType; match: string }[];
    checks?: { id: string; status: string[] }[];
    attributes?: { type: EntityType; match: string; attr: string; value: string }[];
  };
}

const s = (speaker: "staff" | "client", text: string) => ({ speaker, text });

export const SCENARIOS: Scenario[] = [
  {
    id: "01_multi_banks",
    title: "複数金融機関が出てくる会話",
    deathDate: "2026-07-10",
    lines: [
      s("staff", "お父様の預金はどちらにありましたか。"),
      s("client", "メインは常陽銀行の水戸駅前支店で、年金もそこに入っていました。"),
      s("client", "それから筑波銀行に定期預金が300万円くらいあります。"),
      s("staff", "ほかにはいかがですか。"),
      s("client", "水戸信用金庫にも口座があったはずです。あと郵便局、ゆうちょ銀行の通帳もありました。"),
      s("client", "そういえばネットで住信SBIネット銀行も使っていたみたいです。"),
      s("staff", "ほかにはもうないですか。"),
      s("client", "たぶんそれで全部だと思います。"),
    ],
    expect: {
      entities: [
        { type: "bank_account", match: "常陽銀行" },
        { type: "bank_account", match: "筑波銀行" },
        { type: "bank_account", match: "水戸信用金庫" },
        { type: "bank_account", match: "ゆうちょ銀行" },
        { type: "bank_account", match: "住信SBIネット銀行" },
      ],
      documents: [
        { documentId: "bank_balance", target: "常陽銀行" },
        { documentId: "bank_history", target: "常陽銀行" },
        { documentId: "bank_balance", target: "筑波銀行" },
        { documentId: "bank_accrued_interest", target: "筑波銀行" },
        { documentId: "bank_balance", target: "水戸信用金庫" },
        { documentId: "bank_balance", target: "ゆうちょ銀行" },
        { documentId: "bank_balance", target: "住信SBIネット銀行" },
      ],
      attributes: [{ type: "bank_account", match: "常陽銀行", attr: "branch", value: "水戸駅前支店" }],
    },
  },
  {
    id: "02_multi_real_estate",
    title: "不動産が複数存在する会話",
    deathDate: "2026-06-01",
    lines: [
      s("staff", "不動産について教えてください。"),
      s("client", "水戸市千波町に自宅の土地と建物があります。父と母が住んでいました。"),
      s("client", "ひたちなか市にアパートが一棟あって、6部屋とも人に貸しています。"),
      s("client", "それと笠間市に畑と山林が少しあります。"),
      s("staff", "県外にはありますか。"),
      s("client", "東京の世田谷区にマンションの一室を持っていて、今は空き家です。"),
      s("client", "あと、自宅の隣の土地は借地で、地代を払っています。"),
    ],
    expect: {
      entities: [
        { type: "real_estate", match: "水戸市" },
        { type: "real_estate", match: "ひたちなか市" },
        { type: "real_estate", match: "笠間市" },
        { type: "real_estate", match: "世田谷区" },
      ],
      documents: [
        { documentId: "re_registry", target: "水戸市" },
        { documentId: "re_nayose", target: "ひたちなか市" },
        { documentId: "re_lease", target: "ひたちなか市" },
        { documentId: "re_valuation", target: "笠間市" },
        { documentId: "re_registry", target: "世田谷区" },
        { documentId: "re_lease_land" },
      ],
    },
  },
  {
    id: "03_corrections",
    title: "相続人が発言を訂正する会話",
    deathDate: "2026-05-15",
    lockAfterLine: { line: 3, type: "life_insurance", match: "日本生命" },
    lines: [
      s("client", "父は常陽銀行に普通預金がありました。"),
      s("client", "すみません、常陽銀行ではなく筑波銀行でした。"),
      s("client", "生命保険は日本生命で、保険金は300万円です。"),
      s("client", "あ、いえ、保険金は500万円でした。"),
      s("client", "それと、贈与は長男にしたと言いましたが、次男の間違いです。次男に去年200万円です。"),
    ],
    expect: {
      entities: [
        { type: "bank_account", match: "筑波銀行" },
        { type: "life_insurance", match: "日本生命" },
        { type: "lifetime_gift", match: "次男" },
      ],
      retracted: [{ type: "bank_account", match: "常陽銀行" }],
      documents: [
        { documentId: "bank_balance", target: "筑波銀行" },
        { documentId: "ins_payment", target: "日本生命" },
      ],
      forbidden: [{ documentId: "bank_balance", target: "常陽銀行" }],
    },
  },
  {
    id: "04_vague_gifts",
    title: "生前贈与の時期や金額が曖昧な会話",
    deathDate: "2026-09-30",
    lines: [
      s("staff", "お父様から生前にお金をもらった方はいますか。"),
      s("client", "孫の大学の入学金に、確か3年か4年前に100万か200万くらい出してもらったと思います。"),
      s("client", "長男は家を建てるときに、相続時精算課税の届出をして2500万円もらっています。2020年だったかな。"),
      s("client", "私も毎年110万円ずつもらっていたんですけど、何年分かはちょっと覚えていません。"),
    ],
    expect: {
      entities: [
        { type: "lifetime_gift", match: "孫" },
        { type: "lifetime_gift", match: "長男" },
      ],
      documents: [
        { documentId: "gift_evidence", target: "長男" },
        { documentId: "seisan_notice" },
        { documentId: "gift_returns" },
      ],
      checks: [{ id: "gifts.calendar", status: ["needs_followup", "ai_candidate", "contradiction"] }],
    },
  },
  {
    id: "05_nominee",
    title: "預貯金と名義預金の可能性がある会話",
    deathDate: "2026-04-20",
    lines: [
      s("client", "父の口座は常陽銀行だけです。"),
      s("client", "ただ、母名義の定期預金が筑波銀行に1000万円あって、それは父の退職金から入れたものです。"),
      s("client", "孫名義の口座にも父が毎年お金を振り込んでいました。通帳と印鑑は父が管理していました。"),
    ],
    expect: {
      entities: [
        { type: "bank_account", match: "常陽銀行" },
        { type: "nominee_deposit", match: "母" },
        { type: "nominee_deposit", match: "孫" },
      ],
      documents: [
        { documentId: "bank_balance", target: "常陽銀行" },
        { documentId: "nominee_passbook", target: "母" },
        { documentId: "nominee_passbook", target: "孫" },
      ],
    },
  },
  {
    id: "06_unknown",
    title: "相続人が「分からない」と回答する会話",
    deathDate: "2026-08-01",
    lines: [
      s("staff", "生命保険はありましたか。"),
      s("client", "保険に入っていたかどうか、ちょっと分からないです。"),
      s("staff", "借入金はいかがですか。"),
      s("client", "借金があったかは聞いていないので分かりません。"),
      s("staff", "遺言書はありますか。"),
      s("client", "ないと思います。"),
    ],
    expect: {
      entities: [],
      documents: [],
      checks: [
        { id: "insurance.death_benefit", status: ["needs_followup"] },
        { id: "debts.loans", status: ["needs_followup"] },
        { id: "will.exists", status: ["ai_candidate", "needs_followup"] },
      ],
      forbidden: [{ documentId: "debt_balance" }],
    },
  },
  {
    id: "07_jargon",
    title: "税務専門用語が多数出てくる会話",
    deathDate: "2026-03-10",
    lines: [
      s("client", "自宅の土地は路線価地域で、小規模宅地等の特例が使えるか知りたいです。母が同居していました。"),
      s("client", "貸宅地になっている土地が那珂市にあって、借地権者は近所の方です。そこは倍率地域だと聞きました。"),
      s("client", "父は株式会社山田商事という同族会社の非上場株式を7割持っていました。"),
      s("client", "その会社から死亡退職金が2000万円出る予定です。"),
      s("client", "名寄帳は先日取り寄せました。"),
    ],
    expect: {
      entities: [
        { type: "real_estate", match: "那珂市" },
        { type: "unlisted_share", match: "山田商事" },
        { type: "retirement_allowance", match: "山田商事" },
      ],
      documents: [
        { documentId: "unlisted_financials", target: "山田商事" },
        { documentId: "retirement_notice", target: "山田商事" },
        { documentId: "re_lease", target: "那珂市" },
      ],
      checks: [{ id: "special.home_resident", status: ["ai_candidate"] }],
    },
  },
  {
    id: "08_speaker_change",
    title: "話者が途中で交代する会話",
    deathDate: "2026-02-14",
    lines: [
      s("client", "長女の花子です。父の預金は常陽銀行にあります。"),
      s("client", "代わりました、長男の一郎です。姉が言っていない分で、野村證券に株があります。"),
      s("client", "あと父の車がトヨタのプリウスで、まだ父名義です。"),
    ],
    expect: {
      entities: [
        { type: "bank_account", match: "常陽銀行" },
        { type: "listed_security", match: "野村證券" },
        { type: "other_asset", match: "車" },
      ],
      documents: [
        { documentId: "bank_balance", target: "常陽銀行" },
        { documentId: "sec_balance", target: "野村證券" },
        { documentId: "other_asset_eval" },
      ],
    },
  },
  {
    id: "09_irrelevant",
    title: "AIが無関係な資料を追加しそうになる会話",
    deathDate: "2026-01-20",
    lines: [
      s("client", "父の預金はゆうちょ銀行だけです。"),
      s("client", "私自身の住宅ローンが常陽銀行にあって、毎月大変なんですよ。"),
      s("client", "母の年金は筑波銀行の母の口座に入っています。"),
      s("client", "先週、私の車を買い替えたばかりで。"),
      s("staff", "お父様に借入金はありましたか。"),
      s("client", "父には借金はありませんでした。"),
    ],
    expect: {
      entities: [{ type: "bank_account", match: "ゆうちょ銀行" }],
      documents: [{ documentId: "bank_balance", target: "ゆうちょ銀行" }],
      forbidden: [
        { documentId: "debt_balance" },
        { documentId: "bank_balance", target: "常陽銀行" },
        { documentId: "bank_balance", target: "筑波銀行" },
        { documentId: "other_asset_eval" },
      ],
      checks: [{ id: "debts.loans", status: ["ai_candidate"] }],
    },
  },
  {
    id: "10_disconnect",
    title: "回線が一時的に切断される会話（再接続後の重複確定）",
    deathDate: "2026-07-01",
    duplicateLines: [2],
    lines: [
      s("client", "父の預金は常陽銀行と筑波銀行です。"),
      s("client", "生命保険は第一生命に入っていて、受取人は母です。"),
      s("client", "生命保険は第一生命に入っていて、受取人は母です。"),
      s("client", "それから水戸市に自宅があります。"),
    ],
    expect: {
      entities: [
        { type: "bank_account", match: "常陽銀行" },
        { type: "bank_account", match: "筑波銀行" },
        { type: "life_insurance", match: "第一生命" },
        { type: "real_estate", match: "水戸市" },
      ],
      documents: [
        { documentId: "bank_balance", target: "常陽銀行" },
        { documentId: "ins_payment", target: "第一生命" },
        { documentId: "re_registry", target: "水戸市" },
      ],
    },
  },
];
