import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { GoogleAuth } from "google-auth-library";
import { firestoreTicketStore, firestoreUsageRecorder } from "./firestoreStores.js";
import { createRelayServer, defaultUpstreamUrl } from "./relay.js";

/**
 * 本番の起動（Cloud Run）
 *  環境変数:
 *   GOOGLE_CLOUD_PROJECT … Google Cloud のプロジェクトID（Cloud Run では自動設定されないため指定する）
 *   VERTEX_LOCATION      … Vertex AI の場所（既定 global。gemini-3.5-transcribe-live は global / us / eu のみ提供）
 *   USD_PER_AUDIO_HOUR   … 料金の概算（USD / 音声1時間）
 *   PORT                 … Cloud Run が設定
 */
initializeApp();
const db = getFirestore();
const project = process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCLOUD_PROJECT ?? "";
const location = process.env.VERTEX_LOCATION ?? "global";
const usdPerHour = Number(process.env.USD_PER_AUDIO_HOUR ?? "0.54") || 0;
if (!project) throw new Error("GOOGLE_CLOUD_PROJECT が未設定です");

const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
const log = (msg: string, data?: Record<string, unknown>) => console.log(JSON.stringify({ severity: "INFO", message: msg, ...data }));

const server = createRelayServer({
  project,
  location,
  log,
  upstreamUrl: defaultUpstreamUrl,
  getAccessToken: async () => (await auth.getAccessToken()) ?? null,
  ticketStore: firestoreTicketStore(db),
  usage: firestoreUsageRecorder(db, usdPerHour),
});

const port = Number(process.env.PORT ?? 8080);
server.listen(port, () => log("relay listening", { port, location }));
