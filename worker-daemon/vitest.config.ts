import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 30000,
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
      ],
      reporter: ["text", "lcov", "json-summary"],
    },
  },
});
