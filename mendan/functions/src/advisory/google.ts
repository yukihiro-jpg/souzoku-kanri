import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { OAuth2Client } from "google-auth-library";
import { P, applyFakeBatchUpdate, demoMeetingNotes, demoRulebook, fakeDocToApi, FakeRevisionMismatch, type ApiDocument, type DocsRequest, type FakeDoc } from "@mendan/shared";
import { requireUser } from "../auth.js";
import { GOOGLE_MODE, GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, OAUTH_TOKEN_KEY, REGION, secretValue } from "../config.js";
import { db, nowIso } from "../db.js";

/**
 * Google ドライブ連携（顧問モード）
 *
 * 方式: 利用者本人の Google アカウントで一度許可（OAuth）し、サーバーがその許可で Docs API を呼ぶ。
 *  - 権限は drive.file のみ（画面で選んだファイルと、アプリが作ったファイルだけ）。ドライブ全体は読めない
 *  - 更新用の鍵（refresh token）は AES-256-GCM で暗号化して Firestore（ブラウザからは読めない場所）に保存
 *  - ブラウザには鍵を渡さない。ファイル選択画面（Picker）用の短期の鍵だけは、ブラウザが Google から直接受け取る
 */
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

const isMock = () => GOOGLE_MODE.value() === "mock";
const clientId = () => GOOGLE_OAUTH_CLIENT_ID.value();
export const googleConfigured = () => isMock() || (clientId() !== "unset" && !!clientId() && !!secretValue(GOOGLE_OAUTH_CLIENT_SECRET));

function tokenKey(): Buffer {
  const raw = secretValue(OAUTH_TOKEN_KEY);
  const key = raw ? Buffer.from(raw, "base64") : null;
  if (!key || key.length !== 32) throw new HttpsError("failed-precondition", "暗号化の鍵（OAUTH_TOKEN_KEY）が設定されていません。管理者に連絡してください。");
  return key;
}
function encrypt(plain: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", tokenKey(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return { enc: enc.toString("base64"), iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64") };
}
function decrypt(v: { enc: string; iv: string; tag: string }): string {
  const d = createDecipheriv("aes-256-gcm", tokenKey(), Buffer.from(v.iv, "base64"));
  d.setAuthTag(Buffer.from(v.tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(v.enc, "base64")), d.final()]).toString("utf8");
}

const oauthClient = () => new OAuth2Client({ clientId: clientId(), clientSecret: secretValue(GOOGLE_OAUTH_CLIENT_SECRET) ?? undefined, redirectUri: "postmessage" });

/** 連携の状態（画面の表示用） */
export const googleStatus = onCall({ region: REGION, secrets: [GOOGLE_OAUTH_CLIENT_SECRET] }, async (req) => {
  const actor = await requireUser(req);
  const t = (await db.doc(P.oauthToken(actor.uid)).get()).data();
  return { configured: googleConfigured(), mock: isMock(), connected: !!t, email: (t?.email as string) ?? null, connectedAt: (t?.connectedAt as string) ?? null };
});

/** ブラウザの Google の許可画面で受け取ったコードを、サーバーで更新用の鍵に交換して保存する */
export const googleConnect = onCall({ region: REGION, secrets: [GOOGLE_OAUTH_CLIENT_SECRET, OAUTH_TOKEN_KEY] }, async (req) => {
  const actor = await requireUser(req);
  const { code } = (req.data ?? {}) as { code?: string };
  if (isMock()) {
    await db.doc(P.oauthToken(actor.uid)).set({ mock: true, email: actor.email, scope: DRIVE_SCOPE, connectedAt: nowIso() });
    return { ok: true, email: actor.email };
  }
  if (!googleConfigured()) throw new HttpsError("failed-precondition", "Google 連携の設定（OAuth クライアント）がまだです。管理者に連絡してください。");
  if (!code) throw new HttpsError("invalid-argument", "許可のコードがありません。");
  try {
    const { tokens } = await oauthClient().getToken(code);
    if (!tokens.refresh_token) throw new Error("更新用の鍵が返ってきませんでした（許可画面で「許可」を押し直してください）");
    if (tokens.scope && !tokens.scope.split(" ").includes(DRIVE_SCOPE)) throw new Error("ドライブの許可が付いていません");
    let email: string | null = null;
    if (tokens.id_token) {
      const t = await oauthClient().verifyIdToken({ idToken: tokens.id_token, audience: clientId() });
      email = t.getPayload()?.email ?? null;
    }
    // 連携する Google アカウントは、ログイン中のアカウントと同じであること
    if (email && email.toLowerCase() !== actor.email.toLowerCase()) throw new Error(`ログイン中のアカウント（${actor.email}）と同じ Google アカウントで許可してください`);
    await db.doc(P.oauthToken(actor.uid)).set({ ...encrypt(tokens.refresh_token), email: email ?? actor.email, scope: tokens.scope ?? DRIVE_SCOPE, connectedAt: nowIso() });
    return { ok: true, email: email ?? actor.email };
  } catch (e) {
    logger.warn("google connect failed", { uid: actor.uid, message: (e as Error).message });
    throw new HttpsError("failed-precondition", `Google との連携に失敗しました: ${(e as Error).message}`);
  }
});

