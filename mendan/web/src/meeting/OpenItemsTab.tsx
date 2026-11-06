import type { RankedQuestion, ReviewItem } from "@mendan/shared";
import { PriorityDot } from "../components/Badges";
import { fmtDateTime } from "../lib/format";

const KIND: Record<ReviewItem["kind"], string> = {
  contradiction: "矛盾",
  correction_on_locked: "承認済み情報の訂正",
  ai_update_on_locked: "承認済み情報との相違",
  reanalysis_missing_entity: "再解析: 抽出漏れ",
  reanalysis_missing_check: "再解析: 反映漏れ",
  reanalysis_issue: "再解析: 要確認",
  possible_transcription_error: "誤認識の可能性",
};

interface Props {
  questions: RankedQuestion[];
  reviews: ReviewItem[];
  onEvidence: (ids: string[]) => void;
  onReview: (r: ReviewItem, d: "approve" | "reject") => void;
  canEdit: boolean;
}

export function OpenItemsTab({ questions, reviews, onEvidence, onReview, canEdit }: Props) {
  return (
    <div className="space-y-4 p-3">
      <section>
        <h3 className="mb-1 text-sm font-bold text-slate-700">追加確認候補（AIの指摘・担当者の承認待ち）{reviews.length}件</h3>
        {reviews.length === 0 && <p className="text-xs text-slate-400">ありません。</p>}
        <ul className="space-y-1">
          {[...reviews]
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .map((r) => (
              <li key={r.id} data-testid="review-row" className="rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-sm">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-amber-200 px-1 text-[10px]">{KIND[r.kind]}</span>
                  <span className="font-medium">{r.title}</span>
                  <span className="ml-auto text-[10px] text-slate-500">{fmtDateTime(r.createdAt)}</span>
                </div>
                <div className="mt-0.5 text-xs text-slate-700">{r.detail}</div>
                <div className="mt-1 flex gap-2">
                  {r.evidenceSegmentIds.length > 0 && <button onClick={() => onEvidence(r.evidenceSegmentIds)} className="text-[11px] text-blue-700 hover:underline">根拠の発言</button>}
                  {canEdit && (
                    <>
                      {r.proposal ? (
                        <button onClick={() => onReview(r, "approve")} className="rounded border border-green-500 bg-white px-2 text-[11px] text-green-700">承認して反映</button>
                      ) : (
                        <button onClick={() => onReview(r, "approve")} className="rounded border bg-white px-2 text-[11px]">確認した</button>
                      )}
                      <button onClick={() => onReview(r, "reject")} className="rounded border bg-white px-2 text-[11px] text-slate-600">却下</button>
                    </>
                  )}
                </div>
              </li>
            ))}
        </ul>
      </section>
      <section>
        <h3 className="mb-1 text-sm font-bold text-slate-700">まだ聞いていない・確認が必要な事項（重要度順）{questions.length}件</h3>
        <ol className="divide-y rounded border bg-white">
          {questions.map((q, i) => (
            <li key={q.key} className="flex items-start gap-2 px-2 py-1.5 text-sm">
              <span className="w-5 shrink-0 text-right text-xs text-slate-400">{i + 1}</span>
              <PriorityDot p={q.priority} />
              <div className="flex-1">
                <div>{q.question}</div>
                <div className="text-[11px] text-slate-500">
                  {q.source === "ai" ? "AI提案" : "確認事項"}・{q.reason}
                </div>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
