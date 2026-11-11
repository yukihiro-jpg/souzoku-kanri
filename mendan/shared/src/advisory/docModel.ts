/**
 * Google ドキュメント（Docs API の JSON）を、解析と書き込み位置の計算に使う形へ変換する。
 *
 * 位置（index）は Docs API と同じ UTF-16 単位。段落の文字列は、画像やチップなど文字のない要素を
 * 「￼」で埋めて、文字の位置と index が必ず一致するようにしている。
 */

export type ParagraphStyleName = "TITLE" | "SUBTITLE" | "HEADING_1" | "HEADING_2" | "HEADING_3" | "HEADING_4" | "HEADING_5" | "HEADING_6" | "NORMAL_TEXT";

export interface DocParagraph {
  /** 段落の文字列（末尾の改行を含む） */
  text: string;
  startIndex: number;
  endIndex: number;
  style: ParagraphStyleName;
  bullet: boolean;
  /** 表の中の段落か */
  inTable: boolean;
}

export interface DocTab {
  tabId: string | null;
  title: string;
  paragraphs: DocParagraph[];
  /** 本文の最後の位置（末尾の改行の後ろ） */
  endIndex: number;
}

export interface DocModel {
  documentId: string;
  title: string;
  revisionId: string;
  tabs: DocTab[];
}

const PLACEHOLDER = "￼";

/* ---------- Docs API の JSON（必要な部分だけの型） ---------- */
interface ApiTextRun {
  content?: string;
}
interface ApiParElement {
  startIndex?: number;
  endIndex?: number;
  textRun?: ApiTextRun;
}
interface ApiParagraph {
  elements?: ApiParElement[];
  paragraphStyle?: { namedStyleType?: string };
  bullet?: unknown;
}
interface ApiStructural {
  startIndex?: number;
  endIndex?: number;
  paragraph?: ApiParagraph;
  table?: { tableRows?: { tableCells?: { content?: ApiStructural[] }[] }[] };
  tableOfContents?: { content?: ApiStructural[] };
}
interface ApiBody {
  content?: ApiStructural[];
}
interface ApiTab {
  tabProperties?: { tabId?: string; title?: string };
  documentTab?: { body?: ApiBody };
  childTabs?: ApiTab[];
}
export interface ApiDocument {
  documentId?: string;
  title?: string;
  revisionId?: string;
  body?: ApiBody;
  tabs?: ApiTab[];
}

function collect(content: ApiStructural[] | undefined, out: DocParagraph[], inTable: boolean) {
  for (const s of content ?? []) {
    if (s.paragraph) {
      let text = "";
      for (const e of s.paragraph.elements ?? []) {
        const len = (e.endIndex ?? 0) - (e.startIndex ?? 0);
        const t = e.textRun?.content;
        if (t !== undefined && t.length === len) text += t;
        else if (t !== undefined) text += (t + PLACEHOLDER.repeat(Math.max(0, len - t.length))).slice(0, len);
        else text += PLACEHOLDER.repeat(Math.max(0, len));
      }
      out.push({
        text,
        startIndex: s.startIndex ?? 0,
        endIndex: s.endIndex ?? 0,
        style: (s.paragraph.paragraphStyle?.namedStyleType as ParagraphStyleName) ?? "NORMAL_TEXT",
        bullet: !!s.paragraph.bullet,
        inTable,
      });
    } else if (s.table) {
      for (const row of s.table.tableRows ?? []) for (const cell of row.tableCells ?? []) collect(cell.content, out, true);
    } else if (s.tableOfContents) {
      collect(s.tableOfContents.content, out, true);
    }
  }
}

function tabOf(id: string | null, title: string, body: ApiBody | undefined): DocTab {
  const paragraphs: DocParagraph[] = [];
  collect(body?.content, paragraphs, false);
  const last = body?.content?.[body.content.length - 1];
  return { tabId: id, title, paragraphs, endIndex: last?.endIndex ?? 1 };
}

/** Docs API の JSON（includeTabsContent の有無どちらでも）を DocModel に変換 */
export function toDocModel(doc: ApiDocument): DocModel {
  const tabs: DocTab[] = [];
  const walk = (list: ApiTab[] | undefined) => {
    for (const t of list ?? []) {
      tabs.push(tabOf(t.tabProperties?.tabId ?? null, t.tabProperties?.title ?? "", t.documentTab?.body));
      walk(t.childTabs);
    }
  };
  if (doc.tabs?.length) walk(doc.tabs);
  else tabs.push(tabOf(null, doc.title ?? "", doc.body));
  return { documentId: doc.documentId ?? "", title: doc.title ?? "", revisionId: doc.revisionId ?? "", tabs };
}

/** タブ全体の文字列（解析や AI への入力用。表の段落も含む） */
export function tabText(tab: DocTab): string {
  return tab.paragraphs.map((p) => p.text.replaceAll(PLACEHOLDER, "")).join("");
}

export const isHeading = (p: DocParagraph) => /^HEADING_|^TITLE$/.test(p.style);
export const headingLevel = (p: DocParagraph) => (p.style === "TITLE" ? 0 : Number(p.style.replace("HEADING_", "")) || 9);
