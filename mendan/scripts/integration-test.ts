/**
 * エミュレーター上での結合テスト（APIキー不要: AI_MODE=mock）
 *
 * 実行: 別ターミナルで `npm run emulators:clean` → `npm run test:integration`
 *
 * 確認内容:
 *  - 許可ドメイン以外のアカウントは利用不可
 *  - 同意がないと面談・録音を開始できない
 *  - 確定発言の保存 → 解析関数 → ルールエンジン → 必要資料リストの更新
 *  - 同じ発言IDの二重保存・ブラウザからの資料改ざんはセキュリティルールで拒否
 *  - 案件メンバー以外は閲覧不可
 *  - 承認済み資料は訂正発言でも変更されない
 *  - 面談終了時の未確認事項警告、面談後の再解析
 */
import { initializeApp, deleteApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, GoogleAuthProvider, signInWithCredential } from "firebase/auth";
import { collection, connectFirestoreEmulator, doc, getDoc, getDocs, getFirestore, setDoc, updateDoc, type Firestore } from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions, httpsCallable, type Functions } from "firebase/functions";
import { DEMO_SCRIPT, P, segmentId, type DocumentRequirement, type TranscriptSegment } from "@mendan/shared";

const PROJECT = "demo-souzoku-mendan";
let failures = 0;
const ok = (cond: unknown, msg: string) => {
  if (cond) console.log(`  ✔ ${msg}`);
  else {
    failures++;
    console.log(`  ✘ ${msg}`);
  }
};

interface Client {
  app: FirebaseApp;
  db: Firestore;
  fn: Functions;
  uid: string;
  call: <T = any>(name: string, data?: unknown) => Promise<T>;
}

let n = 0;
async function login(email: string): Promise<Client> {
  const app = initializeApp({ projectId: PROJECT, apiKey: "demo-key", authDomain: "localhost" }, `c${++n}`);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const db = getFirestore(app);
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  const fn = getFunctions(app, "asia-northeast1");
  connectFunctionsEmulator(fn, "127.0.0.1", 5001);
  const cred = GoogleAuthProvider.credential(JSON.stringify({ sub: email, email, email_verified: true, name: email.split("@")[0] }));
  const u = await signInWithCredential(auth, cred);
  return { app, db, fn, uid: u.user.uid, call: async (name, data) => (await httpsCallable(fn, name)(data)).data as any };
}

