import { headingLevel, isHeading, type DocParagraph, type DocTab } from "./docModel.js";

/**
 * 顧問先のルール集（Google ドキュメント）を章に分け、口座・科目・取引先の辞書を作る。
 * 辞書は文字起こしの聞き間違い（「常用銀行」→「常陽銀行」など）を見つける手がかりに使う。
 */
export interface RuleSection {
  heading: string;
  level: number;
  /** 見出し段落の位置 */
  headingStart: number;
  headingEnd: number;
  /** この章の終わり（次の見出しの始まり、またはタブの終わり） */
  endIndex: number;
  paragraphs: DocParagraph[];
  text: string;
}

const strip = (s: string) => s.replace(/￼/g, "").replace(/\n$/, "");

export function sectionsOf(tab: DocTab): RuleSection[] {
  const out: RuleSection[] = [];
  let cur: RuleSection | null = null;
  for (const p of tab.paragraphs) {
    if (isHeading(p) && !p.inTable) {
      if (cur) cur.endIndex = p.startIndex;
      cur = { heading: strip(p.text).trim(), level: headingLevel(p), headingStart: p.startIndex, headingEnd: p.endIndex, endIndex: tab.endIndex - 1, paragraphs: [], text: "" };
      out.push(cur);
    } else if (cur) {
      cur.paragraphs.push(p);
    }
  }
  for (const s of out) s.text = s.paragraphs.map((p) => strip(p.text)).join("\n");
  return out;
}

/** 見出しの比較用（空白・記号・全角半角の違いを無視） */
export const normHeading = (s: string) =>
  s
    .normalize("NFKC")
    .replace(/[\s　・．.、,:：()（）「」【】]/g, "")
    .toLowerCase();

/** 見出しの文字（「5-6 東日本銀行…」「5-6」など）から章を探す。見つからなければ null */
export function findSection(sections: RuleSection[], query: string | null | undefined): RuleSection | null {
  if (!query) return null;
  const q = normHeading(query);
  if (!q) return null;
  const exact = sections.find((s) => normHeading(s.heading) === q);
  if (exact) return exact;
  // 章番号（例: 5-6, 4.）で一致
  const num = /^(\d+(?:-\d+)*)/.exec(query.normalize("NFKC").trim())?.[1];
  if (num) {
    const byNum = sections.filter((s) => new RegExp(`^${num.replace(/-/g, "\\-")}(?![\\d-])`).test(s.heading.normalize("NFKC").trim()));
    if (byNum.length === 1) return byNum[0];
  }
  const starts = sections.filter((s) => normHeading(s.heading).startsWith(q) || q.startsWith(normHeading(s.heading)));
  if (starts.length === 1) return starts[0];
  const inc = sections.filter((s) => normHeading(s.heading).includes(q));
  return inc.length === 1 ? inc[0] : null;
}

export interface DictEntry {
  term: string;
  kind: "name" | "number";
  /** ルール集の中でその語が出てくる行（AI と画面への説明用） */
  context: string;
}

const NAME_SUFFIX = /(銀行|信用金庫|信金|信組|農協|証券|生命|損保|商店|商事|産業|工業|製菓|食品|紙業|石油|運輸|自動車|建築工房|リース|ファイナンス)$/;
const TOKEN_RE = /[\p{Script=Han}\p{Script=Katakana}ー々A-Za-zＡ-Ｚａ-ｚ0-9０-９]{2,16}/gu;

/** ルール集から、口座・科目・取引先などの固有の語と番号を拾う */
export function extractDictionary(sections: RuleSection[]): DictEntry[] {
  const out = new Map<string, DictEntry>();
  const add = (term: string, kind: DictEntry["kind"], context: string) => {
    if (!out.has(term)) out.set(term, { term, kind, context: context.slice(0, 120) });
  };
  for (const s of sections) {
    for (const line of s.text.split("\n")) {
      for (const m of line.matchAll(TOKEN_RE)) {
        const t = m[0];
        if (/^\d+$/.test(t)) {
          if (t.length >= 4) add(t, "number", line);
          continue;
        }
        if (NAME_SUFFIX.test(t)) add(t, "name", line);
      }
      // 「130 常陽普通371」のような 科目コード＋科目名
      for (const m of line.matchAll(/(?:^|[\s|｜：:・、])(\d{3})\s*([\p{Script=Han}\p{Script=Katakana}ー]{2,10}[0-9]*)/gu)) add(m[2], "name", line);
      // 銀行名の略称（「常陽普通」→「常陽」は辞書にしない。正式名だけを使う）
    }
  }
  return [...out.values()];
}

export interface ReadingHint {
  segmentId: string;
  heard: string;
  likely: string;
  reason: string;
}

/** 1文字だけ違う語（常用銀行／常陽銀行など）と、口座番号の一部（61234／0061234など）を探す */
export function findReadingHints(dict: DictEntry[], segments: { id: string; text: string }[]): ReadingHint[] {
  const hints: ReadingHint[] = [];
  const names = dict.filter((d) => d.kind === "name" && d.term.length >= 3);
  const nums = dict.filter((d) => d.kind === "number");
  const known = new Set(dict.map((d) => d.term));
  for (const s of segments) {
    const text = s.text.normalize("NFKC");
    for (const d of names) {
      const t = d.term.normalize("NFKC");
      if (text.includes(t)) continue;
      for (let i = 0; i + t.length <= text.length; i++) {
        const sub = text.slice(i, i + t.length);
        let diff = 0;
        for (let k = 0; k < t.length && diff < 2; k++) if (sub[k] !== t[k]) diff++;
        if (diff !== 1 || known.has(sub)) continue;
        // 違う1文字が漢字どうし・末尾の種類（銀行など）は一致していること
        const k = [...t].findIndex((c, j) => sub[j] !== c);
        if (!/\p{Script=Han}/u.test(sub[k] ?? "") || !/\p{Script=Han}/u.test(t[k] ?? "")) continue;
        hints.push({ segmentId: s.id, heard: sub, likely: d.term, reason: `ルール集の「${d.context}」` });
        break;
      }
    }
    for (const m of text.matchAll(/\d{4,}/g)) {
      const heard = m[0];
      if (known.has(heard)) continue;
      const hit = nums.find((d) => d.term.endsWith(heard) || heard.endsWith(d.term.replace(/^0+/, "")));
      if (hit) hints.push({ segmentId: s.id, heard, likely: hit.term, reason: `ルール集の「${hit.context}」` });
    }
  }
  // 同じ聞き間違いは最初の1件だけ
  const seen = new Set<string>();
  return hints.filter((h) => {
    const k = `${h.heard}>${h.likely}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
