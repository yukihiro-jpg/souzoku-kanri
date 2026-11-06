/**
 * 精度検証（指示書 16.）
 *
 *   npm run eval                       … 簡易解析器（mock）で評価の仕組みを確認（APIキー不要）
 *   ANTHROPIC_API_KEY=... npm run eval -- --mode=claude [--model=claude-sonnet-5-5] [--effort=low]
 *
 * 本番と同じ「プロンプト・構造化出力・統合ロジック・ルールエンジン」を使い、
 * 架空の面談を発言ごとに解析して指標を計算する。結果は eval/results/ に保存。
 * ※ claude モードは実際に API 料金が発生します（10シナリオで数十回の呼び出し）。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import {
  CHECK_ITEM_MASTER,
  DEFAULT_RULES,
  DEFAULT_SETTINGS,
  DOCUMENT_MASTER_BY_ID,
  AnalysisOutputSchema,
  applyAnalysis,
  buildSystemPrompt,
  buildUserPrompt,
  initialCheckItems,
  isActiveEntity,
  mockAnalyze,
  similarText,
  type AnalysisOutput,
  type CaseState,
  type Entity,
  type MergeResult,
  type TranscriptSegment,
} from "@mendan/shared";
import { callStructured, toEffort, type ClaudeUsage } from "../functions/src/claudeCore.js";
import { SCENARIOS, type Scenario } from "./scenarios.js";

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")) as [string, string][]);
const mode = (args.mode ?? "mock") as "mock" | "claude";
const model = args.model ?? "claude-sonnet-5-5";
const effort = toEffort(args.effort ?? "low", "low");
const only = args.only;
const SYSTEM = buildSystemPrompt(CHECK_ITEM_MASTER);

function commit(state: CaseState, r: MergeResult): CaseState {
  const up = <T extends { id: string }>(base: T[], ch: T[]) => {
    const m = new Map(base.map((x) => [x.id, x]));
    for (const c of ch) m.set(c.id, c);
    return [...m.values()];
  };
  return { entities: up(state.entities, r.entities), checkItems: up(state.checkItems, r.checkItems), documents: up(state.documents, r.documents) };
}

const entText = (e: Entity) => [e.label, ...Object.values(e.attributes).map((a) => a.value)].join(" ");
const pct = (n: number, d: number) => (d === 0 ? "―" : `${((n / d) * 100).toFixed(1)}%`);

interface Result {
  id: string;
  title: string;
  entity: { hit: number; total: number; missing: string[] };
  docs: { hit: number; total: number; missing: string[] };
  forbidden: { hit: number; total: number; found: string[] };
  extraDocs: number;
  activeEntityDocs: number;
  corrections: { ok: number; total: number };
  checks: { ok: number; total: number; wrong: string[] };
  attrs: { ok: number; total: number };
  autoConfirmedWithoutEvidence: number;
  lockedChanged: number;
  evidenceCoverage: { ok: number; total: number };
  aiMs: number[];
  usage: ClaudeUsage[];
  errors: string[];
}

async function analyze(newSegs: TranscriptSegment[], ctxSegs: TranscriptSegment[], state: CaseState, sc: Scenario): Promise<{ out: AnalysisOutput; ms: number; usage?: ClaudeUsage }> {
  const t = Date.now();
  if (mode === "mock") return { out: mockAnalyze({ newSegments: newSegs, contextSegments: ctxSegs, entities: state.entities }), ms: Date.now() - t };
  const user = buildUserPrompt({ caseInfo: { decedentName: "（架空）", inheritanceStartDate: sc.deathDate }, entities: state.entities, checkItems: state.checkItems, contextSegments: ctxSegs, newSegments: newSegs });
  const r = await callStructured({ apiKey: process.env.ANTHROPIC_API_KEY ?? null, fallbacks: true, model, effort, system: SYSTEM, user, schema: AnalysisOutputSchema, maxTokens: 8000, timeoutMs: 60_000 });
  return { out: r.output, ms: Date.now() - t, usage: r.usage };
}

async function runScenario(sc: Scenario): Promise<Result> {
  let state: CaseState = { entities: [], checkItems: initialCheckItems("eval", CHECK_ITEM_MASTER, new Date().toISOString()), documents: [] };
  const segs: TranscriptSegment[] = [];
  const res: Result = {
    id: sc.id, title: sc.title,
    entity: { hit: 0, total: 0, missing: [] }, docs: { hit: 0, total: 0, missing: [] }, forbidden: { hit: 0, total: 0, found: [] },
    extraDocs: 0, activeEntityDocs: 0, corrections: { ok: 0, total: 0 }, checks: { ok: 0, total: 0, wrong: [] }, attrs: { ok: 0, total: 0 },
    autoConfirmedWithoutEvidence: 0, lockedChanged: 0, evidenceCoverage: { ok: 0, total: 0 }, aiMs: [], usage: [], errors: [],
  };
  let n = 0;
  let locked: Entity | null = null;
  let pending: TranscriptSegment[] = [];
  const flush = async () => {
    if (!pending.length) return;
    const batch = pending;
    pending = [];
    const ctxSegs = segs.filter((x) => !batch.includes(x)).slice(-12);
    try {
      const { out, ms, usage } = await analyze(batch, ctxSegs, state, sc);
      res.aiMs.push(ms);
      if (usage) res.usage.push(usage);
      const r = applyAnalysis(state, out, {
        caseId: "eval", meetingId: "m", actor: "ai:eval", now: new Date().toISOString(), today: "2026-11-06",
        segmentSeq: new Map(segs.map((x) => [x.id, x.seq])), rules: DEFAULT_RULES, documentMaster: DOCUMENT_MASTER_BY_ID,
        checkMaster: CHECK_ITEM_MASTER, settings: DEFAULT_SETTINGS, deathDate: sc.deathDate, newId: (p) => `${p}_${++n}`, mode: "realtime",
      });
      state = commit(state, r);
    } catch (e) {
      res.errors.push((e as Error).message);
    }
  };

  for (let i = 0; i < sc.lines.length; i++) {
    const l = sc.lines[i];
    const seg: TranscriptSegment = {
      id: `seg_${sc.id}_${String(i + 1).padStart(3, "0")}`, caseId: "eval", meetingId: "m", seq: i + 1, speaker: l.speaker, speakerLabel: null,
      speakerConfirmed: true, text: l.text, final: true, kind: "speech", analysisStatus: "pending", timings: { finalAt: Date.now() }, createdAt: "", createdBy: "eval",
    };
    // 画面側と同じ重複検出（再接続後の二重確定）
    const dup = segs.slice(-5).some((p) => similarText(p.text, l.text));
    segs.push(seg);
    if (dup) continue;
    pending.push(seg);
    // 画面側と同じく、短い発言は次とまとめる
    if (pending.reduce((a, p) => a + p.text.length, 0) >= 14 || i === sc.lines.length - 1) await flush();
    // 指定行の解析後に担当者が承認（以後の訂正発言で AI が変更しないことを確認）
    if (sc.lockAfterLine && i + 1 >= sc.lockAfterLine.line && !locked) {
      const e = state.entities.find((x) => x.type === sc.lockAfterLine!.type && entText(x).includes(sc.lockAfterLine!.match) && isActiveEntity(x));
      if (e) {
        e.lockedByUser = true;
        e.status = "confirmed";
        locked = structuredClone(e);
      }
    }
  }
  await flush();

  // ---- 評価 ----
  const active = state.entities.filter((e) => isActiveEntity(e) && e.assertion !== "absent");
  for (const x of sc.expect.entities) {
    res.entity.total++;
    if (active.some((e) => e.type === x.type && entText(e).includes(x.match))) res.entity.hit++;
    else res.entity.missing.push(`${x.type}:${x.match}`);
  }
  const live = state.documents.filter((d) => d.status === "candidate");
  const docMatch = (d: { documentId: string; target: string | null; name: string }, x: { documentId: string; target?: string }) => d.documentId === x.documentId && (!x.target || (d.target ?? d.name).includes(x.target));
  for (const x of sc.expect.documents) {
    res.docs.total++;
    if (live.some((d) => docMatch(d, x))) res.docs.hit++;
    else res.docs.missing.push(`${x.documentId}:${x.target ?? ""}`);
  }
  for (const x of sc.expect.forbidden ?? []) {
    res.forbidden.total++;
    const f = live.filter((d) => docMatch(d, x));
    if (f.length) {
      res.forbidden.hit++;
      res.forbidden.found.push(...f.map((d) => d.name));
    }
  }
  const entityDocs = live.filter((d) => d.entityId);
  res.activeEntityDocs = entityDocs.length;
  const expectedTargets = sc.expect.entities.map((x) => x.match);
  res.extraDocs = entityDocs.filter((d) => !expectedTargets.some((t) => (d.target ?? d.name).includes(t))).length;
  for (const x of sc.expect.retracted ?? []) {
    res.corrections.total++;
    const old = state.entities.filter((e) => e.type === x.type && entText(e).includes(x.match));
    if (old.length && old.every((e) => !isActiveEntity(e))) res.corrections.ok++;
  }
  for (const x of sc.expect.checks ?? []) {
    res.checks.total++;
    const c = state.checkItems.find((y) => y.id === x.id);
    if (c && x.status.includes(c.status)) res.checks.ok++;
    else res.checks.wrong.push(`${x.id}=${c?.status}`);
  }
  for (const x of sc.expect.attributes ?? []) {
    res.attrs.total++;
    const e = active.find((y) => y.type === x.type && entText(y).includes(x.match));
    if (e && Object.values(e.attributes).some((a) => a.value.includes(x.value))) res.attrs.ok++;
  }
  res.autoConfirmedWithoutEvidence = state.documents.filter((d) => d.decidedBy === "rule" && (!["candidate", "removal_candidate"].includes(d.status) || (d.entityId && d.evidenceSegmentIds.length === 0))).length;
  if (locked) {
    const now = state.entities.find((e) => e.id === locked!.id)!;
    if (JSON.stringify(now.attributes) !== JSON.stringify(locked.attributes) || now.status !== "confirmed") res.lockedChanged++;
  }
  const segIds = new Set(segs.map((x) => x.id));
  for (const e of active) {
    res.evidenceCoverage.total++;
    if (e.evidenceSegmentIds.length && e.evidenceSegmentIds.every((id) => segIds.has(id))) res.evidenceCoverage.ok++;
  }
  return res;
}

function percentile(v: number[], p: number) {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
}

async function main() {
  if (mode === "claude" && !process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY を設定してください（例: ANTHROPIC_API_KEY=sk-... npm run eval -- --mode=claude）");
    process.exit(1);
  }
  console.log(`評価モード: ${mode}${mode === "claude" ? `（${model} / effort=${effort}）` : "（簡易解析器・精度の参考にはなりません）"}\n`);
  const results: Result[] = [];
  for (const sc of SCENARIOS.filter((x) => !only || x.id.startsWith(only))) {
    const r = await runScenario(sc);
    results.push(r);
    const flag = r.entity.missing.length || r.docs.missing.length || r.forbidden.hit || r.checks.wrong.length || r.errors.length ? "△" : "○";
    console.log(`${flag} ${r.id} ${r.title}`);
    if (r.entity.missing.length) console.log(`    抽出漏れ: ${r.entity.missing.join(", ")}`);
    if (r.docs.missing.length) console.log(`    資料漏れ: ${r.docs.missing.join(", ")}`);
    if (r.forbidden.found.length) console.log(`    不要な資料: ${r.forbidden.found.join(", ")}`);
    if (r.checks.wrong.length) console.log(`    確認事項: ${r.checks.wrong.join(", ")}`);
    if (r.errors.length) console.log(`    エラー: ${r.errors.join(" / ")}`);
  }
  const sum = (f: (r: Result) => number) => results.reduce((a, r) => a + f(r), 0);
  const ms = results.flatMap((r) => r.aiMs);
  const usage = results.flatMap((r) => r.usage);
  const rows: [string, string, string][] = [
    ["重要な事実（財産・人物）の抽出再現率", pct(sum((r) => r.entity.hit), sum((r) => r.entity.total)), "99%以上"],
    ["必要資料の抽出再現率", pct(sum((r) => r.docs.hit), sum((r) => r.docs.total)), "99%以上"],
    ["無関係な資料の追加（禁止資料の混入率）", pct(sum((r) => r.forbidden.hit), sum((r) => r.forbidden.total)), "0%"],
    ["期待外の財産に基づく資料の割合（参考）", pct(sum((r) => r.extraDocs), sum((r) => r.activeEntityDocs)), "低いほど良い"],
    ["発言訂正の正確性", pct(sum((r) => r.corrections.ok), sum((r) => r.corrections.total)), "100%"],
    ["確認事項の状態の正確性（分からない・該当なし等）", pct(sum((r) => r.checks.ok), sum((r) => r.checks.total)), "―"],
    ["属性（支店名等）の正確性", pct(sum((r) => r.attrs.ok), sum((r) => r.attrs.total)), "―"],
    ["根拠発言との対応率", pct(sum((r) => r.evidenceCoverage.ok), sum((r) => r.evidenceCoverage.total)), "100%"],
    ["根拠が確認できない資料の自動確定", `${sum((r) => r.autoConfirmedWithoutEvidence)}件`, "0件"],
    ["承認済み情報の無断変更", `${sum((r) => r.lockedChanged)}件`, "0件"],
    ["解析時間 P50 / P95", `${(percentile(ms, 50) / 1000).toFixed(2)}秒 / ${(percentile(ms, 95) / 1000).toFixed(2)}秒`, "2〜5秒"],
    ["API呼び出し回数 / 入力・出力トークン", `${usage.length}回 / ${usage.reduce((a, u) => a + u.inputTokens + u.cacheReadTokens + u.cacheWriteTokens, 0)}・${usage.reduce((a, u) => a + u.outputTokens, 0)}`, "―"],
  ];
  console.log("\n指標                                         結果            目標");
  for (const [k, v, g] of rows) console.log(`${k.padEnd(28, "　")} ${v.padEnd(16)} ${g}`);
  mkdirSync("eval/results", { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  writeFileSync(`eval/results/${mode}-${stamp}.json`, JSON.stringify({ mode, model, effort, rows, results }, null, 2));
  console.log(`\n詳細: eval/results/${mode}-${stamp}.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
