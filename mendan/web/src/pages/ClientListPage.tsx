import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { where } from "firebase/firestore";
import { ACCOUNTING_SYSTEM_LABELS, P, type AccountingSystem, type ClientDoc } from "@mendan/shared";
import { Layout } from "../components/Layout";
import { api, errorMessage } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useCollection } from "../lib/hooks";

/** 顧問モード：顧問先の一覧と登録 */
export function ClientListPage() {
  const { user, profile } = useAuth();
  const nav = useNavigate();
  const isAdmin = profile?.role === "admin";
  const constraints = isAdmin ? [] : [where("memberIds", "array-contains", user!.uid)];
  const { data: clients, loading, error } = useCollection<ClientDoc>(P.clients(), constraints, `${user?.uid}:${isAdmin}`);
  const [form, setForm] = useState({ code: "", name: "", accountingSystem: "kaikei_taisho" as AccountingSystem, fiscalMonth: 3 });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [tab, setTab] = useState<"active" | "closed">("active");

  const create = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.createClient(form);
      nav(`/clients/${r.clientId}`);
    } catch (e) {
      setMsg(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const list = clients.filter((c) => (c.status ?? "active") === tab).sort((a, b) => a.code.localeCompare(b.code));

  return (
    <Layout title="顧問先一覧">
      {profile?.role !== "viewer" && (
        <section className="rounded-xl border bg-white p-5">
          <h2 className="font-bold">顧問先を登録</h2>
          <div className="mt-3 grid grid-cols-6 gap-3">
            <input data-testid="client-code" placeholder="コード（例: 0001）" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} className="rounded border px-3 py-2" />
            <input data-testid="client-name" placeholder="顧問先名" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="col-span-2 rounded border px-3 py-2" />
            <select data-testid="client-system" value={form.accountingSystem} onChange={(e) => setForm({ ...form, accountingSystem: e.target.value as AccountingSystem })} className="rounded border px-2 py-2">
              {Object.entries(ACCOUNTING_SYSTEM_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-sm">
              決算月
              <select data-testid="client-fiscal" value={form.fiscalMonth} onChange={(e) => setForm({ ...form, fiscalMonth: Number(e.target.value) })} className="flex-1 rounded border px-2 py-2">
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>{m}月</option>
                ))}
              </select>
            </label>
            <button data-testid="create-client" disabled={busy || !form.code || !form.name} onClick={create} className="rounded-lg bg-blue-600 px-4 py-2 text-white disabled:opacity-40">登録</button>
          </div>
          {msg && <p className="mt-2 text-sm text-red-700">{msg}</p>}
        </section>
      )}
      <section className="mt-6 rounded-xl border bg-white">
        <div className="flex items-center gap-2 border-b px-5 py-3">
          {(["active", "closed"] as const).map((k) => (
            <button key={k} onClick={() => setTab(k)} className={`rounded-lg px-3 py-1.5 text-sm font-bold ${tab === k ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
              {k === "active" ? "契約中" : "終了"}（{clients.filter((c) => (c.status ?? "active") === k).length}）
            </button>
          ))}
        </div>
        {loading && <p className="p-5 text-slate-500">読み込み中…</p>}
        {error && <p className="p-5 text-red-700">{error}</p>}
        {!loading && list.length === 0 && <p className="p-5 text-slate-500">顧問先はまだありません。</p>}
        <ul className="divide-y">
          {list.map((c) => (
            <li key={c.id}>
              <Link to={`/clients/${c.id}`} className="flex items-center gap-4 px-5 py-3 hover:bg-slate-50">
                <span className="w-16 font-mono text-sm text-slate-500">{c.code}</span>
                <span className="font-medium">{c.name}</span>
                <span className="text-sm text-slate-600">{ACCOUNTING_SYSTEM_LABELS[c.accountingSystem]}・{c.fiscalMonth}月決算</span>
                <span className={`ml-auto rounded px-2 py-0.5 text-xs ${c.rulebookDocId || c.mfRulesPath ? "bg-green-100 text-green-800" : "bg-slate-100 text-slate-600"}`}>
                  {c.rulebookDocId || c.mfRulesPath ? "ルール集あり" : "ルール集未登録"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </Layout>
  );
}
