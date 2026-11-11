import { HttpsError, onCall } from "firebase-functions/v2/https";
import { P, type AccountingSystem, type ClientCard, type ClientDoc, type Role } from "@mendan/shared";
import { optStr, requireRole, requireUser, str, type Actor } from "../auth.js";
import { REGION } from "../config.js";
import { FieldValue, db, nowIso } from "../db.js";

/**
 * 顧問先（顧問モード）。データはすべて clients/{clientId} の配下に置き、顧問先をまたいで読まない。
 * 管理者はすべての顧問先、担当者はメンバーになっている顧問先だけを扱える。
 */
export async function requireClient(actor: Actor, clientId: unknown, write: boolean): Promise<ClientDoc> {
  if (!clientId || typeof clientId !== "string") throw new HttpsError("invalid-argument", "clientId が必要です。");
  const snap = await db.doc(P.client(clientId)).get();
  if (!snap.exists) throw new HttpsError("not-found", "顧問先が見つかりません。");
  const c = { ...(snap.data() as ClientDoc), id: snap.id };
  if (actor.role !== "admin") {
    const r = c.members?.[actor.uid];
    if (!r) throw new HttpsError("permission-denied", "この顧問先へのアクセス権がありません。");
    if (write && (r === "viewer" || actor.role === "viewer")) throw new HttpsError("permission-denied", "閲覧のみの権限です。");
  }
  return c;
}

export function clientAudit(batch: FirebaseFirestore.WriteBatch, clientId: string, entry: { actor: string; action: string; target: string; detail?: Record<string, unknown> }) {
  batch.set(db.collection(P.clientAudit(clientId)).doc(), { ...entry, at: nowIso() });
}

const systemOf = (v: unknown): AccountingSystem => {
  if (v === "kaikei_taisho" || v === "mf") return v;
  throw new HttpsError("invalid-argument", "会計ソフトは「会計大将」か「マネーフォワード」を選んでください。");
};
const monthOf = (v: unknown) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 12) throw new HttpsError("invalid-argument", "決算月は1〜12で指定してください。");
  return n;
};

export const createClient = onCall({ region: REGION }, async (req) => {
  const actor = await requireUser(req);
  requireRole(actor, ["admin", "staff"]);
  const d = (req.data ?? {}) as Record<string, unknown>;
  const code = str(d.code, "顧問先コード", 20);
  const dup = await db.collection(P.clients()).where("code", "==", code).limit(1).get();
  if (!dup.empty) throw new HttpsError("already-exists", `顧問先コード ${code} はすでに登録されています。`);
  const ref = db.collection(P.clients()).doc();
  const now = nowIso();
  const c: ClientDoc = {
    id: ref.id,
    code,
    name: str(d.name, "顧問先名", 100),
    accountingSystem: systemOf(d.accountingSystem),
    fiscalMonth: monthOf(d.fiscalMonth),
    industryTags: [],
    memberIds: [actor.uid],
    members: { [actor.uid]: actor.role === "viewer" ? "viewer" : "staff" },
    rulebookDocId: null,
    rulebookDocName: null,
    mfRulesPath: null,
    status: "active",
    createdAt: now,
    createdBy: actor.uid,
    updatedAt: now,
  };
  const batch = db.batch();
  batch.set(ref, c);
  clientAudit(batch, ref.id, { actor: actor.uid, action: "client_created", target: ref.id });
  await batch.commit();
  return { clientId: ref.id };
});

export const updateClient = onCall({ region: REGION }, async (req) => {
  const actor = await requireUser(req);
  const d = (req.data ?? {}) as Record<string, unknown>;
  const c = await requireClient(actor, d.clientId, true);
  const patch: Record<string, unknown> = { updatedAt: nowIso() };
  if (d.name !== undefined) patch.name = str(d.name, "顧問先名", 100);
  if (d.accountingSystem !== undefined) patch.accountingSystem = systemOf(d.accountingSystem);
  if (d.fiscalMonth !== undefined) patch.fiscalMonth = monthOf(d.fiscalMonth);
  if (d.industryTags !== undefined) patch.industryTags = Array.isArray(d.industryTags) ? d.industryTags.map(String).slice(0, 10) : [];
  if (d.rulebookDocId !== undefined) {
    patch.rulebookDocId = optStr(d.rulebookDocId, 200);
    patch.rulebookDocName = optStr(d.rulebookDocName, 300);
  }
  if (d.mfRulesPath !== undefined) patch.mfRulesPath = optStr(d.mfRulesPath, 300);
  if (d.status !== undefined) {
    if (d.status !== "active" && d.status !== "closed") throw new HttpsError("invalid-argument", "状態が不正です。");
    patch.status = d.status;
  }
  if (typeof d.addMemberEmail === "string" && d.addMemberEmail) {
    const u = await db.collection("users").where("email", "==", d.addMemberEmail.toLowerCase()).limit(1).get();
    if (u.empty) throw new HttpsError("not-found", "そのメールアドレスのユーザーはまだログインしていません。");
    const role: Role = d.memberRole === "viewer" ? "viewer" : "staff";
    patch.memberIds = FieldValue.arrayUnion(u.docs[0].id);
    patch[`members.${u.docs[0].id}`] = role;
  }
  const batch = db.batch();
  batch.update(db.doc(P.client(c.id)), patch);
  clientAudit(batch, c.id, { actor: actor.uid, action: "client_updated", target: c.id, detail: { fields: Object.keys(patch) } });
  await batch.commit();
  return { ok: true };
});

/** カードの状態の変更（未着手／対応中／完了／決算で反映済み） */
export const updateCard = onCall({ region: REGION }, async (req) => {
  const actor = await requireUser(req);
  const d = (req.data ?? {}) as { clientId: string; cardId: string; status?: ClientCard["status"]; settlementPolicy?: string | null; due?: string | null };
  const c = await requireClient(actor, d.clientId, true);
  const ref = db.doc(`${P.cards(c.id)}/${d.cardId}`);
  if (!(await ref.get()).exists) throw new HttpsError("not-found", "カードが見つかりません。");
  const patch: Record<string, unknown> = { updatedAt: nowIso() };
  if (d.status !== undefined) {
    if (!["open", "in_progress", "done", "reflected"].includes(d.status)) throw new HttpsError("invalid-argument", "状態が不正です。");
    patch.status = d.status;
  }
  if (d.settlementPolicy !== undefined) patch.settlementPolicy = optStr(d.settlementPolicy, 1000);
  if (d.due !== undefined) patch.due = optStr(d.due, 50);
  const batch = db.batch();
  batch.update(ref, patch);
  clientAudit(batch, c.id, { actor: actor.uid, action: "card_updated", target: d.cardId, detail: patch });
  await batch.commit();
  return { ok: true };
});
