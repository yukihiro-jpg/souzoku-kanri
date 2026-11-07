import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type http from "node:http";
import { WebSocketServer } from "ws";
import { GoogleGenAI, type LiveServerMessage } from "@google/genai/web";
import { audioSecondsOf, createRelayServer, sanitizeSetup, type Ticket } from "../src/relay.js";

/**
 * 中継サーバーの検証。ブラウザと同じ「Google公式SDK（Vertexモード）」で接続し、
 * 偽の Vertex AI サーバーとの間でやり取りが正しく中継・制限されることを確認する。
 */

const TICKET_OK = "t".repeat(32);
const TICKET_USED = "u".repeat(32);
const MODEL = "gemini-3.5-transcribe-live";

let upstreamSeen: Record<string, unknown>[] = [];
let upstreamAuth: string | undefined;
let upstreamPort = 0;
let relayPort = 0;
let fake: WebSocketServer;
let relay: http.Server;
const tickets = new Map<string, Ticket & { used?: boolean }>();
const usage: { t: Ticket; seconds: number }[] = [];

beforeAll(async () => {
  fake = new WebSocketServer({ port: 0 });
  await new Promise((r) => fake.on("listening", r));
  upstreamPort = (fake.address() as AddressInfo).port;
  fake.on("connection", (sock, req) => {
    upstreamAuth = req.headers.authorization;
    sock.on("message", (m) => {
      const msg = JSON.parse(m.toString());
      upstreamSeen.push(msg);
      if (msg.setup) {
        sock.send(JSON.stringify({ setupComplete: {} }));
        sock.send(JSON.stringify({ sessionResumptionUpdate: { newHandle: "h1", resumable: true } }));
      }
      if (msg.realtimeInput?.audio) {
        sock.send(JSON.stringify({ serverContent: { interimInputTranscription: { text: "常陽銀行に" } } }));
        sock.send(JSON.stringify({ serverContent: { inputTranscription: { text: "常陽銀行に口座があります", finished: true } } }));
      }
    });
  });
  tickets.set(TICKET_OK, { uid: "u1", caseId: "c1", meetingId: "m1", model: MODEL });
  tickets.set(TICKET_USED, { uid: "u1", caseId: "c1", meetingId: "m1", model: MODEL, used: true });
  relay = createRelayServer({
    project: "proj-x",
    location: "us-central1",
    upstreamUrl: () => `ws://127.0.0.1:${upstreamPort}/vertex`,
    getAccessToken: async () => "test-token",
    ticketStore: {
      async consume(ticket) {
        const t = tickets.get(ticket);
        if (!t || t.used) return null;
        t.used = true;
        return t;
      },
    },
    usage: { record: async (t, seconds) => void usage.push({ t, seconds }) },
  });
  await new Promise<void>((r) => relay.listen(0, "127.0.0.1", r));
  relayPort = (relay.address() as AddressInfo).port;
});

afterAll(() => {
  relay.close();
  fake.close();
});

