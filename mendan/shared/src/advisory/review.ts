import type { NoteSegment } from "./notes.js";
import { findSection, normHeading, type ReadingHint, type RuleSection } from "./rulebook.js";
import type { RuleRunOutput, RuleRunOutputItem } from "./schema.js";
import type { Evidence, RuleItem, RuleItemChecks } from "./types.js";

/**
 * AI の出力を、承認画面で使う RuleItem に変換し、プログラムで確かめられることを確かめる。
 *  - 根拠の引用が、その発言の本文に本当にあるか
 *  - 書き込み先の章がルール集にあるか
 *  - 書き換える前の文がルール集に1か所だけあるか
 *  - 同じ内容がすでに書いてありそうか
 */
const norm = (s: string) =>
  s
    .normalize("NFKC")
    .replace(/[\s　「」『』"'、。,.・：:（）()]/g, "")
    .toLowerCase();

function bigrams(s: string): Set<string> {
  const n = norm(s);
  const out = new Set<string>();
  for (let i = 0; i < n.length - 1; i++) out.add(n.slice(i, i + 2));
  return out;
}

/** 文の似ている度合い（0〜1） */
export function similarity(a: string, b: string): number {
  const A = bigrams(a);
  const B = bigrams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / Math.min(A.size, B.size);
}

const countOccurrences = (hay: string, needle: string) => {
  if (!needle) return 0;
  let n = 0;
  let i = hay.indexOf(needle);
  while (i >= 0) {
    n++;
    i = hay.indexOf(needle, i + needle.length);
  }
  return n;
};

export function checkItem(item: Pick<RuleItem, "bucket" | "evidence" | "target" | "sectionHeading" | "operation" | "beforeText" | "afterText">, sections: RuleSection[]): RuleItemChecks {
  const evidence: RuleItemChecks["evidence"] = item.evidence.length > 0 && item.evidence.every((e) => e.found) ? "ok" : "missing";
  if (item.bucket !== "rule" || item.target !== "client_rulebook") return { evidence, section: "n/a", before: "n/a", maybeDuplicate: false };
  const sec = findSection(sections, item.sectionHeading);
  let before: RuleItemChecks["before"] = "n/a";
  if (item.operation === "modify") {
    if (!sec || !item.beforeText) before = "not_found";
    else {
      const n = sec.paragraphs.filter((p) => !p.inTable).reduce((acc, p) => acc + countOccurrences(p.text, item.beforeText!), 0);
      before = n === 1 ? "ok" : n === 0 ? "not_found" : "ambiguous";
    }
  }
  const maybeDuplicate = !!item.afterText && sections.some((s) => s.paragraphs.some((p) => similarity(p.text, item.afterText!) > 0.75));
  return { evidence, section: sec ? "ok" : "unknown", before, maybeDuplicate };
}

function evidenceOf(raw: RuleRunOutputItem["evidence"], segments: NoteSegment[]): Evidence[] {
  return raw.map((e) => {
    const seg = segments.find((s) => s.id === e.segment_id);
    const found = !!seg && (norm(seg.text).includes(norm(e.quote)) || (norm(e.quote).length >= 6 && similarity(seg.text, e.quote) > 0.85));
    return { segmentId: e.segment_id, time: seg?.time ?? "", quote: e.quote, found };
  });
}

export function toRuleItems(out: RuleRunOutput, segments: NoteSegment[], sections: RuleSection[], newId: () => string): RuleItem[] {
  return out.items.map((r) => {
    const sec = r.bucket === "rule" ? findSection(sections, r.section_heading) : null;
    const base: RuleItem = {
      id: newId(),
      bucket: r.bucket,
      title: r.title,
      summary: r.summary,
      evidence: evidenceOf(r.evidence, segments),
      corrections: r.corrections.map((c) => ({ segmentId: c.segment_id, heard: c.heard, corrected: c.corrected, reason: c.reason })),
      confidence: Math.max(0, Math.min(1, Number(r.confidence) || 0)),
      target: r.bucket === "rule" ? (r.target ?? "client_rulebook") : null,
      sectionHeading: r.bucket === "rule" ? (sec?.heading ?? r.section_heading) : r.section_heading,
      operation: r.bucket === "rule" ? (r.operation ?? "add") : null,
      beforeText: r.before_text,
      afterText: r.after_text,
      question: r.question,
      suggestedRule: r.suggested_rule,
      answer: null,
      cardKind: r.bucket === "card" ? (r.card_kind ?? "ongoing") : null,
      owner: r.bucket === "card" ? (r.owner ?? "unknown") : null,
      due: r.due,
      amount: r.amount,
      settlementPolicy: r.settlement_policy,
      checks: { evidence: "missing", section: "n/a", before: "n/a", maybeDuplicate: false },
      status: "proposed",
      convertedFromQuestion: false,
      decidedBy: null,
      decidedAt: null,
      writtenAt: null,
      writeError: null,
    };
    base.checks = checkItem(base, sections);
    return base;
  });
}

/** 承認できない状態か（理由を返す。承認できるなら null） */
export function blockingReason(item: RuleItem): string | null {
  if (item.checks.evidence === "missing") return "根拠の引用が文字起こしに見つかりません。根拠を確かめてから承認してください。";
  if (item.bucket === "rule" && item.target === "client_rulebook") {
    if (item.checks.section !== "ok") return "書き込み先の章がルール集に見つかりません。章を選び直してください。";
    if (item.operation === "modify" && item.checks.before !== "ok") return "書き換える前の文がルール集に1か所だけ見つかりません。文を直すか「追記」にしてください。";
    if (!item.afterText?.trim()) return "ルール集に入れる文が空です。";
  }
  return null;
}

/**
 * 開発用の簡易振り分け（AI_MODE=mock）。キーワードで振り分けるだけで、精度は求めない。
 * エミュレーターで画面と書き込みの流れを確かめるために使う。
 */
export function mockRuleRun(segments: NoteSegment[], sections: RuleSection[], hints: ReadingHint[]): RuleRunOutput {
  const items: RuleRunOutput["items"] = [];
  const pickSection = (keyword: string) =>
    sections.find((s) => s.heading.includes(keyword))?.heading ?? sections.filter((s) => s.level >= 2).slice(-1)[0]?.heading ?? null;
  for (const s of segments) {
    const quote = s.text.slice(0, 30);
    const corrections = hints.filter((h) => h.segmentId === s.id).map((h) => ({ segment_id: s.id, heard: h.heard, corrected: h.likely, reason: h.reason }));
    const fixed = corrections.reduce((t, c) => t.replaceAll(c.heard, c.corrected), s.text);
    const empty = { target: null, section_heading: null, operation: null, before_text: null, after_text: null, question: null, suggested_rule: null, card_kind: null, owner: null, due: null, amount: null, settlement_policy: null } as const;
    if (/に変更します|から.*に切り替え|今後は/.test(s.text)) {
      const kw = /電気|水道|ガス/.test(s.text) ? "経費" : /税|納付/.test(s.text) ? "税金" : "売上";
      items.push({ ...empty, bucket: "rule", title: fixed.slice(0, 24), summary: fixed, evidence: [{ segment_id: s.id, quote }], corrections, confidence: 0.6, target: "client_rulebook", section_heading: pickSection(kw), operation: "add", after_text: fixed.replace(/。$/, "") + "。" });
    } else if (/どうしますか|でしょうか|ですか。?$/.test(s.text)) {
      items.push({ ...empty, bucket: "question", title: fixed.slice(0, 24), summary: fixed, evidence: [{ segment_id: s.id, quote }], corrections, confidence: 0.5, question: fixed, section_heading: pickSection("税金"), suggested_rule: null });
    } else if (/までに|方針|悩|目標/.test(s.text)) {
      items.push({ ...empty, bucket: "card", title: fixed.slice(0, 24), summary: fixed, evidence: [{ segment_id: s.id, quote }], corrections, confidence: 0.5, card_kind: /までに/.test(s.text) ? "homework" : "ongoing", owner: /社長/.test(s.text) ? "client" : "office", due: /月末/.test(s.text) ? "月末" : null });
    }
  }
  return { items };
}

export const sameHeading = (a: string | null, b: string | null) => !!a && !!b && normHeading(a) === normHeading(b);
