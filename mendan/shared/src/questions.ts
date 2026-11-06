import type { CheckItem, Priority, SuggestedQuestion } from "./types.js";
import { CATEGORIES, PRIORITY_ORDER } from "./types.js";

/**
 * 「次に確認すべき質問」の優先順位付け
 *
 * 1) 矛盾あり → 2) 要追加確認 → 3) AIが文脈から提案した質問 → 4) 未確認の重要事項
 * 同じ確認事項についての質問は1つにまとめる。
 */
export interface RankedQuestion {
  key: string;
  question: string;
  checkItemId: string | null;
  priority: Priority;
  reason: string;
  source: "ai" | "rule";
  score: number;
}

const OPEN: CheckItem["status"][] = ["unconfirmed", "needs_followup", "contradiction"];
const categoryNo = new Map<string, number>(CATEGORIES.map((c) => [c.id, c.no]));

export function isOpenCheckItem(c: CheckItem): boolean {
  return !c.obsolete && OPEN.includes(c.status);
}

export function rankQuestions(checkItems: CheckItem[], aiQuestions: Pick<SuggestedQuestion, "question" | "checkItemId" | "priority" | "reason" | "status">[]): RankedQuestion[] {
  const byId = new Map(checkItems.map((c) => [c.id, c]));
  const out = new Map<string, RankedQuestion>();

  const put = (q: RankedQuestion) => {
    const prev = out.get(q.key);
    if (!prev || q.score < prev.score) out.set(q.key, q);
  };

  for (const q of aiQuestions) {
    if (q.status !== "open") continue;
    const item = q.checkItemId ? byId.get(q.checkItemId) : undefined;
    if (item && !isOpenCheckItem(item)) continue; // 既に回答済み
    const key = item ? `ci:${item.id}` : `ai:${q.question}`;
    // AI提案は文脈に即しているので、同じ重要度なら規則ベースより優先
    put({ key, question: q.question, checkItemId: item?.id ?? null, priority: q.priority, reason: q.reason, source: "ai", score: 60 + PRIORITY_ORDER[q.priority] * 100 });
  }
  for (const c of checkItems) {
    if (!isOpenCheckItem(c)) continue;
    const base = c.status === "contradiction" ? 0 : c.status === "needs_followup" ? 50 : 100;
    const reason = c.status === "contradiction" ? "前後の発言に矛盾があります" : c.status === "needs_followup" ? "回答が不十分です" : "まだ確認していない事項です";
    put({
      key: `ci:${c.id}`,
      question: c.prompt ?? c.question,
      checkItemId: c.id,
      priority: c.priority,
      reason,
      source: "rule",
      score: base + PRIORITY_ORDER[c.priority] * 100 + (categoryNo.get(c.category) ?? 20) / 100,
    });
  }
  return [...out.values()].sort((a, b) => a.score - b.score);
}

export function completionStats(checkItems: CheckItem[]) {
  const items = checkItems.filter((c) => !c.obsolete);
  const done = items.filter((c) => c.status === "confirmed" || c.status === "not_applicable").length;
  const ai = items.filter((c) => c.status === "ai_candidate").length;
  const open = items.filter((c) => isOpenCheckItem(c)).length;
  const highOpen = items.filter((c) => isOpenCheckItem(c) && c.priority === "high").length;
  return {
    total: items.length,
    confirmed: done,
    aiCandidate: ai,
    open,
    highOpen,
    /** 確認完了率（担当者確認済み＋AI確認候補を「話題に出た」とみなした率も併記） */
    confirmedRate: items.length ? done / items.length : 0,
    coveredRate: items.length ? (done + ai) / items.length : 0,
  };
}
