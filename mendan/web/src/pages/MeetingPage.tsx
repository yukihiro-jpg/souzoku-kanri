import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { arrayUnion, doc, updateDoc } from "firebase/firestore";
import { ref as storageRef, uploadBytes } from "firebase/storage";
import { P, completionStats, rankQuestions, type CheckItem, type CheckStatus, type DocStatus, type DocumentRequirement, type Entity, type RankedQuestion, type ReviewItem, type TranscriptSegment } from "@mendan/shared";
import { api, errorMessage } from "../lib/api";
import { useAuth } from "../lib/auth";
import { db, storage } from "../lib/firebase";
import { cx, fmtDateTime, fmtElapsed, pct } from "../lib/format";
import { useNow } from "../lib/hooks";
import { DemoTranscriber } from "../live/demoTranscriber";
import { SegmentPipeline, type JobTimings } from "../live/pipeline";
import type { Transcriber, TranscriberEvents, TranscriberState } from "../live/types";
import { CheckItemsTab } from "../meeting/CheckItemsTab";
import { DocumentsTab } from "../meeting/DocumentsTab";
import { NextQuestionsBar } from "../meeting/NextQuestionsBar";
import { OpenItemsTab } from "../meeting/OpenItemsTab";
import { TranscriptPanel } from "../meeting/TranscriptPanel";
import { useMeetingData } from "../meeting/useMeetingData";

type Tab = "check" | "docs" | "open";

