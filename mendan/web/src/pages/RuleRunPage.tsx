import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  CARD_KIND_LABELS,
  CARD_OWNER_LABELS,
  P,
  RULE_BUCKET_LABELS,
  RULE_TARGET_LABELS,
  blockingReason,
  withConfirmDate,
  type CardKind,
  type CardOwner,
  type ClientDoc,
  type RuleBucket,
  type RuleItem,
  type RuleRun,
  type RuleTarget,
} from "@mendan/shared";
import { Layout } from "../components/Layout";
import { api, errorMessage } from "../lib/api";
import { cx, fmtDateTime } from "../lib/format";
import { useCollection, useDoc } from "../lib/hooks";

type Run = RuleRun & { rulebookSnapshot?: { heading: string; level: number }[] };
const STATUS: Record<RuleItem["status"], { label: string; cls: string }> = {
  proposed: { label: "提案", cls: "bg-slate-100 text-slate-700" },
  approved: { label: "承認済み", cls: "bg-blue-100 text-blue-800" },
  rejected: { label: "却下", cls: "bg-slate-200 text-slate-500 line-through" },
  written: { label: "書き込み済み", cls: "bg-green-100 text-green-800" },
  exported: { label: "反映文を作成済み", cls: "bg-green-100 text-green-800" },
};
const today = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

