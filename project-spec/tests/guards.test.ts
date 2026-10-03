import assert from "node:assert/strict";
import { symlink } from "node:fs/promises";
import { join } from "node:path";
import { relative } from "node:path";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import { registerGuards } from "../guards.ts";
import type {
  ExtensionAPI,
  ToolCallEvent,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { test } from "vitest";
import { managedPath } from "../guards.ts";
import { fixture, input } from "./fixtures.ts";

test("managed write/edit targets are protected including relative paths and symlink aliases", async () => {
  const f = await fixture();
  try {
    const file = await f.pm.initSpec(input);
    const alias = join(f.root, "alias");
    await symlink(join(f.projects, "atlas/specs"), alias, "dir");
    assert.equal(await managedPath(file.path, f.root, f.projects), true);
    assert.equal(await managedPath("projects/atlas/specs/index.json", f.root, f.projects), true);
    assert.equal(await managedPath(join(alias, "api-design/spec-v1.md"), f.root, f.projects), true);
    assert.equal(await managedPath("projects/atlas/code/src/index.ts", f.root, f.projects), false);
    assert.equal(await managedPath("projects/atlas/specs-extra/a.md", f.root, f.projects), false);
  } finally {
    await f.cleanup();
  }
});

test("registered guard blocks Pi-normalized tilde, at-prefix, file URL and Unicode-space aliases", async () => {
  const f = await fixture();
  try {
    const saved = await f.pm.initSpec(input);
    const alias = join(f.root, "alias space");
    await symlink(join(f.projects, "atlas/specs"), alias, "dir");
    let handler:
      | ((
          event: ToolCallEvent,
          ctx: ExtensionContext,
        ) => Promise<{ block: boolean; reason: string } | undefined>)
      | undefined;
    const pi = {
      on: (_name: string, callback: typeof handler) => {
        handler = callback;
      },
    } as unknown as ExtensionAPI;
    registerGuards(pi, f.projects);
    for (const path of [
      `~/${relative(homedir(), saved.path)}`,
      `@${saved.path}`,
      `@~/${relative(homedir(), saved.path)}`,
      pathToFileURL(saved.path).href,
      join(alias, "index.json").replace("alias space", "alias\u00a0space"),
    ]) {
      for (const toolName of ["write", "edit"]) {
        const result = await handler!(
          { type: "tool_call", toolCallId: "test", toolName, input: { path } },
          { cwd: f.root } as ExtensionContext,
        );
        assert.equal(result?.block, true, `Guard bypass: ${path}`);
      }
    }
    assert.equal(
      await handler!(
        {
          type: "tool_call",
          toolCallId: "test",
          toolName: "read",
          input: { path: saved.path },
        },
        { cwd: f.root } as ExtensionContext,
      ),
      undefined,
    );
  } finally {
    await f.cleanup();
  }
});
