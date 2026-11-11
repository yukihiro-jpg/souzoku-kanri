import { describe, expect, it } from "vitest";
import {
  applyFakeBatchUpdate,
  blockingReason,
  demoMeetingNotes,
  demoRulebook,
  extractDictionary,
  fakeDocToApi,
  findReadingHints,
  findSection,
  mockRuleRun,
  parseGeminiTranscript,
  planDocEdits,
  sectionsOf,
  tabText,
  toDocModel,
  toRuleItems,
  type ApiDocument,
  type RuleRunOutput,
} from "../src/index.js";

const rulebook = () => toDocModel(fakeDocToApi(demoRulebook()));
const notes = () => toDocModel(fakeDocToApi(demoMeetingNotes()));

describe("Gemini のメモ", () => {
  it("文字起こしタブを時刻ごとの発言に分け、終了の印以降は読まない", () => {
    const segs = parseGeminiTranscript(notes());
    expect(segs.map((s) => s.id)).toEqual(["t000005", "t000110", "t000230", "t000340", "t000450"]);
    expect(segs[1]).toMatchObject({ time: "00:01:10", text: "電気代ですけど、来月から常用銀行の口座振替に変更します。" });
    expect(segs.some((s) => s.text.includes("コンピュータが生成"))).toBe(false);
  });
  it("同じ時刻の見出しが続いたら発言IDを分ける", () => {
    const d = demoMeetingNotes();
    d.tabs[1].paragraphs.splice(3, 0, { text: "00:00:05", style: "HEADING_3", bullet: false }, { text: "同じ時刻の続き", style: "NORMAL_TEXT", bullet: false });
    const segs = parseGeminiTranscript(toDocModel(fakeDocToApi(d)));
    expect(segs.slice(0, 2).map((s) => s.id)).toEqual(["t000005", "t000005_2"]);
  });
});

describe("Docs API の JSON", () => {
  it("表の中の段落・文字のない要素も位置がずれない", () => {
    const api: ApiDocument = {
      documentId: "d",
      title: "x",
      revisionId: "r1",
      body: {
        content: [
          { startIndex: 0, endIndex: 1 },
          { startIndex: 1, endIndex: 5, paragraph: { paragraphStyle: { namedStyleType: "HEADING_2" }, elements: [{ startIndex: 1, endIndex: 5, textRun: { content: "見出し\n" } }] } },
          {
            startIndex: 5,
            endIndex: 12,
            table: { tableRows: [{ tableCells: [{ content: [{ startIndex: 6, endIndex: 9, paragraph: { elements: [{ startIndex: 6, endIndex: 9, textRun: { content: "セル\n" } }] } }] }] }] },
          },
          {
            startIndex: 12,
            endIndex: 17,
            paragraph: { elements: [{ startIndex: 12, endIndex: 14, textRun: { content: "あい" } }, { startIndex: 14, endIndex: 15 }, { startIndex: 15, endIndex: 17, textRun: { content: "う\n" } }] },
          },
        ],
      },
    };
    const m = toDocModel(api);
    const ps = m.tabs[0].paragraphs;
    expect(ps.map((p) => [p.style, p.inTable, p.text.length, p.endIndex - p.startIndex])).toEqual([
      ["HEADING_2", false, 4, 4],
      ["NORMAL_TEXT", true, 3, 3],
      ["NORMAL_TEXT", false, 5, 5],
    ]);
    expect(tabText(m.tabs[0])).toBe("見出し\nセル\nあいう\n");
  });
});

describe("ルール集の章と辞書", () => {
  it("章を見出しや章番号で探せる", () => {
    const secs = sectionsOf(rulebook().tabs[0]);
    expect(findSection(secs, "5-6")?.heading).toBe("5-6 税金の納付");
    expect(findSection(secs, "5-4 経費")?.heading).toBe("5-4 経費");
    expect(findSection(secs, "存在しない章")).toBeNull();
  });
  it("聞き間違い（1文字違い）と口座番号の一部を見つける", () => {
    const secs = sectionsOf(rulebook().tabs[0]);
    const dict = extractDictionary(secs);
    expect(dict.some((d) => d.term === "常陽銀行")).toBe(true);
    const hints = findReadingHints(dict, [
      { id: "a", text: "常用銀行の口座振替にします" },
      { id: "b", text: "口座は45678番です" },
      { id: "c", text: "常陽銀行で合っています" },
    ]);
    expect(hints).toEqual(expect.arrayContaining([expect.objectContaining({ segmentId: "a", heard: "常用銀行", likely: "常陽銀行" }), expect.objectContaining({ segmentId: "b", heard: "45678", likely: "0045678" })]));
    expect(hints.some((h) => h.segmentId === "c")).toBe(false);
  });
});

