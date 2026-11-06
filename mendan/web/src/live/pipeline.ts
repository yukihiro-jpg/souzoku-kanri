import { doc, setDoc, updateDoc } from "firebase/firestore";
import { P, segmentId, similarText, type TranscriptSegment } from "@mendan/shared";
import { api, errorMessage } from "../lib/api";
import { db } from "../lib/firebase";
import type { FinalInfo } from "./types";

/**
 * 確定発言の保存と AI 解析の送信
 *
 *  - 発言IDは「面談ID＋連番」で決定的 → 同じ発言の二重保存はセキュリティルールで拒否される
 *  - 再接続直後などに同じ文が再度確定した場合は「重複の疑い」として保存し、解析対象から外す
 *  - 短い発言（「はい」等）は直後の発言とまとめて送る（前後の文脈を一緒に解析するため）
 *  - 待ち時間は最大1.2秒。同時に2件まで並行して解析し、AIが遅れても文字起こしは止めない
 */

const MIN_CHARS = 14;
const DEBOUNCE_MS = 500;
const MAX_WAIT_MS = 1200;
const MAX_INFLIGHT = 2;

export interface JobTimings {
  segmentIds: string[];
  finalAt: number;
  speechStartAt: number | null;
  interimShownAt: number | null;
  requestedAt: number;
  resultReceivedAt?: number;
  docListUpdatedAt?: number;
}

export interface PipelineCallbacks {
  onError: (message: string) => void;
  onJobDone: (jobId: string | null, t: JobTimings, info: { skipped?: string; aiMs?: number; serverMs?: number; budget?: string }) => void;
  onPendingChange?: (pending: number, inflight: number) => void;
}

interface Pending {
  id: string;
  text: string;
  info: FinalInfo;
}

export class SegmentPipeline {
  private seq: number;
  private queue: Pending[] = [];
  private inflight = 0;
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private firstQueuedAt: number | null = null;
  private recent: { id: string; text: string; at: number }[] = [];
  private writes: Promise<unknown> = Promise.resolve();
  aiEnabled = true;

  constructor(
    private readonly caseId: string,
    private readonly meetingId: string,
    private readonly uid: string,
    lastSeq: number,
    private readonly cb: PipelineCallbacks,
    private readonly speakerOf: (label: string | null) => TranscriptSegment["speaker"] = () => "unknown",
  ) {
    this.seq = lastSeq;
  }

  /** 確定した発言を受け取る */
  addFinal(text: string, info: FinalInfo) {
    const seq = ++this.seq;
    const id = segmentId(this.meetingId, seq);
    const dup = this.recent.find((r) => info.finalAt - r.at < 20_000 && similarText(r.text, text));
    const speaker = info.speaker ?? this.speakerOf(info.speakerLabel);
    const seg: TranscriptSegment = {
      id,
      caseId: this.caseId,
      meetingId: this.meetingId,
      seq,
      speaker,
      speakerLabel: info.speakerLabel,
      speakerConfirmed: !!info.speaker,
      text,
      final: true,
      kind: "speech",
      suspectedDuplicateOf: dup?.id ?? null,
      analysisStatus: dup || !this.aiEnabled ? "skipped" : "pending",
      analysisJobId: null,
      timings: { speechStartAt: info.speechStartAt, interimShownAt: info.interimShownAt, finalAt: info.finalAt },
      createdAt: new Date(info.finalAt).toISOString(),
      createdBy: this.uid,
    };
    this.recent.push({ id, text, at: info.finalAt });
    if (this.recent.length > 10) this.recent.shift();
    // 保存は順番に（サーバー確定後に解析を依頼する）
    const write = this.writes.then(() => setDoc(doc(db, P.segment(this.caseId, this.meetingId, id)), seg));
    this.writes = write.catch((e) => this.cb.onError(`発言の保存に失敗しました: ${errorMessage(e)}`));
    void updateDoc(doc(db, P.meeting(this.caseId, this.meetingId)), { lastSeq: seq }).catch(() => undefined);
    if (dup || !this.aiEnabled) return;
    this.queue.push({ id, text, info });
    this.firstQueuedAt ??= Date.now();
    this.schedule();
  }

