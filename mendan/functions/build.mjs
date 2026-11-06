// Cloud Functions 用に shared を同梱して1ファイルへバンドルする。
// （デプロイ時は functions フォルダだけがアップロードされるため）
import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  outfile: "lib/index.js",
  sourcemap: true,
  // 外部パッケージは package.json の dependencies からインストールされる
  external: ["firebase-admin", "firebase-functions", "@anthropic-ai/sdk", "@google/genai", "zod"],
  logLevel: "info",
});
