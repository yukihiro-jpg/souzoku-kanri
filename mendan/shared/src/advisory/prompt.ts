import { ACCOUNTING_SYSTEM_LABELS, type AccountingSystem } from "./types.js";
import type { RuleSection, ReadingHint } from "./rulebook.js";
import { segmentLine, type NoteSegment } from "./notes.js";

/**
 * 打ち合わせメモの振り分け（ルール案／確認事項／カード）の指示文。
 * AI は「提案」だけを返す。ルール集への書き込みは税理士の承認後にプログラムが行う。
 */
export function buildRuleRunSystemPrompt(): string {
  return `あなたは税理士事務所の記帳担当の補助です。顧問先との打ち合わせの文字起こしを読み、決まったことを3つに振り分けて返します。

# 前提
- 1時間を超える打ち合わせでも、月次の仕訳ルールに関わる話はたいてい数件だけです。大半は経営の話（売上・人件費・価格転嫁・人手不足・商品構成など）なので、それはカードに回します。
- 文字起こしは聞き間違いが多い（例:「常用銀行」は「常陽銀行」、「61234」は口座番号0061234の一部）。必ずルール集の口座・科目・取引先と照らし合わせて読み直してください。読み直した語は corrections に入れます。
- 話者の区別はありません。発言の内容と流れから判断してください。

# 振り分け
1. rule（ルール集への追加・修正案）: 今後の仕訳の処理が変わる・決まった話。例: 引落口座の変更、科目の決定、取引先との取引停止、補助科目の追加。
   - 打ち合わせの中で処理方法まで決まったものだけ。科目などが決まっていないものは rule にせず question にする。
   - section_heading は入力のルール集にある章の見出しをそのまま書く。新しい章は作らない。
   - operation は add（章の末尾に追記）か modify（既存の文を書き換え）。modify の before_text はルール集の文をそのまま、1段落の中の一部を写す。
   - after_text はルール集の書き方（科目コード・補助番号・税区分の書き方）にそろえる。「（2026-11-11確認）」のような確認日は付けない（プログラムが付ける）。
   - target: 会計大将の顧問先は client_rulebook。マネーフォワードの顧問先で仕訳ルールに関わるものは mf_rules。記帳の作業手順そのもの（資料の読み方・確認表の作り方など、どの顧問先にも関わる話）は skill。
2. question（税理士への確認事項）: 処理を決めるために確認が必要なこと、ルール集の内容と食い違う話、数字の前提が変わるかもしれない話（例: 実績の粗利率と概算の粗利率が違う、償却費の概算に新しい資産が入っているか、税率変更への対応）。suggested_rule に、回答しだいで入れる文の案を書く。
3. card（宿題・継続論点・社長の悩みや目標・経営の数字）: 誰かがやること（担当・期限）、次回以降も追う論点、社長の悩み・目標、経営判断に使う数字（損益分岐の売上、人件費率など）。owner は顧問先がやるなら client、事務所がやるなら office。

# 根拠
- すべての項目に evidence を1つ以上付ける。segment_id は入力の発言ID、quote はその発言の本文にある文字のまま（読み直す前の文字）を短く。
- 推測で事実を足さない。金額・期限は発言どおり。わからない欄は null。
- 同じ内容がすでにルール集に書いてあるなら rule にしない。`;
}

export function buildRuleRunUserPrompt(input: {
  client: { code: string; name: string; accountingSystem: AccountingSystem; fiscalMonth: number };
  sections: RuleSection[];
  hints: ReadingHint[];
  summary: string;
  segments: NoteSegment[];
}): string {
  const c = input.client;
  const rulebook = input.sections.length
    ? input.sections.map((s) => `${"#".repeat(Math.max(1, s.level))} ${s.heading}\n${s.text}`).join("\n\n")
    : "（ルール集は未登録）";
  const hints = input.hints.length ? input.hints.map((h) => `- [${h.segmentId}] 「${h.heard}」は「${h.likely}」の聞き間違いかもしれない（${h.reason}）`).join("\n") : "（なし）";
  return `# 顧問先
${c.code} ${c.name}（会計ソフト: ${ACCOUNTING_SYSTEM_LABELS[c.accountingSystem]}・${c.fiscalMonth}月決算）

# 顧問先のルール集
${rulebook}

# プログラムが見つけた読み直しの候補（参考。正しいかは文脈で判断）
${hints}

# 打ち合わせメモの要約（参考。根拠には使わない）
${input.summary || "（なし）"}

# 文字起こし（[発言ID 時刻] 本文）
${input.segments.map(segmentLine).join("\n")}`;
}