export const googleDisconnect = onCall({ region: REGION, secrets: [GOOGLE_OAUTH_CLIENT_SECRET, OAUTH_TOKEN_KEY] }, async (req) => {
  const actor = await requireUser(req);
  const ref = db.doc(P.oauthToken(actor.uid));
  const t = (await ref.get()).data();
  if (t && !t.mock) {
    try {
      await oauthClient().revokeToken(decrypt(t as { enc: string; iv: string; tag: string }));
    } catch (e) {
      logger.warn("revoke failed", { message: (e as Error).message });
    }
  }
  await ref.delete();
  return { ok: true };
});

/* ===== Docs API の窓口（本物／開発用の代わり） ===== */
export interface DocsGateway {
  getDocument(docId: string): Promise<ApiDocument>;
  batchUpdate(docId: string, requests: DocsRequest[], requiredRevisionId: string): Promise<{ revisionId: string | null }>;
}

export class RevisionMismatchError extends Error {}

class RealDocs implements DocsGateway {
  constructor(private token: string) {}
  private async call(url: string, init?: RequestInit) {
    const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = (body as { error?: { message?: string } }).error?.message ?? `HTTP ${res.status}`;
      if (res.status === 400 && /revision/i.test(msg)) throw new RevisionMismatchError(msg);
      if (res.status === 403 || res.status === 404) throw new HttpsError("permission-denied", `このドキュメントを開けません。アプリの「ドキュメントを選ぶ」から選び直してください（${msg}）`);
      throw new HttpsError("unavailable", `Google ドキュメントの操作に失敗しました: ${msg}`);
    }
    return body;
  }
  async getDocument(docId: string) {
    return (await this.call(`https://docs.googleapis.com/v1/documents/${encodeURIComponent(docId)}?includeTabsContent=true`)) as ApiDocument;
  }
  async batchUpdate(docId: string, requests: DocsRequest[], requiredRevisionId: string) {
    const r = (await this.call(`https://docs.googleapis.com/v1/documents/${encodeURIComponent(docId)}:batchUpdate`, {
      method: "POST",
      body: JSON.stringify({ requests, writeControl: { requiredRevisionId } }),
    })) as { writeControl?: { requiredRevisionId?: string } };
    return { revisionId: r.writeControl?.requiredRevisionId ?? null };
  }
}

/** 開発用：Firestore の _mockDocs に置いた架空のドキュメントを Docs API と同じ形で扱う */
class MockDocs implements DocsGateway {
  private async load(docId: string): Promise<FakeDoc> {
    const ref = db.doc(P.mockDoc(docId));
    const snap = await ref.get();
    if (snap.exists) return snap.data() as FakeDoc;
    const seed = docId.startsWith("mock-rulebook") ? demoRulebook(docId) : docId.startsWith("mock-notes") ? demoMeetingNotes(docId) : null;
    if (!seed) throw new HttpsError("not-found", `開発用のドキュメント ${docId} がありません（mock-rulebook… / mock-notes… が使えます）`);
    await ref.set(seed);
    return seed;
  }
  async getDocument(docId: string) {
    return fakeDocToApi(await this.load(docId));
  }
  async batchUpdate(docId: string, requests: DocsRequest[], requiredRevisionId: string) {
    const cur = await this.load(docId);
    try {
      const next = applyFakeBatchUpdate(cur, requests, requiredRevisionId);
      await db.doc(P.mockDoc(docId)).set(next);
      return { revisionId: `rev-${next.revision}` };
    } catch (e) {
      if (e instanceof FakeRevisionMismatch) throw new RevisionMismatchError(e.message);
      throw e;
    }
  }
}

/** 利用者本人の許可で Docs API を使う窓口を返す（未連携ならエラー） */
export async function docsFor(uid: string): Promise<DocsGateway> {
  if (isMock()) {
    if (!(await db.doc(P.oauthToken(uid)).get()).exists) throw new HttpsError("failed-precondition", "Google ドライブとの連携がまだです。顧問先の画面で「Google ドライブと連携」を押してください。");
    return new MockDocs();
  }
  if (!googleConfigured()) throw new HttpsError("failed-precondition", "Google 連携の設定（OAuth クライアント）がまだです。管理者に連絡してください。");
  const t = (await db.doc(P.oauthToken(uid)).get()).data();
  if (!t) throw new HttpsError("failed-precondition", "Google ドライブとの連携がまだです。顧問先の画面で「Google ドライブと連携」を押してください。");
  const c = oauthClient();
  c.setCredentials({ refresh_token: decrypt(t as { enc: string; iv: string; tag: string }) });
  try {
    const { token } = await c.getAccessToken();
    if (!token) throw new Error("no token");
    return new RealDocs(token);
  } catch (e) {
    logger.warn("refresh failed", { uid, message: (e as Error).message });
    throw new HttpsError("failed-precondition", "Google ドライブとの連携が切れています。顧問先の画面で「Google ドライブと連携」をもう一度押してください。");
  }
}
