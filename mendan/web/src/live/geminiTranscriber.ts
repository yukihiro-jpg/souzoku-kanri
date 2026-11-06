import { GoogleGenAI, type LiveServerMessage, type Session } from "@google/genai";
import type { TranscriptionSession } from "../lib/api";
import { AudioCapture, toBase64, type AudioFrame } from "./audio";
import type { Transcriber, TranscriberEvents } from "./types";

/**
 * Gemini Live 文字起こし（gemini-3.5-transcribe-live）
 *
 *  - ブラウザから Gemini へ直接 WebSocket 接続（遅延最小）。認可はサーバー発行の一時トークン（APIキーは渡さない）
 *  - 暫定テキスト（interimInputTranscription）を即時表示し、確定（inputTranscription.finished）で置き換える
 *  - 確定済みの文を重複して確定しない（同じ確定文は1回だけ通知。最終判定は SegmentPipeline）
 *  - 切断時は自動再接続。セッション再開ハンドル（transparent）で未処理の音声を再送し、欠落を防ぐ
 *  - 再開できない場合も切断中の音声をバッファから送り直し、それでも欠落した区間は「通信断」として記録
 *  - 接続中なのに文字起こしが返らない状態（無応答）を検知して再接続する
 */

const MAX_BUFFER_FRAMES = 600; // 100ms × 600 = 60秒
const FINAL_FLUSH_MS = 2500; // finished が来ない場合の確定待ち
const STALL_MS = 15_000; // 発話があるのに応答がない時間

interface Buffered {
  index: number;
  data: string;
}

export class GeminiTranscriber implements Transcriber {
  private audio = new AudioCapture();
  private session: Session | null = null;
  private connected = false;
  private stopping = false;
  private resumeHandle: string | null = null;
  private msgIndex = 0;
  private lastConsumed = -1;
  private buffer: Buffered[] = [];
  private interim = "";
  private pendingFinal = "";
  private pendingSpeaker: string | null = null;
  private speechStartAt: number | null = null;
  private interimShownAt: number | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private lastServerAt = Date.now();
  private lastVoiceAt = 0;
  private disconnectedAt: number | null = null;
  private retry = 0;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private audioMs = 0;
  private reconnecting = false;
  private lastFinalIndex = -1;

  constructor(
    private readonly getSession: (resumeHandle: string | null) => Promise<TranscriptionSession>,
    private readonly ev: TranscriberEvents,
  ) {}

  async start() {
    this.stopping = false;
    this.ev.onState("starting", "マイクの許可を確認しています…");
    await this.audio.start((f) => this.onFrame(f), this.ev.onRecordingChunk);
    await this.connect();
    this.watchdog = setInterval(() => this.checkStall(), 3000);
  }

  private async connect() {
    this.ev.onState(this.disconnectedAt ? "reconnecting" : "connecting", this.disconnectedAt ? "再接続しています…" : "音声認識に接続しています…");
    const info = await this.getSession(this.resumeHandle);
    if (info.mode !== "gemini") throw new Error(`音声認識が利用できません（${info.reason}）`);
    const ai = new GoogleGenAI({ apiKey: info.token, httpOptions: { apiVersion: "v1alpha" } });
    const resumed = !!this.resumeHandle;
    this.session = await ai.live.connect({
      model: info.model,
      config: info.config,
      callbacks: {
        onopen: () => undefined,
        onmessage: (m: LiveServerMessage) => this.onMessage(m),
        onerror: (e: ErrorEvent) => this.ev.onState("error", `音声認識の通信エラー: ${e.message ?? ""}`),
        onclose: (e: CloseEvent) => this.onClose(e),
      },
    });
    this.connected = true;
    this.retry = 0;
    this.lastServerAt = Date.now();
    // 切断中・未処理の音声を送り直す（再開時は最後に処理された位置以降のみ）
    // 再開できない新規セッションでは、最後に確定した文より後の音声だけを送る（同じ文の二重確定を防ぐ）
    const resend = this.buffer.filter((b) => b.index === -1 || (resumed ? b.index > this.lastConsumed : b.index > this.lastFinalIndex));
    this.buffer = this.buffer.filter((b) => !resend.includes(b));
    for (const b of resend) this.sendAudio(b.data, true);
    if (this.disconnectedAt) {
      const lostMs = Date.now() - this.disconnectedAt;
      const covered = resend.length * 100;
      if (lostMs - covered > 1500) this.ev.onGap({ from: this.disconnectedAt, to: Date.now(), reason: `通信断（約${Math.round((lostMs - covered) / 1000)}秒の音声が文字起こしされていない可能性。録音で確認できます）` });
      this.disconnectedAt = null;
    }
    this.ev.onState("live", resumed ? "再接続しました（セッションを再開）" : "録音・文字起こし中");
  }

  private onFrame(f: AudioFrame) {
    this.audioMs += 100;
    if (this.audioMs % 60_000 === 0) this.ev.onAudioSeconds?.(60);
    if (f.rms > 0.02) this.lastVoiceAt = f.at;
    const data = toBase64(f.pcm);
    if (this.connected && this.session) this.sendAudio(data, true);
    else {
      this.buffer.push({ index: -1, data });
      if (this.buffer.length > MAX_BUFFER_FRAMES) this.buffer.shift();
    }
  }

