import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["tests/**/*.test.ts"],
          exclude: ["tests/**/*.integration.test.ts"],
          testTimeout: 30000,
        },
      },
      {
        test: {
          name: "integration",
          include: ["tests/**/*.integration.test.ts"],
          testTimeout: 60000,
          hookTimeout: 30000,
          fileParallelism: false,
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: [
        "config.ts",
        "lock.ts",
        "worktree.ts",
        "opencode.ts",
        "prompt.ts",
        "daemon.ts",
        "main.ts",
        "scripts/smoke.ts",
      ],
      reporter: ["text", "lcov", "json-summary"],
    },
  },
});
