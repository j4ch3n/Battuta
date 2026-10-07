import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: [
        "client.ts",
        "auth.ts",
        fileURLToPath(new URL("../supabase/functions/_shared/task-contracts.ts", import.meta.url)),
      ],
      allowExternal: true,
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
          testTimeout: 30000,
          hookTimeout: 30000,
          fileParallelism: false,
        },
      },
    ],
  },
});
