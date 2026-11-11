import { HttpsError, onCall } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import {
  P,
  blockingReason,
  buildRuleRunSystemPrompt,
  buildRuleRunUserPrompt,
  checkItem,
  extractDictionary,
  findReadingHints,
  geminiSummary,
  mockRuleRun,
  parseGeminiTranscript,
  planDocEdits,
  sectionsOf,
  toDocModel,
  toRuleItems,
  type ClientCard,
  type ClientDoc,
  type DocParagraph,
  type RuleItem,
  type RuleRun,
  type RuleSection,
  type RuleTarget,
} from "@mendan/shared";
import { requireRole, requireUser } from "../auth.js";
import { analyzeRuleRun, claudeConfigured, type ClaudeUsage } from "../claude.js";
import { AI_MODE, ANTHROPIC_API_KEY, GOOGLE_OAUTH_CLIENT_SECRET, OAUTH_TOKEN_KEY, REGION } from "../config.js";
import { budgetStatus, recordClaudeUsage } from "../cost.js";
import { db, loadMasters, newId, nowIso, todayJst } from "../db.js";
import { clientAudit, requireClient } from "./clients.js";
import { RevisionMismatchError, docsFor } from "./google.js";

/**
 * 顧問モード：打ち合わせメモ → ルール集への反映
 *   startRuleRun : メモとルール集を読み、AI が3つに振り分け、プログラムが確かめて「提案」として保存
 *   decideRuleItem: 税理士が承認・修正・却下（承認できない状態なら理由を返す）
 *   applyRuleRun : 承認されたものだけを書き込む（ルール集は解析時の版から変わっていないことを確かめてから）
 * AI に渡すのは、その顧問先のメモとルール集だけ（他の顧問先の情報は読まない）。
 */

/** 承認後の確認に使うルール集の写し（章と段落の文字だけ） */
type SectionSnapshot = { heading: string; level: number; paragraphs: { text: string; inTable: boolean }[] };
const snapshot = (secs: RuleSection[]): SectionSnapshot[] => secs.map((s) => ({ heading: s.heading, level: s.level, paragraphs: s.paragraphs.map((p) => ({ text: p.text, inTable: p.inTable })) }));
const fromSnapshot = (snap: SectionSnapshot[]): RuleSection[] =>
  snap.map((s) => ({
    heading: s.heading,
    level: s.level,
    headingStart: 0,
    headingEnd: 0,
    endIndex: 0,
    paragraphs: s.paragraphs.map((p) => ({ ...p, startIndex: 0, endIndex: 0, style: "NORMAL_TEXT", bullet: false }) as DocParagraph),
    text: s.paragraphs.map((p) => p.text.replace(/\n$/, "")).join("\n"),
  }));

const targetFor = (c: ClientDoc, t: RuleTarget | null): RuleTarget => {
  if (t === "skill") return "skill";
  return c.accountingSystem === "mf" ? "mf_rules" : "client_rulebook";
};

