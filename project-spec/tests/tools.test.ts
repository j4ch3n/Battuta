import assert from "node:assert/strict";
import { test } from "vitest";
import register from "../index.ts";
import { fixture, input, fakePi } from "./fixtures.ts";

test("each runtime exposes shared reads and only its own authoring tools", async () => {
  const f = await fixture();
  try {
    for (const role of ["cos", "manager"] as const) {
      const fake = fakePi();
      register(fake.pi, { role });
      const common = ["inspect_specs", "describe_spec", "read_constitution"];
      const own =
        role === "cos"
          ? [
              "init_spec",
              "update_spec",
              "finalize_spec",
              "init_constitution",
              "update_constitution",
            ]
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
    const cos = fakePi();
    const manager = fakePi();
    register(cos.pi, { role: "cos" });
    register(manager.pi, { role: "manager" });
    const call = async (tools: typeof cos.tools, name: string, args: unknown) => {
      const tool = tools.get(name)!;
      return tool.execute(
        "call",
        args,
        undefined,
        undefined,
        {} as Parameters<typeof tool.execute>[4],
      );
    };
    const inventory = await call(manager.tools, "inspect_specs", { project: "atlas" });
    assert.deepEqual(inventory.details, { schema_version: 1, specs: [] });
    await call(cos.tools, "init_spec", input);
    await call(cos.tools, "update_spec", { ...input, content: "# New spec" });
    await call(manager.tools, "write_spec_checklist", input);
    const description = await f.manager.describeSpec("atlas", input.name, true);
    assert.equal(description.contents?.spec, "# New spec");
    await call(manager.tools, "write_spec_review", {
      ...input,
      spec_version: "v2",
      checklist_sha256: description.fingerprints.checklist,
    });
    await call(cos.tools, "describe_spec", {
      project: "atlas",
      name: input.name,
      include_content: true,
    });
    await call(cos.tools, "finalize_spec", {
      project: "atlas",
      name: input.name,
      decision: "go",
      rationale: "Proceed within selected scope.",
    });
    await assert.rejects(call(manager.tools, "write_spec_checklist", input), /finalized/);
  } finally {
    await f.cleanup();
  }
});

test("tool handlers save full text and return errors rather than a false success", async () => {
  const f = await fixture();
  try {
    const fake = fakePi();
    register(fake.pi, { role: "cos" });
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
