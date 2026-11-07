import { httpsCallable } from "firebase/functions";
import type { AppSettings, CheckStatus, DocStatus, DocumentRule, Role, TranscriptSegment } from "@mendan/shared";
import type { LiveConnectConfig } from "@google/genai";
import { functions } from "./firebase";

/** Cloud Functions の呼び出し（APIキーを使う処理はすべてサーバー側） */
function call<Req, Res>(name: string, timeout?: number) {
  const fn = httpsCallable<Req, Res>(functions, name, timeout ? { timeout } : undefined);
  return async (data: Req): Promise<Res> => (await fn(data)).data;
}

export type TranscriptionSession =
  | { mode: "mock"; reason: string }
  | { mode: "gemini"; token: string; model: string; config: LiveConnectConfig; vocabularyCount: number; expiresAt: number }
  | { mode: "vertex"; relayBaseUrl: string; model: string; config: LiveConnectConfig; vocabularyCount: number; expiresAt: number };

export const api = {
  ensureUser: call<void, { role: Role; email: string; displayName: string; active: boolean }>("ensureUser"),
  createCase: call<{ name: string; decedentName: string; inheritanceStartDate?: string }, { caseId: string }>("createCase"),
  updateCase: call<{ caseId: string; name?: string; decedentName?: string; inheritanceStartDate?: string | null; addMemberEmail?: string; memberRole?: Role }, { ok: true }>("updateCase"),
  recordConsent: call<{ caseId: string; recording: boolean; aiAnalysis: boolean; method: "verbal" | "written"; note?: string }, unknown>("recordConsent"),
  startMeeting: call<{ caseId: string }, { meetingId: string; no: number }>("startMeeting"),
  endMeeting: call<{ caseId: string; meetingId: string; force?: boolean }, { ended: boolean; warnings: string[] }>("endMeeting"),
  createTranscriptionSession: call<{ caseId: string; meetingId: string; resumeHandle?: string | null }, TranscriptionSession>("createTranscriptionSession"),
  reportAudioUsage: call<{ caseId: string; meetingId: string; seconds: number }, unknown>("reportAudioUsage"),
  analyzeSegments: call<{ caseId: string; meetingId: string; segmentIds: string[]; clientRequestedAt: number }, { jobId: string | null; skipped?: string; aiMs?: number; serverMs?: number; budget?: string }>("analyzeSegments", 90_000),
  reanalyzeMeeting: call<{ caseId: string; meetingId: string }, { jobId: string; reviewItems: number }>("reanalyzeMeeting", 540_000),
  updateCheckItem: call<{ caseId: string; itemId: string; status?: CheckStatus; answer?: string | null; unlock?: boolean }, unknown>("updateCheckItem"),
  updateDocument: call<{ caseId: string; docId: string; status?: DocStatus; dueDate?: string | null; submitter?: string | null; remarks?: string | null; clearReview?: boolean }, unknown>("updateDocument"),
  addDocument: call<{ caseId: string; documentId: string; target?: string; reason?: string }, { id: string }>("addDocument"),
  updateEntity: call<{ caseId: string; entityId: string; action: "confirm" | "reject" | "unlock" | "edit"; attributes?: Record<string, string>; label?: string }, unknown>("updateEntity"),
  setSegmentSpeaker: call<{ caseId: string; meetingId: string; segmentId: string; speaker: TranscriptSegment["speaker"]; applyToLabel?: boolean }, unknown>("setSegmentSpeaker"),
  resolveReviewItem: call<{ caseId: string; reviewItemId: string; decision: "approve" | "reject" }, { applied: number }>("resolveReviewItem"),
  saveRule: call<{ rule: DocumentRule }, { version: number }>("saveRule"),
  approveRule: call<{ ruleId: string; status: "approved" | "rejected" | "pending_review" }, unknown>("approveRule"),
  resetRule: call<{ ruleId: string }, unknown>("resetRule"),
  saveVocabulary: call<{ add?: string[]; remove?: string[]; seedDefaults?: string[] }, unknown>("saveVocabulary"),
  saveSettings: call<Partial<AppSettings>, unknown>("saveSettings"),
  setUserRole: call<{ uid: string; role?: Role; active?: boolean }, unknown>("setUserRole"),
  getMetrics: call<{ days?: number }, Metrics>("getMetrics", 60_000),
};

export interface Metrics {
  latency: Record<string, { n: number; p50: number | null; p95: number | null }>;
  realtimeJobs: number;
  errorJobs: number;
  month: string;
  cost: { totalUsd?: number; claudeCalls?: number; geminiAudioSeconds?: number; byModel?: Record<string, Record<string, number>> } | null;
  meetings: { caseId: string; meetingId: string; no: number; startedAt: string; interviewer: string; usage: Record<string, number> }[];
  budget: number;
}

export function errorMessage(e: unknown): string {
  const m = (e as { message?: string })?.message ?? String(e);
  return m.replace(/^FirebaseError:\s*/, "");
}
