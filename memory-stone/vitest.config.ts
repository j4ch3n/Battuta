import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["*.ts", "tools/**/*.ts", "commands/**/*.ts"],
      exclude: ["vitest.config.ts"],
      reporter: ["text", "lcov", "json-summary"],
    },
  },
});
