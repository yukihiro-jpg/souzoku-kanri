import { HttpsError, onCall } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { AudioTranscriptionConfigMode, GoogleGenAI, Modality, type LiveConnectConfig } from "@google/genai";
import { DEFAULT_VOCABULARY, P, type Entity, type Meeting } from "@mendan/shared";
import { requireCase, requireRole, requireUser } from "./auth.js";
import {
  GEMINI_API_KEY,
  GEMINI_DIARIZATION,
  GEMINI_LANGUAGE,
  GEMINI_MODEL,
  GEMINI_RESPONSE_MODALITIES,
  GEMINI_SESSION_RESUMPTION,
  GEMINI_SILENCE_MS,
  GEMINI_TRANSCRIPTION_MODE,
  GEMINI_VOCAB_LIMIT,
  REGION,
  TRANSCRIBE_MODE,
  bool,
  secretValue,
} from "./config.js";
import { recordAudioUsage } from "./cost.js";
import { db } from "./db.js";

/**
 * Gemini Live 文字起こしの短期セッション認証
 *
 * ブラウザに Gemini API キーを渡さないため、サーバーで「一時トークン（ephemeral token）」を発行する。
 *  - 1回だけ使用可、新規接続は発行から2分以内、セッションは30分で失効
 *  - モデル・語彙・文字起こし設定をトークンに固定（ブラウザ側で変更不可）
 *  - 再接続のたびに新しいトークンを発行（セッション再開ハンドルを引き継ぐ）
 */
export const createTranscriptionSession = onCall({ region: REGION, secrets: [GEMINI_API_KEY], timeoutSeconds: 30 }, async (req) => {
  const actor = await requireUser(req);
  requireRole(actor, ["admin", "staff"]);
  const { caseId, meetingId, resumeHandle } = (req.data ?? {}) as { caseId: string; meetingId: string; resumeHandle?: string | null };
  const c = await requireCase(actor, caseId, true);
  if (!c.consent?.recording || !c.consent?.aiAnalysis) {
    throw new HttpsError("failed-precondition", "録音・AI利用の同意が記録されていないため、録音を開始できません。");
  }
  const m = (await db.doc(P.meeting(caseId, meetingId)).get()).data() as Meeting | undefined;
  if (!m || m.status !== "in_progress") throw new HttpsError("failed-precondition", "面談が開始されていません。");

  const key = secretValue(GEMINI_API_KEY);
  if (TRANSCRIBE_MODE.value() === "mock" || !key) {
    return { mode: "mock" as const, reason: key ? "TRANSCRIBE_MODE=mock" : "GEMINI_API_KEY が未設定です" };
  }

  const vocabulary = await buildVocabulary(caseId, c.decedentName);
  const config = buildLiveConfig(vocabulary, resumeHandle ?? null);
  const model = GEMINI_MODEL.value();
  const ai = new GoogleGenAI({ apiKey: key, httpOptions: { apiVersion: "v1alpha" } });
  const now = Date.now();
  try {
    const token = await ai.authTokens.create({
      config: {
        uses: 1,
        expireTime: new Date(now + 30 * 60_000).toISOString(),
        newSessionExpireTime: new Date(now + 2 * 60_000).toISOString(),
        liveConnectConstraints: { model, config },
        httpOptions: { apiVersion: "v1alpha" },
      },
    });
    if (!token.name) throw new Error("token.name is empty");
    return { mode: "gemini" as const, token: token.name, model, config, vocabularyCount: vocabulary.length, expiresAt: now + 30 * 60_000 };
  } catch (e) {
    logger.error("ephemeral token failed", { caseId, message: (e as Error).message });
    throw new HttpsError("unavailable", `Gemini の接続準備に失敗しました: ${(e as Error).message}`);
  }
});

export function buildLiveConfig(vocabulary: string[], resumeHandle: string | null): LiveConnectConfig {
  const mode = GEMINI_TRANSCRIPTION_MODE.value() === "SMART" ? AudioTranscriptionConfigMode.SMART : AudioTranscriptionConfigMode.VERBATIM;
  const config: LiveConnectConfig = {
    inputAudioTranscription: {
      languageCodes: [GEMINI_LANGUAGE.value()],
      customVocabulary: vocabulary,
      mode,
      ...(bool(GEMINI_DIARIZATION.value()) ? { diarization: true } : {}),
    },
  };
  const modalities = GEMINI_RESPONSE_MODALITIES.value().trim();
  if (modalities) config.responseModalities = modalities.split(",").map((m) => m.trim().toUpperCase() as Modality);
  const silence = Number(GEMINI_SILENCE_MS.value());
  if (silence > 0) config.realtimeInputConfig = { automaticActivityDetection: { silenceDurationMs: silence } };
  if (bool(GEMINI_SESSION_RESUMPTION.value())) config.sessionResumption = { transparent: true, ...(resumeHandle ? { handle: resumeHandle } : {}) };
  return config;
}

/**
 * カスタム語彙 = 案件固有の語（被相続人名・相続人名・出てきた金融機関名等）＋ 管理画面の専門用語。
 * 数字・日付・金融機関名・相続人名の認識精度を上げるため、案件固有の語を優先する。
 */
export async function buildVocabulary(caseId: string, decedentName: string): Promise<string[]> {
  const limit = Math.max(10, Number(GEMINI_VOCAB_LIMIT.value()) || 100);
  const [vocabSnap, entSnap] = await Promise.all([db.collection(P.vocabulary()).where("active", "==", true).get(), db.collection(P.entities(caseId)).get()]);
  const caseTerms: string[] = [];
  if (decedentName) caseTerms.push(decedentName.replace(/\s+/g, ""));
  for (const d of entSnap.docs) {
    const e = d.data() as Entity;
    if (e.status === "retracted" || e.status === "rejected") continue;
    for (const k of ["name", "institution", "insurer", "company", "branch", "location"]) {
      const v = e.attributes[k]?.value;
      if (v && v.length <= 20) caseTerms.push(v);
    }
  }
  const admin = vocabSnap.empty ? DEFAULT_VOCABULARY : vocabSnap.docs.map((d) => String(d.data().term ?? "")).filter(Boolean);
  return [...new Set([...caseTerms, ...admin])].slice(0, limit);
}

/** 文字起こしした音声時間の報告（料金の概算用） */
export const reportAudioUsage = onCall({ region: REGION }, async (req) => {
  const actor = await requireUser(req);
  const { caseId, meetingId, seconds } = (req.data ?? {}) as { caseId: string; meetingId: string; seconds: number };
  await requireCase(actor, caseId, true);
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 3600) throw new HttpsError("invalid-argument", "seconds が不正です。");
  await recordAudioUsage({ caseId, meetingId }, seconds);
  return { ok: true };
});