describe("振り分け結果の確認", () => {
  const segs = parseGeminiTranscript(notes());
  const secs = sectionsOf(rulebook().tabs[0]);
  let n = 0;
  const id = () => `i${++n}`;
  const base = { corrections: [], confidence: 0.8, target: null, section_heading: null, operation: null, before_text: null, after_text: null, question: null, suggested_rule: null, card_kind: null, owner: null, due: null, amount: null, settlement_policy: null };
  it("引用が本文にない根拠・存在しない章・見つからない書き換え前の文は承認できない", () => {
    const out: RuleRunOutput = {
      items: [
        { ...base, bucket: "rule", title: "ok", summary: "", evidence: [{ segment_id: "t000110", quote: "常用銀行の口座振替に変更します" }], target: "client_rulebook", section_heading: "5-4 経費", operation: "add", after_text: "電気代は常陽普通（130）から口座振替。" },
        { ...base, bucket: "rule", title: "bad-quote", summary: "", evidence: [{ segment_id: "t000110", quote: "言っていないこと" }], target: "client_rulebook", section_heading: "5-4 経費", operation: "add", after_text: "x" },
        { ...base, bucket: "rule", title: "bad-section", summary: "", evidence: [{ segment_id: "t000110", quote: "口座振替" }], target: "client_rulebook", section_heading: "9-9 ない章", operation: "add", after_text: "x" },
        { ...base, bucket: "rule", title: "bad-before", summary: "", evidence: [{ segment_id: "t000110", quote: "口座振替" }], target: "client_rulebook", section_heading: "5-4", operation: "modify", before_text: "存在しない文", after_text: "x" },
        { ...base, bucket: "rule", title: "dup", summary: "", evidence: [{ segment_id: "t000110", quote: "口座振替" }], target: "client_rulebook", section_heading: "5-6", operation: "add", after_text: "法人税等の納付は 327未払法人税等。" },
      ],
    };
    const items = toRuleItems(out, segs, secs, id);
    expect(blockingReason(items[0])).toBeNull();
    expect(items[0].evidence[0]).toMatchObject({ time: "00:01:10", found: true });
    expect(blockingReason(items[1])).toMatch(/根拠/);
    expect(blockingReason(items[2])).toMatch(/章/);
    expect(blockingReason(items[3])).toMatch(/書き換える前/);
    expect(items[4].checks.maybeDuplicate).toBe(true);
  });
  it("開発用の簡易振り分けで3種類が出る", () => {
    const dict = extractDictionary(secs);
    const out = mockRuleRun(segs, secs, findReadingHints(dict, segs));
    expect(new Set(out.items.map((i) => i.bucket))).toEqual(new Set(["rule", "question", "card"]));
    const rule = out.items.find((i) => i.bucket === "rule")!;
    expect(rule.after_text).toContain("常陽銀行");
    expect(rule.corrections[0]).toMatchObject({ heard: "常用銀行", corrected: "常陽銀行" });
  });
});

describe("ルール集への書き込み", () => {
  it("章の末尾に同じ書式で追記し、確認日と更新日を付ける", () => {
    const fake = demoRulebook();
    const tab = toDocModel(fakeDocToApi(fake)).tabs[0];
    const plan = planDocEdits(
      tab,
      [
        { itemId: "a", operation: "add", sectionHeading: "5-4 経費", beforeText: null, afterText: "電気代は常陽普通（130）から口座振替。" },
        { itemId: "b", operation: "add", sectionHeading: "5-6", beforeText: null, afterText: "源泉税の還付金は雑収入。" },
        { itemId: "c", operation: "modify", sectionHeading: "8. 確認事項", beforeText: "固定資産台帳がない", afterText: "固定資産台帳は来月受領予定" },
        { itemId: "d", operation: "add", sectionHeading: "ない章", beforeText: null, afterText: "x" },
      ],
      "2026-11-11",
    );
    expect(plan.errors).toEqual([{ itemId: "d", reason: expect.stringContaining("見つかりません") }]);
    const after = applyFakeBatchUpdate(fake, plan.requests, "rev-1");
    const ps = after.tabs[0].paragraphs;
    const i54 = ps.findIndex((p) => p.text === "5-4 経費");
    expect(ps[i54 + 1].text).toBe("電気代は現金払い（635水道光熱費 課税10%）。");
    expect(ps[i54 + 2]).toEqual({ text: "電気代は常陽普通（130）から口座振替。（2026-11-11確認）", style: "NORMAL_TEXT", bullet: true });
    expect(ps[i54 + 3].text).toBe("5-6 税金の納付");
    expect(ps.find((p) => p.text.startsWith("源泉税の還付金"))).toEqual({ text: "源泉税の還付金は雑収入。（2026-11-11確認）", style: "NORMAL_TEXT", bullet: true });
    expect(ps.some((p) => p.text === "固定資産台帳は来月受領予定（2026-11-11確認）。")).toBe(true);
    expect(ps[1].text).toContain("更新：2026-11-11");
    expect(after.revision).toBe(2);
  });
  it("章の最後が表なら、表の後ろに普通の段落で入れる", () => {
    const tab = {
      tabId: null,
      title: "",
      endIndex: 40,
      paragraphs: [
        { text: "表の章\n", startIndex: 1, endIndex: 5, style: "HEADING_2" as const, bullet: false, inTable: false },
        { text: "セル\n", startIndex: 7, endIndex: 10, style: "NORMAL_TEXT" as const, bullet: false, inTable: true },
        { text: "次の章\n", startIndex: 12, endIndex: 16, style: "HEADING_2" as const, bullet: false, inTable: false },
      ],
    };
    const plan = planDocEdits(tab, [{ itemId: "a", operation: "add", sectionHeading: "表の章", beforeText: null, afterText: "追記" }], "2026-11-11");
    expect(plan.requests[0]).toEqual({ insertText: { location: { index: 12 }, text: "追記（2026-11-11確認）\n" } });
    expect(plan.requests[1]).toMatchObject({ updateParagraphStyle: { paragraphStyle: { namedStyleType: "NORMAL_TEXT" } } });
  });
  it("ルール集が先に更新されていたら書き込まない", () => {
    const fake = demoRulebook();
    expect(() => applyFakeBatchUpdate(fake, [], "rev-0")).toThrow(/revision/);
  });
});