export const startRuleRun = onCall(
  { region: REGION, secrets: [ANTHROPIC_API_KEY, GOOGLE_OAUTH_CLIENT_SECRET, OAUTH_TOKEN_KEY], timeoutSeconds: 540, memory: "1GiB" },
  async (req) => {
    const actor = await requireUser(req);
    requireRole(actor, ["admin", "staff"]);
    const d = (req.data ?? {}) as { clientId: string; notesDocId: string; notesDocName?: string };
    const c = await requireClient(actor, d.clientId, true);
    if (!d.notesDocId || typeof d.notesDocId !== "string") throw new HttpsError("invalid-argument", "打ち合わせメモ（Google ドキュメント）を選んでください。");
    if (c.accountingSystem === "kaikei_taisho" && !c.rulebookDocId) throw new HttpsError("failed-precondition", "この顧問先のルール集がまだ登録されていません。顧問先の画面で「ルール集を選ぶ」から登録してください。");
    const masters = await loadMasters();
    const budget = await budgetStatus(masters.settings);
    if (budget.state === "over") throw new HttpsError("resource-exhausted", `今月の AI 料金が上限（$${budget.budget}）に達しているため実行できません。`);
    if (AI_MODE.value() !== "mock" && !claudeConfigured()) throw new HttpsError("failed-precondition", "Claude の API キーが設定されていません。");

    const docs = await docsFor(actor.uid);
    const notes = toDocModel(await docs.getDocument(d.notesDocId));
    const segments = parseGeminiTranscript(notes);
    if (segments.length === 0) throw new HttpsError("failed-precondition", "このドキュメントに文字起こしが見つかりません。「Gemini によるメモ」の、文字起こしのタブがあるドキュメントを選んでください。");
    const rulebook = c.rulebookDocId ? toDocModel(await docs.getDocument(c.rulebookDocId)) : null;
    const sections = rulebook ? sectionsOf(rulebook.tabs[0]) : [];
    const hints = findReadingHints(extractDictionary(sections), segments);

    const runRef = db.collection(P.ruleRuns(c.id)).doc();
    const now = nowIso();
    const run: RuleRun & { rulebookSnapshot: SectionSnapshot[] } = {
      id: runRef.id,
      clientId: c.id,
      notesDocId: d.notesDocId,
      notesDocName: (d.notesDocName || notes.title).slice(0, 300),
      notesRevisionId: notes.revisionId,
      rulebookDocId: c.rulebookDocId,
      rulebookRevisionId: rulebook?.revisionId ?? null,
      segments,
      hints,
      status: "analyzing",
      error: null,
      model: null,
      usd: 0,
      createdBy: actor.uid,
      createdAt: now,
      updatedAt: now,
      rulebookSnapshot: snapshot(sections),
    };
    await runRef.set(run);
    const jobId = newId("rulejob");
    const t0 = Date.now();
    try {
      let output;
      let usage: ClaudeUsage | null = null;
      if (AI_MODE.value() === "mock") output = mockRuleRun(segments, sections, hints);
      else {
        const r = await analyzeRuleRun(
          buildRuleRunSystemPrompt(),
          buildRuleRunUserPrompt({ client: c, sections, hints, summary: geminiSummary(notes), segments }),
        );
        output = r.output;
        usage = r.usage;
      }
      const items = toRuleItems(output, segments, sections, () => db.collection("_").doc().id).map((it) => {
        if (it.bucket !== "rule") return it;
        const fixed = { ...it, target: targetFor(c, it.target) };
        return { ...fixed, checks: checkItem(fixed, sections) };
      });
      const usd = usage ? await recordClaudeUsage({ caseId: "", clientId: c.id, meetingId: null, jobId, kind: "rule_run" }, usage) : 0;
      const batch = db.batch();
      for (const it of items) batch.set(db.doc(P.ruleItem(c.id, runRef.id, it.id)), it);
      batch.update(runRef, { status: "review", model: usage?.servedModel ?? (AI_MODE.value() === "mock" ? "mock" : null), usd, updatedAt: nowIso() });
      // AI に渡した入力の記録（どの顧問先のどのドキュメントか。他の顧問先が混ざっていないことを後から確かめられる）
      batch.set(db.doc(`${P.clientAiJobs(c.id)}/${jobId}`), {
        kind: "rule_run",
        runId: runRef.id,
        clientId: c.id,
        inputDocs: [d.notesDocId, ...(c.rulebookDocId ? [c.rulebookDocId] : [])],
        segments: segments.length,
        items: items.length,
        ms: Date.now() - t0,
        usd,
        at: nowIso(),
      });
      clientAudit(batch, c.id, { actor: actor.uid, action: "rule_run_created", target: runRef.id, detail: { notesDocId: d.notesDocId, items: items.length } });
      await batch.commit();
      return { runId: runRef.id, items: items.length, segments: segments.length, hints: hints.length };
    } catch (e) {
      logger.error("rule run failed", { clientId: c.id, runId: runRef.id, message: (e as Error).message });
      await runRef.update({ status: "error", error: (e as Error).message.slice(0, 500), updatedAt: nowIso() });
      throw new HttpsError("internal", `振り分けに失敗しました: ${(e as Error).message}`);
    }
  },
);

type Edit = Partial<Pick<RuleItem, "title" | "summary" | "target" | "sectionHeading" | "operation" | "beforeText" | "afterText" | "cardKind" | "owner" | "due" | "amount" | "settlementPolicy">>;

