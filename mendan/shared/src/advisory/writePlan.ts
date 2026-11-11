import type { DocTab } from "./docModel.js";
import type { DocsRequest } from "./fakeDocs.js";
import { findSection, sectionsOf } from "./rulebook.js";

/**
 * 承認されたルール案を、Google ドキュメントへの書き込み要求（Docs API の batchUpdate）に変える。
 *  - 追記: 章の最後の段落の後ろに、同じ書式（箇条書きなら箇条書き）で1段落足す。章の最後が表なら、表の後ろに普通の段落で足す
 *  - 書き換え: 1段落の中の指定の文を置き換える（ルール集に1か所だけあること）
 *  - どちらも文の末尾に「（YYYY-MM-DD確認）」を付け、冒頭の「更新：YYYY-MM-DD」の日付も今日にする
 * 位置がずれないよう、後ろの位置から順に並べて1回の要求で送る。
 */
export interface PlannedEdit {
  itemId: string;
  operation: "add" | "modify";
  sectionHeading: string;
  beforeText: string | null;
  afterText: string;
}

export interface WritePlan {
  requests: DocsRequest[];
  applied: { itemId: string; sectionHeading: string; text: string }[];
  errors: { itemId: string; reason: string }[];
}

export const withConfirmDate = (text: string, date: string) => {
  const t = text.trim().replace(/\n+/g, " ");
  return /確認）$/.test(t) ? t : `${t}（${date}確認）`;
};

interface Op {
  index: number;
  order: number;
  reqs: DocsRequest[];
}

export function planDocEdits(tab: DocTab, edits: PlannedEdit[], date: string): WritePlan {
  const sections = sectionsOf(tab);
  const tabId = tab.tabId ?? undefined;
  const loc = (index: number) => (tabId ? { index, tabId } : { index });
  const rng = (startIndex: number, endIndex: number) => (tabId ? { startIndex, endIndex, tabId } : { startIndex, endIndex });
  const ops: Op[] = [];
  const applied: WritePlan["applied"] = [];
  const errors: WritePlan["errors"] = [];

  // 追記は章ごとにまとめる（同じ位置への複数の挿入を1つにする）
  const adds = new Map<string, { sectionHeading: string; lines: string[]; itemIds: string[] }>();
  let order = 0;
  for (const e of edits) {
    const sec = findSection(sections, e.sectionHeading);
    if (!sec) {
      errors.push({ itemId: e.itemId, reason: `章「${e.sectionHeading}」がルール集に見つかりません` });
      continue;
    }
    const text = withConfirmDate(e.afterText, date);
    if (!e.afterText.trim()) {
      errors.push({ itemId: e.itemId, reason: "入れる文が空です" });
      continue;
    }
    if (e.operation === "modify") {
      const before = e.beforeText ?? "";
      const hits: { p: (typeof sec.paragraphs)[number]; at: number }[] = [];
      for (const p of sec.paragraphs) {
        if (p.inTable || !before) continue;
        let i = p.text.indexOf(before);
        while (i >= 0) {
          hits.push({ p, at: i });
          i = p.text.indexOf(before, i + before.length);
        }
      }
      if (hits.length !== 1) {
        errors.push({ itemId: e.itemId, reason: hits.length === 0 ? "書き換える前の文がルール集に見つかりません" : "書き換える前の文がルール集に複数あります" });
        continue;
      }
      const start = hits[0].p.startIndex + hits[0].at;
      const end = start + before.length;
      // 段落の末尾に「（…確認）」があればそれも新しい日付に置き換える
      const rest = hits[0].p.text.slice(hits[0].at + before.length).replace(/\n$/, "");
      const oldTag = /^（\d{4}-\d{2}-\d{2}確認）/.exec(rest)?.[0] ?? "";
      ops.push({ index: start, order: order++, reqs: [{ deleteContentRange: { range: rng(start, end + oldTag.length) } }, { insertText: { location: loc(start), text } }] });
      applied.push({ itemId: e.itemId, sectionHeading: sec.heading, text });
      continue;
    }
    const key = sec.heading;
    const g = adds.get(key) ?? { sectionHeading: sec.heading, lines: [], itemIds: [] };
    g.lines.push(text);
    g.itemIds.push(e.itemId);
    adds.set(key, g);
    applied.push({ itemId: e.itemId, sectionHeading: sec.heading, text });
  }

  for (const g of adds.values()) {
    const sec = findSection(sections, g.sectionHeading)!;
    const body = sec.paragraphs;
    const last = body[body.length - 1];
    if (last && !last.inTable) {
      // 最後の段落の改行の直前に「\n文」を入れる → 同じ書式の段落が増える
      const at = last.endIndex - 1;
      ops.push({ index: at, order: order++, reqs: [{ insertText: { location: loc(at), text: g.lines.map((l) => `\n${l}`).join("") } }] });
    } else {
      // 章が空、または最後が表: 次の見出しの直前に普通の段落として入れる
      const at = sec.endIndex;
      const text = g.lines.map((l) => `${l}\n`).join("");
      ops.push({
        index: at,
        order: order++,
        reqs: [
          { insertText: { location: loc(at), text } },
          { updateParagraphStyle: { range: rng(at, at + text.length), paragraphStyle: { namedStyleType: "NORMAL_TEXT" }, fields: "namedStyleType" } },
          { deleteParagraphBullets: { range: rng(at, at + text.length) } },
        ],
      });
    }
  }

  // 冒頭の「更新：YYYY-MM-DD」を今日に
  for (const p of tab.paragraphs.slice(0, 4)) {
    const m = /更新：(\d{4}-\d{2}-\d{2})/.exec(p.text);
    if (m && m[1] !== date && applied.length > 0) {
      const at = p.startIndex + m.index + "更新：".length;
      ops.push({ index: at, order: order++, reqs: [{ deleteContentRange: { range: rng(at, at + 10) } }, { insertText: { location: loc(at), text: date } }] });
      break;
    }
  }

  // 後ろの位置から順に（同じ位置なら登録順）
  ops.sort((a, b) => b.index - a.index || a.order - b.order);
  return { requests: ops.flatMap((o) => o.reqs), applied, errors };
}