  /** 通信断などのシステム記録 */
  addSystem(text: string) {
    const seq = ++this.seq;
    const id = segmentId(this.meetingId, seq);
    const seg: TranscriptSegment = {
      id,
      caseId: this.caseId,
      meetingId: this.meetingId,
      seq,
      speaker: "other",
      speakerLabel: null,
      speakerConfirmed: true,
      text,
      final: true,
      kind: "system",
      analysisStatus: "skipped",
      timings: { finalAt: Date.now() },
      createdAt: new Date().toISOString(),
      createdBy: this.uid,
    };
    this.writes = this.writes.then(() => setDoc(doc(db, P.segment(this.caseId, this.meetingId, id)), seg)).catch((e) => this.cb.onError(errorMessage(e)));
  }

  private schedule() {
    if (this.debounce) clearTimeout(this.debounce);
    const chars = this.queue.reduce((n, p) => n + p.text.length, 0);
    const waited = Date.now() - (this.firstQueuedAt ?? Date.now());
    const ready = chars >= MIN_CHARS || waited >= MAX_WAIT_MS;
    if (ready && this.inflight < MAX_INFLIGHT) {
      void this.flush();
      return;
    }
    this.debounce = setTimeout(() => (this.inflight < MAX_INFLIGHT ? void this.flush() : this.schedule()), ready ? 150 : Math.min(DEBOUNCE_MS, MAX_WAIT_MS - waited));
  }

  private async flush() {
    if (this.queue.length === 0) return;
    const batch = this.queue.splice(0, 20);
    this.firstQueuedAt = this.queue.length ? Date.now() : null;
    this.inflight++;
    this.cb.onPendingChange?.(this.queue.length, this.inflight);
    const ids = batch.map((b) => b.id);
    const last = batch[batch.length - 1].info;
    const t: JobTimings = { segmentIds: ids, finalAt: last.finalAt, speechStartAt: batch[0].info.speechStartAt, interimShownAt: batch[0].info.interimShownAt, requestedAt: 0 };
    try {
      await this.writes; // 発言の保存完了を待つ
      t.requestedAt = Date.now();
      const r = await this.callWithRetry(ids, t.requestedAt);
      t.resultReceivedAt = Date.now();
      this.cb.onJobDone(r.jobId, t, r);
    } catch (e) {
      this.cb.onError(`AI解析に失敗しました（発言は保存済みです。面談後の再解析または「再解析」で補完できます）: ${errorMessage(e)}`);
    } finally {
      this.inflight--;
      this.cb.onPendingChange?.(this.queue.length, this.inflight);
      if (this.queue.length) this.schedule();
    }
  }

  private async callWithRetry(ids: string[], at: number) {
    try {
      return await api.analyzeSegments({ caseId: this.caseId, meetingId: this.meetingId, segmentIds: ids, clientRequestedAt: at });
    } catch (e) {
      const code = (e as { code?: string }).code ?? "";
      if (/unavailable|deadline|internal/.test(code)) {
        await new Promise((r) => setTimeout(r, 1500));
        return api.analyzeSegments({ caseId: this.caseId, meetingId: this.meetingId, segmentIds: ids, clientRequestedAt: Date.now() });
      }
      throw e;
    }
  }

  /** 解析エラー・未解析の発言を手動で再送 */
  retry(segments: TranscriptSegment[]) {
    for (const s of segments) this.queue.push({ id: s.id, text: s.text, info: { speakerLabel: s.speakerLabel, speechStartAt: null, interimShownAt: null, finalAt: s.timings.finalAt } });
    this.firstQueuedAt ??= Date.now() - MAX_WAIT_MS;
    this.schedule();
  }

  /** 画面反映時刻などの計測値を記録（P50/P95 集計用） */
  static async reportTimings(caseId: string, jobId: string, t: JobTimings) {
    try {
      await updateDoc(doc(db, `${P.aiJobs(caseId)}/${jobId}`), {
        clientTimings: {
          speechStartAt: t.speechStartAt,
          interimShownAt: t.interimShownAt,
          finalAt: t.finalAt,
          requestedAt: t.requestedAt,
          resultReceivedAt: t.resultReceivedAt ?? null,
          docListUpdatedAt: t.docListUpdatedAt ?? null,
        },
      });
    } catch {
      /* 計測値の記録失敗は無視 */
    }
  }
}
