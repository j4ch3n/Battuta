import { execFileSync } from "node:child_process";
import { expect, test } from "vitest";

test("the launcher's actual strip-only Node runtime can import the host without starting it", () => {
  expect(() =>
    execFileSync(
      process.execPath,
      ["--experimental-strip-types", "--input-type=module", "-e", "await import('./host.ts')"],
      { cwd: process.cwd(), stdio: "pipe" },
    ),
  ).not.toThrow();
});
