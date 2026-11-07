import { defineSecret, defineString } from "firebase-functions/params";

/**
 * 環境ごとに変わる設定。
 *  - 秘密情報（APIキー）は Secret Manager（defineSecret）に保存し、ブラウザには一切渡さない。
 *  - それ以外は functions/.env（.env.<projectId>）で設定する。
 * モデルIDはコードに固定せず、ここで差し替えられるようにしている。
 */
export const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");
export const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

export const REGION = "asia-northeast1";

/** claude: Claude API を使う / mock: 開発用の簡易解析器（APIキー不要） */
export const AI_MODE = defineString("AI_MODE", { default: "claude" });
/**
 * 文字起こしの接続方式
 *  vertex: Google Cloud の Vertex AI（後払い）。中継サーバー（Cloud Run）経由で接続する（既定）
 *  gemini: AI Studio の Gemini API（前払い）。一時トークンでブラウザから直接接続する
 *  mock  : マイクを使わないデモ文字起こしのみ
 */
export const TRANSCRIBE_MODE = defineString("TRANSCRIBE_MODE", { default: "vertex" });
/** 中継サーバー（Cloud Run）の URL（例: https://transcribe-relay-xxxxx-an.a.run.app） */
export const RELAY_URL = defineString("RELAY_URL", { default: "" });

export const CLAUDE_MODEL_REALTIME = defineString("CLAUDE_MODEL_REALTIME", { default: "claude-sonnet-5-5" });
export const CLAUDE_MODEL_REVIEW = defineString("CLAUDE_MODEL_REVIEW", { default: "claude-sonnet-5-5" });
/** low | medium | high | xhigh | max */
export const CLAUDE_EFFORT_REALTIME = defineString("CLAUDE_EFFORT_REALTIME", { default: "low" });
export const CLAUDE_EFFORT_REVIEW = defineString("CLAUDE_EFFORT_REVIEW", { default: "high" });
/** "default" = 安全判定で回答が止まった場合にAnthropic側で自動的に別モデルで再実行 / "off" */
export const CLAUDE_FALLBACKS = defineString("CLAUDE_FALLBACKS", { default: "default" });
/** 料金表（USD / 100万トークン）。変更時は JSON で上書き */
export const CLAUDE_PRICING_JSON = defineString("CLAUDE_PRICING_JSON", { default: "" });

export const GEMINI_MODEL = defineString("GEMINI_MODEL", { default: "gemini-3.5-transcribe-live" });
export const GEMINI_LANGUAGE = defineString("GEMINI_LANGUAGE", { default: "ja-JP" });
/** 発言を省略しない VERBATIM を原則とする（SMART は言い淀み等を除去するため使わない） */
export const GEMINI_TRANSCRIPTION_MODE = defineString("GEMINI_TRANSCRIPTION_MODE", { default: "VERBATIM" });
export const GEMINI_DIARIZATION = defineString("GEMINI_DIARIZATION", { default: "false" });
export const GEMINI_SESSION_RESUMPTION = defineString("GEMINI_SESSION_RESUMPTION", { default: "true" });
export const GEMINI_RESPONSE_MODALITIES = defineString("GEMINI_RESPONSE_MODALITIES", { default: "TEXT" });
export const GEMINI_SILENCE_MS = defineString("GEMINI_SILENCE_MS", { default: "" });
export const GEMINI_VOCAB_LIMIT = defineString("GEMINI_VOCAB_LIMIT", { default: "100" });
/** Gemini の概算単価（USD / 音声1時間）。公式料金表で確認のうえ設定する */
export const GEMINI_USD_PER_AUDIO_HOUR = defineString("GEMINI_USD_PER_AUDIO_HOUR", { default: "0.54" });

/** ログインを許可する Google Workspace のドメイン（カンマ区切り） */
export const ALLOWED_EMAIL_DOMAINS = defineString("ALLOWED_EMAIL_DOMAINS", { default: "" });
/**
 * ログインを許可するメールアドレス（カンマ区切り）。設定した場合は、ドメインが合っていても
 * ここに書いたアドレス以外は利用できない（空欄 = 許可ドメインの全員が利用可）
 */
export const ALLOWED_EMAILS = defineString("ALLOWED_EMAILS", { default: "" });
/** 初回ログイン時に管理者にするメールアドレス（カンマ区切り） */
export const ADMIN_EMAILS = defineString("ADMIN_EMAILS", { default: "" });

export function secretValue(s: ReturnType<typeof defineSecret>): string | null {
  try {
    const v = s.value();
    return v && v !== "unset" ? v : null;
  } catch {
    return null;
  }
}

export interface ModelPrice {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** 2026-10 時点の Anthropic 公開料金（USD/100万トークン）。CLAUDE_PRICING_JSON で上書き可 */
const DEFAULT_PRICING: Record<string, ModelPrice> = {
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
};

export function pricing(model: string): ModelPrice | null {
  let table = DEFAULT_PRICING;
  const raw = CLAUDE_PRICING_JSON.value();
  if (raw) {
    try {
      table = { ...DEFAULT_PRICING, ...JSON.parse(raw) };
    } catch {
      /* 不正なJSONは無視して既定値 */
    }
  }
  return table[model] ?? null;
}

export const bool = (v: string) => /^(1|true|yes|on)$/i.test(v.trim());
