export type TranscriberState = "idle" | "starting" | "connecting" | "live" | "reconnecting" | "stopped" | "error";

export interface FinalInfo {
  speakerLabel: string | null;
  speaker?: "staff" | "client" | null; // デモ再生時のみ確定
  speechStartAt: number | null;
  interimShownAt: number | null;
  finalAt: number;
}

export interface TranscriberEvents {
  onInterim: (text: string, at: number) => void;
  onFinal: (text: string, info: FinalInfo) => void;
  onState: (state: TranscriberState, message?: string) => void;
  /** 通信断の区間（重複・欠落の事後確認用） */
  onGap: (gap: { from: number; to: number | null; reason: string }) => void;
  onRecordingChunk?: (blob: Blob, index: number) => void;
  onAudioSeconds?: (seconds: number) => void;
}

export interface Transcriber {
  start(): Promise<void>;
  stop(): Promise<void>;
}
