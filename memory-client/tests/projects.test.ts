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
import { loadProjectCatalog } from "../projects.ts";

test.each([
  [[], []],
  [
    ["项目", "My Project", "Atlas", "Atlas", "global"],
    ["Atlas", "My Project", "项目"],
  ],
])("loads the catalog without global or duplicates", async (names, expected) => {
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

test.each(["not json", "{}", '{"projects":[42]}'])(
  "rejects a malformed catalog: %s",
  async (output) => {
    execFile.mockImplementation((_cmd, _args, _options, done) => done(null, output));
    await expect(loadProjectCatalog(new AbortController().signal)).rejects.toThrow();
  },
);

test("reports an unavailable CLI", async () => {
  execFile.mockImplementation((_cmd, _args, _options, done) => done(new Error("ENOENT")));
  await expect(loadProjectCatalog(new AbortController().signal)).rejects.toThrow(
    "Project catalog unavailable",
  );
});
