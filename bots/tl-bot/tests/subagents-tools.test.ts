import { afterEach, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type {
  ExtensionAPI,
  ToolDefinition,
  ExtensionToolContext,
} from "@earendil-works/pi-coding-agent";
import { registerScopedTools } from "../.pi/extensions/bounded-subagents/child-tools.ts";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
function tools(profile: "scout" | "reviewer" | "worker") {
  const root = mkdtempSync(join(tmpdir(), "bounded-tools-"));
  roots.push(root);
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src/input"), "evidence");
  const registered = new Map<string, ToolDefinition>();
  const handlers = new Map<string, (event: { toolName: string }) => unknown>();
  const api = {
    registerTool(tool: ToolDefinition) {
      registered.set(tool.name, tool);
    },
    on(event: string, handler: (event: { toolName: string }) => unknown) {
      handlers.set(event, handler);
    },
  } as unknown as ExtensionAPI;
  registerScopedTools(api, root, { profile, inputs: ["src/input"], writable: ["src/output"] });
  const execute = (name: string, args: Record<string, unknown>) =>
    registered.get(name)!.execute("test", args, undefined, undefined, {} as ExtensionToolContext);
  return { registered, execute, root, handlers };
}
it.each(["scout", "reviewer"] as const)(
  "%s has no mutating or unrestricted tools",
  async (profile) => {
    const { registered, execute } = tools(profile);
    expect([...registered.keys()].sort()).toEqual(["bounded_files", "bounded_read"]);
    expect(JSON.stringify(await execute("bounded_read", { path: "src/input" }))).toContain(
      "evidence",
    );
    expect(() => execute("bounded_read", { path: "../auth.json" })).toThrow();
    expect(() => execute("bounded_read", { path: "src/output" })).toThrow();
  },
);
it("worker rejects unauthorized writes and oversized content", async () => {
  const { execute, root } = tools("worker");
  expect(() => execute("bounded_write", { path: "src/input", content: "bad" })).toThrow();
  expect(() =>
    execute("bounded_write", { path: "src/output", content: "x".repeat(262145) }),
  ).toThrow(/size/);
  await execute("bounded_write", { path: "src/output", content: "patch" });
  expect(readFileSync(join(root, "src/output"), "utf8")).toBe("patch");
  expect(JSON.stringify(await execute("bounded_files", {}))).toContain("src/output");
});
it.each(["bash", "bounded_write", "contact_supervisor", "mcp__linear__create_issue"])(
  "read-only execution gate blocks %s even if registered elsewhere",
  (toolName) => {
    const { handlers } = tools("scout");
    expect(handlers.get("tool_call")!({ toolName })).toMatchObject({ block: true });
    expect(handlers.get("tool_call")!({ toolName: "bounded_read" })).toBeUndefined();
  },
);
