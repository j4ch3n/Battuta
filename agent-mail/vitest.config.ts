import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["*.ts"],
      exclude: ["vitest.config.ts"],
      reporter: ["text", "lcov", "json-summary"],
    },
    projects: [
      {
        test: {
          name: "unit",
          include: ["tests/**/*.test.ts"],
          exclude: ["tests/**/*.integration.test.ts"],
          environment: "node",
        },
      },
      {
        test: {
          name: "integration",
          include: ["tests/**/*.integration.test.ts"],
          environment: "node",
          testTimeout: 30_000,
          hookTimeout: 30_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
