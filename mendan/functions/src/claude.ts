import { AnalysisOutputSchema, ReanalysisOutputSchema, type AnalysisOutput, type ReanalysisOutput } from "@mendan/shared";
import { callStructured, toEffort, type ClaudeUsage } from "./claudeCore.js";
import {
  ANTHROPIC_API_KEY,
  CLAUDE_EFFORT_REALTIME,
  CLAUDE_EFFORT_REVIEW,
  CLAUDE_FALLBACKS,
  CLAUDE_MODEL_REALTIME,
  CLAUDE_MODEL_REVIEW,
  secretValue,
} from "./config.js";

/** Claude API 呼び出し（サーバー側のみ。APIキーはブラウザに渡さない） */
export { AnalyzerError, type ClaudeUsage } from "./claudeCore.js";

export function claudeConfigured(): boolean {
  return !!secretValue(ANTHROPIC_API_KEY);
}

export async function analyzeRealtime(system: string, user: string): Promise<{ output: AnalysisOutput; usage: ClaudeUsage }> {
  return callStructured({
    apiKey: secretValue(ANTHROPIC_API_KEY),
    fallbacks: CLAUDE_FALLBACKS.value() === "default",
    model: CLAUDE_MODEL_REALTIME.value(),
    effort: toEffort(CLAUDE_EFFORT_REALTIME.value(), "low"),
    system,
    user,
    schema: AnalysisOutputSchema,
    maxTokens: 8000,
    timeoutMs: 45_000,
  });
}

export async function analyzeFullTranscript(system: string, user: string): Promise<{ output: ReanalysisOutput; usage: ClaudeUsage }> {
  return callStructured({
    apiKey: secretValue(ANTHROPIC_API_KEY),
    fallbacks: CLAUDE_FALLBACKS.value() === "default",
    model: CLAUDE_MODEL_REVIEW.value(),
    effort: toEffort(CLAUDE_EFFORT_REVIEW.value(), "high"),
    system,
    user,
    schema: ReanalysisOutputSchema,
    maxTokens: 32000,
    timeoutMs: 480_000,
  });
}
