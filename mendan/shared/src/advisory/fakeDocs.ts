import type { ApiDocument, ParagraphStyleName } from "./docModel.js";

/**
 * 開発・テスト用の「Google ドキュメントの代わり」。
 * Docs API と同じ JSON を返し、Docs API と同じ書き込み要求（insertText など）をそのまま適用できる。
 * 本物の Google ドキュメントには一切つながない（エミュレーター・自動テスト専用）。
 */

export interface FakeParagraph {
  text: string; // 改行を含まない
  style: ParagraphStyleName;
  bullet: boolean;
}
export interface FakeTab {
  tabId: string;
  title: string;
  paragraphs: FakeParagraph[];
}
export interface FakeDoc {
  documentId: string;
  title: string;
  revision: number;
  tabs: FakeTab[];
}

/** 行の書き方: "# 見出し1" "## 見出し2" "### 見出し3" "- 箇条書き" それ以外は普通の段落 */
export function fakeTabFromLines(tabId: string, title: string, lines: string[]): FakeTab {
  const paragraphs = lines.map<FakeParagraph>((l) => {
    const m = /^(#{1,3}) (.*)$/.exec(l);
    if (m) return { text: m[2], style: (`HEADING_${m[1].length}` as ParagraphStyleName), bullet: false };
    if (l.startsWith("- ")) return { text: l.slice(2), style: "NORMAL_TEXT", bullet: true };
    return { text: l, style: "NORMAL_TEXT", bullet: false };
  });
  return { tabId, title, paragraphs };
}

export function fakeDocToApi(d: FakeDoc): ApiDocument {
  return {
    documentId: d.documentId,
    title: d.title,
    revisionId: `rev-${d.revision}`,
    tabs: d.tabs.map((t) => {
      let idx = 1;
      const content: NonNullable<NonNullable<NonNullable<ApiDocument["tabs"]>[number]["documentTab"]>["body"]>["content"] = [{ startIndex: 0, endIndex: 1 }];
      for (const p of t.paragraphs) {
        const text = `${p.text}\n`;
        const start = idx;
        const end = idx + text.length;
        content!.push({
          startIndex: start,
          endIndex: end,
          paragraph: { elements: [{ startIndex: start, endIndex: end, textRun: { content: text } }], paragraphStyle: { namedStyleType: p.style }, ...(p.bullet ? { bullet: { listId: "l1" } } : {}) },
        });
        idx = end;
      }
      return { tabProperties: { tabId: t.tabId, title: t.title }, documentTab: { body: { content } } };
    }),
  };
}

type Range = { startIndex: number; endIndex: number; tabId?: string };
export type DocsRequest =
  | { insertText: { location: { index: number; tabId?: string }; text: string } }
  | { deleteContentRange: { range: Range } }
  | { updateParagraphStyle: { range: Range; paragraphStyle: { namedStyleType: ParagraphStyleName }; fields: string } }
  | { deleteParagraphBullets: { range: Range } };

export class FakeRevisionMismatch extends Error {
  constructor() {
    super("The required revision ID does not match the latest revision.");
  }
}

/** Docs API の documents.batchUpdate と同じ要求を適用する */
export function applyFakeBatchUpdate(d: FakeDoc, requests: DocsRequest[], requiredRevisionId?: string): FakeDoc {
  if (requiredRevisionId && requiredRevisionId !== `rev-${d.revision}`) throw new FakeRevisionMismatch();
  const next: FakeDoc = structuredClone(d);
  for (const r of requests) {
    const tabId = "insertText" in r ? r.insertText.location.tabId : Object.values(r)[0].range.tabId;
    const tab = next.tabs.find((t) => !tabId || t.tabId === tabId) ?? next.tabs[0];
    // 文字の列と、各段落の終わり（改行）の書式に分解する
    const chars: string[] = [];
    const nl: Map<number, { style: ParagraphStyleName; bullet: boolean }> = new Map();
    for (const p of tab.paragraphs) {
      for (const c of p.text) chars.push(...c.split(""));
      nl.set(chars.length, { style: p.style, bullet: p.bullet });
      chars.push("\n");
    }
    // 位置 → 書式（各文字に付与。改行以外は undefined）
    let styles: ({ style: ParagraphStyleName; bullet: boolean } | undefined)[] = chars.map((_, i) => nl.get(i));
    const nextNl = (pos: number) => {
      for (let i = pos; i < chars.length; i++) if (chars[i] === "\n") return styles[i]!;
      return { style: "NORMAL_TEXT" as ParagraphStyleName, bullet: false };
    };
    const paraRange = (s: number, e: number) => {
      // [s,e) に重なる段落の改行位置
      const out: number[] = [];
      let begin = 0;
      for (let i = 0; i < chars.length; i++) {
        if (chars[i] !== "\n") continue;
        if (i >= s && begin < e) out.push(i);
        begin = i + 1;
      }
      return out;
    };
    if ("insertText" in r) {
      const pos = r.insertText.location.index - 1;
      if (pos < 0 || pos > chars.length - 1) throw new Error(`insertText の位置が範囲外です: ${r.insertText.location.index}`);
      const st = nextNl(pos);
      const ins = r.insertText.text.split("");
      chars.splice(pos, 0, ...ins);
      styles.splice(pos, 0, ...ins.map((c) => (c === "\n" ? { ...st } : undefined)));
    } else if ("deleteContentRange" in r) {
      const s = r.deleteContentRange.range.startIndex - 1;
      const e = r.deleteContentRange.range.endIndex - 1;
      if (s < 0 || e > chars.length - 1 || s >= e) throw new Error("deleteContentRange の範囲が不正です");
      chars.splice(s, e - s);
      styles.splice(s, e - s);
    } else if ("updateParagraphStyle" in r) {
      const { startIndex, endIndex } = r.updateParagraphStyle.range;
      for (const i of paraRange(startIndex - 1, endIndex - 1)) styles[i] = { ...styles[i]!, style: r.updateParagraphStyle.paragraphStyle.namedStyleType };
    } else if ("deleteParagraphBullets" in r) {
      const { startIndex, endIndex } = r.deleteParagraphBullets.range;
      for (const i of paraRange(startIndex - 1, endIndex - 1)) styles[i] = { ...styles[i]!, bullet: false };
    }
    // 段落に組み直す
    const paragraphs: FakeParagraph[] = [];
    let buf = "";
    chars.forEach((c, i) => {
      if (c === "\n") {
        const st = styles[i] ?? { style: "NORMAL_TEXT" as ParagraphStyleName, bullet: false };
        paragraphs.push({ text: buf, style: st.style, bullet: st.bullet });
        buf = "";
      } else buf += c;
    });
    tab.paragraphs = paragraphs;
    styles = [];
  }
  next.revision = d.revision + 1;
  return next;
}

/** テスト・デモ用の架空のルール集（実在の顧問先とは無関係） */
export function demoRulebook(documentId = "mock-rulebook"): FakeDoc {
  return {
    documentId,
    title: "㈱テスト食品（架空）_月次仕訳ルール",
    revision: 1,
    tabs: [
      fakeTabFromLines("t.main", "ルール集", [
        "# ㈱テスト食品（架空）_月次仕訳ルール",
        "作成：2026-10-01／更新：2026-10-01（初版）。会計大将。3月決算。",
        "## 1. 会社の基本",
        "- 食品の製造・販売。決算期は3月。",
        "## 3. 口座と科目コード",
        "- 130 常陽普通 常陽銀行 0045678（メイン口座）",
        "- 132 足利普通 足利銀行 1234567",
        "## 5. 取引別の処理ルール",
        "### 5-1 売上",
        "- 振込入金は 銀行／410売上高 課税売上軽減8%。",
        "### 5-4 経費",
        "- 電気代は現金払い（635水道光熱費 課税10%）。",
        "### 5-6 税金の納付",
        "- 法人税等の納付は 327未払法人税等。",
        "## 8. 確認事項",
        "- 固定資産台帳がない。",
      ]),
    ],
  };
}

/** テスト・デモ用の架空の「Gemini によるメモ」（メモと文字起こしの2タブ） */
export function demoMeetingNotes(documentId = "mock-notes"): FakeDoc {
  return {
    documentId,
    title: "テスト食品　月次報告 - Gemini によるメモ",
    revision: 1,
    tabs: [
      fakeTabFromLines("t.notes", "メモ", ["# メモ", "### 概要", "月次の数字と今後の段取りを確認した。"]),
      fakeTabFromLines("t.transcript", "文字起こし", [
        "# 文字起こし",
        "### 00:00:05",
        "今月の売上は前年より少し増えています。原材料がまた上がってますね。",
        "### 00:01:10",
        "電気代ですけど、来月から常用銀行の口座振替に変更します。",
        "### 00:02:30",
        "配当の源泉税が還付される予定です。還付金の科目はどうしますか。",
        "### 00:03:40",
        "社長が月末までにバイヤーへ値上げの方針を確認します。",
        "### 00:04:50",
        "人手が足りなくて、退職者が出ても補充しない方針です。",
        "### 00:05:30 より後に文字起こしが終了しました",
        "この編集可能な文字起こしはコンピュータが生成したものであり、誤りが含まれている可能性があります。",
      ]),
    ],
  };
}
