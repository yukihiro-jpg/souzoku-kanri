import { useState } from "react";
import { CATEGORIES, CHECK_STATUS_LABELS, ENTITY_TYPE_LABELS, PRIORITY_ORDER, type CheckItem, type CheckStatus, type Entity } from "@mendan/shared";
import { AiTag, CheckBadge, PriorityDot, UserTag } from "../components/Badges";
import { cx } from "../lib/format";

interface Props {
  items: CheckItem[];
  entities: Entity[];
  selectedSegmentId: string | null;
  onEvidence: (segmentIds: string[]) => void;
  onStatus: (item: CheckItem, status: CheckStatus, answer?: string | null) => void;
  onEntity: (e: Entity, action: "confirm" | "reject" | "unlock") => void;
  canEdit: boolean;
}

const has = (ids: string[] | undefined, id: string | null) => !!id && !!ids?.includes(id);

export function CheckItemsTab({ items, entities, selectedSegmentId, onEvidence, onStatus, onEntity, canEdit }: Props) {
  const [filter, setFilter] = useState<"all" | "open" | "ai">("all");
  const [showObsolete, setShowObsolete] = useState(false);
  const [editing, setEditing] = useState<{ id: string; answer: string } | null>(null);
  const entityLabel = new Map(entities.map((e) => [e.id, e.label]));
  const visible = items.filter((c) => (showObsolete || !c.obsolete) && (filter === "all" || (filter === "open" ? ["unconfirmed", "needs_followup", "contradiction"].includes(c.status) : c.status === "ai_candidate")));
  const activeEntities = entities.filter((e) => e.status !== "rejected").sort((a, b) => a.type.localeCompare(b.type));

  return (
    <div className="space-y-4 p-3">
      <section>
        <h3 className="mb-1 text-sm font-bold text-slate-700">会話から抽出した財産・人物（{activeEntities.filter((e) => e.status !== "retracted").length}件）</h3>
        {activeEntities.length === 0 && <p className="text-xs text-slate-400">まだありません。</p>}
        <ul className="space-y-1">
          {activeEntities.map((e) => (
            <li
              key={e.id}
              data-testid="entity-row"
              className={cx(
                "rounded border px-2 py-1.5 text-sm",
                e.status === "retracted" && "bg-slate-50 text-slate-400",
                has(e.evidenceSegmentIds, selectedSegmentId) && "bg-yellow-50 ring-2 ring-yellow-400",
                e.contradiction && "border-red-300",
              )}
            >
              <div className="flex items-center gap-2">
                <span className="rounded bg-slate-100 px-1.5 text-[11px] text-slate-600">{ENTITY_TYPE_LABELS[e.type]}</span>
                <span className={cx("font-medium", e.status === "retracted" && "line-through")}>{e.label}</span>
                {e.assertion === "unknown" && <span className="text-[11px] text-amber-700">可能性あり</span>}
                {e.assertion === "absent" && <span className="text-[11px] text-slate-500">なしと回答</span>}
                {e.status === "retracted" && <span className="text-[11px]">{e.supersededBy ? `訂正→${entityLabel.get(e.supersededBy) ?? ""}` : "撤回"}</span>}
                {e.contradiction && <span className="text-[11px] text-red-700">矛盾あり</span>}
                {e.lockedByUser ? <UserTag>{e.status === "rejected" ? "却下" : "担当者承認"}</UserTag> : e.status === "ai_candidate" && <AiTag>AI抽出</AiTag>}
                <button onClick={() => onEvidence(e.evidenceSegmentIds)} className="ml-auto text-[11px] text-blue-700 hover:underline">根拠 {e.evidenceSegmentIds.length}</button>
                {canEdit && e.status === "ai_candidate" && (
                  <>
                    <button onClick={() => onEntity(e, "confirm")} className="rounded border border-green-400 px-1.5 text-[11px] text-green-700">承認</button>
                    <button onClick={() => onEntity(e, "reject")} className="rounded border px-1.5 text-[11px] text-slate-600">却下</button>
                  </>
                )}
                {canEdit && e.lockedByUser && <button onClick={() => onEntity(e, "unlock")} className="text-[11px] text-slate-500 hover:underline">承認解除</button>}
              </div>
              {Object.keys(e.attributes).length > 0 && (
                <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-slate-600">
                  {Object.entries(e.attributes).map(([k, v]) => (
                    <span key={k} title={v.history?.length ? `訂正前: ${v.history.map((h) => h.value).join(" → ")}` : undefined}>
                      {k}: <b className="font-medium text-slate-800">{v.value}</b>
                      {v.history?.length ? <span className="text-orange-600">（訂正あり）</span> : null}
                    </span>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <div className="mb-1 flex items-center gap-2">
          <h3 className="text-sm font-bold text-slate-700">確認事項</h3>
          <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} className="ml-auto rounded border px-1 py-0.5 text-xs">
            <option value="all">すべて</option>
            <option value="open">未確認・要確認のみ</option>
            <option value="ai">AI確認候補のみ</option>
          </select>
          <label className="flex items-center gap-1 text-xs text-slate-500">
            <input type="checkbox" checked={showObsolete} onChange={(e) => setShowObsolete(e.target.checked)} />
            不要になった項目
          </label>
        </div>
        {CATEGORIES.map((cat) => {
          const list = visible.filter((c) => c.category === cat.id).sort((a, b) => (a.source === "master" ? 0 : 1) - (b.source === "master" ? 0 : 1) || PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
          if (list.length === 0) return null;
          return (
            <div key={cat.id} className="mb-3">
              <div className="sticky top-0 z-10 bg-slate-50 py-1 text-xs font-bold text-slate-500">
                {cat.no}. {cat.label}
              </div>
              <ul className="divide-y rounded border bg-white">
                {list.map((c) => (
                  <li
                    key={c.id}
                    data-testid="check-row"
                    data-status={c.status}
                    className={cx("px-2 py-1.5 text-sm", has(c.evidenceSegmentIds, selectedSegmentId) && "bg-yellow-50 ring-2 ring-inset ring-yellow-400", c.obsolete && "opacity-50")}
                  >
                    <div className="flex items-start gap-2">
                      <PriorityDot p={c.priority} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className={cx(c.entityId && "pl-3 text-slate-700")}>{c.entityId ? "└ " : ""}{c.question}</span>
                          <CheckBadge s={c.status} />
                          {c.status === "ai_candidate" && c.aiProposal === "not_applicable" && <span className="text-[11px] text-slate-600">（該当なしの可能性）</span>}
                          {c.lockedByUser ? <UserTag>担当者</UserTag> : c.status !== "unconfirmed" && <AiTag>{c.autoDerived ? "自動" : "AI"}</AiTag>}
                          {c.confidence !== null && c.status !== "unconfirmed" && !c.lockedByUser && <span className="text-[10px] text-slate-400">信頼度 {Math.round((c.confidence ?? 0) * 100)}%</span>}
                        </div>
                        {editing?.id === c.id ? (
                          <div className="mt-1 flex gap-1">
                            <input autoFocus value={editing.answer} onChange={(e) => setEditing({ ...editing, answer: e.target.value })} className="flex-1 rounded border px-1 text-sm" />
                            <button onClick={() => (onStatus(c, "confirmed", editing.answer), setEditing(null))} className="rounded bg-green-600 px-2 text-xs text-white">確定</button>
                            <button onClick={() => setEditing(null)} className="text-xs">取消</button>
                          </div>
                        ) : (
                          c.answer && <div className="mt-0.5 text-xs text-slate-700">回答: {c.answer}</div>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {c.evidenceSegmentIds.length > 0 && (
                          <button onClick={() => onEvidence(c.evidenceSegmentIds)} className="text-[11px] text-blue-700 hover:underline">根拠</button>
                        )}
                        {canEdit && !c.obsolete && (
                          <>
                            {c.status !== "confirmed" && (
                              <button data-testid="confirm-check" onClick={() => onStatus(c, "confirmed")} className="rounded border border-green-400 px-1.5 text-[11px] text-green-700 hover:bg-green-50">確認済</button>
                            )}
                            <button onClick={() => setEditing({ id: c.id, answer: c.answer ?? "" })} className="rounded border px-1.5 text-[11px] text-slate-600">編集</button>
                            <select
                              value=""
                              onChange={(e) => e.target.value && onStatus(c, e.target.value as CheckStatus)}
                              className="w-6 rounded border text-[11px]"
                              title="状態を変更"
                            >
                              <option value=""></option>
                              {(Object.keys(CHECK_STATUS_LABELS) as CheckStatus[]).map((s) => (
                                <option key={s} value={s}>
                                  {CHECK_STATUS_LABELS[s]}
                                </option>
                              ))}
                            </select>
                          </>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </section>
    </div>
  );
}
