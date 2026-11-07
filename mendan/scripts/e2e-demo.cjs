/**
 * ブラウザでの通しテスト（エミュレーター + デモ再生）
 *   前提: `npm run emulators:clean` と `npm run dev` を起動済み
 *   実行: node scripts/e2e-demo.cjs [出力フォルダ]
 *
 * ログイン → 案件作成 → 同意記録 → 面談開始 → デモ面談の再生 →
 * 文字起こしに応じて必要資料リストが更新されることを確認 → 根拠リンク → 面談終了（警告）→ 再解析 → 資料依頼書
 */
const { chromium } = require("playwright");
const path = require("path");

const BASE = process.env.BASE_URL || "http://127.0.0.1:5173";
const OUT = process.argv[2] || path.join(__dirname, "..", "test-results");
const scale = Number(process.env.SCALE || 1);

let failures = 0;
const ok = (c, m) => {
  console.log(`  ${c ? "✔" : "✘"} ${m}`);
  if (!c) failures++;
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: scale });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !/PERMISSION_DENIED|Failed to load resource/.test(m.text()) && errors.push(m.text()));

  console.log("■ ログイン・案件作成");
  await page.goto(`${BASE}/login`);
  await page.getByTestId("dev-email").fill("admin@example.com");
  await page.getByTestId("dev-login").click();
  await page.getByTestId("case-name").waitFor({ timeout: 20000 });
  await page.getByTestId("case-name").fill("山田家 相続税申告（架空）");
  await page.getByTestId("decedent-name").fill("山田 太郎");
  await page.getByTestId("death-date").fill("2026-08-20");
  await page.getByTestId("create-case").click();
  await page.getByTestId("consent-section").waitFor();
  ok(await page.getByTestId("start-meeting").isDisabled(), "同意記録前は面談開始ボタンが押せない");
  await page.getByTestId("consent-recording").check();
  await page.getByTestId("consent-ai").check();
  await page.getByTestId("save-consent").click();
  await page.waitForFunction(() => !document.querySelector('[data-testid="start-meeting"]')?.hasAttribute("disabled"), null, { timeout: 15000 });
  await page.getByTestId("start-meeting").click();
  await page.waitForURL(/meetings\//, { timeout: 20000 });
  await page.goto(page.url() + "?demoSpeed=4");
  await page.getByTestId("start-demo").waitFor();

  console.log("■ デモ面談の再生");
  const t0 = Date.now();
  await page.getByTestId("start-demo").click();
  await page.getByTestId("interim").waitFor({ timeout: 10000 });
  ok(true, "暫定テキストが表示される");
  await page.waitForTimeout(9000);
  await page.getByTestId("tab-docs").click();
  await page.screenshot({ path: path.join(OUT, "meeting-during.png") });
  await page.waitForFunction(() => document.querySelector('[data-testid="status-bar"]')?.textContent?.includes("デモ再生が終わりました"), null, { timeout: 120000 });
  // 最後の解析の反映を待つ
  await page.waitForFunction(() => ![...document.querySelectorAll('[data-testid="transcript"] [data-seg]')].some((e) => /解析待ち|解析中/.test(e.textContent || "")), null, { timeout: 30000 });
  console.log(`  （再生と解析: ${((Date.now() - t0) / 1000).toFixed(1)}秒）`);

  const docNames = await page.$$eval('[data-testid="doc-row"]', (rows) => rows.map((r) => `${r.getAttribute("data-status")}|${r.textContent}`));
  ok(docNames.some((d) => d.startsWith("candidate|") && d.includes("筑波銀行の残高証明書")), "筑波銀行（訂正後）の残高証明書が必要候補に追加");
  ok(docNames.some((d) => d.startsWith("removal_candidate|") && d.includes("常陽銀行")), "常陽銀行（訂正前）の資料は削除候補");
  ok(docNames.some((d) => d.includes("ゆうちょ銀行の定期預金の既経過利息")), "ゆうちょ銀行の定期預金 → 既経過利息計算書");
  ok(docNames.some((d) => d.includes("登記事項証明書")), "水戸市の自宅 → 登記事項証明書");
  ok(docNames.some((d) => d.includes("さくら生命")), "生命保険 → 支払通知書");
  ok(docNames.filter((d) => d.includes("贈与税の申告書")).length === 1, "同じ資料は重複追加されない");
  await page.screenshot({ path: path.join(OUT, "meeting-docs.png") });

  console.log("■ 根拠リンク");
  await page.getByTestId("tab-check").click();
  const seg = page.locator('[data-seg]').filter({ hasText: "水戸市に自宅" }).first();
  await seg.click();
  const hl = await page.locator(".ring-yellow-400").count();
  ok(hl > 0, `発言をクリックすると対応する確認項目・抽出情報が強調（${hl}件）`);
  await page.screenshot({ path: path.join(OUT, "meeting-check.png") });
  const checks = await page.$$eval('[data-testid="check-row"]', (r) => r.map((x) => x.getAttribute("data-status")));
  ok(checks.includes("ai_candidate"), "AI確認候補の確認事項がある");
  ok(!checks.includes("confirmed"), "AIは「確認済み」を設定しない");
  ok(checks.filter((s) => s === "unconfirmed").length > 20, "話題に出なかった事項は未確認のまま");
  const nq = await page.getByTestId("next-questions").textContent();
  ok(!!nq && nq.length > 20, "次に確認すべき質問が表示される");

  console.log("■ 担当者の操作");
  await page.getByTestId("confirm-check").first().click();
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="check-row"]')].some((e) => e.getAttribute("data-status") === "confirmed"), null, { timeout: 15000 });
  ok(true, "確認事項を「確認済み」にできる");

  console.log("■ 面談終了");
  await page.getByTestId("end-meeting").click();
  await page.getByTestId("end-warning").waitFor({ timeout: 15000 });
  ok(true, "未確認の重要事項があると終了時に警告");
  await page.screenshot({ path: path.join(OUT, "meeting-end-warning.png") });
  await page.getByTestId("force-end").click();
  await page.waitForFunction(() => document.body.textContent?.includes("再解析が完了しました"), null, { timeout: 60000 });
  ok(true, "強制終了 → 面談後の全体再解析が実行される");

  const url = page.url().replace(/\/meetings\/.*/, "/print");
  await page.goto(url);
  await page.waitForTimeout(1500);
  const rows = await page.$$eval("section tbody tr", (r) => r.length);
  ok(rows > 10, `資料依頼書に資料が一覧表示（${rows}行）`);
  await page.screenshot({ path: path.join(OUT, "print.png"), fullPage: true });
  await page.evaluate(() => document.fonts.ready);
  await page.pdf({ path: path.join(OUT, "print.pdf"), format: "A4", preferCSSPageSize: true });

  console.log("■ 案件の完了・削除");
  const NAME = "山田家 相続税申告（架空）";
  const caseUrl = url.replace(/\/print$/, "");
  await page.goto(caseUrl);
  page.once("dialog", (d) => d.accept());
  await page.getByTestId("toggle-close").click();
  await page.waitForURL((u) => new URL(u).pathname === "/", { timeout: 15000 });
  await page.getByTestId("tab-active").waitFor();
  await page.waitForTimeout(800);
  ok(!(await page.getByText(NAME).isVisible()), "完了にした案件はトップ画面（進行中）に表示されない");
  await page.getByTestId("tab-closed").click();
  await page.getByText(NAME).waitFor({ timeout: 5000 });
  ok(true, "「完了した案件」に表示される");
  await page.screenshot({ path: path.join(OUT, "case-list-closed.png") });
  await page.getByText(NAME).click();
  await page.getByTestId("toggle-close").waitFor();
  ok((await page.getByTestId("toggle-close").textContent())?.includes("進行中に戻す"), "完了した案件には「進行中に戻す」ボタン");
  await page.screenshot({ path: path.join(OUT, "case-closed.png") });
  page.once("dialog", (d) => d.accept(NAME));
  await page.getByTestId("delete-case").click();
  await page.waitForURL((u) => new URL(u).pathname === "/", { timeout: 30000 });
  await page.getByTestId("tab-closed").click();
  await page.waitForTimeout(800);
  ok(!(await page.getByText(NAME).isVisible()), "削除した案件はどちらの一覧にも表示されない");

  ok(errors.length === 0, `ブラウザのエラーなし${errors.length ? `: ${errors.slice(0, 3).join(" / ")}` : ""}`);
  await browser.close();
  console.log(failures ? `\nE2E: ${failures} 件失敗` : "\nE2E: すべて成功");
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
