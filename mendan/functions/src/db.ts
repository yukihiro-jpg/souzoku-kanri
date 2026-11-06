import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue, type Firestore, type Transaction } from "firebase-admin/firestore";
import {
  DEFAULT_RULES,
  DEFAULT_SETTINGS,
  DOCUMENT_MASTER,
  P,
  type AppSettings,
  type CaseDoc,
  type CaseState,
  type CheckItem,
  type DocumentMaster,
  type DocumentRequirement,
  type DocumentRule,
  type Entity,
  type HistoryEntry,
} from "@mendan/shared";

if (getApps().length === 0) initializeApp();
export const db: Firestore = getFirestore();
db.settings({ ignoreUndefinedProperties: true });
export { FieldValue };

export const nowIso = () => new Date().toISOString();
export const todayJst = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
export const monthJst = () => todayJst().slice(0, 7);

export function newId(prefix: string): string {
  return `${prefix}_${db.collection("_").doc().id}`;
}

export async function loadCaseState(caseId: string, tx?: Transaction): Promise<CaseState> {
  const get = (path: string) => (tx ? tx.get(db.collection(path)) : db.collection(path).get());
  const [e, c, d] = await Promise.all([get(P.entities(caseId)), get(P.checkItems(caseId)), get(P.documents(caseId))]);
  return {
    entities: e.docs.map((x) => x.data() as Entity),
    checkItems: c.docs.map((x) => x.data() as CheckItem),
    documents: d.docs.map((x) => x.data() as DocumentRequirement),
  };
}

// ---- マスタ類（短時間キャッシュ） ----
let cache: { at: number; rules: DocumentRule[]; docs: Map<string, DocumentMaster>; settings: AppSettings } | null = null;

export async function loadMasters(force = false) {
  if (!force && cache && Date.now() - cache.at < 60_000) return cache;
  const [rulesSnap, settingsSnap, docMasterSnap] = await Promise.all([
    db.collection(P.documentRules()).get(),
    db.doc(P.settings()).get(),
    db.collection("documentMaster").get(),
  ]);
  // Firestore にルールがあればそれを優先（管理画面で編集されたもの）。なければ初期ルール。
  const stored = rulesSnap.docs.map((d) => d.data() as DocumentRule);
  const byId = new Map(DEFAULT_RULES.map((r) => [r.id, r]));
  for (const r of stored) byId.set(r.id, r);
  const docs = new Map(DOCUMENT_MASTER.map((d) => [d.id, d]));
  for (const d of docMasterSnap.docs) docs.set(d.id, d.data() as DocumentMaster);
  cache = {
    at: Date.now(),
    rules: [...byId.values()],
    docs,
    settings: { ...DEFAULT_SETTINGS, ...((settingsSnap.data() as Partial<AppSettings>) ?? {}) },
  };
  return cache;
}

export function invalidateMasters() {
  cache = null;
}

export async function getCase(caseId: string): Promise<CaseDoc> {
  const snap = await db.doc(P.case(caseId)).get();
  if (!snap.exists) throw new Error("case_not_found");
  return snap.data() as CaseDoc;
}

export function deathDateOf(c: CaseDoc, entities: Entity[]): string | null {
  if (c.inheritanceStartDate) return c.inheritanceStartDate;
  const dec = entities.find((e) => e.type === "decedent" && e.status !== "retracted");
  const v = dec?.attributes.death_date?.value;
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

/** 操作履歴（AuditLogs）。顧客の発言内容そのものは記録しない。 */
export function audit(
  writer: { set: (ref: FirebaseFirestore.DocumentReference, data: object) => unknown },
  caseId: string,
  entry: { actor: string; action: string; target: string; detail?: Record<string, unknown> },
) {
  const ref = db.collection(P.auditLogs(caseId)).doc();
  writer.set(ref, { ...entry, at: nowIso() });
}

export function historyEntry(by: string, action: string, before: unknown, after: unknown, note?: string): HistoryEntry {
  return { at: nowIso(), by, action, before, after, note };
}