  private sendAudio(data: string, keep: boolean) {
    try {
      this.session!.sendRealtimeInput({ audio: { data, mimeType: "audio/pcm;rate=16000" } });
      const index = this.msgIndex++;
      if (keep) {
        this.buffer.push({ index, data });
        if (this.buffer.length > MAX_BUFFER_FRAMES) this.buffer.shift();
      }
    } catch {
      this.buffer.push({ index: -1, data });
    }
  }

  private onMessage(m: LiveServerMessage) {
    this.lastServerAt = Date.now();
    const sc = m.serverContent;
    if (sc?.interimInputTranscription?.text) {
      const t = sc.interimInputTranscription.text;
      // 暫定テキストは表示専用（確定テキストで置き換わる）
      this.interim = t;
      if (!this.speechStartAt) this.speechStartAt = Date.now() - 300;
      if (!this.interimShownAt) this.interimShownAt = Date.now();
      this.ev.onInterim(this.pendingFinal + this.interim, Date.now());
    }
    const it = sc?.inputTranscription;
    if (it?.text) {
      this.pendingFinal += it.text;
      this.pendingSpeaker = it.speakerLabel ?? this.pendingSpeaker;
      if (!this.speechStartAt) this.speechStartAt = Date.now() - 500;
      this.interim = "";
      this.ev.onInterim(this.pendingFinal, Date.now());
      this.scheduleFlush();
    }
    if (it?.finished || sc?.turnComplete) this.flushFinal();
    const r = m.sessionResumptionUpdate;
    if (r?.resumable && r.newHandle) {
      this.resumeHandle = r.newHandle;
      if (r.lastConsumedClientMessageIndex) {
        this.lastConsumed = Number(r.lastConsumedClientMessageIndex);
        this.buffer = this.buffer.filter((b) => b.index > this.lastConsumed || b.index === -1);
      }
    }
    if (m.goAway) {
      // まもなくサーバーが切断する → 再開ハンドルで先回りして再接続
      void this.reconnect("サーバーの接続時間上限のため再接続");
    }
  }

  private scheduleFlush() {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => this.flushFinal(), FINAL_FLUSH_MS);
  }

  private flushFinal() {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    const text = this.pendingFinal.trim();
    if (text) {
      this.lastFinalIndex = this.msgIndex - 1;
      this.ev.onFinal(text, { speakerLabel: this.pendingSpeaker, speechStartAt: this.speechStartAt, interimShownAt: this.interimShownAt, finalAt: Date.now() });
    }
    this.pendingFinal = "";
    this.pendingSpeaker = null;
    this.interim = "";
    this.speechStartAt = null;
    this.interimShownAt = null;
    this.ev.onInterim("", Date.now());
  }

  private onClose(e: CloseEvent) {
    this.connected = false;
    this.session = null;
    if (this.stopping) return;
    this.disconnectedAt ??= Date.now();
    this.flushFinal();
    void this.reconnect(`切断されました（${e.code}${e.reason ? `: ${e.reason}` : ""}）`);
  }

  private async reconnect(reason: string) {
    if (this.stopping || this.reconnecting) return;
    this.reconnecting = true;
    try {
      if (this.session) {
        const s = this.session;
        this.session = null;
        this.connected = false;
        this.disconnectedAt ??= Date.now();
        try {
          s.close();
        } catch {
          /* noop */
        }
      }
      while (!this.stopping) {
        const wait = Math.min(10_000, 500 * 2 ** this.retry);
        this.ev.onState("reconnecting", `${reason}。${Math.round(wait / 100) / 10}秒後に再接続します（${this.retry + 1}回目）`);
        await new Promise((r) => setTimeout(r, wait));
        try {
          await this.connect();
          return;
        } catch (err) {
          this.retry++;
          // 再開ハンドルが無効になった場合は新規セッションで接続
          if (this.retry >= 2) this.resumeHandle = null;
          reason = `再接続に失敗: ${(err as Error).message}`;
        }
      }
    } finally {
      this.reconnecting = false;
    }
  }

  private checkStall() {
    if (!this.connected || this.stopping) return;
    const now = Date.now();
    if (now - this.lastVoiceAt < 5000 && now - this.lastServerAt > STALL_MS) {
      this.disconnectedAt ??= this.lastServerAt;
      void this.reconnect("音声認識から応答がないため再接続");
    }
  }

  async stop() {
    this.stopping = true;
    if (this.watchdog) clearInterval(this.watchdog);
    this.audio.stop();
    try {
      this.session?.sendRealtimeInput({ audioStreamEnd: true });
    } catch {
      /* noop */
    }
    await new Promise((r) => setTimeout(r, 800)); // 最後の確定を待つ
    this.flushFinal();
    try {
      this.session?.close();
    } catch {
      /* noop */
    }
    this.session = null;
    this.connected = false;
    const rest = (this.audioMs % 60_000) / 1000;
    if (rest > 0) this.ev.onAudioSeconds?.(rest);
    this.ev.onState("stopped", "録音を停止しました");
  }
}
