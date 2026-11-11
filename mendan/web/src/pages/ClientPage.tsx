import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { orderBy } from "firebase/firestore";
import { ACCOUNTING_SYSTEM_LABELS, CARD_KIND_LABELS, CARD_OWNER_LABELS, P, type ClientCard, type ClientDoc, type RuleRun } from "@mendan/shared";
import { Layout } from "../components/Layout";
import { api, errorMessage } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmtDateTime } from "../lib/format";
import { googleUiConfigured, pickGoogleDoc, requestAuthCode } from "../lib/google";
import { useCollection, useDoc } from "../lib/hooks";

type GoogleState = Awaited<ReturnType<typeof api.googleStatus>>;
const RUN_STATUS: Record<RuleRun["status"], string> = { analyzing: "解析中", review: "承認待ち", done: "完了", error: "エラー" };
const CARD_STATUS: Record<ClientCard["status"], string> = { open: "未着手", in_progress: "対応中", done: "完了", reflected: "決算で反映済み" };
const docUrl = (id: string) => `https://docs.google.com/document/d/${id}/edit`;

/** 顧問モード：顧問先の画面（Google 連携・ルール集・打ち合わせメモからの反映・カード） */
export function ClientPage() {
  const { clientId = "" } = useParams();
  const nav = useNavigate();
  const { profile, user } = useAuth();
  const { data: c, error } = useDoc<ClientDoc>(P.client(clientId));
  const { data: runs } = useCollection<RuleRun>(P.ruleRuns(clientId), [orderBy("createdAt", "desc")]);
  const { data: cards } = useCollection<ClientCard>(P.cards(clientId));
  const [g, setG] = useState<GoogleState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok?: boolean } | null>(null);
  const [showReflected, setShowReflected] = useState(false);

  const loadG = useCallback(() => {
    api.googleStatus().then(setG).catch((e) => setMsg({ text: errorMessage(e) }));
  }, []);
  useEffect(loadG, [loadG]);

  const run = async (label: string, f: () => Promise<void>) => {
    setBusy(label);
    setMsg(null);
    try {
      await f();
    } catch (e) {
      setMsg({ text: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };

  /** ドキュメントを選ぶ（本番は Google の選択画面、開発時は開発用のドキュメント名を入力） */
  const choose = async (title: string, mockDefault: string) => {
    if (g?.mock) {
      const id = window.prompt(`${title}（開発用：mock-rulebook / mock-notes が使えます）`, mockDefault);
      return id ? { id, name: `${id}（開発用）` } : null;
    }
    return pickGoogleDoc(title, profile?.email);
  };

  if (error) return <Layout title="顧問先">{error}</Layout>;
  if (!c) return <Layout title="顧問先">読み込み中…</Layout>;
  const canWrite = profile?.role === "admin" || (profile?.role === "staff" && c.members?.[user?.uid ?? ""] === "staff");
  const ready = !!g?.connected && (c.accountingSystem === "mf" || !!c.rulebookDocId);
  const openCards = cards.filter((x) => showReflected || x.status !== "reflected").sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return (
    <Layout title={`${c.code} ${c.name}`}>
      <div className="grid grid-cols-3 gap-4">
        <section className="col-span-2 rounded-xl border bg-white p-5">
          <h2 className="text-lg font-bold">
            <span className="mr-2 font-mono text-slate-500">{c.code}</span>
            {c.name}
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            {ACCOUNTING_SYSTEM_LABELS[c.accountingSystem]}・{c.fiscalMonth}月決算
          </p>

          <h3 className="mt-5 font-bold">ルール集</h3>
          {c.accountingSystem === "kaikei_taisho" ? (
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
              {c.rulebookDocId ? (
                <a href={docUrl(c.rulebookDocId)} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline" data-testid="rulebook-link">
                  {c.rulebookDocName ?? c.rulebookDocId}
                </a>
              ) : (
                <span className="text-slate-500">未登録</span>
              )}
              {canWrite && (
                <button
                  data-testid="pick-rulebook"
                  disabled={!g?.connected || !!busy}
                  onClick={() =>
                    run("rulebook", async () => {
                      const f = await choose("この顧問先のルール集（Google ドキュメント）を選んでください", "mock-rulebook");
                      if (f) await api.updateClient({ clientId, rulebookDocId: f.id, rulebookDocName: f.name });
                    })
                  }
                  className="rounded border px-3 py-1 hover:bg-slate-50 disabled:opacity-40"
                >
                  ルール集を選ぶ
                </button>
              )}
            </div>
          ) : (
            <div className="mt-2 text-sm">
              <label className="flex items-center gap-2">
                MF-kaikei-rules の中のファイル
                <input
                  defaultValue={c.mfRulesPath ?? ""}
                  placeholder="例: clients/0000_会社名.md"
                  disabled={!canWrite}
                  onBlur={(e) => e.target.value !== (c.mfRulesPath ?? "") && run("mf", () => api.updateClient({ clientId, mfRulesPath: e.target.value || null }).then(() => undefined))}
                  className="flex-1 rounded border px-2 py-1"
                />
              </label>
              <p className="mt-1 text-xs text-slate-500">MF の顧問先のルール案は、承認後に「MF-kaikei-rules への反映文」として表示します（リポジトリへの自動反映は次の段階で作ります）。</p>
            </div>
          )}

          <div className="mt-6 rounded-lg border border-blue-200 bg-blue-50 p-4">
            <h3 className="font-bold">打ち合わせメモからルール集へ反映</h3>
            <p className="mt-1 text-sm text-slate-700">Google Meet の「Gemini によるメモ」を選ぶと、AI が ①ルール集への反映案 ②確認事項 ③カード に振り分けます。書き込むのは承認したものだけです。</p>
            <button
              data-testid="start-rule-run"
              disabled={!canWrite || !ready || !!busy}
              onClick={() =>
                run("analyze", async () => {
                  const f = await choose("打ち合わせの「Gemini によるメモ」を選んでください", "mock-notes");
                  if (!f) return;
                  const r = await api.startRuleRun({ clientId, notesDocId: f.id, notesDocName: f.name });
                  nav(`/clients/${clientId}/runs/${r.runId}`);
                })
              }
              className="mt-3 rounded-lg bg-blue-600 px-4 py-2 text-white disabled:opacity-40"
            >
              {busy === "analyze" ? "解析中…（1〜3分かかります）" : "打ち合わせメモを選んで解析"}
            </button>
            {!ready && <p className="mt-2 text-xs text-red-700">{!g?.connected ? "先に右の「Google ドライブと連携」を行ってください。" : "先にルール集を選んでください。"}</p>}
          </div>
          {msg && <p className={`mt-3 text-sm ${msg.ok ? "text-green-700" : "text-red-700"}`}>{msg.text}</p>}
        </section>

        <section className="rounded-xl border bg-white p-5">
          <h3 className="font-bold">Google ドライブ連携</h3>
          {!g ? (
            <p className="mt-2 text-sm text-slate-500">確認中…</p>
          ) : !g.configured || (!g.mock && !googleUiConfigured()) ? (
            <p className="mt-2 text-sm text-amber-800">Google 連携の設定（OAuth クライアント）がまだです。管理者の設定が終わると使えるようになります。</p>
          ) : g.connected ? (
            <div className="mt-2 text-sm">
              <p className="text-green-700" data-testid="google-connected">連携済み：{g.email}</p>
              <p className="text-xs text-slate-500">{fmtDateTime(g.connectedAt)}</p>
              <button onClick={() => run("disconnect", async () => { await api.googleDisconnect(); loadG(); })} className="mt-2 rounded border px-2 py-1 text-xs hover:bg-slate-50">連携を解除</button>
            </div>
          ) : (
            <div className="mt-2 text-sm">
              <p className="text-slate-600">アプリが使えるのは、画面で選んだファイルとアプリが作ったファイルだけです（ドライブ全体は読みません）。</p>
              <button
                data-testid="google-connect"
                disabled={!!busy}
                onClick={() =>
                  run("connect", async () => {
                    if (g.mock) await api.googleConnect({});
                    else await api.googleConnect({ code: await requestAuthCode(profile?.email) });
                    loadG();
                  })
                }
                className="mt-2 rounded-lg bg-slate-800 px-3 py-1.5 text-white"
              >
                Google ドライブと連携
              </button>
            </div>
          )}

          <h3 className="mt-6 font-bold">反映の履歴</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {runs.map((r) => (
              <li key={r.id}>
                <Link to={`/clients/${clientId}/runs/${r.id}`} className="text-blue-700 hover:underline">
                  {fmtDateTime(r.createdAt)} {r.notesDocName}
                </Link>
                <span className="ml-1 text-xs text-slate-500">（{RUN_STATUS[r.status]}）</span>
              </li>
            ))}
            {runs.length === 0 && <li className="text-slate-500">まだありません。</li>}
          </ul>
        </section>
      </div>

      <section className="mt-4 rounded-xl border bg-white p-5" data-testid="cards-section">
        <div className="flex items-center gap-3">
          <h3 className="font-bold">カード（宿題・継続論点・確認事項など）</h3>
          <label className="ml-auto flex items-center gap-1 text-sm text-slate-600">
            <input type="checkbox" checked={showReflected} onChange={(e) => setShowReflected(e.target.checked)} />
            決算で反映済みも表示
          </label>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-3">
          {openCards.map((x) => (
            <div key={x.id} className="rounded-lg border bg-slate-50 p-3 text-sm">
              <div className="flex items-center gap-2">
                <span className="rounded bg-white px-1.5 py-0.5 text-xs text-slate-600">{CARD_KIND_LABELS[x.kind]}</span>
                <span className="text-xs text-slate-500">担当：{CARD_OWNER_LABELS[x.owner]}</span>
                {x.due && <span className="text-xs text-red-700">期限：{x.due}</span>}
              </div>
              <p className="mt-1 font-medium">{x.title}</p>
              <p className="mt-1 whitespace-pre-line text-xs text-slate-600">{x.detail}</p>
              {x.amount && <p className="mt-1 text-xs">金額：{x.amount}</p>}
              {x.settlementPolicy && <p className="mt-1 text-xs">決算での処理：{x.settlementPolicy}</p>}
              <p className="mt-1 text-xs text-slate-400">{x.evidence.map((e) => e.time).filter(Boolean).join("・")} {x.source?.notesDocName}</p>
              {canWrite && (
                <select value={x.status} onChange={(e) => run("card", () => api.updateCard({ clientId, cardId: x.id, status: e.target.value as ClientCard["status"] }).then(() => undefined))} className="mt-2 rounded border px-1 py-0.5 text-xs">
                  {Object.entries(CARD_STATUS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              )}
            </div>
          ))}
          {openCards.length === 0 && <p className="text-sm text-slate-500">カードはまだありません。</p>}
        </div>
      </section>
    </Layout>
  );
}
