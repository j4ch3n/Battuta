import { afterEach, describe, expect, it } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  rmSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseConfig,
  prepareWorkspace,
  scopedPath,
} from "../.pi/extensions/bounded-subagents/policy.ts";
import { childEnvironment } from "../.pi/extensions/bounded-subagents/runtime.ts";

const dirs: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "bounded-policy-"));
  dirs.push(root);
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src/a.ts"), "original");
  return root;
}
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));
const config = (root: string) => ({
  root,
  inputs: ["src/a.ts"],
  writable: ["src/a.ts", "src/new.ts"],
  model: "test-model",
  baseUrl: "https://api.openai.com/v1",
  apiKeyEnv: "OPENAI_API_KEY",
});

describe("operator grants", () => {
  it("constructs a credential-minimized environment without parent inheritance", () => {
    const env = childEnvironment("/private/child", "/private/child/agent", "dedicated-key");
    expect(Object.keys(env).sort()).toEqual([
      "BATTUTA_CHILD_API_KEY",
      "HOME",
      "PATH",
      "PI_CODING_AGENT_DIR",
      "TMPDIR",
    ]);
    expect(env.BATTUTA_CHILD_API_KEY).toBe("dedicated-key");
    expect(env.HOME).toBe("/private/child");
    expect(env.PI_CODING_AGENT_DIR).toBe("/private/child/agent");
  });
  it.each([0, -1, 5, 1.5, "2"])("rejects concurrency %s", (concurrency) => {
    expect(() => parseConfig({ ...config(fixture()), concurrency })).toThrow();
  });
  it.each(["../outside", "/etc/passwd", ".env", "src/.secret", "auth.json", "src/../a.ts"])(
    "rejects private or ambiguous path %s",
    (path) => {
      expect(() => parseConfig({ ...config(fixture()), inputs: [path] })).toThrow();
    },
  );
  it("copies only granted files and leaves source untouched", () => {
    const root = fixture();
    writeFileSync(join(root, ".env"), "secret");
    const grant = parseConfig(config(root));
    const workspace = prepareWorkspace(grant, "worker");
    dirs.push(workspace);
    writeFileSync(scopedPath(join(workspace, "work"), "src/a.ts", grant.writable), "changed");
    expect(readFileSync(join(root, "src/a.ts"), "utf8")).toBe("original");
    expect(existsSync(join(workspace, "work/.env"))).toBe(false);
    expect(() => scopedPath(workspace, "../.env", grant.writable)).toThrow();
    expect(() => scopedPath(workspace, "other.ts", grant.writable)).toThrow();
    expect(() => scopedPath(workspace, ".env", grant.inputs)).toThrow();
  });
  it("rejects a symlink input and a symlink write ancestor", () => {
    const root = fixture();
    symlinkSync(join(root, "src/a.ts"), join(root, "alias.ts"));
    expect(() =>
      prepareWorkspace(parseConfig({ ...config(root), inputs: ["alias.ts"] }), "scout"),
    ).toThrow(/symlink/i);
    const other = fixture();
    symlinkSync(other, join(root, "linked"));
    expect(() => scopedPath(root, "linked/new.ts", ["linked/new.ts"])).toThrow(/symlink/i);
  });
  it.each([
    { timeoutMs: 600001 },
    { maxSpawns: 33 },
    { apiKeyEnv: "LINEAR_API_TOKEN" },
    { baseUrl: "https://user:secret@example.com" },
  ])("rejects invalid grant %j", (extra) => {
    expect(() => parseConfig({ ...config(fixture()), ...extra })).toThrow();
  });
  it("rejects dangling symlinks before a worker can create their target", () => {
    const root = fixture();
    symlinkSync(join(root, "missing.ts"), join(root, "dangling.ts"));
    expect(() => scopedPath(root, "dangling.ts", ["dangling.ts"])).toThrow(/symlink/i);
  });
});
