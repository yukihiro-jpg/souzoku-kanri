import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { CATEGORIES, DEFAULT_SETTINGS, DOCUMENT_MASTER, P, type AppSettings, type CaseDoc, type CategoryId, type DocumentRequirement, type Entity } from "@mendan/shared";
import { useCollection, useDoc } from "../lib/hooks";

/**
 * 必要資料依頼書（ブラウザの「印刷 → PDFに保存」で PDF 出力）
 * 取得先・取得方法は資料マスタの登録内容のみを表示する（AIが作成した文は使わない）。
 * 資料はカテゴリ（戸籍関係・現金預金関係・葬式費用関係など）ごとに区分けして表示する。
 */
const OUTSTANDING = ["required", "requested", "partial", "insufficient"];
const SUBMITTED = ["submitted", "verified"];
/** 資料マスタ（＝事務所の資料収集ガイド）の並び順で表示する */
const MASTER_ORDER = new Map(DOCUMENT_MASTER.map((d, i) => [d.id, i]));

/** 相続人にお渡しする書面での区分名（画面内のカテゴリ名より、資料の種類が分かりやすい表現にする） */
const PRINT_LABEL: Record<CategoryId, string> = {
  basic: "戸籍・住民票などの基本資料",
  deposits: "現金・預貯金関係",
  real_estate: "土地・建物関係",
  securities: "上場株式・投資信託関係",
  unlisted: "非上場株式（同族会社）関係",
  insurance: "生命保険・死亡退職金関係",
  other_assets: "その他の財産関係",
  debts: "借入金・未払金関係",
  funeral: "葬式費用関係",
  gifts: "生前贈与関係",
  nominee: "ご家族名義の預金関係",
  will: "遺言・遺産分割関係",
  special: "特例・控除関係",
  misc: "その他",
};

function statusLabel(d: DocumentRequirement): { text: string; cls: string } {
  if (SUBMITTED.includes(d.status)) return { text: "提出済み", cls: "text-slate-400" };
  if (d.status === "partial") return { text: "一部提出", cls: "font-bold text-amber-700" };
  if (d.status === "insufficient") return { text: "再取得", cls: "font-bold text-red-700" };
  return { text: "□", cls: "text-[15px] text-slate-500" };
}

