import { expect, test, vi } from "vitest";
const execFile = vi.hoisted(() =>
  vi.fn<
    (
      command: string,
      args: string[],
      options: unknown,
      done: (error: Error | null, output?: string) => void,
    ) => void
  >(),
);
vi.mock("node:child_process", () => ({ execFile }));
import { loadProjectCatalog, validateMemoryProjects } from "../projects.ts";

test.each([
  [[], ["global"]],
  [
    ["项目", "My Project", "Atlas"],
    ["Atlas", "My Project", "global", "项目"],
  ],
])("loads the complete catalog with original spelling", async (names, expected) => {
  execFile.mockImplementation((_cmd, _args, _options, done) =>
    done(null, JSON.stringify({ projects: names })),
  );
  const signal = new AbortController().signal;
  expect(await loadProjectCatalog(signal)).toEqual(expected);
  expect(execFile).toHaveBeenLastCalledWith(
    "battuta-project",
    ["list", "--json"],
    expect.objectContaining({ signal, maxBuffer: 1048576 }),
    expect.any(Function),
  );
});

test.each([
  "not json",
  "{}",
  '{"projects":[42]}',
  '{"projects":["global"]}',
  '{"projects":["GLOBAL"]}',
  '{"projects":["Atlas","Atlas"]}',
])("rejects unusable discovery instead of authorizing global extraction: %s", async (stdout) => {
  execFile.mockImplementation((_cmd, _args, _options, done) => done(null, stdout));
  await expect(loadProjectCatalog(new AbortController().signal)).rejects.toThrow();
});
test.each(["command failed", "stdout maxBuffer exceeded", "aborted"])(
  "propagates subprocess failure: %s",
  async (message) => {
    execFile.mockImplementation((_cmd, _args, _options, done) => done(new Error(message)));
    await expect(loadProjectCatalog(new AbortController().signal)).rejects.toThrow(
      "Project catalog unavailable",
    );
  },
);
test("validates only catalog membership, not slug syntax", () => {
  const catalog = ["Atlas", "my project", "项目", "x".repeat(100), "global"];
  expect(validateMemoryProjects(["my project", "Atlas", "Atlas"], catalog)).toEqual([
    "Atlas",
    "my project",
  ]);
  expect(validateMemoryProjects(["项目", "x".repeat(100)], catalog)).toHaveLength(2);
  for (const projects of [["atlas"], ["unknown"], [], ["global", "Atlas"], [42]])
    expect(() => validateMemoryProjects(projects, catalog)).toThrow();
});