export const decideRuleItem = onCall({ region: REGION }, async (req) => {
  const actor = await requireUser(req);
  requireRole(actor, ["admin", "staff"]);
  const d = (req.data ?? {}) as { clientId: string; runId: string; itemId: string; decision: "approve" | "reject" | "reset"; edit?: Edit; answer?: string; convertToRule?: boolean };
  const c = await requireClient(actor, d.clientId, true);
  const runRef = db.doc(P.ruleRun(c.id, d.runId));
  const ref = db.doc(P.ruleItem(c.id, d.runId, d.itemId));
  const [runSnap, snap] = await Promise.all([runRef.get(), ref.get()]);
  if (!runSnap.exists || !snap.exists) throw new HttpsError("not-found", "項目が見つかりません。");
  const run = runSnap.data() as RuleRun & { rulebookSnapshot?: SectionSnapshot[] };
  let item = snap.data() as RuleItem;
  if (item.status === "written" || item.status === "exported") throw new HttpsError("failed-precondition", "この項目はすでに書き込み済みです。");
  const e = d.edit ?? {};
  const allowed: (keyof Edit)[] = ["title", "summary", "target", "sectionHeading", "operation", "beforeText", "afterText", "cardKind", "owner", "due", "amount", "settlementPolicy"];
  for (const k of allowed) if (e[k] !== undefined) (item as unknown as Record<string, unknown>)[k] = typeof e[k] === "string" ? (e[k] as string).slice(0, 4000) : e[k];
  if (d.answer !== undefined) item.answer = String(d.answer).slice(0, 2000);
  if (d.convertToRule) {
    if (item.bucket !== "question") throw new HttpsError("failed-precondition", "ルール案に変えられるのは確認事項だけです。");
    item = { ...item, bucket: "rule", convertedFromQuestion: true, target: targetFor(c, item.target), operation: item.operation ?? "add", afterText: item.afterText ?? item.suggestedRule };
  }
  if (item.bucket === "rule") item.target = targetFor(c, item.target);
  item.checks = checkItem(item, fromSnapshot(run.rulebookSnapshot ?? []));
  if (d.decision === "approve") {
    const reason = blockingReason(item);
    if (reason) throw new HttpsError("failed-precondition", reason);
    item.status = "approved";
  } else if (d.decision === "reject") item.status = "rejected";
  else item.status = "proposed";
  item.decidedBy = d.decision === "reset" ? null : actor.uid;
  item.decidedAt = d.decision === "reset" ? null : nowIso();
  const batch = db.batch();
  batch.set(ref, item);
  clientAudit(batch, c.id, { actor: actor.uid, action: `rule_item_${d.decision}`, target: `${d.runId}/${d.itemId}`, detail: { bucket: item.bucket } });
  await batch.commit();
  return { item };
});

