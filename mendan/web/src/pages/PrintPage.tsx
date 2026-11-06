import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { CATEGORIES, DEFAULT_SETTINGS, DOCUMENT_MASTER, P, type AppSettings, type CaseDoc, type DocumentRequirement, type Entity } from "@mendan/shared";
import { useCollection, useDoc } from "../lib/hooks";

/**
 * 必要資料依頼書（ブラウザの「印刷 → PDFに保存」で PDF 出力）
 * 取得先・取得方法は資料マスタの登録内容のみを表示する（AIが作成した文は使わない）。
 */
const OUTSTANDING = ["required", "requested", "partial", "insufficient"];
const SUBMITTED = ["submitted", "verified"];
/** 資料マスタ（＝事務所の資料収集ガイド）の並び順で表示する */
const MASTER_ORDER = new Map(DOCUMENT_MASTER.map((d, i) => [d.id, i]));

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
  const ordered = CATEGORIES.flatMap((cat) => list.filter((d) => d.category === cat.id).sort((a, b) => (a.target ?? "").localeCompare(b.target ?? "") || (MASTER_ORDER.get(a.documentId) ?? 999) - (MASTER_ORDER.get(b.documentId) ?? 999)));
  const unconfirmedCount = list.filter((d) => d.status === "candidate").length;

  return (
    <div className="mx-auto max-w-[210mm] bg-white p-8 text-[12px] leading-relaxed">
      <div className="no-print mb-4 flex items-center gap-4 rounded border bg-slate-50 p-3 text-sm">
        <Link to={`/cases/${caseId}`} className="text-blue-700 hover:underline">← 案件へ戻る</Link>
        <label className="flex items-center gap-1"><input type="checkbox" checked={includeCandidates} onChange={(e) => setIncludeCandidates(e.target.checked)} />必要候補（未確定）も含める</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={showSubmitted} onChange={(e) => setShowSubmitted(e.target.checked)} />提出済みも表示</label>
        <button onClick={() => window.print()} className="ml-auto rounded bg-blue-600 px-4 py-1.5 text-white">印刷 / PDFに保存</button>
      </div>
      {includeCandidates && unconfirmedCount > 0 && (
        <p className="no-print mb-3 rounded bg-amber-50 p-2 text-sm text-amber-900">担当者が未確定の資料が {unconfirmedCount} 件含まれています。相続人へお渡しする前に確認してください。</p>
      )}

      <h1 className="text-center text-xl font-bold tracking-widest">相続税申告 必要資料のご案内</h1>
      <div className="mt-4 flex justify-between">
        <div>
          <div>被相続人: <b>{c.decedentName}</b> 様</div>
          <div>相続開始日: {c.inheritanceStartDate ?? "　　年　月　日"}</div>
          <div>相続人: {heirs.length ? heirs.join("、") : "　"}</div>
        </div>
        <div className="text-right">
          <div>作成日: {new Date().toLocaleDateString("ja-JP")}</div>
          <div className="font-bold">{s.officeName}</div>
          <div className="whitespace-pre-line">{s.officeContact}</div>
        </div>
      </div>
      <p className="mt-4">相続税の申告に必要な資料を下記のとおりご案内いたします。お手数ですが、ご準備をお願いいたします。ご不明な点はお気軽にお問い合わせください。</p>

      <table className="mt-4 w-full table-fixed border-collapse text-[11px]">
        <colgroup>
          {["4%", "19%", "13%", "29%", "13%", "8%", "6%", "8%"].map((w, i) => (
            <col key={i} style={{ width: w }} />
          ))}
        </colgroup>
        <thead>
          <tr className="bg-slate-100">
            {["No", "資料名", "取得先", "取得方法", "対象期間", "ご提出者", "期限", "状況"].map((h) => (
              <th key={h} className="border border-slate-400 px-1 py-1 text-left font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ordered.map((d, i) => {
            const done = SUBMITTED.includes(d.status);
            return (
              <tr key={d.id} className={done ? "text-slate-400" : ""}>
                <td className="border border-slate-400 px-1 text-center">{i + 1}</td>
                <td className="border border-slate-400 px-1">{d.name}</td>
                <td className="border border-slate-400 px-1">{d.source}</td>
                <td className="border border-slate-400 px-1">{d.howTo}</td>
                <td className="border border-slate-400 px-1">{d.period ?? "―"}</td>
                <td className="border border-slate-400 px-1">{d.submitter ?? ""}</td>
                <td className="border border-slate-400 px-1 whitespace-nowrap">{d.dueDate ?? ""}</td>
                <td className="border border-slate-400 px-1 whitespace-nowrap">{done ? "提出済み" : d.status === "partial" ? "一部提出" : d.status === "insufficient" ? "再取得" : "□ 未提出"}</td>
              </tr>
            );
          })}
          {ordered.length === 0 && (
            <tr>
              <td colSpan={8} className="border border-slate-400 p-3 text-center text-slate-500">表示する資料がありません</td>
            </tr>
          )}
        </tbody>
      </table>
      <p className="mt-4 text-[11px] text-slate-600">※ 面談の内容により、追加で資料をお願いする場合があります。原本が必要な資料は別途ご案内します。</p>
    </div>
  );
}
