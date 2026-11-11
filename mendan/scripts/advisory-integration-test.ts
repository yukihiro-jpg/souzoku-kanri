/**
 * 顧問モード（打ち合わせメモ → ルール集への反映）の結合テスト
 *   前提: エミュレーター起動済み（npm run emulators:clean）。AI_MODE=mock・GOOGLE_MODE=mock
 *   実行: npm run test:advisory
 *
 * 本物の Google ドキュメント・AI にはつながない（開発用のドキュメントと簡易振り分けを使う）。
 * 確認内容:
 *  - Google 連携・ルール集の登録がないと解析できない
 *  - メモを発言に分け、聞き間違いを読み直し、3つに振り分ける
 *  - 承認できない状態（章がない）は承認できない
 *  - 承認したものだけをルール集に書き込み、確認日・更新日を付ける。カードは Firestore に残る
 *  - 解析のあとにルール集が編集されていたら書き込まない
 *  - 顧問先のメンバー以外は、他の顧問先の結果を読めず、操作もできない
 */
import { initializeApp, deleteApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, GoogleAuthProvider, signInWithCredential } from "firebase/auth";
import { collection, connectFirestoreEmulator, doc, getDoc, getDocs, getFirestore, query, where, type Firestore } from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions, httpsCallable, type Functions } from "firebase/functions";
import { P, type RuleItem } from "@mendan/shared";

const PROJECT = "demo-souzoku-mendan";
let failures = 0;
const ok = (cond: unknown, msg: string) => {
  console.log(`  ${cond ? "✔" : "✘"} ${msg}`);
  if (!cond) failures++;
};
interface C {
  app: FirebaseApp;
  db: Firestore;
  fn: Functions;
  uid: string;
  call: <T = any>(name: string, data?: unknown) => Promise<T>;
}
let n = 0;
async function login(email: string): Promise<C> {
  const app = initializeApp({ projectId: PROJECT, apiKey: "demo-key", authDomain: "localhost" }, `a${++n}`);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const db = getFirestore(app);
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  const fn = getFunctions(app, "asia-northeast1");
  connectFunctionsEmulator(fn, "127.0.0.1", 5001);
  const u = await signInWithCredential(auth, GoogleAuthProvider.credential(JSON.stringify({ sub: email, email, email_verified: true, name: email.split("@")[0] })));
  return { app, db, fn, uid: u.user.uid, call: async (name, data) => (await httpsCallable(fn, name, { timeout: 120_000 })(data)).data as any };
}
async function fails(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}
/** 開発用ドキュメントの中身（ブラウザからは読めないので、エミュレーターの管理者権限で読む） */
async function mockDocText(id: string): Promise<string> {
  const r = await fetch(`http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents/_mockDocs/${id}`, { headers: { Authorization: "Bearer owner" } });
  return JSON.stringify(await r.json());
}

