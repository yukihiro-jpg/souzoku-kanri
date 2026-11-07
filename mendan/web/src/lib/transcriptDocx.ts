import { AlignmentType, BorderStyle, Document, Packer, PageBreak, Paragraph, ShadingType, TextRun } from "docx";
import { DOC_STATUS_LABELS, ENTITY_TYPE_LABELS, attrLabel, type CaseDoc, type DocumentRequirement, type Entity, type Meeting, type TranscriptSegment } from "@mendan/shared";

/**
 * 面談の文字起こしを Word（.docx）で出力する。
 * 各発言の下に、その発言を根拠に「抽出した財産・人物」と「必要と判断した資料」を差し込む。
 * フォントは Noto Sans JP（パソコンに入っていない場合、Word が近いフォントで表示する）。
 */
const FONT = "Noto Sans JP";
const SPEAKER: Record<TranscriptSegment["speaker"], { label: string; color: string }> = {
  staff: { label: "担当者", color: "3730A3" },
  client: { label: "相続人", color: "047857" },
  other: { label: "その他", color: "475569" },
  unknown: { label: "話者未確定", color: "64748B" },
};
const INACTIVE_DOC = new Set(["not_needed", "removal_candidate"]);

export interface MeetingTranscript {
  meeting: Meeting;
  segments: TranscriptSegment[];
}

const time = (ms: number) => new Date(ms).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const dateTime = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("ja-JP", { dateStyle: "medium", timeStyle: "short" }) : "");
const speakerName = (s: TranscriptSegment) => {
  const num = s.speakerLabel ? `話者${s.speakerLabel.replace(/^spk_?/i, "")}` : "";
  if (s.speaker === "unknown") return num || SPEAKER.unknown.label;
  return SPEAKER[s.speaker].label + (s.speakerConfirmed ? "" : "?") + (num ? `（${num}）` : "");
};
const entityText = (e: Entity) => {
  const attrs = Object.entries(e.attributes)
    .filter(([, v]) => v?.value)
    .map(([k, v]) => `${attrLabel(e.type, k)}: ${v.value}`)
    .join("、");
  return `${ENTITY_TYPE_LABELS[e.type]}「${e.label}」${attrs ? `（${attrs}）` : ""}`;
};

function heading(text: string, size: number, opts: { color?: string; before?: number; after?: number; center?: boolean; border?: boolean } = {}) {
  return new Paragraph({
    alignment: opts.center ? AlignmentType.CENTER : AlignmentType.LEFT,
    spacing: { before: opts.before ?? 0, after: opts.after ?? 120 },
    border: opts.border ? { bottom: { style: BorderStyle.SINGLE, size: 12, color: "075985", space: 4 } } : undefined,
    children: [new TextRun({ text, bold: true, size, color: opts.color ?? "0C4A6E" })],
  });
}

function infoLine(label: string, value: string) {
  return new Paragraph({
    spacing: { after: 40 },
    children: [new TextRun({ text: `${label}：`, bold: true, color: "0C4A6E", size: 20 }), new TextRun({ text: value || "―", size: 20 })],
  });
}

/** 発言の下に入れる「解析の結果」（薄い青の帯） */
function analysisLine(label: string, text: string, color: string) {
  return new Paragraph({
    indent: { left: 1700 },
    spacing: { after: 30 },
    shading: { type: ShadingType.CLEAR, fill: "EFF6FF", color: "auto" },
    children: [new TextRun({ text: `▶ ${label}：`, bold: true, size: 18, color }), new TextRun({ text, size: 18, color: "1E293B" })],
  });
}

