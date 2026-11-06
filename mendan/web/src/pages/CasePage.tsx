import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { orderBy } from "firebase/firestore";
import { P, completionStats, type CaseDoc, type CheckItem, type DocumentRequirement, type Meeting } from "@mendan/shared";
import { Layout } from "../components/Layout";
import { api, errorMessage } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmtDateTime, pct } from "../lib/format";
import { useCollection, useDoc } from "../lib/hooks";

/** 面談開始前に相続人へ説明する文面（同意確認） */
const CONSENT_SCRIPT =
  "本日の面談内容は、聞き漏らしを防ぎ、必要書類を正確にご案内するため、録音させていただきます。録音した音声はAI（Google社・Anthropic社のサービス）で文字起こし・内容整理を行い、当事務所が厳重に管理します。録音データは一定期間経過後に削除します。録音やAIの利用を希望されない場合は、録音せずに面談を行います。";

export function CasePage() {
  const { caseId = "" } = useParams();
  const nav = useNavigate();
  const { profile, user } = useAuth();
  const { data: c, error } = useDoc<CaseDoc>(P.case(caseId));
  const { data: meetings } = useCollection<Meeting>(P.meetings(caseId), [orderBy("no", "desc")]);
  const { data: checkItems } = useCollection<CheckItem>(P.checkItems(caseId));
  const { data: docs } = useCollection<DocumentRequirement>(P.documents(caseId));
  const [consent, setConsent] = useState({ recording: false, aiAnalysis: false, method: "verbal" as "verbal" | "written", note: "" });
  const [member, setMember] = useState({ email: "", role: "staff" as "staff" | "viewer" });
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (error) return <Layout title="案件">{error}</Layout>;
  if (!c) return <Layout title="案件">読み込み中…</Layout>;
  const canWrite = profile?.role === "admin" || (profile?.role === "staff" && c.members?.[user?.uid ?? ""] === "staff");
  const consented = !!(c.consent?.recording && c.consent?.aiAnalysis);
  const stats = completionStats(checkItems);
  const activeDocs = docs.filter((d) => !["not_needed", "removal_candidate"].includes(d.status));
  const live = meetings.find((m) => m.status === "in_progress");

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
    <Layout title={c.name}>
      <div className="grid grid-cols-3 gap-4">
        <section className="col-span-2 rounded-xl border bg-white p-5">
          <h2 className="text-lg font-bold">{c.name}</h2>
          <dl className="mt-3 grid grid-cols-2 gap-y-1 text-sm">
            <dt className="text-slate-500">被相続人</dt>
            <dd>{c.decedentName}</dd>
            <dt className="text-slate-500">相続開始日</dt>
            <dd>{c.inheritanceStartDate ?? "未入力"}</dd>
            <dt className="text-slate-500">確認完了率（担当者確認済み）</dt>
            <dd>{pct(stats.confirmedRate)}（話題に出た項目を含む: {pct(stats.coveredRate)}）</dd>
            <dt className="text-slate-500">必要資料</dt>
            <dd>{activeDocs.length} 件</dd>
            <dt className="text-slate-500">未確認事項</dt>
            <dd>{stats.open} 件（うち重要 {stats.highOpen} 件）</dd>
          </dl>
          <div className="mt-4 flex gap-2">
            <Link to={`/cases/${caseId}/print`} className="rounded border px-3 py-1.5 text-sm hover:bg-slate-50">必要資料依頼書（PDF出力）</Link>
          </div>
        </section>

        <section className="rounded-xl border bg-white p-5">
          <h3 className="font-bold">面談</h3>
          {live ? (
            <Link data-testid="open-meeting" to={`/cases/${caseId}/meetings/${live.id}`} className="mt-3 block rounded-lg bg-red-600 px-4 py-2 text-center text-white">
              面談中（第{live.no}回）を開く
            </Link>
          ) : (
            <button
              data-testid="start-meeting"
              disabled={!consented || busy}
              onClick={() => run(async () => nav(`/cases/${caseId}/meetings/${(await api.startMeeting({ caseId })).meetingId}`))}
              className="mt-3 w-full rounded-lg bg-blue-600 px-4 py-2 text-white disabled:opacity-40"
            >
              {meetings.length ? `第${meetings.length + 1}回面談を開始` : "初回面談を開始"}
            </button>
          )}
          {!consented && <p className="mt-2 text-xs text-red-700">録音・AI利用の同意を記録すると開始できます。</p>}
          <ul className="mt-4 space-y-1 text-sm">
            {meetings.map((m) => (
              <li key={m.id}>
                <Link to={`/cases/${caseId}/meetings/${m.id}`} className="text-blue-700 hover:underline">
                  第{m.no}回 {fmtDateTime(m.startedAt)} {m.interviewer} {m.status === "ended" ? "（終了）" : "（面談中）"}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="mt-4 rounded-xl border bg-white p-5" data-testid="consent-section">
        <h3 className="font-bold">録音・AI利用の説明と同意</h3>
        {c.consent ? (
          <p className="mt-2 text-sm">
            記録済み: 録音 {c.consent.recording ? "同意" : "不同意"} / AI解析 {c.consent.aiAnalysis ? "同意" : "不同意"}（{c.consent.method === "written" ? "書面" : "口頭"}、{fmtDateTime(c.consent.explainedAt)}）
          </p>
        ) : (
          <p className="mt-2 text-sm text-slate-600">まだ記録されていません。</p>
        )}
        <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm leading-relaxed">
          <div className="mb-1 text-xs font-medium text-slate-500">相続人への説明例（読み上げ）</div>
          {CONSENT_SCRIPT}
        </div>
        {canWrite && (
          <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
            <label className="flex items-center gap-1"><input data-testid="consent-recording" type="checkbox" checked={consent.recording} onChange={(e) => setConsent({ ...consent, recording: e.target.checked })} />録音に同意</label>
            <label className="flex items-center gap-1"><input data-testid="consent-ai" type="checkbox" checked={consent.aiAnalysis} onChange={(e) => setConsent({ ...consent, aiAnalysis: e.target.checked })} />AIによる文字起こし・解析に同意</label>
            <select value={consent.method} onChange={(e) => setConsent({ ...consent, method: e.target.value as "verbal" | "written" })} className="rounded border px-2 py-1">
              <option value="verbal">口頭で確認</option>
              <option value="written">書面で確認</option>
            </select>
            <input placeholder="備考（同意者名など）" value={consent.note} onChange={(e) => setConsent({ ...consent, note: e.target.value })} className="flex-1 rounded border px-2 py-1" />
            <button data-testid="save-consent" disabled={busy} onClick={() => run(async () => void (await api.recordConsent({ caseId, ...consent })))} className="rounded bg-slate-800 px-3 py-1 text-white">
              同意状況を記録
            </button>
          </div>
        )}
      </section>

      {canWrite && (
        <section className="mt-4 rounded-xl border bg-white p-5">
          <h3 className="font-bold">案件メンバー</h3>
          <p className="mt-1 text-sm text-slate-600">{Object.keys(c.members ?? {}).length} 名がアクセスできます。追加するユーザーは一度ログインしている必要があります。</p>
          <div className="mt-2 flex gap-2 text-sm">
            <input placeholder="メールアドレス" value={member.email} onChange={(e) => setMember({ ...member, email: e.target.value })} className="w-72 rounded border px-2 py-1" />
            <select value={member.role} onChange={(e) => setMember({ ...member, role: e.target.value as "staff" | "viewer" })} className="rounded border px-2 py-1">
              <option value="staff">担当者</option>
              <option value="viewer">閲覧者</option>
            </select>
            <button disabled={busy || !member.email} onClick={() => run(async () => void (await api.updateCase({ caseId, addMemberEmail: member.email, memberRole: member.role })))} className="rounded border px-3 py-1">追加</button>
          </div>
        </section>
      )}
      {msg && <p className="mt-3 rounded bg-red-50 p-2 text-sm text-red-700">{msg}</p>}
    </Layout>
  );
}
