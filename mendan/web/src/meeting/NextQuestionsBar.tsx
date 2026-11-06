import type { RankedQuestion } from "@mendan/shared";
import { PriorityDot } from "../components/Badges";

/** 画面下部: 次に確認すべき質問（最大3件）。営業担当者への支援表示のみ（AIは発話しない） */
export function NextQuestionsBar({ questions, onAsked }: { questions: RankedQuestion[]; onAsked: (q: RankedQuestion) => void }) {
  return (
    <div className="border-t-2 border-blue-500 bg-blue-50 px-4 py-2" data-testid="next-questions">
      <div className="mb-1 text-xs font-bold text-blue-900">次に確認すべき質問</div>
      <div className="grid grid-cols-3 gap-2">
        {questions.slice(0, 3).map((q) => (
          <div key={q.key} className="flex items-start gap-2 rounded-lg border border-blue-200 bg-white px-3 py-2">
            <PriorityDot p={q.priority} />
            <div className="min-w-0 flex-1">
              <div className="text-[15px] leading-snug">{q.question}</div>
              <div className="mt-0.5 text-[11px] text-slate-500">{q.source === "ai" ? "会話の流れから" : "未確認事項"}・{q.reason}</div>
            </div>
            <button onClick={() => onAsked(q)} title="質問した（一時的に非表示）" className="text-xs text-slate-400 hover:text-slate-700">✓</button>
          </div>
        ))}
        {questions.length === 0 && <div className="col-span-3 text-sm text-slate-500">未確認の事項はありません。</div>}
      </div>
    </div>
  );
}