export function MeetingPage() {
  const { caseId = "", meetingId = "" } = useParams();
  const { user, profile } = useAuth();
  const { caseDoc, meeting, segments, entities, checkItems, documents, reviewItems } = useMeetingData(caseId, meetingId);
  const now = useNow(1000);
  const [tab, setTab] = useState<Tab>("check");
  const [state, setState] = useState<TranscriberState>("idle");
  const [stateMsg, setStateMsg] = useState("");
  const [interim, setInterim] = useState("");
  const [toasts, setToasts] = useState<{ id: number; text: string; level: "error" | "info" }[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [asked, setAsked] = useState<Set<string>>(new Set());
  const [endWarn, setEndWarn] = useState<string[] | null>(null);
  const [lastLatency, setLastLatency] = useState<{ total: number; ai?: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const transcriber = useRef<Transcriber | null>(null);
  const pipeline = useRef<SegmentPipeline | null>(null);
  const segRefs = useRef(new Map<string, HTMLElement>());
  const lastDocsAt = useRef(0);
  lastDocsAt.current = Math.max(documents.updatedAt, checkItems.updatedAt);

  const c = caseDoc.data;
  const m = meeting.data;
  const isMember = profile?.role === "admin" || c?.members?.[user?.uid ?? ""] === "staff";
  const canEdit = !!isMember && profile?.role !== "viewer";
  const live = state === "live" || state === "connecting" || state === "reconnecting" || state === "starting";

  const toast = useCallback((text: string, level: "error" | "info" = "error") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, text, level }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), level === "error" ? 12000 : 5000);
  }, []);

  const speakerMapRef = useRef(m?.speakerMap ?? {});
  speakerMapRef.current = m?.speakerMap ?? {};

  const makePipeline = useCallback(() => {
    const lastSeq = Math.max(m?.lastSeq ?? 0, ...segments.data.map((s) => s.seq));
    return new SegmentPipeline(
      caseId,
      meetingId,
      user!.uid,
      lastSeq,
      {
        onError: (msg) => toast(msg),
        onJobDone: (jobId, t: JobTimings, info) => {
          if (info.skipped === "budget_exceeded") toast("API料金が月間上限に達したため、AI解析を停止しています（発言は保存されています）");
          if (info.budget === "warn") toast("API料金が月間上限に近づいています", "info");
          // 解析結果は Firestore の購読で画面に反映済み。次の描画後の時刻を「資料リスト反映時刻」とする
          requestAnimationFrame(() => {
            t.docListUpdatedAt = Math.max(t.resultReceivedAt ?? 0, lastDocsAt.current > t.requestedAt ? lastDocsAt.current : 0) || Date.now();
            setLastLatency({ total: t.docListUpdatedAt - t.finalAt, ai: info.aiMs });
            if (jobId) void SegmentPipeline.reportTimings(caseId, jobId, t);
          });
        },
      },
      (label) => (label ? speakerMapRef.current[label] ?? "unknown" : "unknown"),
    );
  }, [caseId, meetingId, user, m?.lastSeq, segments.data, toast]);

  const events = useCallback(
    (): TranscriberEvents => ({
      onInterim: (t) => setInterim(t),
      onFinal: (text, info) => pipeline.current?.addFinal(text, info),
      onState: (s, msg) => {
        setState(s);
        setStateMsg(msg ?? "");
        if (s === "error" && msg) toast(msg);
      },
      onGap: (g) => {
        pipeline.current?.addSystem(`【通信断】${new Date(g.from).toLocaleTimeString("ja-JP")}〜${g.to ? new Date(g.to).toLocaleTimeString("ja-JP") : ""} ${g.reason}`);
        void updateDoc(doc(db, P.meeting(caseId, meetingId)), { gaps: arrayUnion(g) }).catch(() => undefined);
      },
      onRecordingChunk: (blob, index) => {
        // 録音は事後照合のため Cloud Storage に保存（案件の担当者のみアクセス可）
        const path = `audio/${caseId}/${meetingId}/${Date.now()}_${String(index).padStart(4, "0")}.webm`;
        uploadBytes(storageRef(storage, path), blob, { contentType: blob.type || "audio/webm" })
          .then(() => updateDoc(doc(db, P.meeting(caseId, meetingId)), { audioParts: arrayUnion(path) }))
          .catch((e) => toast(`録音の保存に失敗しました: ${errorMessage(e)}`));
      },
      onAudioSeconds: (sec) => void api.reportAudioUsage({ caseId, meetingId, seconds: sec }).catch(() => undefined),
    }),
    [caseId, meetingId, toast],
  );

  const startMic = async () => {
    if (!c?.consent?.recording || !c?.consent?.aiAnalysis) return toast("録音・AI利用の同意が記録されていません。案件画面で同意を記録してください。");
    setBusy(true);
    try {
      const probe = await api.createTranscriptionSession({ caseId, meetingId });
      if (probe.mode === "mock") {
        toast(`マイクでの文字起こしは利用できません（${probe.reason}）。「デモ再生」で動作を確認できます。`);
        return;
      }
      pipeline.current = makePipeline();
      let first: typeof probe | null = probe;
      const probedAt = Date.now();
      // Gemini SDK は録音開始時にだけ読み込む（初期表示を軽くする）
      const { GeminiTranscriber } = await import("../live/geminiTranscriber");
      const tr = new GeminiTranscriber(async (handle) => {
        // 最初の接続は確認時のチケットを使う（マイク許可に時間がかかって1分を過ぎたら取り直す）
        if (first && !handle && Date.now() - probedAt < 60_000) {
          const p = first;
          first = null;
          return p;
        }
        return api.createTranscriptionSession({ caseId, meetingId, resumeHandle: handle });
      }, events());
      transcriber.current = tr;
      await tr.start();
    } catch (e) {
      setState("error");
      setStateMsg(errorMessage(e));
      toast(errorMessage(e));
      await transcriber.current?.stop().catch(() => undefined);
      transcriber.current = null;
    } finally {
      setBusy(false);
    }
  };

  const startDemo = async () => {
    pipeline.current = makePipeline();
    const speed = Number(new URLSearchParams(window.location.search).get("demoSpeed")) || 1;
    const tr = new DemoTranscriber(events(), undefined, speed);
    transcriber.current = tr;
    await tr.start();
  };

  const stop = async () => {
    await transcriber.current?.stop();
    transcriber.current = null;
  };

  useEffect(() => () => void transcriber.current?.stop(), []);

  // ---- 派生データ ----
  const checks = checkItems.data;
  const stats = completionStats(checks);
  const activeDocs = documents.data.filter((d) => !["not_needed", "removal_candidate"].includes(d.status));
  const ranked = useMemo(() => rankQuestions(checks, m?.aiQuestions ?? []), [checks, m?.aiQuestions]);
  const nextQs = ranked.filter((q) => !asked.has(q.key));
  // 左側で選んだ項目の根拠発言（複数）を右側で淡く強調
  const [evidenceIds, setEvidenceIds] = useState<string[]>([]);
  const highlighted = useMemo(() => new Set(evidenceIds), [evidenceIds]);
  const selectedRelated = useMemo(() => {
    if (!selected) return { checks: 0, docs: 0, entities: 0 };
    return {
      checks: checks.filter((x) => x.evidenceSegmentIds.includes(selected)).length,
      docs: documents.data.filter((x) => x.evidenceSegmentIds.includes(selected)).length,
      entities: entities.data.filter((x) => x.evidenceSegmentIds.includes(selected)).length,
    };
  }, [selected, checks, documents.data, entities.data]);

  const showEvidence = (ids: string[]) => {
    const id = ids.find((x) => segRefs.current.has(x));
    if (!id) return toast(ids.length ? "根拠の発言は別の面談のものです。" : "根拠となる発言はありません。", "info");
    segRefs.current.get(id)!.scrollIntoView({ behavior: "smooth", block: "center" });
    setEvidenceIds(ids);
    setSelected(null);
    setFlash(null);
    requestAnimationFrame(() => setFlash(id));
  };

  const act = async (f: () => Promise<unknown>) => {
    try {
      await f();
    } catch (e) {
      toast(errorMessage(e));
    }
  };
  const onStatus = (item: CheckItem, status: CheckStatus, answer?: string | null) => act(() => api.updateCheckItem({ caseId, itemId: item.id, status, ...(answer !== undefined ? { answer } : {}) }));
  const onDoc = (d: DocumentRequirement, patch: { status?: DocStatus; dueDate?: string | null; submitter?: string | null; remarks?: string | null; clearReview?: boolean }) => act(() => api.updateDocument({ caseId, docId: d.id, ...patch }));
  const onEntity = (e: Entity, action: "confirm" | "reject" | "unlock") => act(() => api.updateEntity({ caseId, entityId: e.id, action }));
  const onReview = (r: ReviewItem, decision: "approve" | "reject") => act(() => api.resolveReviewItem({ caseId, reviewItemId: r.id, decision }));
  const onSpeaker = (s: TranscriptSegment, speaker: TranscriptSegment["speaker"], all: boolean) => act(() => api.setSegmentSpeaker({ caseId, meetingId, segmentId: s.id, speaker, applyToLabel: all }));

  const endMeeting = async (force: boolean) => {
    setBusy(true);
    try {
      if (live) await stop();
      const r = await api.endMeeting({ caseId, meetingId, force });
      if (!r.ended) setEndWarn(r.warnings);
      else {
        setEndWarn(null);
        toast("面談を終了しました。全体の再点検（再解析）を開始します。", "info");
        const re = await api.reanalyzeMeeting({ caseId, meetingId });
        toast(`再解析が完了しました。追加確認候補 ${re.reviewItems} 件を「未確認・追加質問」タブに表示しています。`, "info");
        setTab("open");
      }
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (caseDoc.error || meeting.error) return <div className="p-8 text-red-700">{caseDoc.error ?? meeting.error}</div>;
  if (!c || !m) return <div className="p-8 text-slate-500">読み込み中…</div>;
  const ended = m.status === "ended";

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      {/* ===== 上部: 案件情報 ===== */}
      <header className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b bg-white px-4 py-2 text-sm">
        <Link to="/" data-testid="back-to-list" className="rounded-lg border px-2 py-1 text-slate-600 hover:bg-slate-50">← 案件一覧</Link>
        <Link to={`/cases/${caseId}`} className="font-bold text-slate-800 hover:underline" title="案件の詳細へ">{c.name}</Link>
        <span>被相続人 <b>{c.decedentName}</b></span>
        <span>相続開始日 <b>{c.inheritanceStartDate ?? "未入力"}</b></span>
        <span>担当 <b>{m.interviewer}</b></span>
        <span>開始 {fmtDateTime(m.startedAt)}</span>
        <span>経過 <b className="tabular-nums">{fmtElapsed(m.startedAt, ended && m.endedAt ? new Date(m.endedAt).getTime() : now)}</b></span>
        <span data-testid="completion">確認完了率 <b>{pct(stats.confirmedRate)}</b><span className="text-slate-400">（話題済 {pct(stats.coveredRate)}）</span></span>
        <span data-testid="doc-count">必要資料 <b>{activeDocs.length}</b>件</span>
        <span>未確認 <b className={stats.highOpen ? "text-red-600" : ""}>{stats.open}</b>件</span>
        {lastLatency && (
          <span className="text-xs text-slate-500" title="発話確定から資料リスト反映まで（直近）">
            反映 {(lastLatency.total / 1000).toFixed(1)}秒{lastLatency.ai ? `（AI ${(lastLatency.ai / 1000).toFixed(1)}秒）` : ""}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {!ended && canEdit && !live && (
            <>
              <button data-testid="start-mic" disabled={busy} onClick={startMic} className="rounded-lg bg-red-600 px-3 py-1.5 font-medium text-white hover:bg-red-700 disabled:opacity-50">● 録音開始</button>
              <button data-testid="start-demo" disabled={busy} onClick={startDemo} className="rounded-lg border px-3 py-1.5 hover:bg-slate-50">デモ再生</button>
            </>
          )}
          {live && (
            <button data-testid="stop" onClick={stop} className="rounded-lg bg-slate-800 px-3 py-1.5 font-medium text-white hover:bg-slate-700" title="停止中は文字起こしの料金はかかりません。「録音開始」で再開できます">
              {transcriber.current instanceof DemoTranscriber ? "■ デモ停止" : "■ 録音停止"}
            </button>
          )}
          {!ended && canEdit && <button data-testid="end-meeting" disabled={busy} onClick={() => endMeeting(false)} className="rounded-lg border border-slate-400 px-3 py-1.5">面談終了</button>}
          {ended && canEdit && (
            <button disabled={busy || m.reanalysis?.status === "running"} onClick={() => act(async () => toast(`追加確認候補 ${(await api.reanalyzeMeeting({ caseId, meetingId })).reviewItems} 件`, "info"))} className="rounded-lg border px-3 py-1.5">
              {m.reanalysis?.status === "running" ? "再解析中…" : "全文を再解析"}
            </button>
          )}
          <Link to={`/cases/${caseId}/print`} className="rounded-lg border px-3 py-1.5">資料依頼書</Link>
        </div>
      </header>

      {/* 接続状態 */}
      {(state !== "idle" || ended) && (
        <div
          data-testid="status-bar"
          className={cx(
            "px-4 py-1 text-xs",
            ended ? "bg-slate-200 text-slate-700" : state === "live" ? "bg-green-50 text-green-800" : state === "error" ? "bg-red-100 text-red-800" : state === "reconnecting" ? "bg-amber-100 text-amber-900" : "bg-slate-100 text-slate-700",
          )}
        >
          {ended ? `面談は終了しています（${fmtDateTime(m.endedAt)}）` : <>{state === "live" && <span className="mr-1 inline-block h-2 w-2 animate-pulse rounded-full bg-red-600" />}{stateMsg}</>}
          {m.gaps?.length ? <span className="ml-3 text-amber-800">通信断 {m.gaps.length} 回（録音で照合可）</span> : null}
        </div>
      )}

      {/* ===== 2カラム ===== */}
      <div className="flex min-h-0 flex-1">
        <section className="flex w-[47%] min-w-[520px] flex-col border-r">
          <nav className="flex border-b bg-white text-sm">
            {(
              [
                ["check", `確認事項（未確認 ${stats.open}）`],
                ["docs", `必要資料（${activeDocs.length}）`],
                ["open", `未確認・追加質問（${reviewItems.data.length ? `要確認 ${reviewItems.data.length}・` : ""}${ranked.length}）`],
              ] as [Tab, string][]
            ).map(([k, label]) => (
              <button key={k} data-testid={`tab-${k}`} onClick={() => setTab(k)} className={cx("flex-1 px-3 py-2", tab === k ? "border-b-2 border-blue-600 font-bold text-blue-700" : "text-slate-600 hover:bg-slate-50")}>
                {label}
              </button>
            ))}
          </nav>
          {selected && (
            <div className="flex items-center gap-2 bg-yellow-50 px-3 py-1 text-xs text-yellow-900">
              選択中の発言に対応: 確認事項 {selectedRelated.checks} / 必要資料 {selectedRelated.docs} / 抽出情報 {selectedRelated.entities}
              <button onClick={() => setSelected(null)} className="ml-auto underline">選択解除</button>
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {tab === "check" && <CheckItemsTab items={checks} entities={entities.data} selectedSegmentId={selected} onEvidence={showEvidence} onStatus={onStatus} onEntity={onEntity} canEdit={canEdit} />}
            {tab === "docs" && <DocumentsTab docs={documents.data} selectedSegmentId={selected} onEvidence={showEvidence} onUpdate={onDoc} onAdd={(documentId, target) => act(() => api.addDocument({ caseId, documentId, target }))} canEdit={canEdit} />}
            {tab === "open" && <OpenItemsTab questions={ranked} reviews={reviewItems.data} onEvidence={showEvidence} onReview={onReview} canEdit={canEdit} />}
          </div>
        </section>
        <section className="flex min-w-0 flex-1 flex-col">
          <TranscriptPanel
            segments={segments.data}
            interim={interim}
            selectedId={selected}
            highlightedIds={highlighted}
            flashId={flash}
            onSelect={(id) => {
              setSelected(id);
              setEvidenceIds([]);
            }}
            onSpeaker={onSpeaker}
            onRetry={(segs) => {
              pipeline.current ??= makePipeline();
              pipeline.current.retry(segs);
            }}
            registerRef={(id, el) => (el ? segRefs.current.set(id, el) : segRefs.current.delete(id))}
            canEdit={canEdit}
          />
        </section>
      </div>

      {/* ===== 下部: 次の質問 ===== */}
      {!ended && <NextQuestionsBar questions={nextQs} onAsked={(q: RankedQuestion) => setAsked(new Set([...asked, q.key]))} />}

      {/* 面談終了時の警告 */}
      {endWarn && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="max-h-[80vh] w-[640px] overflow-y-auto rounded-xl bg-white p-6 shadow-xl" data-testid="end-warning">
            <h2 className="text-lg font-bold text-red-700">まだ確認していない重要事項があります</h2>
            <ul className="mt-3 list-disc space-y-0.5 pl-5 text-sm">
              {endWarn.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
            <p className="mt-3 text-sm text-slate-600">このまま終了しても内容は保存され、次回の面談で引き続き確認できます。</p>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setEndWarn(null)} className="rounded-lg border px-4 py-2">面談に戻る</button>
              <button data-testid="force-end" disabled={busy} onClick={() => endMeeting(true)} className="rounded-lg bg-red-600 px-4 py-2 text-white">このまま終了する</button>
            </div>
          </div>
        </div>
      )}

      <div className="fixed bottom-24 left-4 z-40 space-y-2">
        {toasts.map((t) => (
          <div key={t.id} className={cx("max-w-md rounded-lg px-4 py-2 text-sm shadow-lg", t.level === "error" ? "bg-red-600 text-white" : "bg-slate-800 text-white")}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}
