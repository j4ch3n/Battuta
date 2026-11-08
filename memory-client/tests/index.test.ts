import { afterEach, expect, test, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import extension from "../index.ts";

afterEach(() => vi.unstubAllEnvs());
test.each(["manager", "worker", ""])("%s cannot register memory hooks", (role) => {
  vi.stubEnv("AGENT_ROLE", role);
  const hooks: string[] = [];
  extension({ on: (name: string) => hooks.push(name) } as unknown as ExtensionAPI);
  expect(hooks).toEqual([]);
});
test("CoS registers lifecycle hooks but no main-agent memory tools or commission hook", () => {
  vi.stubEnv("AGENT_ROLE", "cos");
  const hooks: string[] = [],
    tools: unknown[] = [];
  extension({
    on: (name: string) => hooks.push(name),
    registerTool: (tool: unknown) => tools.push(tool),
  } as unknown as ExtensionAPI);
  expect(hooks).toContain("before_agent_start");
  expect(hooks).not.toContain("tool_call");
  expect(tools).toEqual([]);
});
