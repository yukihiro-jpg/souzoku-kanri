import { useState } from "react";
import { Navigate } from "react-router-dom";
import { errorMessage } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useEmulators } from "../lib/firebase";

export function LoginPage() {
  const { user, profile, loading, error, signIn, devSignIn } = useAuth();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [email, setEmail] = useState("admin@example.com");
  if (!loading && user && profile) return <Navigate to="/" replace />;

  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    setMsg(null);
    try {
      await f();
    } catch (e) {
      setMsg(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-[420px] rounded-xl border bg-white p-8 shadow-sm">
        <h1 className="text-xl font-bold">相続税 AI面談・必要資料管理</h1>
        <p className="mt-2 text-sm text-slate-600">事務所の Google Workspace アカウントでログインしてください。</p>
        <button disabled={busy} onClick={() => run(signIn)} className="mt-6 w-full rounded-lg bg-blue-600 py-2.5 font-medium text-white hover:bg-blue-700 disabled:opacity-50">
          Google でログイン
        </button>
        {useEmulators && (
          <div className="mt-6 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
            <div className="font-medium text-amber-900">開発用ログイン（エミュレーター接続時のみ）</div>
            <div className="mt-2 flex gap-2">
              <input data-testid="dev-email" value={email} onChange={(e) => setEmail(e.target.value)} className="flex-1 rounded border px-2 py-1" />
              <button data-testid="dev-login" disabled={busy} onClick={() => run(() => devSignIn(email))} className="rounded bg-amber-600 px-3 py-1 text-white">ログイン</button>
            </div>
          </div>
        )}
        {(error || msg) && <p className="mt-4 rounded bg-red-50 p-2 text-sm text-red-700">{error ?? msg}</p>}
      </div>
    </div>
  );
}
