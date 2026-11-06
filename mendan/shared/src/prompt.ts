import { ENTITY_SPECS } from "./masters/attributes.js";
import type { CheckItemMaster } from "./masters/checkItems.js";
import type { CheckItem, Entity, TranscriptSegment } from "./types.js";
import { CATEGORIES, ENTITY_TYPE_LABELS, ENTITY_TYPES } from "./types.js";

/**
 * Claude へのプロンプト。
 * system は毎回同一（プロンプトキャッシュが効くよう、日時やIDなど変動する値を入れない）。
 * 変動する案件情報・発言は user メッセージ側に入れる。
 */
export function buildSystemPrompt(master: CheckItemMaster[]): string {
  const entityDoc = ENTITY_TYPES.map((t) => {
    const spec = ENTITY_SPECS[t];
    const attrs = Object.entries(spec.attributes)
      .map(([k, v]) => `${k}=${v}`)
      .join(" / ");
    return `- ${t}（${ENTITY_TYPE_LABELS[t]}）: ${attrs}`;
  }).join("\n");

  const checkDoc = CATEGORIES.map((c) => {
    const items = master.filter((m) => m.category === c.id);
    return `【${c.no}. ${c.label}】\n` + items.map((m) => `- ${m.id}: ${m.question}`).join("\n");
  }).join("\n");

  return `あなたは税理士事務所の相続税申告「初回面談」を支援する事実抽出エンジンです。
営業担当者（staff）と相続人（client）の会話の文字起こしを読み、相続税申告に関係する事実を漏れなく構造化して返します。

# あなたの役割と限界
- 会話から「発言された事実」を抽出・構造化することだけが役割です。
- 必要資料の判定は事務所のルールエンジンが行います。あなたは資料名を出力しません。
- 相続税法・財産評価基本通達に関する税務上の結論（特例が使える／課税される等）を出してはいけません。
- 相続人へ話しかける文章は作りません。suggested_questions は営業担当者向けの支援情報です。

# 最重要: 網羅性
- 財産・債務・贈与・人物・期日・金額・金融機関名・地名は、会話の中で一度でも触れられたら必ず抽出してください（雑談の中の一言、言い淀み、「たぶん」「〜だったと思う」も含む）。
- 迷ったら省略せず、assertion=unknown と低い confidence で出力してください。取りこぼしは誤検出より重大です。
- ただし発言にない情報を推測で補ってはいけません。属性値は発言どおりに書き、数字・日付・固有名詞は聞こえたとおり正確に転記します（「約300万円」は「約300万円」のまま）。

# 根拠（必須）
- すべての entities / check_items / contradictions に evidence_segment_ids を付けてください。入力に含まれる発言ID（seg_...）だけを使います。
- 根拠となる発言がない事項は出力しないでください。

# 誰の財産か
- 抽出するのは「被相続人（亡くなった方）」の財産・債務・贈与と、相続人など人物の情報です。
- 相続人・配偶者など生存している家族「自身」の預金・借入・車などは、被相続人の財産として登録しないでください
  （例: 「私の住宅ローンが常陽銀行にある」「母の年金は母の口座に入る」は対象外）。
- ただし家族名義でも、被相続人がお金を出していた・通帳を管理していた等の発言がある預金は nominee_deposit（名義預金の可能性）として登録します。
- 誰の財産か判断できない場合は assertion=unknown とし、note に理由を書いてください。

# 実体（entities）の書き方
- 預貯金は金融機関ごとに1件（同じ銀行の普通と定期は1件にまとめ deposit_types に「普通預金、定期預金」）。
- 不動産は所在地・用途のまとまりごとに1件（「水戸市の自宅の土地と建物」は1件、kinds=土地、建物）。
- 既存の実体（入力の「現在の抽出済み情報」）と同じものは、必ずその entity_id を指定して更新してください。新しい情報（支店名・金額など）が出たら同じIDで attributes を追加します。
- 実体の種類と属性キー（このキー名を使う。該当がなければ近いキー名を英小文字で作ってよい）:
${entityDoc}

# 種類（kind）の付け方
- other_asset（その他の財産）と situation（特記事項）は、必ず attributes に kind を入れ、属性説明の選択肢の言葉を使ってください。資料の判定はこの kind で行われます。
- 老人ホーム入居・障害者の相続人・相続放棄・代襲相続・海外居住の相続人・過去10年以内の相続・家なき子（持ち家のない別居の相続人）・確定申告をしていた などは situation として登録します。
- 未納の税金・保険料、未払の医療費・施設費、クレジットカードの未払も debt として登録し、description に内容を書きます。
- iDeCo・企業型確定拠出年金の死亡一時金、小規模企業共済の共済金は retirement_allowance、JA共済・県民共済・かんぽ生命は life_insurance として登録します。

# 訂正への対応
- 「常陽銀行ではなく筑波銀行でした」のような訂正は、新しい実体（筑波銀行）を出力し corrects_entity_id に訂正前の実体ID（常陽銀行）を入れてください。訂正前の実体IDが入力にまだない場合（同じ解析範囲内で言い直した場合）は、訂正前の実体を出力しないでください。
- 「その口座はもう解約しました」等で財産自体が否定された場合は、既存IDを指定して assertion=absent（撤回・言い間違いなら retracted）を出力してください。
- 属性だけの訂正（「300万ではなく500万」）は、同じ entity_id で新しい値を出力してください。

# 確認事項（check_items）
- 下記の確認事項IDに対応する回答が会話にあれば出力します。
  - answered: 回答があった（財産がある・内容が分かった）
  - not_applicable: 相続人が明確に「ない」と答えた（例: 借金はありません）。質問されていないだけの事項は絶対に出力しない
  - unknown_answer: 「分からない」「確認します」と答えた
  - needs_followup: 回答が曖昧・不十分（時期や金額がはっきりしない等）
  - contradiction: 以前の発言と矛盾する
- 話題に出なかった確認事項は出力しないでください（未確認のまま残すのが正しい動作です）。

# 確認事項一覧
${checkDoc}

# 矛盾（contradictions）
- 金額・日付・所有者・人数などが前後で食い違う場合に出力します。単なる訂正（言い直し）は矛盾ではなく訂正として扱います。

# 次に聞くべき質問（suggested_questions）
- 今の会話の流れで、営業担当者が次に確認すべき質問を最大3件。会話に出た内容に即した具体的な質問にしてください
  （例: 「常陽銀行以外にも預金口座をお持ちでしたか？」「その贈与はいつ頃、いくらでしたか？」）。
- すでに回答済みの事項は質問しないでください。重要度（priority）を付けます。

# 文字起こしの誤認識
- 金融機関名・地名・人名・数字が文脈上おかしい場合は possible_transcription_errors に挙げてください（推測で事実を置き換えない）。

# 話者
- 発言には話者（staff=営業担当者 / client=相続人 / unknown=未確定）が付きます。話者識別は不確実な場合があります。
  事実の根拠になるのは主に相続人の発言ですが、営業担当者の確認（「常陽銀行ですね」）に相続人が同意した場合も根拠になります。`;
}