async function expectFail(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

async function main() {
  console.log("■ 認証・権限");
  const admin = await login("admin@example.com");
  const prof = await admin.call("ensureUser");
  ok(prof.role === "admin", "ADMIN_EMAILS のユーザーは管理者として登録");
  const outsider = await login("someone@gmail.com");
  ok(!!(await expectFail(outsider.call("ensureUser"))), "許可ドメイン外のアカウントは拒否");
  const notListed = await login("stranger@example.com");
  ok(!!(await expectFail(notListed.call("ensureUser"))), "同じドメインでも ALLOWED_EMAILS にないアカウントは拒否");
  ok(!!(await expectFail(notListed.call("createCase", { name: "x", decedentName: "x" }))), "ALLOWED_EMAILS にないアカウントは操作もできない");
  const staff2 = await login("staff2@example.com");
  await staff2.call("ensureUser");

  console.log("■ 案件作成・同意");
  const { caseId } = await admin.call("createCase", { name: "テスト案件（架空）", decedentName: "山田 太郎", inheritanceStartDate: "2026-08-20" });
  ok(!!caseId, "案件を作成");
  ok(!!(await expectFail(admin.call("startMeeting", { caseId }))), "同意なしでは面談を開始できない");
  ok(!!(await expectFail(getDoc(doc(staff2.db, P.case(caseId))))), "メンバー以外は案件を閲覧できない");
  await admin.call("recordConsent", { caseId, recording: true, aiAnalysis: true, method: "verbal" });
  const { meetingId } = await admin.call("startMeeting", { caseId });
  ok(!!meetingId, "同意記録後に面談を開始");
  const sess = await admin.call("createTranscriptionSession", { caseId, meetingId });
  ok(sess.mode === "mock", `文字起こしセッション（キー未設定のため mock: ${sess.reason}）`);

  console.log("■ 発言の保存 → AI解析 → 必要資料");
  const latencies: number[] = [];
  for (let i = 0; i < DEMO_SCRIPT.length; i++) {
    const seq = i + 1;
    const id = segmentId(meetingId, seq);
    const line = DEMO_SCRIPT[i];
    const s: TranscriptSegment = {
      id,
      caseId,
      meetingId,
      seq,
      speaker: line.speaker,
      speakerLabel: null,
      speakerConfirmed: true,
      text: line.text,
      final: true,
      kind: "speech",
      analysisStatus: "pending",
      timings: { finalAt: Date.now() },
      createdAt: new Date().toISOString(),
      createdBy: admin.uid,
    };
    await setDoc(doc(admin.db, P.segment(caseId, meetingId, id)), s);
    const t = Date.now();
    await admin.call("analyzeSegments", { caseId, meetingId, segmentIds: [id], clientRequestedAt: t });
    latencies.push(Date.now() - t);
  }
  latencies.sort((a, b) => a - b);
  console.log(`  （解析関数の往復時間 P50=${latencies[Math.floor(latencies.length / 2)]}ms / 最大=${latencies[latencies.length - 1]}ms ※エミュレーター・mock）`);

  const docs = (await getDocs(collection(admin.db, P.documents(caseId)))).docs.map((d) => d.data() as DocumentRequirement);
  const names = docs.filter((d) => d.status === "candidate").map((d) => d.name);
  ok(names.includes("筑波銀行の残高証明書（相続開始日時点）"), "訂正後の筑波銀行の残高証明書が候補");
  ok(docs.filter((d) => d.target === "常陽銀行").every((d) => d.status === "removal_candidate"), "訂正前の常陽銀行の資料は削除候補");
  ok(names.some((x) => x.includes("ゆうちょ銀行の取引履歴")), "ゆうちょ銀行の取引履歴が候補");
  ok(names.some((x) => x.includes("登記事項証明書")), "不動産の登記事項証明書が候補");
  ok(names.some((x) => x.includes("さくら生命")), "生命保険の資料が候補");
  ok(docs.find((d) => d.documentId === "bank_history" && d.target === "筑波銀行")?.period?.includes("2021-08-21") === true, "取引履歴の対象期間が調査方針（5年）で算定");
  ok(docs.filter((d) => d.entityId).every((d) => d.evidenceSegmentIds.length > 0), "財産由来の資料にはすべて根拠発言がある");

  console.log("■ セキュリティルール");
  const dupId = segmentId(meetingId, 1);
  ok(!!(await expectFail(setDoc(doc(admin.db, P.segment(caseId, meetingId, dupId)), { id: dupId, text: "改ざん" }))), "同じ発言IDの上書きは拒否");
  const someDoc = docs[0];
  ok(!!(await expectFail(updateDoc(doc(admin.db, `${P.documents(caseId)}/${someDoc.id}`), { status: "verified" }))), "ブラウザから必要資料を直接変更できない");
  ok(!!(await expectFail(getDocs(collection(staff2.db, P.documents(caseId))))), "メンバー以外は必要資料を閲覧できない");

  console.log("■ 担当者の承認を AI が上書きしない");
  const tsukuba = docs.find((d) => d.documentId === "bank_balance" && d.target === "筑波銀行")!;
  await admin.call("updateDocument", { caseId, docId: tsukuba.id, status: "required" });
  const seq = DEMO_SCRIPT.length + 1;
  const corrId = segmentId(meetingId, seq);
  await setDoc(doc(admin.db, P.segment(caseId, meetingId, corrId)), {
    id: corrId, caseId, meetingId, seq, speaker: "client", speakerLabel: null, speakerConfirmed: true,
    text: "ごめんなさい、筑波銀行ではなく水戸信用金庫でした。", final: true, kind: "speech", analysisStatus: "pending",
    timings: { finalAt: Date.now() }, createdAt: new Date().toISOString(), createdBy: admin.uid,
  });
  await admin.call("analyzeSegments", { caseId, meetingId, segmentIds: [corrId] });
  const after = (await getDoc(doc(admin.db, `${P.documents(caseId)}/${tsukuba.id}`))).data() as DocumentRequirement;
  ok(after.status === "required", "必要確定にした資料は訂正発言後も変更されない");
  ok(after.needsReview === true, "根拠が訂正された承認済み資料には要確認フラグ");
  const reviews = (await getDocs(collection(admin.db, P.reviewItems(caseId)))).docs.map((d) => d.data());
  ok(reviews.some((r) => r.kind === "correction_on_locked"), "追加確認候補が作成される");

  console.log("■ 面談終了・再解析");
  const end1 = await admin.call("endMeeting", { caseId, meetingId });
  ok(end1.ended === false && end1.warnings.length > 0, `未確認の重要事項があると警告（${end1.warnings.length}件）`);
  const end2 = await admin.call("endMeeting", { caseId, meetingId, force: true });
  ok(end2.ended === true, "警告を確認したうえで終了できる");
  const re = await admin.call("reanalyzeMeeting", { caseId, meetingId });
  ok(typeof re.reviewItems === "number", `面談後の全体再解析（追加確認候補 ${re.reviewItems} 件）`);
  ok(!!(await expectFail(setDoc(doc(admin.db, P.segment(caseId, meetingId, segmentId(meetingId, 999))), { id: segmentId(meetingId, 999) }))), "終了した面談には発言を追加できない");

  console.log("■ 案件の完了・削除");
  const m2 = await admin.call("startMeeting", { caseId });
  ok(!!(await expectFail(admin.call("setCaseStatus", { caseId, status: "closed" }))), "面談中の案件は完了にできない");
  await admin.call("endMeeting", { caseId, meetingId: m2.meetingId, force: true });
  await admin.call("setCaseStatus", { caseId, status: "closed" });
  const closedCase = (await getDoc(doc(admin.db, P.case(caseId)))).data();
  ok(closedCase?.status === "closed" && !!closedCase?.closedAt, "案件を完了にできる（完了日時を記録）");
  await admin.call("setCaseStatus", { caseId, status: "active" });
  ok((await getDoc(doc(admin.db, P.case(caseId)))).data()?.status === "active", "完了した案件を進行中に戻せる");
  ok(!!(await expectFail(staff2.call("deleteCase", { caseId, confirmName: "テスト案件（架空）" }))), "管理者以外は削除できない");
  ok(!!(await expectFail(admin.call("deleteCase", { caseId, confirmName: "違う名前" }))), "案件名が一致しないと削除しない");
  await admin.call("deleteCase", { caseId, confirmName: "テスト案件（架空）" });
  const left = await Promise.all([P.documents(caseId), P.entities(caseId), P.checkItems(caseId), P.meetings(caseId), P.segments(caseId, meetingId)].map((c) => getDocs(collection(admin.db, c)).then((r) => r.size).catch(() => 0)));
  ok(!(await getDoc(doc(admin.db, P.case(caseId)))).exists() && left.every((n) => n === 0), `削除すると案件と配下のデータがすべて消える（残り ${left.join("/")}）`);

  for (const c of [admin, outsider, staff2]) await deleteApp(c.app);
  console.log(failures === 0 ? "\n結合テスト: すべて成功" : `\n結合テスト: ${failures} 件失敗`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
