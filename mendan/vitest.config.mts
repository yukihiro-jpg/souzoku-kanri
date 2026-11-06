import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["shared/test/**/*.test.ts", "functions/test/**/*.test.ts", "web/src/**/*.test.ts"],
    environment: "node",
  },
});
