import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";

/**
 * Claude 呼び出しの中核（Firebase に依存しない。評価スクリプトからも同じコードを使う）
 * Structured Outputs（output_config.format）で JSON Schema に沿った出力を強制し、
 * SDK の parse() と zod で型検証する。
 */

export class AnalyzerError extends Error {
  constructor(
    message: string,
    readonly code: "not_configured" | "refusal" | "max_tokens" | "invalid_output" | "api_error" | "rate_limited",
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

export interface ClaudeUsage {
  model: string;
  servedModel: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  fallbackUsed: boolean;
}

const clients = new Map<string, Anthropic>();
function getClient(apiKey: string | null): Anthropic {
  if (!apiKey) throw new AnalyzerError("ANTHROPIC_API_KEY が設定されていません", "not_configured", false);
  let c = clients.get(apiKey);
  if (!c) {
    c = new Anthropic({ apiKey, maxRetries: 2 });
    clients.set(apiKey, c);
  }
  return c;
}

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];
export const toEffort = (v: string, d: Effort): Effort => (EFFORTS.includes(v as Effort) ? (v as Effort) : d);

/** サーバー側フォールバック（"default" 形式）に対応するモデル */
const FALLBACK_MODELS = ["claude-sonnet-5-5", "claude-opus-5-5", "claude-opus-5", "claude-fable-5-1"];

export async function callStructured<S extends z.ZodType>(opts: {
  apiKey: string | null;
  fallbacks: boolean;
  model: string;
  effort: Effort;
  system: string;
  user: string;
  schema: S;
  maxTokens: number;
  timeoutMs: number;
}): Promise<{ output: z.infer<S>; usage: ClaudeUsage }> {
  const c = getClient(opts.apiKey);
  const useFallback = opts.fallbacks && FALLBACK_MODELS.includes(opts.model);
  let res;
  try {
    res = await c.beta.messages.parse(
      {
        model: opts.model,
        max_tokens: opts.maxTokens,
        ...(useFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
        thinking: { type: "adaptive" },
        // system は毎回同一 → プロンプトキャッシュ
        system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: opts.user }],
        output_config: { effort: opts.effort, format: betaZodOutputFormat(opts.schema) },
      },
      { timeout: opts.timeoutMs },
    );
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) throw new AnalyzerError("Claude API の利用上限に達しました（一時的）", "rate_limited", true);
    if (e instanceof Anthropic.AuthenticationError) throw new AnalyzerError("Claude API キーが無効です", "not_configured", false);
    if (e instanceof Anthropic.BadRequestError) throw new AnalyzerError(`Claude API リクエストエラー: ${e.message}`, "api_error", false);
    if (e instanceof Anthropic.APIError) throw new AnalyzerError(`Claude API エラー (${e.status ?? "network"}): ${e.message}`, "api_error", true);
    if (e instanceof Error && /JSON|parse|zod/i.test(e.message)) throw new AnalyzerError(`出力の検証に失敗: ${e.message}`, "invalid_output", true);
    throw e;
  }
  const u = res.usage;
  const usage: ClaudeUsage = {
    model: opts.model,
    servedModel: res.model,
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
    fallbackUsed: (u.iterations ?? []).some((it) => it.type === "fallback_message"),
  };
  if (res.stop_reason === "refusal") throw Object.assign(new AnalyzerError("Claude が応答を拒否しました", "refusal", false), { usage });
  if (res.stop_reason === "max_tokens") throw Object.assign(new AnalyzerError("出力が上限に達しました", "max_tokens", true), { usage });
  const parsed = res.parsed_output;
  if (!parsed) throw Object.assign(new AnalyzerError("構造化出力を取得できませんでした", "invalid_output", true), { usage });
  // 念のため再検証（型検証は必須要件）
  const check = opts.schema.safeParse(parsed);
  if (!check.success) throw Object.assign(new AnalyzerError(`出力がスキーマに一致しません: ${check.error.message}`, "invalid_output", true), { usage });
  return { output: check.data, usage };
}