function connect(ticket: string, model = MODEL) {
  const ai = new GoogleGenAI({ vertexai: true, apiKey: "relay", httpOptions: { baseUrl: `http://127.0.0.1:${relayPort}/t/${ticket}` } });
  const got: LiveServerMessage[] = [];
  let closed: { code: number } | null = null;
  const p = ai.live.connect({
    model,
    config: {
      responseModalities: ["TEXT" as never],
      inputAudioTranscription: { languageCodes: ["ja-JP"], customVocabulary: ["常陽銀行"] },
      sessionResumption: { transparent: true },
    },
    callbacks: { onmessage: (m) => got.push(m), onclose: (e: CloseEvent) => (closed = { code: e.code }), onerror: () => undefined },
  });
  return { p, got, closed: () => closed };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("中継サーバー", () => {
  it("有効なチケットで接続でき、文字起こし（暫定・確定）が届く。モデルはプロジェクトのフルパスに書き換わる", async () => {
    upstreamSeen = [];
    const c = connect(TICKET_OK);
    const s = await c.p;
    // 1秒分の音声（16kHz・16bit = 32,000 バイト）
    s.sendRealtimeInput({ audio: { data: Buffer.alloc(32000).toString("base64"), mimeType: "audio/pcm;rate=16000" } });
    await wait(300);
    expect(upstreamAuth).toBe("Bearer test-token");
    const setup = upstreamSeen[0].setup as Record<string, unknown>;
    expect(setup.model).toBe(`projects/proj-x/locations/us-central1/publishers/google/models/${MODEL}`);
    expect(setup.inputAudioTranscription).toMatchObject({ customVocabulary: ["常陽銀行"] });
    expect(c.got.some((m) => m.serverContent?.interimInputTranscription?.text === "常陽銀行に")).toBe(true);
    expect(c.got.some((m) => m.serverContent?.inputTranscription?.finished === true)).toBe(true);
    expect(c.got.some((m) => m.sessionResumptionUpdate?.newHandle === "h1")).toBe(true);
    s.close();
    await wait(200);
    expect(usage.at(-1)?.seconds).toBeCloseTo(1, 1);
    expect(usage.at(-1)?.t.meetingId).toBe("m1");
  });

  /** 拒否された接続は SDK の connect() が完了しないため、一定時間後の状態で判定する */
  const settle = (p: Promise<unknown>, ms = 600) => Promise.race([p.then(() => "open", () => "error"), wait(ms).then(() => "pending")]);

  it("同じチケットは2回使えない", async () => {
    upstreamSeen = [];
    const c = connect(TICKET_OK);
    expect(await settle(c.p)).not.toBe("open");
    expect(upstreamSeen).toHaveLength(0);
  });

  it("使用済み・存在しないチケットは拒否される", async () => {
    for (const t of [TICKET_USED, "x".repeat(32)]) {
      upstreamSeen = [];
      const c = connect(t);
      expect(await settle(c.p)).not.toBe("open");
      expect(upstreamSeen).toHaveLength(0);
    }
  });

  it("チケットと違うモデルは拒否される（ブラウザ側でモデルを変えられない）", async () => {
    tickets.set("m".repeat(32), { uid: "u1", caseId: "c1", meetingId: "m1", model: MODEL });
    upstreamSeen = [];
    const c = connect("m".repeat(32), "gemini-3.5-pro");
    await settle(c.p);
    await wait(300);
    expect(upstreamSeen.filter((x) => x.setup)).toHaveLength(0);
    expect(c.closed()?.code).toBe(4003);
  });

  it("音声以外の送信（会話の生成など）は Vertex AI に送らない", async () => {
    tickets.set("v".repeat(32), { uid: "u1", caseId: "c1", meetingId: "m1", model: MODEL });
    upstreamSeen = [];
    const c = connect("v".repeat(32));
    const s = await c.p;
    s.sendClientContent({ turns: [{ role: "user", parts: [{ text: "別の用途に使う" }] }] });
    await wait(300);
    expect(upstreamSeen.some((x) => "clientContent" in x)).toBe(false);
    s.close();
  });
});

describe("制限と計算", () => {
  it("setup の不要な項目（指示文・ツール等）は捨て、応答形式は文字のみ", () => {
    const s = sanitizeSetup(
      { model: `publishers/google/models/${MODEL}`, systemInstruction: { parts: [{ text: "x" }] }, tools: [{}], generationConfig: { responseModalities: ["TEXT"], temperature: 2 }, inputAudioTranscription: {} },
      { uid: "u", caseId: "c", meetingId: "m", model: MODEL },
      "p",
      "l",
    ) as Record<string, unknown>;
    expect(s.systemInstruction).toBeUndefined();
    expect(s.tools).toBeUndefined();
    expect(s.generationConfig).toEqual({ responseModalities: ["TEXT"] });
  });
  it("音声の長さを base64 の長さから計算する", () => {
    expect(audioSecondsOf({ realtimeInput: { audio: { data: Buffer.alloc(16000).toString("base64") } } })).toBeCloseTo(0.5, 2);
  });
});
