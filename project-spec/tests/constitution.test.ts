import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionContext, ToolCallEvent } from "@earendil-works/pi-coding-agent";
import { test } from "vitest";
import register from "../index.ts";
import { fixture, fakePi } from "./fixtures.ts";

const input = {
  project: "atlas",
  summary: "Adopt principles",
  content: "# Constitution\r\n\r\n## Governance\r\nReview amendments.\r\n",
};

test("constitution reads identify exact persisted bytes and updates preserve prior versions", async () => {
  const f = await fixture();
  try {
    const first = await f.pm.initConstitution(input);
    assert.equal(first.name, "Constitution");
    assert.equal(first.version, "v1");
    assert.equal(first.path, join(f.projects, "atlas/specs/constitution/spec-v1.md"));
    assert.equal(first.sha256, createHash("sha256").update(input.content).digest("hex"));
    assert.equal(await readFile(first.path, "utf8"), input.content);
    assert.equal((await stat(first.path)).mode & 0o222, 0);
    assert.deepEqual(await f.tl.readConstitution("atlas"), {
      name: "Constitution",
      path: first.path,
      version: "v1",
      summary: input.summary,
      content: input.content,
      sha256: first.sha256,
      decision: null,
    });
    const next = await f.pm.updateConstitution({
      ...input,
      summary: "Amend principles",
      content: "# Revised Constitution\n",
    });
    assert.equal(next.version, "v2");
    assert.equal(await readFile(first.path, "utf8"), input.content);
    assert.equal((await f.pm.readConstitution("atlas")).content, "# Revised Constitution\n");
    assert.equal((await f.pm.readConstitution("atlas")).sha256, next.sha256);
    assert.equal((await f.pm.describeSpec("atlas", "Constitution")).latest_version, "v2");
  } finally {
    await f.cleanup();
  }
});

test.each(["go", "no-go"] as const)(
  "constitution finalized as %s rejects writes and remains readable",
  async (decision) => {
    const f = await fixture();
    try {
      await f.pm.initConstitution(input);
      await f.pm.finalizeSpec({
        project: "atlas",
        name: "Constitution",
        decision,
        rationale: "Resolved governance",
      });
      const before = await f.pm.readConstitution("atlas");
      const index = await readFile(join(f.projects, "atlas/specs/index.json"));
      await assert.rejects(
        f.pm.updateConstitution({ ...input, content: "Changed" }),
        /finalized.*v1/,
      );
      assert.deepEqual(await f.tl.readConstitution("atlas"), before);
      assert.equal(before.decision?.outcome, decision);
      assert.deepEqual(await readFile(join(f.projects, "atlas/specs/index.json")), index);
      await assert.rejects(stat(join(f.projects, "atlas/specs/constitution/spec-v2.md")), /ENOENT/);
    } finally {
      await f.cleanup();
    }
  },
);

test("missing constitutions do not create storage; duplicate creation and missing version files fail", async () => {
  const f = await fixture();
  try {
    await assert.rejects(f.pm.readConstitution("atlas"), /not found/);
    await assert.rejects(f.pm.updateConstitution(input), /not found/);
    await assert.rejects(stat(join(f.projects, "atlas/specs/index.json")), /ENOENT/);
    const saved = await f.pm.initConstitution(input);
    await assert.rejects(f.pm.initConstitution(input), /already exists.*update_constitution/);
    await rm(saved.path);
    await assert.rejects(f.pm.readConstitution("atlas"), /missing/);
    await assert.rejects(f.pm.updateConstitution(input), /missing/);
  } finally {
    await f.cleanup();
  }
});

test("TL cannot write constitutions through the store", async () => {
  const f = await fixture();
  try {
    await assert.rejects(f.tl.initConstitution(input), /PM/);
    await f.pm.initConstitution(input);
    await assert.rejects(f.tl.updateConstitution(input), /PM/);
    assert.equal((await f.pm.readConstitution("atlas")).version, "v1");
  } finally {
    await f.cleanup();
  }
});

test("dedicated tool handlers persist full documents and enforce their schemas", async () => {
  const f = await fixture();
  try {
    const fake = fakePi();
    register(fake.pi, { role: "pm", projectsRoot: f.projects });
    const call = (name: string, args: unknown) => {
      const tool = fake.tools.get(name)!;
      return tool.execute(
        "test",
        args,
        undefined,
        undefined,
        {} as Parameters<typeof tool.execute>[4],
      );
    };
    const first = await call("init_constitution", input);
    assert.match(JSON.stringify(first.details), /spec-v1\.md/);
    const read = await call("read_constitution", { project: "atlas" });
    assert.equal((read.details as { content: string }).content, input.content);
    await call("update_constitution", { ...input, content: "# Revised" });
    assert.equal((await f.tl.readConstitution("atlas")).content, "# Revised");
    for (const args of [
      { ...input, content: " " },
      { ...input, summary: "" },
      { ...input, name: "Other" },
      { ...input, content: 123 },
    ]) {
      await assert.rejects(call("update_constitution", args), /argument/);
    }
    await assert.rejects(
      call("read_constitution", { project: "atlas", name: "Other" }),
      /argument/,
    );
    const guard = fake.hooks.get("tool_call") as (
      event: ToolCallEvent,
      context: ExtensionContext,
    ) => Promise<{ block: boolean } | undefined>;
    const saved = await f.pm.readConstitution("atlas");
    for (const toolName of ["write", "edit"]) {
      const event = {
        type: "tool_call" as const,
        toolCallId: "test",
        toolName,
        input: { path: saved.path },
      };
      assert.equal((await guard(event, { cwd: f.root } as ExtensionContext))?.block, true);
      assert.equal(
        await guard({ ...event, input: { path: join(f.root, "notes.md") } }, {
          cwd: f.root,
        } as ExtensionContext),
        undefined,
      );
    }
  } finally {
    await f.cleanup();
  }
});