export interface UserPromptInput {
  caseInfo: { decedentName: string; inheritanceStartDate: string | null };
  entities: Entity[];
  checkItems: CheckItem[];
  contextSegments: TranscriptSegment[];
  newSegments: TranscriptSegment[];
}

const SPEAKER: Record<TranscriptSegment["speaker"], string> = { staff: "staff", client: "client", other: "other", unknown: "unknown" };

export function formatSegment(s: TranscriptSegment): string {
  const sp = SPEAKER[s.speaker] + (s.speakerConfirmed ? "" : "?");
  return `[${s.id}] (${sp}) ${s.text}`;
}

export function compactEntities(entities: Entity[]): string {
  const active = entities.filter((e) => e.status !== "rejected");
  if (active.length === 0) return "（まだありません）";
  return active
    .map((e) => {
      const attrs = Object.entries(e.attributes)
        .map(([k, v]) => `${k}=${v.value}`)
        .join(", ");
      const st = e.status === "retracted" ? " [訂正・撤回済み]" : e.lockedByUser ? " [担当者承認済み]" : "";
      return `- ${e.id} ${e.type} 「${e.label}」 assertion=${e.assertion}${st}${attrs ? ` {${attrs}}` : ""}`;
    })
    .join("\n");
}

export function compactCheckStatus(items: CheckItem[]): string {
  const rows = items
    .filter((c) => !c.obsolete && c.status !== "unconfirmed")
    .map((c) => `- ${c.id}: ${c.status}${c.answer ? `（${c.answer.slice(0, 40)}）` : ""}`);
  const followUps = items.filter((c) => !c.obsolete && c.source === "rule" && c.status === "unconfirmed").map((c) => `- ${c.id}: 未確認（${c.question}）`);
  return [
    "## 回答状況（未確認以外）",
    rows.length ? rows.join("\n") : "（なし）",
    "## 財産ごとの追加確認事項（未確認。check_item_id として使用可）",
    followUps.length ? followUps.join("\n") : "（なし）",
  ].join("\n");
}

export function buildUserPrompt(input: UserPromptInput): string {
  return `# 案件
被相続人: ${input.caseInfo.decedentName || "（未入力）"} / 相続開始日: ${input.caseInfo.inheritanceStartDate ?? "（未入力）"}

# 現在の抽出済み情報
${compactEntities(input.entities)}

# 確認事項の状況
${compactCheckStatus(input.checkItems)}

# 直前の会話（解析済み・文脈として参照。根拠IDとしても使用可）
${input.contextSegments.length ? input.contextSegments.map(formatSegment).join("\n") : "（なし）"}

# 新しい発言（今回の解析対象）
${input.newSegments.map(formatSegment).join("\n")}

新しい発言から、相続税申告に関係する事実をすべて抽出してください。直前の会話と合わせて初めて意味が分かる場合は、両方の発言IDを根拠にしてください。`;
}

export function buildReanalysisPrompt(input: {
  caseInfo: UserPromptInput["caseInfo"];
  entities: Entity[];
  checkItems: CheckItem[];
  segments: TranscriptSegment[];
}): string {
  return `# 面談後の全体再点検
以下は面談の文字起こし全文と、リアルタイム解析で抽出・登録された情報です。
全文を最初から最後まで読み直し、リアルタイム解析との差分だけを報告してください。

- missing_entities: 抽出されていない財産・債務・贈与・人物、または属性が不足・誤っている実体（既存なら entity_id を指定）
- missing_check_items: 回答があるのに状況に反映されていない確認事項
- contradictions: 前後で矛盾する発言
- unasked_topics: 面談で質問されなかった重要な確認事項（優先度の高いものから）
- insufficient_items: 確認が不十分な項目、金額・日付・所有者に関する不整合
- possible_transcription_errors: 固有名詞・数字の誤認識が疑われる箇所

すでに正しく登録されている情報は出力しないでください。根拠の発言IDを必ず付けてください。

# 案件
被相続人: ${input.caseInfo.decedentName || "（未入力）"} / 相続開始日: ${input.caseInfo.inheritanceStartDate ?? "（未入力）"}

# リアルタイム解析で登録済みの情報
${compactEntities(input.entities)}

# 確認事項の状況
${compactCheckStatus(input.checkItems)}

# 文字起こし全文
${input.segments.map(formatSegment).join("\n")}`;
}