export function PrintPage() {
  const { caseId = "" } = useParams();
  const { data: c } = useDoc<CaseDoc>(P.case(caseId));
  const { data: settings } = useDoc<AppSettings>(P.settings());
  const { data: docs } = useCollection<DocumentRequirement>(P.documents(caseId));
  const { data: entities } = useCollection<Entity>(P.entities(caseId));
  const [includeCandidates, setIncludeCandidates] = useState(true);
  const [showSubmitted, setShowSubmitted] = useState(true);
  const s = { ...DEFAULT_SETTINGS, ...(settings ?? {}) };
  if (!c) return <div className="p-8">読み込み中…</div>;

  const heirs = entities.filter((e) => e.type === "heir" && e.status !== "retracted" && e.status !== "rejected").map((e) => e.attributes.name?.value ?? e.attributes.relationship?.value ?? e.label);
  const list = docs.filter((d) => OUTSTANDING.includes(d.status) || (includeCandidates && d.status === "candidate") || (showSubmitted && SUBMITTED.includes(d.status)));
  const groups = CATEGORIES.map((cat) => ({
    id: cat.id,
    label: PRINT_LABEL[cat.id],
    items: list
      .filter((d) => d.category === cat.id)
      .sort((a, b) => (a.target ?? "").localeCompare(b.target ?? "") || (MASTER_ORDER.get(a.documentId) ?? 999) - (MASTER_ORDER.get(b.documentId) ?? 999)),
  })).filter((g) => g.items.length > 0);
  const unconfirmedCount = list.filter((d) => d.status === "candidate").length;
  const remaining = list.filter((d) => !SUBMITTED.includes(d.status)).length;
  const print = () => void document.fonts.ready.then(() => window.print());
  let no = 0;

  return (
    <div className="doc-request mx-auto max-w-[210mm] bg-white p-8 text-[11.5px] leading-relaxed text-slate-800">
      <div className="no-print mb-4 flex items-center gap-4 rounded border bg-slate-50 p-3 text-sm">
        <Link to={`/cases/${caseId}`} className="text-blue-700 hover:underline">← 案件へ戻る</Link>
        <label className="flex items-center gap-1"><input type="checkbox" checked={includeCandidates} onChange={(e) => setIncludeCandidates(e.target.checked)} />必要候補（未確定）も含める</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={showSubmitted} onChange={(e) => setShowSubmitted(e.target.checked)} />提出済みも表示</label>
        <button onClick={print} className="ml-auto rounded bg-blue-600 px-4 py-1.5 text-white">印刷 / PDFに保存</button>
      </div>
      {includeCandidates && unconfirmedCount > 0 && (
        <p className="no-print mb-3 rounded bg-amber-50 p-2 text-sm text-amber-900">担当者が未確定の資料が {unconfirmedCount} 件含まれています。相続人へお渡しする前に確認してください。</p>
      )}

      {/* 表題 */}
      <div className="border-b-[3px] border-sky-800 pb-2">
        <h1 className="text-center text-[20px] font-bold tracking-[0.2em] text-sky-900">相続税申告 必要資料のご案内</h1>
      </div>

      {/* 案件と事務所の情報 */}
      <div className="mt-4 flex items-stretch justify-between gap-6">
        <table className="border-collapse text-[12px]">
          <tbody>
            {[
              ["被相続人", <><b className="text-[14px]">{c.decedentName}</b> 様</>],
              ["相続開始日", c.inheritanceStartDate ?? "　　　年　　月　　日"],
              ["相続人", heirs.length ? heirs.join("、") : "　"],
            ].map(([k, v], i) => (
              <tr key={i}>
                <th className="w-24 border border-slate-300 bg-sky-50 px-2 py-1 text-left font-medium text-sky-900">{k}</th>
                <td className="min-w-[200px] border border-slate-300 px-3 py-1">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="text-right text-[11px]">
          <div>作成日：{new Date().toLocaleDateString("ja-JP")}</div>
          <div className="mt-1 text-[13px] font-bold">{s.officeName}</div>
          <div className="whitespace-pre-line text-slate-600">{s.officeContact}</div>
        </div>
      </div>

      <p className="mt-4">相続税の申告に必要な資料を下記のとおりご案内いたします。お手数ですが、ご準備をお願いいたします。ご不明な点はお気軽にお問い合わせください。</p>

      {/* 区分の一覧 */}
      <div className="keep mt-3 rounded border border-sky-200 bg-sky-50/60 px-3 py-2">
        <div className="text-[11px] font-bold text-sky-900">ご準備いただく資料：全 {list.length} 点{remaining !== list.length && `（うち未提出 ${remaining} 点）`}</div>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px]">
          {groups.map((g, i) => (
            <span key={g.id}>
              <span className="font-bold text-sky-800">{i + 1}.</span> {g.label}（{g.items.length}点）
            </span>
          ))}
        </div>
      </div>

      {groups.length === 0 && <p className="mt-6 rounded border border-dashed p-6 text-center text-slate-500">表示する資料がありません</p>}

      {/* 区分ごとの資料 */}
      {groups.map((g, gi) => (
        <section key={g.id} className="mt-5">
          <table className="w-full table-fixed border-collapse">
            <colgroup>
              {["5%", "43%", "17%", "13%", "10%", "6%", "6%"].map((w, i) => (
                <col key={i} style={{ width: w }} />
              ))}
            </colgroup>
            {/* 区分名は表の見出しに含め、ページをまたいでも各ページの先頭に表示する */}
            <thead>
              <tr>
                <th colSpan={7} className="bg-sky-800 px-3 py-1.5 text-left text-[13px] font-bold text-white">
                  <span className="flex items-baseline gap-2">
                    <span>{gi + 1}.</span>
                    <span>{g.label}</span>
                    <span className="ml-auto text-[11px] font-medium text-sky-100">{g.items.length}点</span>
                  </span>
                </th>
              </tr>
              <tr className="bg-sky-50 text-[10.5px] text-sky-900">
                {["No", "資料名／取得方法", "取得先", "対象期間", "ご提出者", "期限", "確認"].map((h) => (
                  <th key={h} className="border border-slate-300 px-1.5 py-1 text-left font-bold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {g.items.map((d, i) => {
                no += 1;
                const st = statusLabel(d);
                const done = SUBMITTED.includes(d.status);
                return (
                  <tr key={d.id} className={`keep align-top ${i % 2 === 1 ? "bg-slate-50" : "bg-white"} ${done ? "text-slate-400" : ""}`}>
                    <td className="border border-slate-300 px-1 py-1.5 text-center font-medium">{no}</td>
                    <td className="border border-slate-300 px-2 py-1.5">
                      <div className={`text-[12px] font-bold ${done ? "line-through" : "text-slate-900"}`}>{d.name}</div>
                      {d.howTo && <div className="mt-0.5 text-[10.5px] leading-snug text-slate-600">{d.howTo}</div>}
                    </td>
                    <td className="border border-slate-300 px-1.5 py-1.5">{d.source}</td>
                    <td className="border border-slate-300 px-1.5 py-1.5">{d.period ?? "―"}</td>
                    <td className="border border-slate-300 px-1.5 py-1.5">{d.submitter ?? ""}</td>
                    <td className={`border border-slate-300 px-1 py-1.5 ${d.dueDate ? "font-bold text-red-700" : ""}`}>{d.dueDate ?? ""}</td>
                    <td className={`border border-slate-300 px-1 py-1.5 text-center whitespace-nowrap ${st.cls}`}>{st.text}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      ))}

      <p className="mt-5 border-t border-slate-300 pt-2 text-[10.5px] text-slate-600">
        ※ 面談の内容により、追加で資料をお願いする場合があります。原本が必要な資料は別途ご案内します。<br />※ ご準備ができた資料は「確認」欄に ✓ を付けていただくと、漏れの防止に役立ちます。
      </p>
    </div>
  );
}
