import { expect, test } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import extension from "../index.ts";

test("extension does not register legacy profile or memory tools", () => {
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
