import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { P, type CaseDoc, type Role } from "@mendan/shared";
import { db } from "./db.js";

export interface Actor {
  uid: string;
  email: string;
  name: string;
  role: Role;
}

/** ログイン中かつ、許可されたユーザー（users/{uid} が active）であること */
export async function requireUser(req: CallableRequest<unknown>): Promise<Actor> {
  const a = req.auth;
  if (!a) throw new HttpsError("unauthenticated", "ログインしてください。");
  const snap = await db.doc(P.user(a.uid)).get();
  const u = snap.data() as { role?: Role; active?: boolean; email?: string; displayName?: string } | undefined;
  if (!u || !u.active) throw new HttpsError("permission-denied", "このアカウントは利用が許可されていません。管理者に連絡してください。");
  return { uid: a.uid, email: u.email ?? "", name: u.displayName ?? u.email ?? a.uid, role: u.role ?? "viewer" };
}

export function requireRole(actor: Actor, roles: Role[]) {
  if (!roles.includes(actor.role)) throw new HttpsError("permission-denied", "この操作の権限がありません。");
}

/** 案件別アクセス権限。管理者はすべて、担当者・閲覧者は案件メンバーのみ。 */
export async function requireCase(actor: Actor, caseId: string, write: boolean): Promise<CaseDoc> {
  if (!caseId || typeof caseId !== "string") throw new HttpsError("invalid-argument", "caseId が必要です。");
  const snap = await db.doc(P.case(caseId)).get();
  if (!snap.exists) throw new HttpsError("not-found", "案件が見つかりません。");
  const c = snap.data() as CaseDoc;
  if (actor.role !== "admin") {
    const r = c.members?.[actor.uid];
    if (!r) throw new HttpsError("permission-denied", "この案件へのアクセス権がありません。");
    if (write && (r === "viewer" || actor.role === "viewer")) throw new HttpsError("permission-denied", "閲覧のみの権限です。");
  }
  return c;
}

export function str(v: unknown, name: string, max = 2000): string {
  if (typeof v !== "string" || !v.trim()) throw new HttpsError("invalid-argument", `${name} が必要です。`);
  if (v.length > max) throw new HttpsError("invalid-argument", `${name} が長すぎます。`);
  return v.trim();
}

export function optStr(v: unknown, max = 2000): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string") throw new HttpsError("invalid-argument", "文字列で指定してください。");
  return v.slice(0, max);
}