async function main() {
  const ts = Date.now();
  const rulebookId = `mock-rulebook-${ts}`;
  const notesId = `mock-notes-${ts}`;
  const admin = await login("admin@example.com");
  await admin.call("ensureUser");
  const staff = await login("staff2@example.com");
  await staff.call("ensureUser");

  console.log("■ 顧問先の登録と準備");
  const { clientId: A } = await admin.call("createClient", { code: `A${ts}`, name: "テスト食品（架空）", accountingSystem: "kaikei_taisho", fiscalMonth: 3 });
  const { clientId: B } = await staff.call("createClient", { code: `B${ts}`, name: "別の会社（架空）", accountingSystem: "mf", fiscalMonth: 8 });
  ok(!!A && !!B, "顧問先を登録できる");
  ok(/already|すでに/.test((await fails(admin.call("createClient", { code: `A${ts}`, name: "重複", accountingSystem: "mf", fiscalMonth: 1 }))) ?? ""), "同じ顧問先コードは登録できない");
  await admin.call("googleDisconnect");
  ok(/ルール集/.test((await fails(admin.call("startRuleRun", { clientId: A, notesDocId: notesId }))) ?? ""), "ルール集が未登録なら解析できない");
  await admin.call("updateClient", { clientId: A, rulebookDocId: rulebookId, rulebookDocName: "ルール集（開発用）" });
  ok(/連携/.test((await fails(admin.call("startRuleRun", { clientId: A, notesDocId: notesId }))) ?? ""), "Google 連携がないと解析できない");
  await admin.call("googleConnect", {});

  console.log("■ 解析（発言に分割・読み直し・振り分け）");
  const r1 = await admin.call("startRuleRun", { clientId: A, notesDocId: notesId, notesDocName: "メモ（開発用）" });
  ok(r1.segments === 5 && r1.hints >= 1, `メモを発言に分け、読み直しの候補を見つける（発言 ${r1.segments}・候補 ${r1.hints}）`);
  const items1 = (await getDocs(collection(admin.db, P.ruleItems(A, r1.runId)))).docs.map((d) => d.data() as RuleItem);
  const rule = items1.find((i) => i.bucket === "rule")!;
  const question = items1.find((i) => i.bucket === "question")!;
  const card = items1.find((i) => i.bucket === "card")!;
  ok(rule && question && card, "ルール案・確認事項・カードに振り分けられる");
  ok(rule.corrections.some((c) => c.heard === "常用銀行" && c.corrected === "常陽銀行") && rule.afterText?.includes("常陽銀行"), "聞き間違い（常用銀行→常陽銀行）を読み直す");
  ok(rule.evidence[0].found && rule.evidence[0].time === "00:01:10", "根拠の時刻と引用が付く");
  const job = (await getDocs(collection(admin.db, P.clientAiJobs(A)))).docs.map((d) => d.data())[0];
  ok(JSON.stringify(job.inputDocs) === JSON.stringify([notesId, rulebookId]) && job.clientId === A, "AI への入力はこの顧問先のメモとルール集だけ（記録で確認）");

  console.log("■ 顧問先ごとの分離");
  ok(!!(await fails(getDoc(doc(staff.db, P.ruleRun(A, r1.runId))))), "メンバー以外は他の顧問先の結果を読めない");
  ok(!!(await fails(getDocs(collection(staff.db, P.ruleItems(A, r1.runId))))), "メンバー以外は他の顧問先の項目を読めない");
  ok(!!(await fails(staff.call("decideRuleItem", { clientId: A, runId: r1.runId, itemId: rule.id, decision: "approve" }))), "メンバー以外は他の顧問先の項目を承認できない");
  ok(!!(await fails(staff.call("startRuleRun", { clientId: A, notesDocId: notesId }))), "メンバー以外は他の顧問先で解析できない");
  const mine = (await getDocs(query(collection(staff.db, P.clients()), where("memberIds", "array-contains", staff.uid)))).docs.map((d) => d.id);
  ok(mine.includes(B) && !mine.includes(A), "顧問先の一覧には自分の顧問先だけが出る");

  console.log("■ 承認と書き込み");
  ok(/章/.test((await fails(admin.call("decideRuleItem", { clientId: A, runId: r1.runId, itemId: rule.id, decision: "approve", edit: { sectionHeading: "9-9 存在しない章" } }))) ?? ""), "存在しない章には承認できない");
  await admin.call("decideRuleItem", { clientId: A, runId: r1.runId, itemId: rule.id, decision: "approve", edit: { sectionHeading: "5-4 経費", afterText: "電気代は常陽普通（130）から口座振替。" } });
  await admin.call("decideRuleItem", { clientId: A, runId: r1.runId, itemId: question.id, decision: "approve", answer: "雑収入で処理する" });
  await admin.call("decideRuleItem", { clientId: A, runId: r1.runId, itemId: card.id, decision: "approve" });
  const res = await admin.call("applyRuleRun", { clientId: A, runId: r1.runId });
  ok(res.written === 3 && res.errors.length === 0, `承認した3件を書き込み・保存（${JSON.stringify(res)}）`);
  const text = await mockDocText(rulebookId);
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  ok(text.includes(`電気代は常陽普通（130）から口座振替。（${today}確認）`), "ルール集に確認日つきで書き込まれる");
  ok(text.includes(`更新：${today}`), "ルール集の更新日が今日になる");
  const cards = (await getDocs(collection(admin.db, P.cards(A)))).docs.map((d) => d.data());
  ok(cards.length === 2 && cards.some((c) => c.kind === "question" && c.status === "done"), "カードと確認事項（回答つき）が顧問先に残る");
  ok((await getDocs(collection(admin.db, P.ruleChanges(A)))).size === 1, "ルール集の変更の記録が残る");
  const after = (await getDoc(doc(admin.db, P.ruleItem(A, r1.runId, rule.id)))).data() as RuleItem;
  ok(after.status === "written", "書き込んだ項目は「書き込み済み」になる");
  ok(!!(await fails(admin.call("decideRuleItem", { clientId: A, runId: r1.runId, itemId: rule.id, decision: "reject" }))), "書き込み済みの項目は変更できない");

  console.log("■ ルール集が先に編集されていたら書き込まない");
  const r2 = await admin.call("startRuleRun", { clientId: A, notesDocId: notesId });
  const r3 = await admin.call("startRuleRun", { clientId: A, notesDocId: notesId });
  const pick = async (runId: string) => (await getDocs(collection(admin.db, P.ruleItems(A, runId)))).docs.map((d) => d.data() as RuleItem).find((i) => i.bucket === "rule")!;
  const i2 = await pick(r2.runId);
  const i3 = await pick(r3.runId);
  await admin.call("decideRuleItem", { clientId: A, runId: r2.runId, itemId: i2.id, decision: "approve", edit: { sectionHeading: "5-4 経費", afterText: "2回目の追記" } });
  await admin.call("decideRuleItem", { clientId: A, runId: r3.runId, itemId: i3.id, decision: "approve", edit: { sectionHeading: "5-6 税金の納付", afterText: "3回目の追記" } });
  await admin.call("applyRuleRun", { clientId: A, runId: r3.runId });
  ok(/編集されています/.test((await fails(admin.call("applyRuleRun", { clientId: A, runId: r2.runId }))) ?? ""), "解析のあとにルール集が変わっていたら書き込まない");
  ok(!(await mockDocText(rulebookId)).includes("2回目の追記"), "書き込まなかった内容はルール集に入らない");

  for (const c of [admin, staff]) await deleteApp(c.app);
  console.log(failures ? `\n顧問モードの結合テスト: ${failures} 件失敗` : "\n顧問モードの結合テスト: すべて成功");
  process.exit(failures ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
