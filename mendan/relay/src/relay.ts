import { createHash } from "node:crypto";
import http from "node:http";
import { WebSocket, WebSocketServer, type RawData } from "ws";

/**
 * Gemini Live（Vertex AI）文字起こしの中継サーバー
 *
 * なぜ中継が必要か：
 *  Vertex AI（後払い）は Google Cloud の権限で呼び出す必要があり、その権限をブラウザに渡せない。
 *  そこで、ブラウザ ⇔ この中継 ⇔ Vertex AI とつなぎ、Google Cloud の認証はこの中継だけが持つ。
 *
 * 守っていること：
 *  - 接続には Cloud Functions が発行した「1回限り・2分以内」のチケットが必要（案件・面談・担当者に紐づく）
 *  - モデルはチケットに書かれたものに固定（ブラウザ側で変更できない）
 *  - ブラウザから送れるのは「設定（最初の1回）」と「音声」だけ。それ以外の要求は捨てる
 *  - 会話内容はログに出さない（件数・時間だけ）
 *  - 文字起こしした音声の長さを数えて、料金の概算として記録する
 */

export interface Ticket {
  uid: string;
  caseId: string;
  meetingId: string;
  model: string;
}

export interface TicketStore {
  /** チケットを使用済みにして内容を返す。無効・期限切れ・使用済みなら null */
  consume(ticket: string): Promise<Ticket | null>;
}

export interface UsageRecorder {
  record(t: Ticket, audioSeconds: number): Promise<void>;
}

export interface RelayOptions {
  ticketStore: TicketStore;
  usage?: UsageRecorder;
  /** Vertex AI の WebSocket の URL（テストでは偽物を指定） */
  upstreamUrl: (location: string) => string;
  /** Google Cloud のアクセストークン（null なら認証ヘッダーなし＝テスト用） */
  getAccessToken: () => Promise<string | null>;
  project: string;
  location: string;
  /** 1接続の最長時間（ミリ秒） */
  maxSessionMs?: number;
  log?: (msg: string, data?: Record<string, unknown>) => void;
}

const PATH_RE = /^\/t\/([A-Za-z0-9_-]{20,200})\/ws\/google\.cloud\.aiplatform\.(v1beta1|v1)\.LlmBidiService\/BidiGenerateContent\/?$/;
/** setup で受け付ける項目（それ以外は捨てる） */
const SETUP_KEYS = ["model", "generationConfig", "inputAudioTranscription", "realtimeInputConfig", "sessionResumption", "contextWindowCompression"];
/** 音声以外の送信（会話の生成・ツール実行など）は受け付けない */
const REALTIME_KEYS = ["audio", "audioStreamEnd", "activityStart", "activityEnd", "mediaChunks"];
const MAX_MESSAGE_BYTES = 512 * 1024;

export function hashTicket(ticket: string): string {
  return createHash("sha256").update(ticket).digest("hex");
}

export function vertexHost(location: string): string {
  return location === "global" ? "aiplatform.googleapis.com" : `${location}-aiplatform.googleapis.com`;
}

export function defaultUpstreamUrl(location: string): string {
  return `wss://${vertexHost(location)}/ws/google.cloud.aiplatform.v1beta1.LlmBidiService/BidiGenerateContent`;
}

/** ブラウザから届いた setup を検査し、サーバーが決めた値で上書きする */
export function sanitizeSetup(setup: Record<string, unknown>, t: Ticket, project: string, location: string): Record<string, unknown> | { error: string } {
  const model = String(setup.model ?? "");
  const short = model.split("/").pop();
  if (short !== t.model) return { error: "model_not_allowed" };
  const out: Record<string, unknown> = {};
  for (const k of SETUP_KEYS) if (setup[k] !== undefined) out[k] = setup[k];
  out.model = `projects/${project}/locations/${location}/publishers/google/models/${t.model}`;
  const gc = (setup.generationConfig ?? {}) as Record<string, unknown>;
  out.generationConfig = { responseModalities: Array.isArray(gc.responseModalities) ? gc.responseModalities : ["TEXT"] };
  return out;
}

