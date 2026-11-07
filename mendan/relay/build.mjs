// Cloud Run 用に1ファイルへまとめる（依存パッケージは Dockerfile で npm install する）
import { build } from "esbuild";
await build({
  entryPoints: ["src/server.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  outfile: "dist/server.js",
  sourcemap: true,
  external: ["firebase-admin", "google-auth-library", "ws"],
  logLevel: "info",
});
