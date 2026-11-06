import { describe, expect, it } from "vitest";
import { DEMO_SCRIPT, giftAdditionPeriod, mockAnalyze, rankQuestions, similarText } from "../src/index.js";
import { commit, ctx, newState, seg } from "./helpers.js";
import { applyAnalysis } from "../src/merge.js";

describe("期間の算定", () => {
  it("生前贈与加算期間は相続開始年に応じて3年→7年へ段階的に延長", () => {
    expect(giftAdditionPeriod("2026-08-20")).toMatchObject({ from: "2023-08-21", to: "2026-08-20" });
    expect(giftAdditionPeriod("2028-05-01")).toMatchObject({ from: "2024-01-01" });
    expect(giftAdditionPeriod("2032-03-01")).toMatchObject({ from: "2025-03-02" });
  });
});

describe("次の質問", () => {
  it("矛盾・要追加確認・AI提案・未確認の重要事項の順に並ぶ", () => {
    const st = newState();
    st.checkItems.find((c) => c.id === "gifts.calendar")!.status = "needs_followup";
    st.checkItems.find((c) => c.id === "debts.loans")!.status = "contradiction";
    const qs = rankQuestions(st.checkItems, [{ question: "常陽銀行以外にも口座はありますか？", checkItemId: "deposits.other_institutions", priority: "high", reason: "", status: "open" }]);
    expect(qs[0].checkItemId).toBe("debts.loans");
    expect(qs[1].checkItemId).toBe("gifts.calendar");
    expect(qs[2].question).toBe("常陽銀行以外にも口座はありますか？");
    expect(new Set(qs.map((q) => q.key)).size).toBe(qs.length);
  });
});

describe("重複検出", () => {
  it("再接続時の同一文を検出する", () => {
    expect(similarText("常陽銀行に普通預金がありました。", "常陽銀行に普通預金がありました")).toBe(true);
    expect(similarText("はい", "はい、そうです")).toBe(false);
  });
});

describe("デモ台本（簡易解析器）による通しテスト", () => {
  it("訂正・複数金融機関・不動産・保険・贈与・名義預金が資料に反映される", () => {
    let state = newState();
    const segs = DEMO_SCRIPT.map((l, i) => seg(i + 1, l.text, l.speaker));
    for (let i = 0; i < segs.length; i++) {
      const a = mockAnalyze({ newSegments: [segs[i]], contextSegments: segs.slice(Math.max(0, i - 6), i), entities: state.entities });
      const r = applyAnalysis(state, a, ctx(segs.slice(0, i + 1)));
      state = commit(state, r);
    }
    const active = state.documents.filter((d) => d.status === "candidate");
    const names = active.map((d) => d.name);
    expect(names).toContain("筑波銀行の残高証明書（相続開始日時点）");
    expect(names).toContain("ゆうちょ銀行の定期預金の既経過利息計算書");
    expect(names.some((n) => n.startsWith("水戸市") && n.includes("登記事項証明書"))).toBe(true);
    expect(names).toContain("さくら生命の死亡保険金の支払通知書");
    expect(names.some((n) => n.includes("家族名義の口座"))).toBe(true);
    // 訂正された常陽銀行は削除候補
    expect(state.documents.filter((d) => d.target === "常陽銀行").every((d) => d.status === "removal_candidate")).toBe(true);
    // 「借金はありません」→ 候補止まり
    expect(state.checkItems.find((c) => c.id === "debts.loans")!.aiProposal).toBe("not_applicable");
    // 遺言「分からない」→ 要追加確認
    expect(state.checkItems.find((c) => c.id === "will.exists")!.status).toBe("needs_followup");
    // すべての資料に根拠発言（案件共通の戸籍等を除く）
    expect(state.documents.filter((d) => d.entityId).every((d) => d.evidenceSegmentIds.length > 0)).toBe(true);
  });
});
