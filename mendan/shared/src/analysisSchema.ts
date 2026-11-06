import { z } from "zod";
import { ASSERTIONS, ENTITY_TYPES } from "./types.js";

/**
 * Claude Structured Outputs のスキーマ（正式な JSON Schema は zod から生成）。
 *
 * 注意: Structured Outputs の制約により、数値の min/max・文字列長・可変キーのオブジェクトは使えない。
 * そのため属性は {key, value} の配列で受け取り、confidence の範囲はサーバー側で検証・丸める。
 */
export const EvidenceIds = z.array(z.string()).describe("根拠となる発言ID（入力に含まれる seg_ で始まるID）。必須。");

export const EntityOpSchema = z.object({
  entity_id: z
    .string()
    .nullable()
    .describe("既存の実体を更新する場合はそのID（ent_...）。新規はnull。"),
  entity_type: z.enum(ENTITY_TYPES),
  label: z.string().describe("短い表示名（例: 常陽銀行、水戸市の自宅）"),
  assertion: z.enum(ASSERTIONS).describe("present=あると発言 / absent=明確に否定 / unknown=可能性・不明 / retracted=訂正・撤回"),
  attributes: z.array(z.object({ key: z.string(), value: z.string() })),
  corrects_entity_id: z
    .string()
    .nullable()
    .describe("訂正により置き換わる既存実体のID（例: 常陽銀行→筑波銀行の訂正なら常陽銀行のID）。なければnull。"),
  evidence_segment_ids: EvidenceIds,
  confidence: z.number().describe("0〜1。参考値。"),
  note: z.string().nullable(),
});

export const CheckItemOpSchema = z.object({
  check_item_id: z.string().describe("確認事項ID（入力の一覧にあるもの）"),
  status: z
    .enum(["answered", "not_applicable", "unknown_answer", "needs_followup", "contradiction"])
    .describe("answered=回答あり / not_applicable=明確に該当なしと回答 / unknown_answer=分からないと回答 / needs_followup=回答が不十分 / contradiction=前後で矛盾"),
  answer: z.string().describe("回答内容の要約（発言に基づく）"),
  evidence_segment_ids: EvidenceIds,
  confidence: z.number(),
});

export const ContradictionSchema = z.object({
  description: z.string(),
  entity_ids: z.array(z.string()),
  check_item_ids: z.array(z.string()),
  evidence_segment_ids: EvidenceIds,
});

export const SuggestedQuestionSchema = z.object({
  question: z.string().describe("営業担当者がそのまま読める丁寧な質問文"),
  check_item_id: z.string().nullable(),
  priority: z.enum(["high", "medium", "low"]),
  reason: z.string(),
});

export const AnalysisOutputSchema = z.object({
  entities: z.array(EntityOpSchema),
  check_items: z.array(CheckItemOpSchema),
  contradictions: z.array(ContradictionSchema),
  suggested_questions: z.array(SuggestedQuestionSchema),
  possible_transcription_errors: z
    .array(z.object({ segment_id: z.string(), suspected: z.string(), likely: z.string() }))
    .describe("固有名詞・数字の誤認識が疑われる箇所"),
});

export type AnalysisOutput = z.infer<typeof AnalysisOutputSchema>;
export type EntityOp = z.infer<typeof EntityOpSchema>;
export type CheckItemOp = z.infer<typeof CheckItemOpSchema>;

/** 面談後の全体再解析の出力（リアルタイム結果との差分） */
export const ReanalysisOutputSchema = z.object({
  missing_entities: z.array(EntityOpSchema).describe("リアルタイム解析で抽出されていない、または内容が不十分な財産・人物"),
  missing_check_items: z.array(CheckItemOpSchema).describe("回答があるのに反映されていない確認事項"),
  contradictions: z.array(ContradictionSchema),
  unasked_topics: z
    .array(z.object({ check_item_id: z.string(), reason: z.string() }))
    .describe("面談で質問されなかった重要事項"),
  insufficient_items: z
    .array(z.object({ check_item_id: z.string().nullable(), entity_id: z.string().nullable(), issue: z.string(), evidence_segment_ids: EvidenceIds }))
    .describe("確認が不十分な項目、金額・日付・所有者の不整合"),
  possible_transcription_errors: z.array(z.object({ segment_id: z.string(), suspected: z.string(), likely: z.string() })),
});
export type ReanalysisOutput = z.infer<typeof ReanalysisOutputSchema>;

export const EMPTY_ANALYSIS: AnalysisOutput = {
  entities: [],
  check_items: [],
  contradictions: [],
  suggested_questions: [],
  possible_transcription_errors: [],
};
