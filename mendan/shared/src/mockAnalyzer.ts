import type { AnalysisOutput, EntityOp } from "./analysisSchema.js";
import { canonicalName } from "./normalize.js";
import type { Entity, TranscriptSegment } from "./types.js";

/**
 * 【開発・デモ専用】キーワードによる簡易解析器。
 *
 * APIキーなしで画面・データの流れ（文字起こし→解析→ルール判定→資料リスト）を
 * 確認するためのもの。精度は Claude に遠く及ばないため、本番では使用しない。
 * （AI_MODE=mock のときだけ使われる）
 */

const BANK_RE = /(ゆうちょ(?:銀行)?)|([一-龥ァ-ヶー]{1,10}?(?:銀行|信用金庫|信用組合|信金|農協))|(JA[一-龥ァ-ヶー]{0,6})/g;
const INSURER_RE = /(?:^|[、。はがのにでとも\s])([^\s、。はがのにでとも]{1,8}生命)/g;
const SECURITIES_RE = /([一-龥ァ-ヶー]{1,8}証券)/g;
const PLACE_RE = /([一-龥]{1,6}[市町村区])/;

function isNegative(text: string): boolean {
  return /(ありません|ないです|ない です|ございません|していません|ないと思います|なかった|無いです|ありませんでした)/.test(text);
}
function isUnknown(text: string): boolean {
  return /(分からない|わからない|分かりません|わかりません|知らない|確認します|覚えていない)/.test(text);
}

