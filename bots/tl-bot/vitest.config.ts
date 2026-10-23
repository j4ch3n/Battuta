import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 30000,
    coverage: {
      provider: "v8",
      include: [".pi/extensions/bounded-subagents/**/*.ts"],
      exclude: ["**/broker.ts"],
    },
  },
});
