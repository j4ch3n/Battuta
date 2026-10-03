import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["index.ts", "guards.ts", "tools/**/*.ts", "store/**/*.ts"],
      reporter: ["text", "lcov", "json-summary"],
    },
  },
});
