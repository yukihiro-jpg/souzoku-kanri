import { useEffect, useState } from "react";
import { DEFAULT_RULES, DEFAULT_SETTINGS, DEFAULT_VOCABULARY, P, type AppSettings, type DocumentRule, type Role } from "@mendan/shared";
import { Layout } from "../components/Layout";
import { api, errorMessage, type Metrics } from "../lib/api";
import { cx, fmtDateTime } from "../lib/format";
import { useCollection, useDoc } from "../lib/hooks";

type Tab = "rules" | "vocab" | "settings" | "metrics" | "users";

export function AdminPage() {
  const [tab, setTab] = useState<Tab>("rules");
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const run = async (f: () => Promise<unknown>, done = "保存しました") => {
    setMsg(null);
    try {
      await f();
      setMsg({ text: done, ok: true });
    } catch (e) {
      setMsg({ text: errorMessage(e), ok: false });
    }
  };
  return (
    <Layout title="管理画面">
      <nav className="mb-4 flex gap-1 text-sm">
        {(
          [
            ["rules", "資料判定ルール"],
            ["vocab", "専門用語（音声認識）"],
            ["settings", "設定"],
            ["metrics", "費用・性能"],
            ["users", "ユーザー"],
          ] as [Tab, string][]
        ).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={cx("rounded-lg px-3 py-1.5", tab === k ? "bg-slate-800 text-white" : "bg-white hover:bg-slate-100")}>
            {l}
          </button>
        ))}
      </nav>
      {msg && <p className={cx("mb-3 rounded p-2 text-sm", msg.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700")}>{msg.text}</p>}
      {tab === "rules" && <Rules run={run} />}
      {tab === "vocab" && <Vocab run={run} />}
      {tab === "settings" && <Settings run={run} />}
      {tab === "metrics" && <MetricsView />}
      {tab === "users" && <Users run={run} />}
    </Layout>
  );
}

type Run = (f: () => Promise<unknown>, done?: string) => Promise<void>;

function Rules({ run }: { run: Run }) {
  const { data: stored } = useCollection<DocumentRule>(P.documentRules());
  const byId = new Map(DEFAULT_RULES.map((r) => [r.id, r]));
  for (const r of stored) byId.set(r.id, r);
  const rules = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  const [edit, setEdit] = useState<{ id: string; json: string } | null>(null);
  const label = { approved: "税理士承認済み", pending_review: "未承認", rejected: "不採用" } as const;
  return (
    <div className="space-y-2">
      <p className="text-sm text-slate-600">必要資料はこのルールで判定されます（AIは資料を決めません）。ルールを変更すると版が上がり、税理士の再承認待ちになります。</p>
      <button onClick={() => setEdit({ id: "", json: JSON.stringify({ ...DEFAULT_RULES[1], id: "R-NEW-001", title: "新しいルール" }, null, 2) })} className="rounded border bg-white px-3 py-1 text-sm">＋ ルールを追加</button>
      {edit && (
        <div className="rounded-xl border bg-white p-3">
          <div className="mb-1 text-sm font-bold">{edit.id || "新規ルール"}（JSON で編集）</div>
          <textarea value={edit.json} onChange={(e) => setEdit({ ...edit, json: e.target.value })} className="h-80 w-full rounded border p-2 font-mono text-xs" />
          <div className="mt-2 flex gap-2">
            <button onClick={() => run(async () => (await api.saveRule({ rule: JSON.parse(edit.json) }), setEdit(null)))} className="rounded bg-blue-600 px-3 py-1 text-sm text-white">保存</button>
            <button onClick={() => setEdit(null)} className="rounded border px-3 py-1 text-sm">閉じる</button>
          </div>
        </div>
      )}
      <table className="w-full rounded-xl border bg-white text-sm">
        <thead className="bg-slate-50 text-left text-xs text-slate-500">
          <tr>
            <th className="p-2">ID / 版</th>
            <th>カテゴリー・タイトル</th>
            <th>適用条件</th>
            <th>必要資料</th>
            <th>重要度</th>
            <th>承認</th>
            <th></th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rules.map((r) => (
            <tr key={r.id} className={r.enabled ? "" : "opacity-50"}>
              <td className="p-2 font-mono text-xs">{r.id}<br />v{r.version}</td>
              <td>{r.title}</td>
              <td className="text-xs">
                {r.appliesTo.kind === "case" ? "全案件" : r.appliesTo.entityType}
                {r.conditions.map((c) => ` / ${c.attr} ${c.op} ${c.value ?? ""}`)}
                {r.exceptions.length > 0 && <div className="text-slate-500">除外: {r.exceptions.map((c) => `${c.attr} ${c.op} ${c.value ?? ""}`).join(", ")}</div>}
              </td>
              <td className="text-xs">{r.documentIds.join(", ")}</td>
              <td className="text-xs">{r.importance}</td>
              <td className="text-xs">
                <span className={cx("rounded px-1", r.approval.status === "approved" ? "bg-green-100 text-green-800" : "bg-yellow-100 text-yellow-800")}>{label[r.approval.status]}</span>
                {r.approval.at && <div className="text-slate-400">{fmtDateTime(r.approval.at)}</div>}
              </td>
              <td className="space-x-1 whitespace-nowrap text-xs">
                {r.approval.status !== "approved" && <button onClick={() => run(() => api.approveRule({ ruleId: r.id, status: "approved" }), "承認しました")} className="rounded border border-green-400 px-1.5 text-green-700">承認</button>}
                <button onClick={() => setEdit({ id: r.id, json: JSON.stringify(r, null, 2) })} className="rounded border px-1.5">編集</button>
                {stored.some((s) => s.id === r.id) && byId.has(r.id) && DEFAULT_RULES.some((d) => d.id === r.id) && (
                  <button onClick={() => run(() => api.resetRule({ ruleId: r.id }), "初期値に戻しました")} className="rounded border px-1.5">初期値</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Vocab({ run }: { run: Run }) {
  const { data } = useCollection<{ term: string; active: boolean }>(P.vocabulary());
  const [term, setTerm] = useState("");
  const terms = data.map((d) => d.term).sort();
  return (
    <div className="rounded-xl border bg-white p-4">
      <p className="text-sm text-slate-600">Gemini の音声認識に渡すカスタム語彙です。案件ごとに、被相続人名・相続人名・会話に出た金融機関名も自動で追加されます。</p>
      {terms.length === 0 && (
        <button onClick={() => run(() => api.saveVocabulary({ seedDefaults: DEFAULT_VOCABULARY }), "初期語彙を登録しました")} className="mt-2 rounded border px-3 py-1 text-sm">
          初期語彙（{DEFAULT_VOCABULARY.length}語）を登録
        </button>
      )}
      <div className="mt-3 flex gap-2">
        <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="例: 茨城県信用組合" className="w-72 rounded border px-2 py-1" />
        <button disabled={!term.trim()} onClick={() => run(async () => (await api.saveVocabulary({ add: [term] }), setTerm("")))} className="rounded bg-blue-600 px-3 py-1 text-sm text-white disabled:opacity-40">追加</button>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {terms.map((t) => (
          <span key={t} className="flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-sm">
            {t}
            <button onClick={() => run(() => api.saveVocabulary({ remove: [t] }), "削除しました")} className="text-slate-400 hover:text-red-600">×</button>
          </span>
        ))}
      </div>
    </div>
  );
}

function Settings({ run }: { run: Run }) {
  const { data } = useDoc<AppSettings>(P.settings());
  const [s, setS] = useState<AppSettings>(DEFAULT_SETTINGS);
  useEffect(() => setS({ ...DEFAULT_SETTINGS, ...(data ?? {}) }), [data]);
  const num = (k: keyof AppSettings, label: string, step = 1, note?: string) => (
    <label className="grid grid-cols-[260px_160px_1fr] items-center gap-2 text-sm">
      {label}
      <input type="number" step={step} value={s[k] as number} onChange={(e) => setS({ ...s, [k]: Number(e.target.value) })} className="rounded border px-2 py-1" />
      <span className="text-xs text-slate-500">{note}</span>
    </label>
  );
  return (
    <div className="space-y-2 rounded-xl border bg-white p-4">
      {num("transactionHistoryYears", "取引履歴の収集期間（年）", 1, "事務所の調査方針。生前贈与加算期間とは別に管理します")}
      {num("defaultDueDays", "資料の提出期限の目安（日）")}
      {num("audioRetentionDays", "録音データの保存期間（日）", 1, "期間経過後に自動削除（毎日3:15）")}
      {num("monthlyBudgetUsd", "API料金の月間上限（USD）", 1, "超過するとAI解析を停止（発言の保存は継続）")}
      {num("budgetWarnRatio", "上限に対する警告ライン（0〜1）", 0.05)}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={s.requireApprovedRules} onChange={(e) => setS({ ...s, requireApprovedRules: e.target.checked })} />
        税理士承認済みのルールだけを適用する
      </label>
      <label className="grid grid-cols-[260px_1fr] items-center gap-2 text-sm">事務所名<input value={s.officeName} onChange={(e) => setS({ ...s, officeName: e.target.value })} className="rounded border px-2 py-1" /></label>
      <label className="grid grid-cols-[260px_1fr] items-start gap-2 text-sm">事務所連絡先（資料依頼書に記載）<textarea value={s.officeContact} onChange={(e) => setS({ ...s, officeContact: e.target.value })} className="h-16 rounded border px-2 py-1" /></label>
      <button onClick={() => run(() => api.saveSettings(s))} className="rounded bg-blue-600 px-4 py-1.5 text-sm text-white">保存</button>
    </div>
  );
}

function MetricsView() {
  const [m, setM] = useState<Metrics | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api.getMetrics({ days: 30 }).then(setM, (e) => setErr(errorMessage(e)));
  }, []);
  if (err) return <p className="text-red-700">{err}</p>;
  if (!m) return <p>集計中…</p>;
  const L: Record<string, string> = {
    interimMs: "発話開始 → 暫定テキスト表示（目標 約1秒）",
    finalToRequestMs: "発話確定 → 解析依頼",
    aiMs: "Claude 解析時間",
    serverMs: "サーバー処理全体（受信〜反映）",
    finalToAppliedMs: "発話確定 → 解析結果受信（目標 2〜5秒）",
    finalToDocListMs: "発話確定 → 資料リスト反映（目標 1〜3秒）",
  };
  const sec = (v: number | null) => (v === null ? "―" : `${(v / 1000).toFixed(2)}秒`);
  return (
    <div className="space-y-4">
      <section className="rounded-xl border bg-white p-4">
        <h3 className="font-bold">応答時間（直近30日・リアルタイム解析 {m.realtimeJobs} 回、エラー {m.errorJobs} 回）</h3>
        <table className="mt-2 w-full text-sm">
          <thead className="text-left text-xs text-slate-500"><tr><th>区間</th><th>件数</th><th>P50</th><th>P95</th></tr></thead>
          <tbody>
            {Object.entries(L).map(([k, label]) => (
              <tr key={k} className="border-t"><td className="py-1">{label}</td><td>{m.latency[k]?.n ?? 0}</td><td>{sec(m.latency[k]?.p50 ?? null)}</td><td>{sec(m.latency[k]?.p95 ?? null)}</td></tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="rounded-xl border bg-white p-4">
        <h3 className="font-bold">今月（{m.month}）の概算料金: ${(m.cost?.totalUsd ?? 0).toFixed(2)} / 上限 ${m.budget}</h3>
        <p className="text-xs text-slate-500">Claude 呼び出し {m.cost?.claudeCalls ?? 0} 回 / 文字起こし音声 {Math.round((m.cost?.geminiAudioSeconds ?? 0) / 60)} 分。料金はトークン数・音声時間からの概算です。</p>
        <table className="mt-2 w-full text-sm">
          <thead className="text-left text-xs text-slate-500"><tr><th>モデル</th><th>回数</th><th>入力トークン</th><th>キャッシュ読込</th><th>出力トークン</th><th>概算(USD)</th></tr></thead>
          <tbody>
            {Object.entries(m.cost?.byModel ?? {}).map(([k, v]) => (
              <tr key={k} className="border-t"><td className="py-1">{k}</td><td>{v.calls ?? "―"}</td><td>{v.inputTokens?.toLocaleString() ?? "―"}</td><td>{v.cacheReadTokens?.toLocaleString() ?? "―"}</td><td>{v.outputTokens?.toLocaleString() ?? "―"}</td><td>{(v.usd ?? 0).toFixed(3)}</td></tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="rounded-xl border bg-white p-4">
        <h3 className="font-bold">面談ごとの使用量</h3>
        <table className="mt-2 w-full text-sm">
          <thead className="text-left text-xs text-slate-500"><tr><th>開始</th><th>担当</th><th>回</th><th>Claude入力</th><th>Claude出力</th><th>解析回数</th><th>音声(分)</th><th>概算(USD)</th></tr></thead>
          <tbody>
            {m.meetings.map((x) => (
              <tr key={x.meetingId} className="border-t"><td className="py-1">{fmtDateTime(x.startedAt)}</td><td>{x.interviewer}</td><td>{x.no}</td><td>{(x.usage.claudeInputTokens ?? 0).toLocaleString()}</td><td>{(x.usage.claudeOutputTokens ?? 0).toLocaleString()}</td><td>{x.usage.claudeCalls ?? 0}</td><td>{Math.round((x.usage.audioSeconds ?? 0) / 60)}</td><td>{(x.usage.usd ?? 0).toFixed(3)}</td></tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function Users({ run }: { run: Run }) {
  const { data } = useCollection<{ uid: string; email: string; displayName: string; role: Role; active: boolean; lastLoginAt?: string }>("users");
  return (
    <table className="w-full rounded-xl border bg-white text-sm">
      <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="p-2">ユーザー</th><th>権限</th><th>利用</th><th>最終ログイン</th></tr></thead>
      <tbody className="divide-y">
        {data.map((u) => (
          <tr key={u.uid}>
            <td className="p-2">{u.displayName}<div className="text-xs text-slate-500">{u.email}</div></td>
            <td>
              <select value={u.role} onChange={(e) => run(() => api.setUserRole({ uid: u.uid, role: e.target.value as Role }))} className="rounded border px-1">
                <option value="admin">管理者</option>
                <option value="staff">担当者</option>
                <option value="viewer">閲覧者</option>
              </select>
            </td>
            <td><input type="checkbox" checked={u.active} onChange={(e) => run(() => api.setUserRole({ uid: u.uid, active: e.target.checked }))} /></td>
            <td className="text-xs">{fmtDateTime(u.lastLoginAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