/** 音声データ（base64）の長さから秒数を求める（16kHz・16bit・モノラル = 32,000 バイト/秒） */
export function audioSecondsOf(msg: Record<string, unknown>): number {
  const ri = msg.realtimeInput as Record<string, unknown> | undefined;
  if (!ri) return 0;
  const chunks: { data?: string; mimeType?: string }[] = [];
  if (ri.audio) chunks.push(ri.audio as { data?: string });
  if (Array.isArray(ri.mediaChunks)) chunks.push(...(ri.mediaChunks as { data?: string }[]));
  let bytes = 0;
  for (const c of chunks) if (typeof c?.data === "string") bytes += Math.floor((c.data.length * 3) / 4);
  return bytes / 32000;
}

export function createRelayServer(opts: RelayOptions): http.Server {
  const log = opts.log ?? (() => undefined);
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  const server = http.createServer((req, res) => {
    if (req.url === "/healthz") {
      res.writeHead(200, { "content-type": "text/plain" }).end("ok");
      return;
    }
    res.writeHead(404).end();
  });

  server.on("upgrade", async (req, socket, head) => {
    const m = PATH_RE.exec((req.url ?? "").split("?")[0]);
    if (!m) {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return;
    }
    let ticket: Ticket | null = null;
    try {
      ticket = await opts.ticketStore.consume(m[1]);
    } catch (e) {
      log("ticket check failed", { message: (e as Error).message });
    }
    if (!ticket) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      log("rejected: invalid ticket");
      return;
    }
    const t = ticket;
    wss.handleUpgrade(req, socket, head, (client) => void bridge(client, t));
  });

  async function bridge(client: WebSocket, t: Ticket) {
    const started = Date.now();
    let audioSeconds = 0;
    let setupDone = false;
    let closed = false;
    const pending: string[] = [];
    let upstream: WebSocket | null = null;

    const finish = async (code: number, reason: string) => {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      try {
        if (client.readyState === WebSocket.OPEN) client.close(code, reason.slice(0, 120));
      } catch {
        /* noop */
      }
      try {
        if (upstream && (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING)) upstream.close();
      } catch {
        /* noop */
      }
      log("session closed", { caseId: t.caseId, meetingId: t.meetingId, seconds: Math.round((Date.now() - started) / 1000), audioSeconds: Math.round(audioSeconds), code });
      if (audioSeconds > 0 && opts.usage) {
        try {
          await opts.usage.record(t, audioSeconds);
        } catch (e) {
          log("usage record failed", { message: (e as Error).message });
        }
      }
    };
    const timer = setTimeout(() => void finish(4000, "max session time"), opts.maxSessionMs ?? 3 * 3600_000);

    // ブラウザ → 中継
    client.on("message", (data: RawData) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (!setupDone) {
        if (!msg.setup) return void finish(4002, "setup required");
        const s = sanitizeSetup(msg.setup as Record<string, unknown>, t, opts.project, opts.location);
        if ("error" in s) return void finish(4003, String(s.error));
        setupDone = true;
        send(JSON.stringify({ setup: s }));
        return;
      }
      const ri = msg.realtimeInput as Record<string, unknown> | undefined;
      if (!ri || Object.keys(msg).length !== 1 || Object.keys(ri).some((k) => !REALTIME_KEYS.includes(k))) return; // 音声以外は捨てる
      audioSeconds += audioSecondsOf(msg);
      send(JSON.stringify({ realtimeInput: ri }));
    });
    client.on("close", () => void finish(1000, "client closed"));
    client.on("error", () => void finish(1011, "client error"));

    const send = (s: string) => {
      if (upstream?.readyState === WebSocket.OPEN) upstream.send(s);
      else pending.push(s);
    };

    // 中継 → Vertex AI
    try {
      const token = await opts.getAccessToken();
      upstream = new WebSocket(opts.upstreamUrl(opts.location), token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);
    } catch (e) {
      log("upstream auth failed", { message: (e as Error).message });
      return void finish(1011, "upstream auth failed");
    }
    upstream.on("open", () => {
      for (const s of pending.splice(0)) upstream!.send(s);
    });
    upstream.on("message", (data: RawData, isBinary: boolean) => {
      if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary });
    });
    upstream.on("close", (code: number, reason: Buffer) => void finish(code === 1000 || code === 1005 ? 1000 : 4001, `upstream closed: ${code} ${reason.toString()}`));
    upstream.on("error", (e: Error) => {
      log("upstream error", { message: e.message });
      void finish(1011, "upstream error");
    });
  }

  return server;
}
