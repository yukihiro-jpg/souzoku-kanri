import { useState } from "react";
import { CATEGORIES, DOCUMENT_MASTER, DOC_STATUS_LABELS, PRIORITY_ORDER, type DocStatus, type DocumentRequirement } from "@mendan/shared";
import { AiTag, DocBadge, UserTag } from "../components/Badges";
import { cx } from "../lib/format";

interface Props {
  docs: DocumentRequirement[];
  selectedSegmentId: string | null;
  onEvidence: (ids: string[]) => void;
  onUpdate: (d: DocumentRequirement, patch: { status?: DocStatus; dueDate?: string | null; submitter?: string | null; remarks?: string | null; clearReview?: boolean }) => void;
  onAdd: (documentId: string, target: string) => void;
  canEdit: boolean;
}

export function DocumentsTab({ docs, selectedSegmentId, onEvidence, onUpdate, onAdd, canEdit }: Props) {
  const [showClosed, setShowClosed] = useState(true);
  const [add, setAdd] = useState({ documentId: "", target: "" });
  const [open, setOpen] = useState<string | null>(null);
  const visible = docs.filter((d) => showClosed || !["not_needed", "removal_candidate"].includes(d.status));

  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center gap-2 text-xs">
        <span className="text-slate-600">
          AI判定（ルール）{docs.filter((d) => d.decidedBy === "rule").length}件 / 担当者確定 {docs.filter((d) => d.decidedBy === "user").length}件
        </span>
        <label className="ml-auto flex items-center gap-1 text-slate-500">
          <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
          削除候補・不要も表示
        </label>
      </div>
      {CATEGORIES.map((cat) => {
        const list = visible.filter((d) => d.category === cat.id).sort((a, b) => PRIORITY_ORDER[a.importance] - PRIORITY_ORDER[b.importance] || (a.target ?? "").localeCompare(b.target ?? ""));
        if (list.length === 0) return null;
        return (
          <div key={cat.id}>
            <div className="py-1 text-xs font-bold text-slate-500">
              {cat.no}. {cat.label}
            </div>
            <ul className="divide-y rounded border bg-white">
              {list.map((d) => {
                const hl = !!selectedSegmentId && d.evidenceSegmentIds.includes(selectedSegmentId);
                return (
                  <li key={d.id} data-testid="doc-row" data-status={d.status} className={cx("px-2 py-1.5 text-sm", hl && "bg-yellow-50 ring-2 ring-inset ring-yellow-400", ["removal_candidate", "not_needed"].includes(d.status) && "opacity-60")}>
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button onClick={() => setOpen(open === d.id ? null : d.id)} className="text-left font-medium hover:underline">
                            {d.name}
                          </button>
                          <DocBadge s={d.status} />
                          {d.decidedBy === "user" ? <UserTag /> : <AiTag>ルール判定</AiTag>}
                          {d.fromUnapprovedRule && d.decidedBy === "rule" && <span className="rounded bg-yellow-100 px-1 text-[10px] text-yellow-800" title="税理士未承認のルールによる候補">ルール未承認</span>}
                          {d.needsReview && <span className="rounded bg-red-100 px-1 text-[10px] text-red-700">根拠が訂正されました・要確認</span>}
                        </div>
                        <div className="mt-0.5 text-xs text-slate-600">
                          {d.reasons[0]}
                          {d.period && <span className="ml-2 text-slate-500">［期間］{d.period}</span>}
                        </div>
                        {open === d.id && (
                          <div className="mt-1 space-y-0.5 rounded bg-slate-50 p-2 text-xs text-slate-700">
                            {d.target && <div>対象: {d.target}</div>}
                            <div>取得先: {d.source}</div>
                            <div>取得方法: {d.howTo}</div>
                            <div>判定根拠: {d.ruleIds.length ? d.ruleIds.map((r) => `${r} v${d.ruleVersions[r]}`).join(", ") : "担当者が追加"}</div>
                            {d.reasons.length > 1 && <div>その他の理由: {d.reasons.slice(1).join(" / ")}</div>}
                            <div className="flex items-center gap-2">
                              提出者:
                              <input disabled={!canEdit} defaultValue={d.submitter ?? ""} onBlur={(e) => e.target.value !== (d.submitter ?? "") && onUpdate(d, { submitter: e.target.value })} className="rounded border px-1" />
                              提出期限:
                              <input disabled={!canEdit} type="date" defaultValue={d.dueDate ?? ""} onChange={(e) => onUpdate(d, { dueDate: e.target.value || null })} className="rounded border px-1" />
                            </div>
                            <div className="flex items-center gap-2">
                              備考:
                              <input disabled={!canEdit} defaultValue={d.remarks ?? ""} onBlur={(e) => e.target.value !== (d.remarks ?? "") && onUpdate(d, { remarks: e.target.value })} className="flex-1 rounded border px-1" />
                            </div>
                            {d.needsReview && canEdit && (
                              <button onClick={() => onUpdate(d, { clearReview: true })} className="rounded border px-2">確認した（要確認を解除）</button>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {d.evidenceSegmentIds.length > 0 && <button onClick={() => onEvidence(d.evidenceSegmentIds)} className="text-[11px] text-blue-700 hover:underline">根拠</button>}
                        {canEdit && d.status === "candidate" && (
                          <button data-testid="approve-doc" onClick={() => onUpdate(d, { status: "required" })} className="rounded border border-blue-400 px-1.5 text-[11px] text-blue-700 hover:bg-blue-50">必要確定</button>
                        )}
                        {canEdit && d.status === "removal_candidate" && (
                          <button onClick={() => onUpdate(d, { status: "not_needed" })} className="rounded border px-1.5 text-[11px]">不要確定</button>
                        )}
                        {canEdit && (
                          <select value={d.status} onChange={(e) => onUpdate(d, { status: e.target.value as DocStatus })} className="rounded border text-[11px]">
                            {(Object.keys(DOC_STATUS_LABELS) as DocStatus[]).map((s) => (
                              <option key={s} value={s}>
                                {DOC_STATUS_LABELS[s]}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
      {canEdit && (
        <div className="flex gap-1 rounded border border-dashed p-2 text-xs">
          <select value={add.documentId} onChange={(e) => setAdd({ ...add, documentId: e.target.value })} className="flex-1 rounded border">
            <option value="">資料マスタから手動で追加…</option>
            {DOCUMENT_MASTER.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name.replace("{target}", "〇〇")}
              </option>
            ))}
          </select>
          <input placeholder="対象（金融機関名など）" value={add.target} onChange={(e) => setAdd({ ...add, target: e.target.value })} className="w-40 rounded border px-1" />
          <button disabled={!add.documentId} onClick={() => (onAdd(add.documentId, add.target), setAdd({ documentId: "", target: "" }))} className="rounded bg-slate-700 px-2 text-white disabled:opacity-40">
            追加
          </button>
        </div>
      )}
    </div>
  );
}
