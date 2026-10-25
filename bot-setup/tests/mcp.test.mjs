import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { configureMcp, validateMemoryUrl } from "../mcp.mjs";

async function workspace(t) {
  const root = await mkdtemp(join(tmpdir(), "battuta-mcp-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const pi = join(root, ".pi");
  await mkdir(pi);
  return { root, pi };
}

for (const role of ["pm", "tl"]) {
  test(`${role}: preserves custom servers, settings, and private auth on repeat setup`, async (t) => {
    const { root, pi } = await workspace(t);
    const auth = '{"sentinel":"private-oauth-token"}\n';
    await writeFile(join(pi, "mcp-auth.json"), auth, { mode: 0o600 });
    await writeFile(
      join(pi, "mcp.json"),
      JSON.stringify({
        custom: true,
        mcpServers: { other: { command: "custom-server" } },
      }),
    );
    await writeFile(
      join(pi, "settings.json"),
      JSON.stringify({
        theme: "dark",
        packages: [
          "npm:pi-mcp-adapter@2.37.0",
          { source: "npm:pi-mcp-adapter", extensions: ["index.ts"] },
          "npm:pi-mcp-adapter-extra@1.0.0",
        ],
      }),
    );
    for (let i = 0; i < 2; i++) {
      await configureMcp(root, { role, memoryUrl: "http://localhost:8989/mcp" });
      const text = await readFile(join(pi, "mcp.json"), "utf8");
      const config = JSON.parse(text);
      assert.equal(config.custom, true);
      assert.deepEqual(config.mcpServers.other, { command: "custom-server" });
      assert.equal("luma" in config.mcpServers, role === "pm");
      assert.deepEqual(JSON.parse(await readFile(join(pi, "settings.json"), "utf8")), {
        theme: "dark",
        packages: ["npm:pi-mcp-adapter-extra@1.0.0"],
      });
      assert.equal(await readFile(join(pi, "mcp-auth.json"), "utf8"), auth);
      assert.equal((await stat(join(pi, "mcp-auth.json"))).mode & 0o777, 0o600);
      assert.equal((await stat(join(pi, "mcp.json"))).mode & 0o777, 0o600);
      assert.equal((await stat(join(pi, "settings.json"))).mode & 0o777, 0o600);
      assert.ok(!text.includes("private-oauth-token"));
    }
  });
}

test("loopback validation rejects unsafe endpoints without writing config", async (t) => {
  const { root, pi } = await workspace(t);
  const original = '{"mcpServers":{"other":{"command":"custom"}}}';
  await writeFile(join(pi, "mcp.json"), original);
  for (const memoryUrl of [
    "https://localhost/mcp",
    "http://example.com/mcp",
    "http://user:private-password@localhost/mcp",
    "invalid",
    "",
  ]) {
    await assert.rejects(configureMcp(root, { role: "pm", memoryUrl }), (error) => {
      assert.match(error.message, /loopback HTTP/);
      assert.ok(!error.message.includes("private-password"));
      return true;
    });
    assert.equal(await readFile(join(pi, "mcp.json"), "utf8"), original);
  }
  assert.doesNotThrow(() => validateMemoryUrl());
  for (const url of [
    "http://127.0.0.1:8901/mcp",
    "http://localhost:8901/mcp",
    "http://[::1]:8901/mcp",
  ]) {
    assert.doesNotThrow(() => validateMemoryUrl(url));
  }
});

test("invalid role is rejected before writing any state", async (t) => {
  const { root, pi } = await workspace(t);
  await assert.rejects(configureMcp(root, { role: "unknown" }), /role/);
  await assert.rejects(readFile(join(pi, "mcp.json")), { code: "ENOENT" });
});

for (const [filename, content] of [
  ["mcp.json", "null"],
  ["mcp.json", "[]"],
  ["mcp.json", '{"mcpServers":null}'],
  ["mcp.json", '{"mcpServers":[]}'],
  ["mcp.json", '{"secret":"private-token",broken}'],
  ["settings.json", "null"],
  ["settings.json", '{"packages":{}}'],
  ["settings.json", '{"packages":null}'],
]) {
  test(`invalid ${filename} (${content}) leaves both configuration files unchanged`, async (t) => {
    const { root, pi } = await workspace(t);
    const before = { "mcp.json": "{}", "settings.json": "{}", [filename]: content };
    for (const [file, data] of Object.entries(before)) await writeFile(join(pi, file), data);
    await assert.rejects(configureMcp(root, { role: "pm" }), (error) => {
      assert.ok(!error.message.includes("private-token"));
      return true;
    });
    for (const [file, data] of Object.entries(before))
      assert.equal(await readFile(join(pi, file), "utf8"), data);
  });
}
