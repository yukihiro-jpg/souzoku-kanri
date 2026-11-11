import { z } from "zod";

/**
 * 打ち合わせメモ → 3つの振り分け の AI 出力（Claude の構造化出力）。
 * 構造化出力の制約のため、使わない欄も null で必ず返させる。
 */
const Evidence = z.object({
  segment_id: z.string().describe("根拠の発言ID（入力の [t001207 00:12:07] の t001207 の部分）"),
  quote: z.string().describe("その発言からの短い引用。文字起こしの文字のまま（読み直す前の文字）で、発言の本文に実際にある部分だけ"),
});

const Correction = z.object({
  segment_id: z.string(),
  heard: z.string().describe("文字起こしの文字（例: 常用銀行）"),
  corrected: z.string().describe("ルール集などから正しいと判断した語（例: 常陽銀行）"),
  reason: z.string(),
});

export const RuleRunItemSchema = z.object({
  bucket: z.enum(["rule", "question", "card"]).describe("rule=ルール集への追加・修正案 / question=税理士への確認事項 / card=宿題・継続論点・社長の悩みや目標・経営の数字"),
  title: z.string().describe("一行の見出し"),
  summary: z.string().describe("何が決まった・話されたか（2文以内）"),
  evidence: z.array(Evidence).describe("根拠。必ず1つ以上"),
  corrections: z.array(Correction).describe("この項目で読み直した語（なければ空）"),
  confidence: z.number().describe("0〜1"),
  target: z.enum(["client_rulebook", "mf_rules", "skill"]).nullable().describe("rule のときの書き込み先。それ以外は null"),
  section_heading: z.string().nullable().describe("rule のとき、入力のルール集にある章の見出しをそのまま（例: 5-6 東日本銀行・税金の納付・配当）"),
  operation: z.enum(["add", "modify"]).nullable(),
  before_text: z.string().nullable().describe("modify のとき、書き換える既存の文をルール集からそのまま（1段落の中の一部）。add なら null"),
  after_text: z.string().nullable().describe("rule のとき、ルール集に入れる文（ルール集の書き方にそろえる。確認日は付けない）"),
  question: z.string().nullable().describe("question のとき、税理士への質問文"),
  suggested_rule: z.string().nullable().describe("question のとき、回答しだいでルール集に入れる文の案（なければ null）"),
  card_kind: z.enum(["homework", "ongoing", "worry", "goal", "metric"]).nullable(),
  owner: z.enum(["client", "office", "unknown"]).nullable().describe("card のときの担当（顧問先／事務所）"),
  due: z.string().nullable().describe("期限（発言どおり。例: 今月末）"),
  amount: z.string().nullable().describe("金額・数値（発言どおり）"),
  settlement_policy: z.string().nullable().describe("決算での処理方針（話に出ていれば）"),
});

export const RuleRunOutputSchema = z.object({
  items: z.array(RuleRunItemSchema),
});

export type RuleRunOutput = z.infer<typeof RuleRunOutputSchema>;
export type RuleRunOutputItem = z.infer<typeof RuleRunItemSchema>;
