import { DEMO_SCRIPT, type DemoLine } from "@mendan/shared";
import type { Transcriber, TranscriberEvents } from "./types";

/**
 * デモ再生（架空の面談）。マイク・Gemini なしで、暫定→確定の文字起こしの流れを再現する。
 * 解析・ルール判定・画面更新は本番と同じ経路を通る。
 */
export class DemoTranscriber implements Transcriber {
  private stopped = false;

  constructor(
    private readonly ev: TranscriberEvents,
    private readonly script: DemoLine[] = DEMO_SCRIPT,
    private readonly speed = 1,
  ) {}

  async start() {
    this.stopped = false;
    this.ev.onState("live", "デモ再生中（架空の面談）");
    void this.play();
  }

  private sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms / this.speed));
  }

  private async play() {
    for (const line of this.script) {
      if (this.stopped) return;
      const speechStartAt = Date.now();
      let interimShownAt: number | null = null;
      // 1文字ずつ話しているかのように暫定テキストを出す
      for (let i = 2; i <= line.text.length; i += 3) {
        if (this.stopped) return;
        await this.sleep(110);
        interimShownAt ??= Date.now();
        this.ev.onInterim(line.text.slice(0, i), Date.now());
      }
      await this.sleep(400);
      this.ev.onInterim("", Date.now());
      this.ev.onFinal(line.text, { speakerLabel: null, speaker: line.speaker, speechStartAt, interimShownAt, finalAt: Date.now() });
      await this.sleep(line.pauseMs ?? 1200);
    }
    if (!this.stopped) this.ev.onState("stopped", "デモ再生が終わりました");
  }

  async stop() {
    this.stopped = true;
    this.ev.onState("stopped", "停止しました");
  }
}
