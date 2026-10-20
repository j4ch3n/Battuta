import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/**/*.integration.test.ts"],
    coverage: {
      provider: "v8",
      include: ["*.ts"],
      exclude: ["vitest.config.ts"],
      reporter: ["text", "lcov", "json-summary"],
    },
  },
});
