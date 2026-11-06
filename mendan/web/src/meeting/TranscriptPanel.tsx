import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { TranscriptSegment } from "@mendan/shared";
import { cx, fmtTime } from "../lib/format";

const SPEAKER: Record<TranscriptSegment["speaker"], { label: string; cls: string }> = {
  staff: { label: "担当者", cls: "bg-indigo-100 text-indigo-800" },
  client: { label: "相続人", cls: "bg-emerald-100 text-emerald-800" },
  other: { label: "その他", cls: "bg-slate-200 text-slate-700" },
  unknown: { label: "話者未確定", cls: "bg-slate-100 text-slate-500 border border-dashed border-slate-400" },
};
const NEXT: Record<TranscriptSegment["speaker"], TranscriptSegment["speaker"]> = { unknown: "client", client: "staff", staff: "other", other: "client" };

const ANALYSIS: Record<TranscriptSegment["analysisStatus"], { label: string; cls: string }> = {
  pending: { label: "解析待ち", cls: "text-slate-400" },
  queued: { label: "解析待ち", cls: "text-slate-400" },
  analyzing: { label: "解析中…", cls: "text-sky-600" },
  done: { label: "解析済", cls: "text-green-600" },
  skipped: { label: "解析対象外", cls: "text-slate-400" },
  error: { label: "解析エラー", cls: "text-red-600" },
};

interface Props {
  segments: TranscriptSegment[];
  interim: string;
  selectedId: string | null;
  highlightedIds: Set<string>;
  flashId: string | null;
  onSelect: (id: string | null) => void;
  onSpeaker: (s: TranscriptSegment, speaker: TranscriptSegment["speaker"], all: boolean) => void;
  onRetry: (segs: TranscriptSegment[]) => void;
  registerRef: (id: string, el: HTMLElement | null) => void;
  canEdit: boolean;
}

export function TranscriptPanel({ segments, interim, selectedId, highlightedIds, flashId, onSelect, onSpeaker, onRetry, registerRef, canEdit }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  const errors = segments.filter((s) => s.analysisStatus === "error" || s.analysisStatus === "pending");

  // 自動スクロール（過去の発言を見ているときは止める）
  useLayoutEffect(() => {
    if (follow && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [segments.length, interim, follow]);
  const onScroll = () => {
    const el = box.current;
    if (!el) return;
    setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 60);
  };
  useEffect(() => {
    if (flashId) setFollow(false);
  }, [flashId]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b bg-white px-4 py-2 text-sm">
        <span className="font-bold">リアルタイム文字起こし</span>
        <span className="text-slate-500">{segments.filter((s) => s.kind === "speech").length} 発言</span>
        {errors.length > 0 && canEdit && (
          <button onClick={() => onRetry(errors.filter((s) => s.kind === "speech"))} className="ml-auto rounded border border-red-300 px-2 py-0.5 text-xs text-red-700 hover:bg-red-50">
            未解析 {errors.length} 件を再解析
          </button>
        )}
      </div>
      <div ref={box} onScroll={onScroll} data-testid="transcript" className="min-h-0 flex-1 space-y-1 overflow-y-auto bg-white px-3 py-2">
        {segments.length === 0 && !interim && <p className="p-6 text-center text-sm text-slate-400">録音を開始すると、ここに会話が表示されます。</p>}
        {segments.map((s) =>
          s.kind === "system" ? (
            <div key={s.id} ref={(el) => registerRef(s.id, el)} className="rounded border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-900">
              {fmtTime(s.timings.finalAt)} {s.text}
            </div>
          ) : (
            <div
              key={s.id}
              ref={(el) => registerRef(s.id, el)}
              data-seg={s.id}
              onClick={() => onSelect(selectedId === s.id ? null : s.id)}
              className={cx(
                "group flex cursor-pointer gap-2 rounded px-2 py-1.5 hover:bg-slate-50",
                selectedId === s.id && "bg-yellow-50 ring-2 ring-yellow-400",
                highlightedIds.has(s.id) && selectedId !== s.id && "bg-sky-50 ring-1 ring-sky-300",
                flashId === s.id && "flash",
                s.suspectedDuplicateOf && "opacity-50",
              )}
            >
              <div className="w-16 shrink-0 pt-0.5 text-[11px] text-slate-400">{fmtTime(s.timings.finalAt)}</div>
              <button
                disabled={!canEdit}
                title={canEdit ? "クリックで話者を変更（Shift+クリックで同じ話者ラベルの発言すべて）" : ""}
                onClick={(e) => {
                  e.stopPropagation();
                  onSpeaker(s, NEXT[s.speaker], e.shiftKey);
                }}
                className={cx("h-fit shrink-0 rounded px-1.5 py-0.5 text-[11px]", SPEAKER[s.speaker].cls, !s.speakerConfirmed && s.speaker !== "unknown" && "italic")}
              >
                {SPEAKER[s.speaker].label}
                {!s.speakerConfirmed && s.speaker !== "unknown" ? "?" : ""}
              </button>
              <div className="min-w-0 flex-1 text-[15px] leading-relaxed">
                {s.text}
                {s.suspectedDuplicateOf && <span className="ml-2 text-xs text-orange-700">（重複の疑い・解析対象外）</span>}
              </div>
              <div className={cx("w-16 shrink-0 pt-0.5 text-right text-[11px]", ANALYSIS[s.analysisStatus].cls)}>
                <span className="mr-1 text-slate-300">確定</span>
                {ANALYSIS[s.analysisStatus].label}
              </div>
            </div>
          ),
        )}
        {interim && (
          <div className="flex gap-2 rounded px-2 py-1.5" data-testid="interim">
            <div className="w-16 shrink-0 text-[11px] text-slate-400">暫定</div>
            <div className="flex-1 text-[15px] italic text-slate-400">{interim}▍</div>
          </div>
        )}
      </div>
      {!follow && (
        <button onClick={() => setFollow(true)} className="absolute bottom-4 right-6 rounded-full bg-slate-800 px-4 py-2 text-sm text-white shadow-lg">
          最新の発言へ ↓
        </button>
      )}
    </div>
  );
}
