import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { orderBy, where } from "firebase/firestore";
import { P, type CaseDoc } from "@mendan/shared";
import { Layout } from "../components/Layout";
import { api, errorMessage } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useCollection } from "../lib/hooks";

export function CaseListPage() {
  const { user, profile } = useAuth();
  const nav = useNavigate();
  const isAdmin = profile?.role === "admin";
  const constraints = isAdmin ? [orderBy("createdAt", "desc")] : [where("memberIds", "array-contains", user!.uid)];
  const { data: cases, loading, error } = useCollection<CaseDoc>(P.cases(), constraints, `${user?.uid}:${isAdmin}`);
  const [form, setForm] = useState({ name: "", decedentName: "", inheritanceStartDate: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.createCase({ ...form, inheritanceStartDate: form.inheritanceStartDate || undefined });
      nav(`/cases/${r.caseId}`);
    } catch (e) {
      setMsg(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const sorted = [...cases].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <Layout title="案件一覧">
      {profile?.role !== "viewer" && (
        <section className="rounded-xl border bg-white p-5">
          <h2 className="font-bold">新しい相続案件</h2>
          <div className="mt-3 grid grid-cols-4 gap-3">
            <input data-testid="case-name" placeholder="案件名（例: 山田家 相続税申告）" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="col-span-2 rounded border px-3 py-2" />
            <input data-testid="decedent-name" placeholder="被相続人名" value={form.decedentName} onChange={(e) => setForm({ ...form, decedentName: e.target.value })} className="rounded border px-3 py-2" />
            <label className="flex items-center gap-2 text-sm">
              相続開始日
              <input data-testid="death-date" type="date" value={form.inheritanceStartDate} onChange={(e) => setForm({ ...form, inheritanceStartDate: e.target.value })} className="flex-1 rounded border px-2 py-2" />
            </label>
          </div>
          <button data-testid="create-case" disabled={busy || !form.name || !form.decedentName} onClick={create} className="mt-3 rounded-lg bg-blue-600 px-4 py-2 text-white disabled:opacity-40">
            案件を作成
          </button>
          {msg && <p className="mt-2 text-sm text-red-700">{msg}</p>}
        </section>
      )}
      <section className="mt-6 rounded-xl border bg-white">
        <h2 className="border-b px-5 py-3 font-bold">担当案件</h2>
        {loading && <p className="p-5 text-slate-500">読み込み中…</p>}
        {error && <p className="p-5 text-red-700">{error}</p>}
        {!loading && sorted.length === 0 && <p className="p-5 text-slate-500">案件はまだありません。</p>}
        <ul className="divide-y">
          {sorted.map((c) => (
            <li key={c.id}>
              <Link to={`/cases/${c.id}`} className="flex items-center gap-4 px-5 py-3 hover:bg-slate-50">
                <span className="font-medium">{c.name}</span>
                <span className="text-sm text-slate-600">被相続人: {c.decedentName}</span>
                <span className="text-sm text-slate-600">相続開始日: {c.inheritanceStartDate ?? "未入力"}</span>
                <span className={`ml-auto rounded px-2 py-0.5 text-xs ${c.consent?.recording && c.consent?.aiAnalysis ? "bg-green-100 text-green-800" : "bg-slate-100 text-slate-600"}`}>
                  {c.consent?.recording && c.consent?.aiAnalysis ? "同意済み" : "同意未記録"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </Layout>
  );
}
