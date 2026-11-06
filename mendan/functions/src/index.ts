/**
 * Cloud Functions エントリーポイント
 *
 * 責務の分離:
 *  - Gemini（gemini.ts）: 音声 → 文字起こし（ブラウザ⇔Geminiの直接接続を一時トークンで認可）
 *  - Claude（analyze.ts / reanalyze.ts）: 確定した発言 → 事実の構造化
 *  - ルールエンジン（@mendan/shared）: 事実 → 必要資料・追加確認項目（AIに依存しない）
 */
export { ensureUser, createCase, updateCase, recordConsent, startMeeting, endMeeting } from "./cases.js";
export { createTranscriptionSession, reportAudioUsage } from "./gemini.js";
export { analyzeSegments } from "./analyze.js";
export { reanalyzeMeeting } from "./reanalyze.js";
export { updateCheckItem, updateDocument, addDocument, updateEntity, setSegmentSpeaker, resolveReviewItem } from "./edits.js";
export { saveRule, approveRule, resetRule, saveVocabulary, saveSettings, setUserRole, getMetrics, purgeExpiredAudio } from "./admin.js";
