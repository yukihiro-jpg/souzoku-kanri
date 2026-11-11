import { headingLevel, isHeading, tabText, type DocModel, type DocParagraph, type DocTab } from "./docModel.js";

/**
 * 「Gemini によるメモ」の文字起こしタブを、時刻ごとの発言に分ける。
 * 文字起こしタブには約30秒ごとに「01:12:45」のような時刻の見出しが付く（話者の区別はない）。
 */
export interface NoteSegment {
  /** 発言ID（例: t011245。同じ時刻が続いたら t011245_2） */
  id: string;
  /** 時刻（例: 01:12:45） */
  time: string;
  text: string;
}

const TIME_RE = /^(\d{1,2}):(\d{2}):(\d{2})$/;
const END_RE = /より後に文字起こしが終了しました/;

const clean = (s: string) => s.replace(/￼/g, "").replace(/\s+/g, " ").trim();

function timeOf(p: DocParagraph): string | null {
  const t = clean(p.text);
  const m = TIME_RE.exec(t);
  if (!m) return null;
  return `${m[1].padStart(2, "0")}:${m[2]}:${m[3]}`;
}

/** 文字起こしのタブを探す（タブ名に「文字起こし」、なければ時刻の見出しが最も多いタブ） */
export function findTranscriptTab(doc: DocModel): DocTab | null {
  const byName = doc.tabs.find((t) => /文字起こし|transcript/i.test(t.title) && t.paragraphs.some((p) => timeOf(p)));
  if (byName) return byName;
  let best: DocTab | null = null;
  let n = 0;
  for (const t of doc.tabs) {
    const c = t.paragraphs.filter((p) => timeOf(p)).length;
    if (c > n) {
      n = c;
      best = t;
    }
  }
  return best;
}

export function parseGeminiTranscript(doc: DocModel): NoteSegment[] {
  const tab = findTranscriptTab(doc);
  if (!tab) return [];
  const out: NoteSegment[] = [];
  const seen = new Map<string, number>();
  let cur: NoteSegment | null = null;
  for (const p of tab.paragraphs) {
    const text = clean(p.text);
    if (END_RE.test(text)) break;
    const time = timeOf(p);
    if (time) {
      if (cur && cur.text) out.push(cur);
      const base = `t${time.replaceAll(":", "")}`;
      const k = (seen.get(base) ?? 0) + 1;
      seen.set(base, k);
      cur = { id: k === 1 ? base : `${base}_${k}`, time, text: "" };
      continue;
    }
    if (!cur || !text) continue;
    if (isHeading(p) && headingLevel(p) <= 2) continue; // タブの表題など
    cur.text = cur.text ? `${cur.text}${text}` : text;
  }
  if (cur && cur.text) out.push(cur);
  return out;
}

/** 「メモ」タブの要約（AI への補助情報。根拠には使わない） */
export function geminiSummary(doc: DocModel): string {
  const t = doc.tabs.find((x) => /メモ|notes/i.test(x.title) && x !== findTranscriptTab(doc));
  return t ? tabText(t).slice(0, 6000) : "";
}

export const segmentLine = (s: NoteSegment) => `[${s.id} ${s.time}] ${s.text}`;