function meetingSection(c: CaseDoc, t: MeetingTranscript, docs: DocumentRequirement[], entities: Entity[]): Paragraph[] {
  const m = t.meeting;
  const docsBySeg = new Map<string, DocumentRequirement[]>();
  for (const d of docs) for (const id of d.evidenceSegmentIds ?? []) docsBySeg.set(id, [...(docsBySeg.get(id) ?? []), d]);
  const entBySeg = new Map<string, Entity[]>();
  for (const e of entities) {
    if (e.status === "rejected") continue;
    for (const id of e.evidenceSegmentIds ?? []) entBySeg.set(id, [...(entBySeg.get(id) ?? []), e]);
  }
  const segs = [...t.segments].sort((a, b) => a.seq - b.seq);
  const out: Paragraph[] = [
    heading(`第${m.no}回 面談記録（文字起こし）`, 30, { border: true, after: 160 }),
    infoLine("案件", c.name),
    infoLine("被相続人", c.decedentName),
    infoLine("相続開始日", c.inheritanceStartDate ?? "未入力"),
    infoLine("面談日時", `${dateTime(m.recordingStartedAt ?? m.startedAt)}〜${m.endedAt ? dateTime(m.endedAt) : "（面談中）"}`),
    infoLine("担当", m.interviewer),
    infoLine("発言数", `${segs.filter((s) => s.kind !== "system").length} 件`),
    new Paragraph({
      spacing: { before: 120, after: 200 },
      children: [new TextRun({ text: "※ 青い帯（▶）は、その発言をもとに AI が抽出した財産・人物と、ルールにより必要と判断した資料です。担当者の確認前のものを含みます。", size: 17, color: "64748B" })],
    }),
  ];
  if (segs.length === 0) out.push(new Paragraph({ children: [new TextRun({ text: "（発言はありません）", color: "64748B" })] }));

  for (const s of segs) {
    if (s.kind === "system") {
      out.push(new Paragraph({ spacing: { before: 60, after: 60 }, children: [new TextRun({ text: s.text, italics: true, size: 18, color: "B45309" })] }));
      continue;
    }
    const sp = SPEAKER[s.speaker];
    out.push(
      new Paragraph({
        spacing: { before: 100, after: 40 },
        indent: { left: 1700, hanging: 1700 },
        children: [
          new TextRun({ text: time(s.timings?.finalAt ?? Date.parse(s.createdAt)), size: 17, color: "94A3B8" }),
          new TextRun({ text: `　${speakerName(s)}`, bold: true, size: 19, color: sp.color }),
          new TextRun({ text: "\t" }),
          new TextRun({ text: s.text, size: 21 }),
        ],
      }),
    );
    for (const e of entBySeg.get(s.id) ?? []) {
      const retracted = e.status === "retracted";
      out.push(analysisLine(retracted ? "抽出（後に訂正）" : "抽出した事実", entityText(e), retracted ? "B45309" : "0369A1"));
    }
    for (const d of docsBySeg.get(s.id) ?? []) {
      const inactive = INACTIVE_DOC.has(d.status);
      const name = d.target && !d.name.includes(d.target) ? `${d.name}（${d.target}）` : d.name;
      out.push(analysisLine(inactive ? (d.status === "removal_candidate" ? "資料（訂正により削除候補）" : "資料（不要）") : "必要と判断した資料", `${name}【${DOC_STATUS_LABELS[d.status]}】`, inactive ? "B45309" : "B91C1C"));
    }
  }
  return out;
}

/** 文字起こしの Word を作成してダウンロードする（meetings が複数なら1つのファイルに回ごとに改ページして収める） */
export async function downloadTranscriptDocx(c: CaseDoc, meetings: MeetingTranscript[], docs: DocumentRequirement[], entities: Entity[], fileName: string) {
  const ordered = [...meetings].sort((a, b) => a.meeting.no - b.meeting.no);
  const children: Paragraph[] = [];
  if (ordered.length > 1) {
    children.push(heading("面談記録（文字起こし）", 36, { center: true, after: 240 }));
    children.push(infoLine("案件", c.name), infoLine("被相続人", c.decedentName), infoLine("収録", `第1回〜第${ordered[ordered.length - 1].meeting.no}回（全${ordered.length}回）`));
    children.push(new Paragraph({ children: [new PageBreak()] }));
  }
  ordered.forEach((t, i) => {
    if (i > 0) children.push(new Paragraph({ children: [new PageBreak()] }));
    children.push(...meetingSection(c, t, docs, entities));
  });
  const doc = new Document({
    creator: "相続税 AI面談",
    title: fileName,
    styles: { default: { document: { run: { font: { ascii: FONT, eastAsia: FONT, hAnsi: FONT, cs: FONT }, size: 21 } } } },
    sections: [{ properties: { page: { margin: { top: 1000, bottom: 1000, left: 1000, right: 1000 } } }, children }],
  });
  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${fileName.replace(/[\\/:*?"<>|]/g, "_")}.docx`;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 10_000);
}
