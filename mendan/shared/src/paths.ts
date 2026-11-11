/** Firestore のパス（サーバー・ブラウザ共通） */
export const P = {
  user: (uid: string) => `users/${uid}`,
  cases: () => "cases",
  case: (c: string) => `cases/${c}`,
  meetings: (c: string) => `cases/${c}/meetings`,
  meeting: (c: string, m: string) => `cases/${c}/meetings/${m}`,
  segments: (c: string, m: string) => `cases/${c}/meetings/${m}/segments`,
  segment: (c: string, m: string, s: string) => `cases/${c}/meetings/${m}/segments/${s}`,
  entities: (c: string) => `cases/${c}/entities`,
  checkItems: (c: string) => `cases/${c}/checkItems`,
  documents: (c: string) => `cases/${c}/documents`,
  reviewItems: (c: string) => `cases/${c}/reviewItems`,
  auditLogs: (c: string) => `cases/${c}/auditLogs`,
  aiJobs: (c: string) => `cases/${c}/aiJobs`,
  costLogs: () => "costLogs",
  /** 削除した案件の記録（案件名・削除者・日時のみ。面談内容は残さない） */
  deletedCases: () => "deletedCases",
  costSummary: (month: string) => `costSummary/${month}`,
  documentRules: () => "documentRules",
  vocabulary: () => "vocabulary",
  settings: () => "settings/app",
  notifications: () => "notifications",
  // ===== 顧問モード（顧問先ごとに clients/{clientId} の配下へ。顧問先をまたぐ箱は作らない） =====
  clients: () => "clients",
  client: (c: string) => `clients/${c}`,
  ruleRuns: (c: string) => `clients/${c}/ruleRuns`,
  ruleRun: (c: string, r: string) => `clients/${c}/ruleRuns/${r}`,
  ruleItems: (c: string, r: string) => `clients/${c}/ruleRuns/${r}/items`,
  ruleItem: (c: string, r: string, i: string) => `clients/${c}/ruleRuns/${r}/items/${i}`,
  ruleChanges: (c: string) => `clients/${c}/ruleChanges`,
  cards: (c: string) => `clients/${c}/cards`,
  clientAudit: (c: string) => `clients/${c}/auditLogs`,
  clientAiJobs: (c: string) => `clients/${c}/aiJobs`,
  /** Google 連携の許可（暗号化した更新用の鍵。ブラウザからは読めない） */
  oauthToken: (uid: string) => `oauthTokens/${uid}`,
  /** 開発用の Google ドキュメントの代わり（GOOGLE_MODE=mock のときだけ使う） */
  mockDoc: (id: string) => `_mockDocs/${id}`,
};

/** 発言IDは meeting と連番から決定的に作る（同じ発言の二重保存を防ぐ） */
export function segmentId(meetingId: string, seq: number): string {
  return `seg_${meetingId.slice(-6)}_${String(seq).padStart(5, "0")}`;
}