/** 顧問モード：打ち合わせメモの振り分け結果の承認画面 */
export function RuleRunPage() {
  const { clientId = "", runId = "" } = useParams();
  const { data: c } = useDoc<ClientDoc>(P.client(clientId));
  const { data: run } = useDoc<Run>(P.ruleRun(clientId, runId));
  const { data: items } = useCollection<RuleItem>(P.ruleItems(clientId, runId));
  const [tab, setTab] = useState<RuleBucket>("rule");
  const [msg, setMsg] = useState<{ text: string; ok?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const segs = useMemo(() => new Map((run?.segments ?? []).map((s) => [s.id, s])), [run]);
  const headings = useMemo(() => (run?.rulebookSnapshot ?? []).filter((s) => s.level >= 2).map((s) => s.heading), [run]);
  if (!run || !c) return <Layout title="ルール集への反映">読み込み中…</Layout>;

  const byBucket = (b: RuleBucket) => items.filter((i) => i.bucket === b).sort((a, b2) => (a.evidence[0]?.segmentId ?? "").localeCompare(b2.evidence[0]?.segmentId ?? ""));
  const approved = items.filter((i) => i.status === "approved").length;

  const apply = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.applyRuleRun({ clientId, runId });
      const err = r.errors.length ? ` 書き込めなかったもの ${r.errors.length} 件（各項目に理由を表示）。` : "";
      setMsg({ text: `書き込み・保存 ${r.written} 件、反映文の作成 ${r.exported} 件。${err}`, ok: r.errors.length === 0 });
    } catch (e) {
      setMsg({ text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Layout title={`${c.code} ${c.name} / ルール集への反映`}>
      <section className="rounded-xl border bg-white p-5">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
          <Link to={`/clients/${clientId}`} className="text-blue-700 hover:underline">← 顧問先へ戻る</Link>
          <span>
            打ち合わせメモ：<a href={`https://docs.google.com/document/d/${run.notesDocId}/edit`} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">{run.notesDocName}</a>
          </span>
          <span>解析：{fmtDateTime(run.createdAt)}（発言 {run.segments.length} 件・{run.model ?? ""}・約{Math.round(run.usd * 150)}円）</span>
          {c.rulebookDocId && (
            <a href={`https://docs.google.com/document/d/${c.rulebookDocId}/edit`} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">ルール集を開く</a>
          )}
          <button data-testid="apply-run" disabled={busy || approved === 0} onClick={apply} className="ml-auto rounded-lg bg-green-700 px-4 py-2 font-medium text-white disabled:opacity-40">
            {busy ? "書き込み中…" : `承認した ${approved} 件を書き込む`}
          </button>
        </div>
        {run.status === "error" && <p className="mt-2 text-sm text-red-700">解析エラー：{run.error}</p>}
        {msg && <p data-testid="apply-result" className={cx("mt-2 text-sm", msg.ok ? "text-green-700" : "text-red-700")}>{msg.text}</p>}
        {run.hints.length > 0 && (
          <div className="mt-3 text-xs text-slate-600">
            <span className="font-bold">読み直しの候補：</span>
            {run.hints.map((h, i) => (
              <span key={i} className="mr-3">
                {segs.get(h.segmentId)?.time} 「{h.heard}」→「{h.likely}」
              </span>
            ))}
          </div>
        )}
      </section>

      <div className="mt-4 flex gap-2">
        {(["rule", "question", "card"] as RuleBucket[]).map((b) => (
          <button key={b} data-testid={`bucket-${b}`} onClick={() => setTab(b)} className={cx("rounded-lg px-4 py-2 text-sm font-bold", tab === b ? "bg-slate-800 text-white" : "bg-white text-slate-600 hover:bg-slate-100")}>
            {b === "rule" ? "①" : b === "question" ? "②" : "③"} {RULE_BUCKET_LABELS[b]}（{byBucket(b).length}）
          </button>
        ))}
      </div>
      <div className="mt-3 space-y-3">
        {byBucket(tab).map((it) => (
          <ItemCard key={it.id} item={it} clientId={clientId} runId={runId} segs={segs} headings={headings} isMf={c.accountingSystem === "mf"} />
        ))}
        {byBucket(tab).length === 0 && <p className="rounded-xl border bg-white p-5 text-sm text-slate-500">この区分の項目はありません。</p>}
      </div>
    </Layout>
  );
}

function ItemCard({ item, clientId, runId, segs, headings, isMf }: { item: RuleItem; clientId: string; runId: string; segs: Map<string, { time: string; text: string }>; headings: string[]; isMf: boolean }) {
  const [e, setE] = useState({
    title: item.title,
    target: item.target ?? ((isMf ? "mf_rules" : "client_rulebook") as RuleTarget),
    sectionHeading: item.sectionHeading ?? "",
    operation: item.operation ?? "add",
    beforeText: item.beforeText ?? "",
    afterText: item.afterText ?? item.suggestedRule ?? "",
    cardKind: item.cardKind ?? ("ongoing" as CardKind),
    owner: item.owner ?? ("unknown" as CardOwner),
    due: item.due ?? "",
    amount: item.amount ?? "",
    settlementPolicy: item.settlementPolicy ?? "",
    answer: item.answer ?? "",
  });
  const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const locked = item.status === "written" || item.status === "exported";
  const set = (k: keyof typeof e) => (ev: { target: { value: string } }) => setE({ ...e, [k]: ev.target.value });

  const edit = () => {
    const base = { title: e.title };
    if (item.bucket === "rule") return { ...base, target: e.target, sectionHeading: e.sectionHeading || null, operation: e.operation, beforeText: e.operation === "modify" ? e.beforeText : null, afterText: e.afterText };
    if (item.bucket === "card") return { ...base, cardKind: e.cardKind, owner: e.owner, due: e.due || null, amount: e.amount || null, settlementPolicy: e.settlementPolicy || null };
    return { ...base, sectionHeading: e.sectionHeading || null, afterText: e.afterText || null };
  };
  const decide = async (decision: "approve" | "reject" | "reset", convertToRule = false) => {
    setBusy(true);
    setErr(null);
    try {
      await api.decideRuleItem({ clientId, runId, itemId: item.id, decision, edit: edit(), answer: item.bucket === "question" ? e.answer : undefined, convertToRule });
    } catch (x) {
      setErr(errorMessage(x));
    } finally {
      setBusy(false);
    }
  };
  // 承認前に分かる問題（画面で直せば消える）
  const warn = blockingReason({ ...item, ...edit(), operation: e.operation, target: e.target } as RuleItem);

  return (
    <div data-testid="rule-item" className={cx("rounded-xl border bg-white p-4", item.status === "rejected" && "opacity-60")}>
      <div className="flex items-start gap-3">
        <span className={cx("shrink-0 rounded px-2 py-0.5 text-xs", STATUS[item.status].cls)}>{STATUS[item.status].label}</span>
        <input value={e.title} onChange={set("title")} disabled={locked} className="flex-1 rounded border border-transparent px-1 font-bold hover:border-slate-200" />
        <span className="shrink-0 text-xs text-slate-500">確実さ {Math.round(item.confidence * 100)}%</span>
      </div>
      <p className="mt-1 text-sm text-slate-700">{item.summary}</p>

      <div className="mt-2 flex flex-wrap gap-2 text-xs">
        {item.evidence.map((ev, i) => (
          <button key={i} onClick={() => setOpen(open === ev.segmentId ? null : ev.segmentId)} className={cx("rounded border px-2 py-0.5 text-left", ev.found ? "border-sky-300 bg-sky-50 text-sky-900" : "border-red-300 bg-red-50 text-red-800")}>
            {ev.time || ev.segmentId}「{ev.quote}」{!ev.found && "（文字起こしに見つかりません）"}
          </button>
        ))}
        {item.corrections.map((x, i) => (
          <span key={`c${i}`} className="rounded bg-amber-50 px-2 py-0.5 text-amber-900" title={x.reason}>
            読み直し：{x.heard} → {x.corrected}
          </span>
        ))}
      </div>
      {open && segs.get(open) && (
        <p className="mt-2 rounded bg-slate-50 p-2 text-sm text-slate-700">
          <span className="mr-2 text-xs text-slate-400">{segs.get(open)!.time}</span>
          {segs.get(open)!.text}
        </p>
      )}

      {item.bucket === "rule" && (
        <div className="mt-3 grid grid-cols-6 gap-2 text-sm">
          <select value={e.target} onChange={set("target")} disabled={locked} className="col-span-2 rounded border px-2 py-1">
            {(Object.keys(RULE_TARGET_LABELS) as RuleTarget[]).filter((t) => (isMf ? t !== "client_rulebook" : t !== "mf_rules")).map((t) => (
              <option key={t} value={t}>{RULE_TARGET_LABELS[t]}</option>
            ))}
          </select>
          {e.target === "client_rulebook" && (
            <>
              <select data-testid="section-select" value={e.sectionHeading} onChange={set("sectionHeading")} disabled={locked} className="col-span-3 rounded border px-2 py-1">
                <option value="">（章を選ぶ）</option>
                {headings.map((h) => (
                  <option key={h} value={h}>{h}</option>
                ))}
                {e.sectionHeading && !headings.includes(e.sectionHeading) && <option value={e.sectionHeading}>{e.sectionHeading}（ルール集にない章）</option>}
              </select>
              <select value={e.operation} onChange={set("operation")} disabled={locked} className="rounded border px-2 py-1">
                <option value="add">章の末尾に追記</option>
                <option value="modify">既存の文を書き換え</option>
              </select>
            </>
          )}
          {e.target === "client_rulebook" && e.operation === "modify" && (
            <label className="col-span-6 text-xs text-slate-600">
              書き換える前の文（ルール集の文をそのまま）
              <textarea value={e.beforeText} onChange={set("beforeText")} disabled={locked} rows={2} className="mt-0.5 w-full rounded border px-2 py-1 text-sm" />
            </label>
          )}
          <label className="col-span-6 text-xs text-slate-600">
            {e.target === "client_rulebook" ? "ルール集に入れる文" : e.target === "mf_rules" ? "MF-kaikei-rules に入れる文" : "スキルへの改善メモ"}
            <textarea data-testid="after-text" value={e.afterText} onChange={set("afterText")} disabled={locked} rows={2} className="mt-0.5 w-full rounded border px-2 py-1 text-sm" />
          </label>
          {e.target === "client_rulebook" && e.afterText && (
            <p className="col-span-6 rounded bg-green-50 px-2 py-1 text-xs text-green-900">
              ここに入れます：「{e.sectionHeading || "（章が未選択）"}」{e.operation === "add" ? "の末尾に" : "の該当の文を"} 「{withConfirmDate(e.afterText, today())}」
            </p>
          )}
          {item.status === "exported" && (
            <button onClick={() => navigator.clipboard.writeText(e.afterText)} className="col-span-2 rounded border px-2 py-1 text-xs hover:bg-slate-50">反映文をコピー</button>
          )}
        </div>
      )}

      {item.bucket === "question" && (
        <div className="mt-3 space-y-2 text-sm">
          <p className="rounded bg-amber-50 p-2">{item.question}</p>
          <label className="block text-xs text-slate-600">
            回答（税理士が記入）
            <textarea value={e.answer} onChange={set("answer")} disabled={locked} rows={2} className="mt-0.5 w-full rounded border px-2 py-1 text-sm" />
          </label>
          <div className="grid grid-cols-6 gap-2">
            <select value={e.sectionHeading} onChange={set("sectionHeading")} disabled={locked} className="col-span-2 rounded border px-2 py-1 text-xs">
              <option value="">（ルール案にするときの章）</option>
              {headings.map((h) => (
                <option key={h} value={h}>{h}</option>
              ))}
            </select>
            <input value={e.afterText} onChange={set("afterText")} disabled={locked} placeholder="ルール案にするときの文（回答をふまえて）" className="col-span-4 rounded border px-2 py-1 text-xs" />
          </div>
        </div>
      )}

      {item.bucket === "card" && (
        <div className="mt-3 grid grid-cols-6 gap-2 text-sm">
          <select value={e.cardKind} onChange={set("cardKind")} disabled={locked} className="rounded border px-2 py-1">
            {(Object.keys(CARD_KIND_LABELS) as CardKind[]).filter((k) => k !== "question").map((k) => (
              <option key={k} value={k}>{CARD_KIND_LABELS[k]}</option>
            ))}
          </select>
          <select value={e.owner} onChange={set("owner")} disabled={locked} className="rounded border px-2 py-1">
            {(Object.keys(CARD_OWNER_LABELS) as CardOwner[]).map((k) => (
              <option key={k} value={k}>担当：{CARD_OWNER_LABELS[k]}</option>
            ))}
          </select>
          <input value={e.due} onChange={set("due")} disabled={locked} placeholder="期限" className="rounded border px-2 py-1" />
          <input value={e.amount} onChange={set("amount")} disabled={locked} placeholder="金額・数値" className="rounded border px-2 py-1" />
          <input value={e.settlementPolicy} onChange={set("settlementPolicy")} disabled={locked} placeholder="決算での処理方針" className="col-span-2 rounded border px-2 py-1" />
        </div>
      )}

      {item.checks.maybeDuplicate && item.bucket === "rule" && <p className="mt-2 text-xs text-amber-800">同じような文がすでにルール集にあります。重複していないか確かめてください。</p>}
      {item.writeError && <p className="mt-2 text-xs text-red-700">書き込めませんでした：{item.writeError}</p>}
      {!locked && item.status !== "approved" && warn && <p className="mt-2 text-xs text-red-700">{warn}</p>}
      {err && <p className="mt-2 text-xs text-red-700">{err}</p>}

      {!locked && (
        <div className="mt-3 flex flex-wrap gap-2">
          {item.status !== "approved" ? (
            <button data-testid="approve" disabled={busy} onClick={() => decide("approve")} className="rounded-lg bg-blue-600 px-3 py-1 text-sm text-white disabled:opacity-40">
              {item.bucket === "question" ? "確認事項として残す" : "承認"}
            </button>
          ) : (
            <button disabled={busy} onClick={() => decide("approve")} className="rounded-lg border border-blue-300 px-3 py-1 text-sm text-blue-800">修正を反映して承認</button>
          )}
          {item.bucket === "question" && (
            <button data-testid="convert-rule" disabled={busy || !e.afterText || !e.sectionHeading} onClick={() => decide("approve", true)} className="rounded-lg border px-3 py-1 text-sm disabled:opacity-40">
              回答をふまえてルール案にする
            </button>
          )}
          {item.status !== "rejected" && (
            <button disabled={busy} onClick={() => decide("reject")} className="rounded-lg border px-3 py-1 text-sm text-slate-600">却下</button>
          )}
          {item.status !== "proposed" && (
            <button disabled={busy} onClick={() => decide("reset")} className="rounded-lg border px-3 py-1 text-sm text-slate-600">提案に戻す</button>
          )}
        </div>
      )}
    </div>
  );
}
