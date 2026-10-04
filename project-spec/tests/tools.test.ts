import assert from "node:assert/strict";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { test } from "vitest";
import register from "../index.ts";
import { fixture, input } from "./fixtures.ts";

export function fakePi() {
  const tools = new Map<string, Parameters<ExtensionAPI["registerTool"]>[0]>();
  const hooks = new Map<string, unknown>();
  const pi = {
    registerTool: (tool: Parameters<ExtensionAPI["registerTool"]>[0]) => tools.set(tool.name, tool),
    on: (name: string, hook: unknown) => hooks.set(name, hook),
  } as unknown as ExtensionAPI;
  return { pi, tools, hooks };
}

test("each runtime exposes shared reads and only its own authoring tools", async () => {
  const f = await fixture();
  try {
    for (const role of ["pm", "tl"] as const) {
      const fake = fakePi();
      register(fake.pi, { role, projectsRoot: f.projects });
      const common = ["inspect_specs", "describe_spec"];
      const own =
        role === "pm"
          ? ["init_spec", "update_spec", "finalize_spec"]
          : ["write_spec_checklist", "write_spec_review"];
      assert.deepEqual([...fake.tools.keys()].sort(), [...common, ...own].sort());
      assert.ok(fake.hooks.has("tool_call"));
    }
  } finally {
    await f.cleanup();
  }
});

test("all registered tool groups exercise the actual shared store", async () => {
  const f = await fixture();
  try {
    const pm = fakePi();
    const tl = fakePi();
    register(pm.pi, { role: "pm", projectsRoot: f.projects });
    register(tl.pi, { role: "tl", projectsRoot: f.projects });
    const call = async (tools: typeof pm.tools, name: string, args: unknown) => {
      const tool = tools.get(name)!;
      return tool.execute(
        "call",
        args,
        undefined,
        undefined,
        {} as Parameters<typeof tool.execute>[4],
      );
    };
    const inventory = await call(tl.tools, "inspect_specs", { project: "atlas" });
    assert.deepEqual(inventory.details, { schema_version: 1, specs: [] });
    await call(pm.tools, "init_spec", input);
    await call(pm.tools, "update_spec", { ...input, content: "# New spec" });
    await call(tl.tools, "write_spec_checklist", input);
    const description = await f.tl.describeSpec("atlas", input.name, true);
    assert.equal(description.contents?.spec, "# New spec");
    await call(tl.tools, "write_spec_review", {
      ...input,
      spec_version: "v2",
      checklist_sha256: description.fingerprints.checklist,
    });
    await call(pm.tools, "describe_spec", {
      project: "atlas",
      name: input.name,
      include_content: true,
    });
    await call(pm.tools, "finalize_spec", {
      project: "atlas",
      name: input.name,
      decision: "go",
      rationale: "Proceed within selected scope.",
    });
    await assert.rejects(call(tl.tools, "write_spec_checklist", input), /finalized/);
  } finally {
    await f.cleanup();
  }
});

test("tool handlers save full text and return errors rather than a false success", async () => {
  const f = await fixture();
  try {
    const fake = fakePi();
    register(fake.pi, { role: "pm", projectsRoot: f.projects });
    const tool = fake.tools.get("init_spec")!;
    const context = {} as Parameters<typeof tool.execute>[4];
    const result = await tool.execute("call-1", input, undefined, undefined, context);
    assert.match(JSON.stringify(result), /spec-v1\.md/);
    await assert.rejects(
      tool.execute("call-2", input, undefined, undefined, context),
      /update_spec/,
    );
    await assert.rejects(
      tool.execute("call-3", { ...input, content: 123 }, undefined, undefined, context),
      /argument/,
    );
  } finally {
    await f.cleanup();
  }
});