export const applyRuleRun = onCall({ region: REGION, secrets: [GOOGLE_OAUTH_CLIENT_SECRET, OAUTH_TOKEN_KEY], timeoutSeconds: 120 }, async (req) => {
  const actor = await requireUser(req);
  requireRole(actor, ["admin", "staff"]);
  const d = (req.data ?? {}) as { clientId: string; runId: string };
  const c = await requireClient(actor, d.clientId, true);
  const runRef = db.doc(P.ruleRun(c.id, d.runId));
  const runSnap = await runRef.get();
  if (!runSnap.exists) throw new HttpsError("not-found", "見つかりません。");
  const run = runSnap.data() as RuleRun;
  const itemsSnap = await db.collection(P.ruleItems(c.id, d.runId)).where("status", "==", "approved").get();
  const items = itemsSnap.docs.map((x) => x.data() as RuleItem);
  if (items.length === 0) throw new HttpsError("failed-precondition", "承認された項目がありません。");
  const today = todayJst();
  const now = nowIso();
  const toDocs = items.filter((i) => i.bucket === "rule" && i.target === "client_rulebook");
  const results: Record<string, { status: RuleItem["status"]; writeError?: string | null }> = {};
  const batch = db.batch();
  let newRevision: string | null = null;

  if (toDocs.length > 0) {
    if (!c.rulebookDocId || c.rulebookDocId !== run.rulebookDocId) throw new HttpsError("failed-precondition", "ルール集の登録が解析のあとに変わっています。もう一度「打ち合わせメモから反映」を実行してください。");
    const docs = await docsFor(actor.uid);
    const doc = toDocModel(await docs.getDocument(c.rulebookDocId));
    if (doc.revisionId !== run.rulebookRevisionId) {
      throw new HttpsError("failed-precondition", "解析のあとにルール集が編集されています。最新のルール集で確かめるため、もう一度「打ち合わせメモから反映」を実行してください。");
    }
    const tab = doc.tabs[0];
    const plan = planDocEdits(
      tab,
      toDocs.map((i) => ({ itemId: i.id, operation: i.operation ?? "add", sectionHeading: i.sectionHeading ?? "", beforeText: i.beforeText, afterText: i.afterText ?? "" })),
      today,
    );
    for (const er of plan.errors) results[er.itemId] = { status: "approved", writeError: er.reason };
    if (plan.requests.length > 0) {
      try {
        newRevision = (await docs.batchUpdate(c.rulebookDocId, plan.requests, doc.revisionId)).revisionId;
        if (!newRevision) newRevision = toDocModel(await docs.getDocument(c.rulebookDocId)).revisionId;
      } catch (e) {
        if (e instanceof RevisionMismatchError) throw new HttpsError("failed-precondition", "書き込みの直前にルール集が編集されました。もう一度「打ち合わせメモから反映」を実行してください。");
        throw e;
      }
      for (const a of plan.applied) {
        const it = toDocs.find((i) => i.id === a.itemId)!;
        results[a.itemId] = { status: "written", writeError: null };
        batch.set(db.collection(P.ruleChanges(c.id)).doc(), {
          runId: d.runId,
          itemId: a.itemId,
          docId: c.rulebookDocId,
          sectionHeading: a.sectionHeading,
          operation: it.operation ?? "add",
          beforeText: it.beforeText,
          afterText: a.text,
          confirmedDate: today,
          revisionBefore: doc.revisionId,
          revisionAfter: newRevision,
          by: actor.uid,
          at: now,
        });
      }
    }
  }

  for (const it of items) {
    if (it.bucket === "rule" && it.target !== "client_rulebook") results[it.id] = { status: "exported", writeError: null };
    if (it.bucket === "card" || it.bucket === "question") {
      const card: ClientCard = {
        id: it.id,
        kind: it.bucket === "question" ? "question" : (it.cardKind ?? "ongoing"),
        title: it.title,
        detail: it.bucket === "question" ? [it.question, it.answer ? `回答: ${it.answer}` : ""].filter(Boolean).join("\n") : it.summary,
        owner: it.owner ?? (it.bucket === "question" ? "office" : "unknown"),
        due: it.due,
        amount: it.amount,
        settlementPolicy: it.settlementPolicy,
        evidence: it.evidence,
        source: { runId: d.runId, itemId: it.id, notesDocName: run.notesDocName },
        status: it.bucket === "question" && it.answer ? "done" : "open",
        createdAt: now,
        createdBy: actor.uid,
        updatedAt: now,
      };
      batch.set(db.doc(`${P.cards(c.id)}/${it.id}`), card);
      results[it.id] = { status: "written", writeError: null };
    }
  }
  for (const [id, r] of Object.entries(results)) batch.update(db.doc(P.ruleItem(c.id, d.runId, id)), { status: r.status, writeError: r.writeError ?? null, ...(r.status !== "approved" ? { writtenAt: now } : {}) });
  const proposed = (await db.collection(P.ruleItems(c.id, d.runId)).where("status", "==", "proposed").get()).size;
  const failed = Object.values(results).filter((r) => r.writeError).length;
  batch.update(runRef, { ...(newRevision ? { rulebookRevisionId: newRevision } : {}), status: proposed + failed > 0 ? "review" : "done", updatedAt: now });
  clientAudit(batch, c.id, { actor: actor.uid, action: "rule_run_applied", target: d.runId, detail: { written: Object.values(results).filter((r) => r.status === "written").length } });
  await batch.commit();
  const vals = Object.values(results);
  return {
    written: vals.filter((r) => r.status === "written").length,
    exported: vals.filter((r) => r.status === "exported").length,
    errors: Object.entries(results).filter(([, r]) => r.writeError).map(([itemId, r]) => ({ itemId, reason: r.writeError })),
  };
});
