import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { P, type CaseDoc, type Role } from "@mendan/shared";
import { ALLOWED_EMAILS, ALLOWED_EMAIL_DOMAINS } from "./config.js";
import { db } from "./db.js";

export interface Actor {
  uid: string;
  email: string;
  name: string;
  role: Role;
}

export const csvList = (v: string) =>
  v
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

/**
 * このメールアドレスでの利用を許可するか（ログイン時と、毎回の操作の両方で確認する）
 *  - メールアドレスが確認済みであること
 *  - ALLOWED_EMAIL_DOMAINS のドメインであること
 *  - ALLOWED_EMAILS を設定している場合は、そこに書かれたアドレスであること
 */
export function assertEmailAllowed(token: { email?: unknown; email_verified?: unknown }): string {
  const email = String(token.email ?? "").toLowerCase();
  if (token.email_verified !== true || !email) throw new HttpsError("permission-denied", "メールアドレスが確認できないアカウントです。");
  const domains = csvList(ALLOWED_EMAIL_DOMAINS.value());
  if (domains.length === 0) throw new HttpsError("failed-precondition", "ALLOWED_EMAIL_DOMAINS が未設定のため、ログインを受け付けられません。");
  const domain = email.split("@")[1] ?? "";
  if (!domains.includes(domain)) throw new HttpsError("permission-denied", `このアカウント（@${domain}）は利用が許可されていません。`);
  const emails = csvList(ALLOWED_EMAILS.value());
  if (emails.length > 0 && !emails.includes(email)) throw new HttpsError("permission-denied", `このアカウント（${email}）は利用が許可されていません。`);
  return email;
}

/** ログイン中かつ、許可されたユーザー（users/{uid} が active）であること */
export async function requireUser(req: CallableRequest<unknown>): Promise<Actor> {
  const a = req.auth;
  if (!a) throw new HttpsError("unauthenticated", "ログインしてください。");
  assertEmailAllowed(a.token);
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
