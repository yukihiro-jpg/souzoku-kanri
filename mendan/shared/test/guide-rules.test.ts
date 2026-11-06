import { describe, expect, it } from "vitest";
import { DEFAULT_RULES, DOCUMENT_MASTER, DOCUMENT_MASTER_BY_ID, type EntityType } from "../src/index.js";
import { analysis, entityOp, newState, run, seg } from "./helpers.js";

/** 事務所の資料収集ガイドに基づくルールの確認 */
function docsFor(type: EntityType, label: string, attrs: Record<string, string>) {
  const s1 = seg(1, "テスト発言");
  const { state } = run(
    newState(),
    analysis({ entities: [entityOp({ entity_type: type, label, attributes: Object.entries(attrs).map(([key, value]) => ({ key, value })), evidence_segment_ids: [s1.id] })] }),
    [s1],
  );
  return state;
}
const ids = (st: ReturnType<typeof docsFor>) => st.documents.filter((d) => d.status === "candidate").map((d) => d.documentId);

describe("資料マスタ・ルールの整合性", () => {
  it("すべてのルールが資料マスタにある資料を参照している", () => {
    for (const r of DEFAULT_RULES) for (const d of r.documentIds) expect(DOCUMENT_MASTER_BY_ID.has(d), `${r.id} → ${d}`).toBe(true);
  });
  it("ルールIDが重複していない", () => {
    expect(new Set(DEFAULT_RULES.map((r) => r.id)).size).toBe(DEFAULT_RULES.length);
  });
  it("取得代行の表記がない（事務所方針）", () => {
    for (const d of DOCUMENT_MASTER) expect(`${d.name}${d.howTo}${d.defaultSubmitter}`).not.toMatch(/代行|事務所で取得/);
  });
});

describe("すべての案件で必要な資料", () => {
  it("マイナンバー・戸籍・印鑑証明・手元現金・略歴が案件作成直後から候補になる", () => {
    const st = docsFor("other_fact", "雑談", { topic: "天気" });
    const list = ids(st);
    for (const d of ["mynumber_heirs", "koseki_decedent", "joseki_decedent", "koseki_heirs", "juminhyo_heirs", "inkan_heirs", "cash_on_hand", "biography_decedent", "heir_contacts", "houtei_ichiran"]) expect(list).toContain(d);
    expect(st.documents.find((d) => d.documentId === "houtei_ichiran")!.importance).toBe("low");
  });
});

describe("預貯金", () => {
  it("ゆうちょ銀行 → 現存照会", () => {
    expect(ids(docsFor("bank_account", "ゆうちょ銀行", { institution: "ゆうちょ銀行" }))).toContain("yucho_genson");
  });
  it("信用金庫 → 出資金、銀行には出資金なし", () => {
    expect(ids(docsFor("bank_account", "水戸信用金庫", { institution: "水戸信用金庫" }))).toContain("shinkin_capital");
    expect(ids(docsFor("bank_account", "常陽銀行", { institution: "常陽銀行" }))).not.toContain("shinkin_capital");
  });
});

describe("今の相続で増えている財産", () => {
  it("暗号資産 → 交換業者の残高証明書（汎用資料は出さない）", () => {
    const l = ids(docsFor("other_asset", "ビットコイン", { kind: "暗号資産", description: "ビットコイン" }));
    expect(l).toContain("crypto_docs");
    expect(l).not.toContain("other_asset_eval");
  });
  it("スマホ決済 → 残高がわかるもの", () => {
    expect(ids(docsFor("other_asset", "PayPay残高", { kind: "電子マネー・スマホ決済・ポイント" }))).toContain("emoney_docs");
  });
  it("iDeCo の死亡一時金 → 支払通知書、確認事項も候補に", () => {
    const st = docsFor("retirement_allowance", "iDeCo", { payer: "iDeCo（個人型確定拠出年金）" });
    expect(ids(st)).toContain("retirement_notice");
    expect(st.checkItems.find((c) => c.id === "insurance.dc_kyosai")!.status).toBe("ai_candidate");
  });
  it("種類が不明なその他の財産 → 汎用資料", () => {
    expect(ids(docsFor("other_asset", "何かの権利", { kind: "その他" }))).toContain("other_asset_eval");
  });
});

describe("債務の種類で資料を出し分ける", () => {
  it("住宅ローン → 残高証明書", () => {
    const l = ids(docsFor("debt", "常陽銀行の住宅ローン", { creditor: "常陽銀行", description: "住宅ローン" }));
    expect(l).toContain("debt_balance");
    expect(l).not.toContain("unpaid_tax_notices");
  });
  it("未納の住民税 → 納税通知書（借入金の残高証明書は出さない）", () => {
    const l = ids(docsFor("debt", "住民税", { description: "未納の住民税" }));
    expect(l).toContain("unpaid_tax_notices");
    expect(l).not.toContain("debt_balance");
  });
});

describe("特記事項", () => {
  it("老人ホーム入居 → 入居契約書・介護保険被保険者証・戸籍の附票、確認事項も候補に", () => {
    const st = docsFor("situation", "老人ホーム入居", { kind: "老人ホーム等への入居", detail: "2024年からサービス付き高齢者向け住宅" });
    const l = ids(st);
    for (const d of ["nursing_home_docs", "care_insurance", "fuhyo_decedent"]) expect(l).toContain(d);
    expect(st.checkItems.find((c) => c.id === "special.nursing_home")!.status).toBe("ai_candidate");
  });
  it("相続放棄 → 受理証明書", () => {
    expect(ids(docsFor("situation", "次男の相続放棄", { kind: "相続放棄", person: "次男" }))).toContain("renunciation_cert");
  });
  it("家なき子 → 自宅の賃貸借契約書と戸籍の附票（対象者名つき）", () => {
    const st = docsFor("situation", "長男は賃貸住まい", { kind: "家なき子（持ち家のない別居の相続人）", person: "長男" });
    expect(st.documents.find((d) => d.documentId === "ienaki_lease")!.name).toContain("長男");
    expect(ids(st)).toContain("fuhyo_heirs");
  });
});

describe("生前贈与", () => {
  it("暦年贈与の対象期間は相続開始年に応じて表示（2026年の相続は3年）", () => {
    const st = docsFor("lifetime_gift", "孫への贈与", { recipient: "孫", amount: "100万円" });
    expect(st.documents.find((d) => d.documentId === "gift_evidence")!.period).toContain("2023-08-21〜2026-08-20");
  });
  it("相続時精算課税 → 届出書・選択以後の申告書・戸籍の附票", () => {
    const l = ids(docsFor("lifetime_gift", "長男への贈与", { recipient: "長男", taxation: "相続時精算課税" }));
    for (const d of ["seisan_notice", "seisan_returns", "fuhyo_decedent", "fuhyo_heirs"]) expect(l).toContain(d);
  });
  it("教育資金の一括贈与 → 非課税申告書と残高", () => {
    expect(ids(docsFor("lifetime_gift", "孫の教育資金", { recipient: "孫", taxation: "教育資金の一括贈与" }))).toContain("edu_gift_docs");
  });
});
