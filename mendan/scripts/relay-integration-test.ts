/**
 * 文字起こし中継（Vertex AI 方式）の結合テスト
 *   前提: Firestore エミュレーター起動済み（npm run emulators:clean）
 *   実行: npm run test:relay
 *
 * 本番と同じコードで「チケット発行（Cloud Functions）→ 中継サーバー（Firestore でチケット確認）→ Vertex AI」を通す。
 * Vertex AI の代わりに偽のサーバーを使う（Google Cloud には接続しない）。
 */
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
process.env.GCLOUD_PROJECT ??= "demo-souzoku-mendan";

import type { AddressInfo } from "node:net";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { WebSocketServer } from "ws";
import { GoogleGenAI, type LiveServerMessage } from "@google/genai/web";
import { issueRelayTicket } from "../functions/src/relayTicket.js";
import { firestoreTicketStore, firestoreUsageRecorder } from "../relay/src/firestoreStores.js";
import { createRelayServer } from "../relay/src/relay.js";

let failures = 0;
const ok = (c: unknown, m: string) => {
  console.log(`  ${c ? "✔" : "✘"} ${m}`);
  if (!c) failures++;
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MODEL = "gemini-3.5-transcribe-live";

async function main() {
  initializeApp({ projectId: process.env.GCLOUD_PROJECT });
  const db = getFirestore();

  // 偽の Vertex AI
  const fake = new WebSocketServer({ port: 0 });
  await new Promise((r) => fake.on("listening", r));
  let setupModel = "";
  fake.on("connection", (sock) =>
    sock.on("message", (m) => {
      const msg = JSON.parse(m.toString());
      if (msg.setup) {
        setupModel = msg.setup.model;
        sock.send(JSON.stringify({ setupComplete: {} }));
      }
      if (msg.realtimeInput?.audio) sock.send(JSON.stringify({ serverContent: { inputTranscription: { text: "筑波銀行に定期預金があります", finished: true } } }));
    }),
  );

  const relay = createRelayServer({
    project: "demo-souzoku-mendan",
    location: "us-central1",
    upstreamUrl: () => `ws://127.0.0.1:${(fake.address() as AddressInfo).port}`,
    getAccessToken: async () => null,
    ticketStore: firestoreTicketStore(db),
    usage: firestoreUsageRecorder(db, 0.54),
  });
  await new Promise<void>((r) => relay.listen(0, "127.0.0.1", r));
  const relayUrl = `http://127.0.0.1:${(relay.address() as AddressInfo).port}`;

  const caseId = `relaytest-${Date.now()}`;
  const connect = (ticket: string) => {
    const got: LiveServerMessage[] = [];
    const ai = new GoogleGenAI({ vertexai: true, apiKey: "relay", httpOptions: { baseUrl: `${relayUrl}/t/${ticket}` } });
    const p = ai.live.connect({ model: MODEL, config: { inputAudioTranscription: { languageCodes: ["ja-JP"] } }, callbacks: { onmessage: (m) => got.push(m), onerror: () => undefined, onclose: () => undefined } });
    return { p, got };
  };
  const settle = (p: Promise<unknown>) => Promise.race([p.then(() => "open", () => "error"), wait(800).then(() => "pending")]);

  console.log("■ チケット（Firestore）→ 中継 → Vertex AI（偽）");
  const t1 = await issueRelayTicket(db, { uid: "u1", caseId, meetingId: "m1", model: MODEL });
  const c1 = connect(t1.ticket);
  const s1 = await c1.p;
  s1.sendRealtimeInput({ audio: { data: Buffer.alloc(64000).toString("base64"), mimeType: "audio/pcm;rate=16000" } });
  await wait(400);
  ok(c1.got.some((m) => m.serverContent?.inputTranscription?.text === "筑波銀行に定期預金があります"), "発行したチケットで接続し、文字起こしが届く");
  ok(setupModel === `projects/demo-souzoku-mendan/locations/us-central1/publishers/google/models/${MODEL}`, "モデルはプロジェクトのフルパスに固定される");
  s1.close();
  await wait(500);
  const meeting = (await db.doc(`cases/${caseId}/meetings/m1`).get()).data();
  ok(Math.abs((meeting?.usage?.audioSeconds ?? 0) - 2) < 0.1, `音声時間（2秒）が面談の使用量に記録される（${meeting?.usage?.audioSeconds}秒）`);

  console.log("■ チケットの制限");
  ok((await settle(connect(t1.ticket).p)) !== "open", "同じチケットは2回使えない");
  const expired = await issueRelayTicket(db, { uid: "u1", caseId, meetingId: "m1", model: MODEL, ttlMs: -1000 });
  ok((await settle(connect(expired.ticket).p)) !== "open", "期限切れのチケットは使えない");
  ok((await settle(connect("not-a-real-ticket-0000000000000").p)) !== "open", "存在しないチケットは使えない");
  const stored = (await db.collection("liveTickets").get()).docs.map((d) => d.id);
  ok(stored.every((id) => /^[0-9a-f]{64}$/.test(id)) && !stored.includes(t1.ticket), "Firestore にはチケットそのものではなくハッシュ値だけを保存");

  relay.close();
  fake.close();
  console.log(failures ? `\n中継の結合テスト: ${failures} 件失敗` : "\n中継の結合テスト: すべて成功");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
