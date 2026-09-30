import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      { test: {
        name: "unit",
        include: ["tests/schema.test.ts", "tests/completion.test.ts"],
      } },
      { test: {
        name: "integration",
        include: ["tests/database.test.ts", "tests/api.test.ts", "tests/extension.test.ts"],
        testTimeout: 30_000,
        hookTimeout: 30_000,
        fileParallelism: false,
      } },
    ],
  },
});
