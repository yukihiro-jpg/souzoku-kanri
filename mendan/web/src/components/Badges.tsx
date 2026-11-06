import { CHECK_STATUS_LABELS, DOC_STATUS_LABELS, type CheckStatus, type DocStatus, type Priority } from "@mendan/shared";
import { cx } from "../lib/format";

const CHECK_COLOR: Record<CheckStatus, string> = {
  unconfirmed: "bg-slate-100 text-slate-600",
  ai_candidate: "bg-sky-100 text-sky-800",
  confirmed: "bg-green-100 text-green-800",
  needs_followup: "bg-amber-100 text-amber-800",
  not_applicable: "bg-slate-200 text-slate-700",
  contradiction: "bg-red-100 text-red-800",
};
const DOC_COLOR: Record<DocStatus, string> = {
  candidate: "bg-sky-100 text-sky-800",
  required: "bg-blue-600 text-white",
  requested: "bg-indigo-100 text-indigo-800",
  partial: "bg-amber-100 text-amber-800",
  submitted: "bg-teal-100 text-teal-800",
  verified: "bg-green-600 text-white",
  insufficient: "bg-red-100 text-red-800",
  not_needed: "bg-slate-200 text-slate-600",
  removal_candidate: "bg-orange-100 text-orange-800 line-through",
};

export const CheckBadge = ({ s }: { s: CheckStatus }) => <span className={cx("whitespace-nowrap rounded px-1.5 py-0.5 text-xs", CHECK_COLOR[s])}>{CHECK_STATUS_LABELS[s]}</span>;
export const DocBadge = ({ s }: { s: DocStatus }) => <span className={cx("whitespace-nowrap rounded px-1.5 py-0.5 text-xs", DOC_COLOR[s])}>{DOC_STATUS_LABELS[s]}</span>;
export const PriorityDot = ({ p }: { p: Priority }) => (
  <span title={{ high: "重要度: 高", medium: "重要度: 中", low: "重要度: 低" }[p]} className={cx("inline-block h-2 w-2 shrink-0 rounded-full", p === "high" ? "bg-red-500" : p === "medium" ? "bg-amber-400" : "bg-slate-300")} />
);
export const AiTag = ({ children = "AI判定" }: { children?: string }) => <span className="whitespace-nowrap rounded border border-sky-300 px-1 text-[10px] text-sky-700">{children}</span>;
export const UserTag = ({ children = "担当者確定" }: { children?: string }) => <span className="whitespace-nowrap rounded border border-green-400 px-1 text-[10px] text-green-700">{children}</span>;
