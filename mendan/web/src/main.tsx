import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import "./index.css";
import { AuthProvider, useAuth } from "./lib/auth";
import { LoginPage } from "./pages/LoginPage";
import { CaseListPage } from "./pages/CaseListPage";
import { CasePage } from "./pages/CasePage";
import { MeetingPage } from "./pages/MeetingPage";
import { PrintPage } from "./pages/PrintPage";
import { AdminPage } from "./pages/AdminPage";

function Guard({ children, admin }: { children: React.ReactNode; admin?: boolean }) {
  const { user, profile, loading } = useAuth();
  if (loading) return <div className="p-10 text-slate-500">読み込み中…</div>;
  if (!user || !profile) return <Navigate to="/login" replace />;
  if (admin && profile.role !== "admin") return <div className="p-10">管理者のみ利用できます。</div>;
  return <>{children}</>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<Guard><CaseListPage /></Guard>} />
          <Route path="/cases/:caseId" element={<Guard><CasePage /></Guard>} />
          <Route path="/cases/:caseId/meetings/:meetingId" element={<Guard><MeetingPage /></Guard>} />
          <Route path="/cases/:caseId/print" element={<Guard><PrintPage /></Guard>} />
          <Route path="/admin" element={<Guard admin><AdminPage /></Guard>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  </StrictMode>,
);