export function mockAnalyze(input: { newSegments: TranscriptSegment[]; contextSegments: TranscriptSegment[]; entities: Entity[] }): AnalysisOutput {
  const out: AnalysisOutput = { entities: [], check_items: [], contradictions: [], suggested_questions: [], possible_transcription_errors: [] };
  const known = [...input.entities];
  const byLabel = (type: Entity["type"], label: string) =>
    known.find((e) => e.type === type && e.status !== "retracted" && canonicalName(e.label) === canonicalName(label));
  const prev = [...input.contextSegments];
  let lastTopic: string | null = null;

  const pushEntity = (op: EntityOp) => {
    out.entities.push(op);
  };

  for (const s of input.newSegments) {
    const t = s.text;
    // 営業担当者の質問文は事実として扱わない（簡易判定）
    if (s.speaker === "staff" && /[か？?]。?$/.test(t.trim())) {
      prev.push(s);
      continue;
    }
    const ev = [s.id];
    const context = prev.slice(-2).map((p) => p.text).join(" ");

    // 訂正: 「AではなくBでした」
    const corr = t.match(/([^\s、。]+?)(?:じゃなくて|ではなく)[、\s]*([^\s、。]+?)(?:でした|です|だった)/);
    if (corr) {
      const oldName = canonicalName(corr[1].replace(/^(すみません|あ|いえ)/, ""));
      const newName = canonicalName(corr[2]);
      const old = known.find((e) => e.type === "bank_account" && e.status !== "retracted" && canonicalName(e.label).includes(oldName.replace(/銀行$/, "")));
      if (old && /銀行|信用金庫|信金|ゆうちょ/.test(newName)) {
        pushEntity({
          entity_id: null,
          entity_type: "bank_account",
          label: newName,
          assertion: "present",
          attributes: [{ key: "institution", value: newName }, ...Object.entries(old.attributes).filter(([k]) => k !== "institution").map(([k, v]) => ({ key: k, value: v.value }))],
          corrects_entity_id: old.id,
          evidence_segment_ids: ev,
          confidence: 0.8,
          note: `${old.label}から訂正`,
        });
        prev.push(s);
        continue;
      }
    }

    // 預貯金
    const banks = [...t.matchAll(BANK_RE)].map((m) => canonicalName(m[0]));
    if (banks.length && !(isNegative(t) && /他|ほか/.test(t))) {
      for (const b of new Set(banks)) {
        const types: string[] = [];
        if (/普通/.test(t)) types.push("普通預金");
        if (/定期/.test(t)) types.push("定期預金");
        const branch = t.match(new RegExp(`${b.replace(/銀行$/, "")}[^、。]*?([一-龥]{1,6}支店)`))?.[1];
        const existing = byLabel("bank_account", b);
        const attrs = [{ key: "institution", value: b }];
        if (types.length) attrs.push({ key: "deposit_types", value: types.join("、") });
        if (branch) attrs.push({ key: "branch", value: branch });
        pushEntity({ entity_id: existing?.id ?? null, entity_type: "bank_account", label: b, assertion: "present", attributes: attrs, corrects_entity_id: null, evidence_segment_ids: ev, confidence: 0.7, note: null });
        out.suggested_questions.push({ question: `亡くなった方は${b}以外にも預金口座をお持ちでしたか？`, check_item_id: "deposits.other_institutions", priority: "high", reason: `${b}の口座が話題に出たため` });
      }
      lastTopic = "deposits.other_institutions";
    } else if (/(口座|預金)/.test(t) && /(他|ほか)/.test(t) && isNegative(t)) {
      out.check_items.push({ check_item_id: "deposits.other_institutions", status: "not_applicable", answer: "他の金融機関の口座はないとの回答", evidence_segment_ids: ev, confidence: 0.6 });
    }

    // 不動産
    if (/(土地|建物|自宅|家屋|アパート|マンション|駐車場|田んぼ|畑)/.test(t) && !isNegative(t)) {
      const place = t.match(PLACE_RE)?.[1] ?? context.match(PLACE_RE)?.[1];
      if (place) {
        const kinds: string[] = [];
        if (/土地|駐車場|田んぼ|畑/.test(t)) kinds.push("土地");
        if (/建物|家屋|アパート|マンション/.test(t)) kinds.push("建物");
        const usage = /アパート|貸家|貸して/.test(t) ? "貸家" : /駐車場/.test(t) ? "貸駐車場" : /自宅/.test(t) ? "自宅" : undefined;
        const attrs = [{ key: "location", value: place }];
        if (kinds.length) attrs.push({ key: "kinds", value: kinds.join("、") });
        if (usage) attrs.push({ key: "usage", value: usage });
        pushEntity({ entity_id: null, entity_type: "real_estate", label: `${place}の${usage ?? "不動産"}`, assertion: "present", attributes: attrs, corrects_entity_id: null, evidence_segment_ids: ev, confidence: 0.7, note: null });
        if (usage === "自宅") out.suggested_questions.push({ question: "ご自宅に亡くなる直前まで住んでいた方はどなたですか？", check_item_id: "special.home_resident", priority: "high", reason: "自宅不動産が話題に出たため" });
      }
      lastTopic = "real_estate.other_regions";
    }
    if (/(住んで|同居)/.test(t) && /(私|母|父|長男|長女|妻|夫|一緒)/.test(t) && !/住んでいた方/.test(t)) {
      out.check_items.push({ check_item_id: "special.home_resident", status: "answered", answer: t.slice(0, 60), evidence_segment_ids: ev, confidence: 0.6 });
    }

    // 生命保険
    const insurers = [...t.matchAll(INSURER_RE)].map((m) => m[1]);
    if (insurers.length || (/(生命保険|保険金)/.test(t) && !isNegative(t))) {
      const names = insurers.length ? insurers : ["生命保険（保険会社未確認）"];
      for (const n of new Set(names)) {
        const attrs = insurers.length ? [{ key: "insurer", value: n }] : [];
        const ben = t.match(/受取人は([^、。]+?)(?:です|で|になって)/)?.[1];
        if (ben) attrs.push({ key: "beneficiary", value: ben });
        const amt = t.match(/([0-9０-９一二三四五六七八九十百千万億]+万円)/)?.[1];
        if (amt) attrs.push({ key: "amount", value: amt });
        pushEntity({ entity_id: byLabel("life_insurance", n)?.id ?? null, entity_type: "life_insurance", label: n, assertion: "present", attributes: attrs, corrects_entity_id: null, evidence_segment_ids: ev, confidence: 0.65, note: null });
      }
      lastTopic = "insurance.death_benefit";
    } else if (/保険/.test(t) && isNegative(t)) {
      out.check_items.push({ check_item_id: "insurance.death_benefit", status: "not_applicable", answer: "生命保険はないとの回答", evidence_segment_ids: ev, confidence: 0.6 });
    }

    // 証券
    for (const sname of new Set([...t.matchAll(SECURITIES_RE)].map((m) => m[1]))) {
      pushEntity({ entity_id: null, entity_type: "listed_security", label: sname, assertion: "present", attributes: [{ key: "institution", value: sname }], corrects_entity_id: null, evidence_segment_ids: ev, confidence: 0.65, note: null });
    }

    // 借入金
    if (/(借金|借入|ローン)/.test(t)) {
      if (isNegative(t)) out.check_items.push({ check_item_id: "debts.loans", status: "not_applicable", answer: "借入金はないとの回答", evidence_segment_ids: ev, confidence: 0.6 });
      else pushEntity({ entity_id: null, entity_type: "debt", label: "借入金", assertion: "present", attributes: [{ key: "description", value: t.match(/[^、。]*ローン/)?.[0] ?? "借入金" }], corrects_entity_id: null, evidence_segment_ids: ev, confidence: 0.6, note: null });
    }

    // 葬儀
    if (/(葬儀|葬式|お布施)/.test(t) && !isNegative(t)) {
      pushEntity({ entity_id: null, entity_type: "funeral_expense", label: "葬儀費用", assertion: "present", attributes: [{ key: "payee", value: t.match(/([一-龥ぁ-んァ-ヶー]+(?:葬祭|斎場|葬儀社|寺))/)?.[1] ?? "葬儀社" }], corrects_entity_id: null, evidence_segment_ids: ev, confidence: 0.6, note: null });
    }

    // 贈与
    if (/(贈与|あげた|もらった|援助)/.test(t)) {
      if (isNegative(t)) out.check_items.push({ check_item_id: "gifts.calendar", status: "not_applicable", answer: "生前贈与はないとの回答", evidence_segment_ids: ev, confidence: 0.5 });
      else {
        const who = t.match(/(孫|長男|長女|次男|次女|妻|息子|娘)/)?.[1] ?? "受贈者未確認";
        const vague = /(くらい|ぐらい|ほど|頃|たぶん|確か)/.test(t);
        const attrs = [{ key: "recipient", value: who }];
        const amt = t.match(/([0-9０-９一二三四五六七八九十百千]+万円?)/)?.[1];
        if (amt) attrs.push({ key: "amount", value: amt });
        const when = t.match(/([0-9０-９一二三四五六七八九十]+年前|[0-9]{4}年|令和[一二三四五六七八九十0-9]+年)/)?.[1];
        if (when) attrs.push({ key: "date", value: when });
        pushEntity({ entity_id: null, entity_type: "lifetime_gift", label: `${who}への贈与`, assertion: vague ? "unknown" : "present", attributes: attrs, corrects_entity_id: null, evidence_segment_ids: ev, confidence: 0.5, note: null });
        if (vague) out.check_items.push({ check_item_id: "gifts.calendar", status: "needs_followup", answer: "贈与の時期・金額が曖昧", evidence_segment_ids: ev, confidence: 0.5 });
      }
      lastTopic = "gifts.calendar";
    }

    // 名義預金
    if (/名義/.test(t) && /(孫|妻|子|息子|娘|家族)/.test(t) && /(口座|預金|通帳)/.test(t)) {
      const holder = t.match(/(孫|妻|長男|長女|息子|娘)/)?.[1] ?? "家族";
      pushEntity({ entity_id: null, entity_type: "nominee_deposit", label: `${holder}名義の預金`, assertion: "unknown", attributes: [{ key: "holder", value: holder }], corrects_entity_id: null, evidence_segment_ids: ev, confidence: 0.5, note: "名義預金の可能性" });
    }

    // 遺言
    if (/遺言/.test(t)) {
      lastTopic = "will.exists";
      if (isUnknown(t)) {
        /* 下の「分からない」処理で will.exists を要追加確認にする */
      } else if (isNegative(t)) out.check_items.push({ check_item_id: "will.exists", status: "not_applicable", answer: "遺言書はないとの回答", evidence_segment_ids: ev, confidence: 0.6 });
      else if (!/遺言書は/.test(t) || /あります/.test(t)) pushEntity({ entity_id: null, entity_type: "will", label: "遺言書", assertion: "present", attributes: [{ key: "exists", value: "あり" }, ...(/公正/.test(t) ? [{ key: "type", value: "公正証書遺言" }] : [])], corrects_entity_id: null, evidence_segment_ids: ev, confidence: 0.6, note: null });
    }

    // 相続人
    const heirMatch = t.match(/相続人は([^。]+)/);
    if (heirMatch) {
      for (const rel of heirMatch[1].split(/[、と]/).map((x) => x.replace(/(です|の|\s|私|人)/g, "")).filter((x) => /^(妻|夫|長男|長女|次男|次女|三男|三女|母|父|兄|弟|姉|妹)$/.test(x))) {
        pushEntity({ entity_id: null, entity_type: "heir", label: rel, assertion: "present", attributes: [{ key: "relationship", value: rel }], corrects_entity_id: null, evidence_segment_ids: ev, confidence: 0.6, note: null });
      }
    }

    // 死亡日
    const death = t.match(/(20[0-9]{2})年([0-9]{1,2})月([0-9]{1,2})日に亡くな/);
    if (death) {
      const d = `${death[1]}-${death[2].padStart(2, "0")}-${death[3].padStart(2, "0")}`;
      pushEntity({ entity_id: null, entity_type: "decedent", label: "被相続人", assertion: "present", attributes: [{ key: "death_date", value: d }], corrects_entity_id: null, evidence_segment_ids: ev, confidence: 0.8, note: null });
      out.check_items.push({ check_item_id: "basic.death_date", status: "answered", answer: d, evidence_segment_ids: ev, confidence: 0.8 });
    }

    // 「分からない」
    if (isUnknown(t) && lastTopic) {
      out.check_items.push({ check_item_id: lastTopic, status: "unknown_answer", answer: "相続人は分からないと回答", evidence_segment_ids: ev, confidence: 0.5 });
    }
    prev.push(s);
  }
  out.suggested_questions = out.suggested_questions.slice(0, 3);
  return out;
}
