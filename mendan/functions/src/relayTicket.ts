import { createHash, randomBytes } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";

/**
 * 文字起こし中継サーバー（Cloud Run）用の1回限りのチケットを発行する。
 * Firestore にはチケットそのものではなくハッシュ値を保存する（漏れても再利用できない）。
 */
export async function issueRelayTicket(
  db: Firestore,
  p: { uid: string; caseId: string; meetingId: string; model: string; ttlMs?: number },
): Promise<{ ticket: string; expiresAt: number }> {
  const ticket = randomBytes(32).toString("base64url");
  const expiresAt = Date.now() + (p.ttlMs ?? 2 * 60_000);
  await db.doc(`liveTickets/${createHash("sha256").update(ticket).digest("hex")}`).set({
    uid: p.uid,
    caseId: p.caseId,
    meetingId: p.meetingId,
    model: p.model,
    used: false,
    expiresAt,
    createdAt: new Date().toISOString(),
  });
  return { ticket, expiresAt };
}
