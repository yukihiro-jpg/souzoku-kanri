/**
 * マイク音声の取得
 *  - Gemini 送信用: 16kHz / 16bit PCM / モノラル、100ms ごとのフレーム（AudioWorklet で変換）
 *  - 事後照合用の録音: MediaRecorder（webm/opus）を30秒ごとに分割してアップロード
 */

const WORKLET = `
class PcmCapture extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Int16Array(1600); this.n = 0; this.sum = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      const s = Math.max(-1, Math.min(1, ch[i]));
      this.buf[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      this.sum += s * s;
      if (this.n === this.buf.length) {
        const rms = Math.sqrt(this.sum / this.n);
        this.port.postMessage({ pcm: this.buf.buffer, rms }, [this.buf.buffer]);
        this.buf = new Int16Array(1600); this.n = 0; this.sum = 0;
      }
    }
    return true;
  }
}
registerProcessor("pcm-capture", PcmCapture);
`;

export interface AudioFrame {
  pcm: ArrayBuffer; // Int16 LE 16kHz mono, 100ms
  rms: number;
  at: number;
}

export class AudioCapture {
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private recorder: MediaRecorder | null = null;
  stream: MediaStream | null = null;

  /** マイク許可を求めて開始。拒否された場合は分かりやすいエラーにする */
  async start(onFrame: (f: AudioFrame) => void, onRecordingChunk?: (blob: Blob, index: number) => void): Promise<void> {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (e) {
      const name = (e as DOMException)?.name;
      if (name === "NotAllowedError") throw new Error("マイクの使用が許可されていません。ブラウザのアドレスバー左のアイコンからマイクを許可してください。");
      if (name === "NotFoundError") throw new Error("マイクが見つかりません。接続を確認してください。");
      throw new Error(`マイクを開始できません: ${(e as Error).message}`);
    }
    // ブラウザが 16kHz へリサンプリングする
    this.ctx = new AudioContext({ sampleRate: 16000 });
    const url = URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" }));
    await this.ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, "pcm-capture");
    this.node.port.onmessage = (ev: MessageEvent<{ pcm: ArrayBuffer; rms: number }>) => onFrame({ pcm: ev.data.pcm, rms: ev.data.rms, at: Date.now() });
    this.source.connect(this.node);

    if (onRecordingChunk && typeof MediaRecorder !== "undefined") {
      const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"].find((m) => MediaRecorder.isTypeSupported(m));
      this.recorder = new MediaRecorder(this.stream, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : undefined);
      let i = 0;
      this.recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) onRecordingChunk(ev.data, i++);
      };
      this.recorder.start(30_000);
    }
  }

  stop() {
    try {
      this.recorder?.state !== "inactive" && this.recorder?.stop();
    } catch {
      /* noop */
    }
    this.source?.disconnect();
    this.node?.disconnect();
    void this.ctx?.close();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx = null;
    this.node = null;
    this.source = null;
    this.recorder = null;
    this.stream = null;
  }
}

export function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
