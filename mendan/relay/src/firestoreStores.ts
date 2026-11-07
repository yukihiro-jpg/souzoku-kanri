import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { hashTicket, type Ticket, type TicketStore, type UsageRecorder } from "./relay.js";

const monthJst = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 7);

/** チケットは Cloud Functions（createTranscriptionSession）が liveTickets/{sha256} に作る。1回使ったら無効 */
export function firestoreTicketStore(db: Firestore): TicketStore {
  return {
    async consume(ticket: string): Promise<Ticket | null> {
      const ref = db.doc(`liveTickets/${hashTicket(ticket)}`);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const d = snap.data();
        if (!d || d.used || typeof d.expiresAt !== "number" || d.expiresAt < Date.now()) return null;
        tx.update(ref, { used: true, usedAt: new Date().toISOString() });
        return { uid: d.uid, caseId: d.caseId, meetingId: d.meetingId, model: d.model };
      });
    },
  };
}

/** 文字起こしした音声時間を料金の概算として記録（面談・月次・明細） */
export function firestoreUsageRecorder(db: Firestore, usdPerHour: number): UsageRecorder {
  return {
    async record(t, audioSeconds) {
      const usd = (audioSeconds / 3600) * usdPerHour;
      const month = monthJst();
      const b = db.batch();
      b.set(db.collection("costLogs").doc(), { caseId: t.caseId, meetingId: t.meetingId, provider: "google-vertex", model: t.model, kind: "transcription", audioSeconds, usd, month, at: new Date().toISOString() });
      b.set(db.doc(`costSummary/${month}`), { month, totalUsd: FieldValue.increment(usd), geminiAudioSeconds: FieldValue.increment(audioSeconds), "byModel.vertex-transcribe.usd": FieldValue.increment(usd), updatedAt: new Date().toISOString() }, { merge: true });
      b.set(db.doc(`cases/${t.caseId}/meetings/${t.meetingId}`), { usage: { audioSeconds: FieldValue.increment(audioSeconds), usd: FieldValue.increment(usd) } }, { merge: true });
      await b.commit();
    },
  };
}
