import { afterEach, expect, test, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import extension from "../index.ts";
afterEach(() => vi.unstubAllEnvs());

test("extension does not register legacy profile or memory tools", () => {
  vi.stubEnv("AGENT_ROLE", "cos");
  const tools: unknown[] = [];
  const hooks: string[] = [];
  extension({
    on: (event: string) => {
      hooks.push(event);
    },
    registerTool: (tool: unknown) => {
      tools.push(tool);
    },
  } as unknown as ExtensionAPI);
  expect(tools).toEqual([]);
  expect(hooks).toContain("before_agent_start");
});

test.each(["manager", "worker", ""])("%s cannot register memory hooks", (role) => {
  vi.stubEnv("AGENT_ROLE", role);
  const hooks: string[] = [];
  extension({ on: (event: string) => hooks.push(event) } as unknown as ExtensionAPI);
  expect(hooks).toEqual([]);
});
