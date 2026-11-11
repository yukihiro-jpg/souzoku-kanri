import { Link, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "../lib/auth";
import { useEmulators } from "../lib/firebase";

const ROLE: Record<string, string> = { admin: "管理者", staff: "担当者", viewer: "閲覧者" };

export function Layout({ children, title }: { children: ReactNode; title?: string }) {
  const { profile, logout } = useAuth();
  const advisory = useLocation().pathname.startsWith("/clients");
  const tab = (on: boolean) => `rounded-md px-3 py-1 text-sm ${on ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-100"}`;
  return (
    <div className="min-h-screen">
      <header className="no-print flex items-center gap-4 border-b bg-white px-6 py-3">
        <Link to="/" className="font-bold text-slate-800">相続税 AI面談</Link>
        <nav className="flex gap-1" data-testid="mode-switch">
          <Link to="/" className={tab(!advisory)}>相続モード</Link>
          <Link to="/clients" data-testid="mode-advisory" className={tab(advisory)}>顧問モード</Link>
        </nav>
        {title && <span className="text-slate-500">/ {title}</span>}
        {useEmulators && <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">ローカル開発（エミュレーター）</span>}
        <div className="ml-auto flex items-center gap-3 text-sm">
          {profile?.role === "admin" && <Link to="/admin" className="text-blue-700 hover:underline">管理画面</Link>}
          <span className="text-slate-600">{profile?.displayName}（{ROLE[profile?.role ?? ""]}）</span>
          <button onClick={() => logout()} className="rounded border px-2 py-1 hover:bg-slate-50">ログアウト</button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl p-6">{children}</main>
    </div>
  );
}
