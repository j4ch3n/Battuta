import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { test, vi } from "vitest";
import lockfile from "proper-lockfile";
import { fixture, input } from "./fixtures.ts";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    rename: vi.fn(actual.rename),
    open: vi.fn(actual.open),
    rm: vi.fn(actual.rm),
  };
});

test("finalization index failure removes decision and restores checklist/review bytes and modes", async () => {
  const f = await fixture();
  const original = vi.mocked(fs.rename).getMockImplementation()!;
  try {
    await f.pm.initSpec(input);
    const checklist = await f.tl.writeChecklist(input);
    const review = await f.tl.writeReview({
      ...input,
      spec_version: "v1",
      checklist_sha256: checklist.sha256,
    });
    const index = join(f.projects, "atlas/specs/index.json");
    let fail = true;
    vi.mocked(fs.rename).mockImplementation(async (from, to) => {
      if (to === index && fail) {
        fail = false;
        throw new Error("commit failed");
      }
      return original(from, to);
    });
    await assert.rejects(
      f.pm.finalizeSpec({
        project: "atlas",
        name: input.name,
        decision: "go",
        rationale: "Selected scope",
      }),
      /commit failed/,
    );
    const description = await f.pm.describeSpec("atlas", input.name);
    assert.equal(description.spec.decision, null);
    assert.equal(description.has_decision, false);
    for (const path of [checklist.path, review.path]) {
      assert.equal(await fs.readFile(path, "utf8"), input.content);
      assert.equal((await fs.stat(path)).mode & 0o777, 0o600);
    }
  } finally {
    vi.mocked(fs.rename).mockImplementation(original);
    await f.cleanup();
  }
});

test("committed finalization survives journal-cleanup failure and recovery", async () => {
  const f = await fixture();
  const original = vi.mocked(fs.rm).getMockImplementation()!;
  try {
    await f.pm.initSpec(input);
    let fail = true;
    vi.mocked(fs.rm).mockImplementation(async (path, options) => {
      if (String(path).endsWith(".project-spec-transaction.json") && fail) {
        fail = false;
        throw new Error("cleanup failed");
      }
      return original(path, options);
    });
    await assert.rejects(
      f.pm.finalizeSpec({
        project: "atlas",
        name: input.name,
        decision: "no-go",
        rationale: "Out of scope",
      }),
      /cleanup failed/,
    );
    const description = await f.pm.describeSpec("atlas", input.name);
    assert.equal(description.spec.decision?.outcome, "no-go");
    assert.equal(description.has_decision, true);
    assert.equal((await f.pm.describeSpec("atlas", input.name)).spec.decision?.outcome, "no-go");
    await assert.rejects(f.pm.updateSpec(input), /finalized/);
  } finally {
    vi.mocked(fs.rm).mockImplementation(original);
    await f.cleanup();
  }
});

test("failed index directory sync retains recovery journal until commit is durable", async () => {
  const f = await fixture();
  const originalOpen = vi.mocked(fs.open).getMockImplementation()!;
  const originalRename = vi.mocked(fs.rename).getMockImplementation()!;
  try {
    await f.pm.initSpec(input);
    const specs = join(f.projects, "atlas/specs");
    let committed = false;
    let failures = 2;
    vi.mocked(fs.rename).mockImplementation(async (from, to) => {
      await originalRename(from, to);
      if (to === join(specs, "index.json")) committed = true;
    });
    vi.mocked(fs.open).mockImplementation(async (...args) => {
      const handle = await originalOpen(...args);
      const sync = handle.sync.bind(handle);
      handle.sync = async () => {
        if (String(args[0]) === specs && committed && failures > 0) {
          failures--;
          throw new Error("directory sync failed");
        }
        await sync();
      };
      return handle;
    });
    await assert.rejects(
      f.pm.finalizeSpec({
        project: "atlas",
        name: input.name,
        decision: "go",
        rationale: "Proceed",
      }),
      /recovery is pending/,
    );
    assert.ok((await fs.stat(join(specs, ".project-spec-transaction.json"))).isFile());
    failures = 0;
    assert.equal((await f.pm.describeSpec("atlas", input.name)).spec.decision?.outcome, "go");
  } finally {
    vi.mocked(fs.open).mockImplementation(originalOpen);
    vi.mocked(fs.rename).mockImplementation(originalRename);
    await f.cleanup();
  }
});

test("describe_spec holds the shared lock across metadata and file reads", async () => {
  const f = await fixture();
  const original = vi.mocked(fs.open).getMockImplementation()!;
  let release!: () => void;
  let observed!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const reached = new Promise<void>((resolve) => {
    observed = resolve;
  });
  let reading: ReturnType<typeof f.pm.describeSpec> | undefined;
  try {
    await f.pm.initSpec(input);
    await f.tl.writeChecklist(input);
    let once = true;
    vi.mocked(fs.open).mockImplementation(async (...args) => {
      const handle = await original(...args);
      if (once && String(args[0]).endsWith("/index.json") && args[1] === "r") {
        once = false;
        const read = handle.readFile.bind(handle);
        vi.spyOn(handle, "readFile").mockImplementation(async () => {
          const bytes = await read();
          observed();
          await barrier;
          return bytes;
        });
      }
      return handle;
    });
    reading = f.pm.describeSpec("atlas", input.name);
    await reached;
    assert.equal(
      await lockfile.check(join(f.projects, "atlas/specs")),
      true,
      "Description must retain the lock while constructing its snapshot",
    );
    const writing = f.tl.writeChecklist({ ...input, content: "Changed checklist" });
    release();
    const description = await reading;
    await writing;
    assert.equal(description.spec.checklist!.sha256, description.fingerprints.checklist);
  } finally {
    release();
    await reading?.catch(() => undefined);
    vi.mocked(fs.open).mockImplementation(original);
    await f.cleanup();
  }
});

test("journal, artifact and index renames have directory-sync ordering", async () => {
  const f = await fixture();
  const originalOpen = vi.mocked(fs.open).getMockImplementation()!;
  const originalRename = vi.mocked(fs.rename).getMockImplementation()!;
  const events: string[] = [];
  try {
    vi.mocked(fs.rename).mockImplementation(async (from, to) => {
      await originalRename(from, to);
      events.push(`rename:${String(to)}`);
    });
    vi.mocked(fs.open).mockImplementation(async (...args) => {
      const handle = await originalOpen(...args);
      const sync = handle.sync.bind(handle);
      handle.sync = async () => {
        await sync();
        events.push(`sync:${String(args[0])}`);
      };
      return handle;
    });
    await f.pm.initSpec(input);
    const specs = join(f.projects, "atlas/specs");
    const journal = events.indexOf(`rename:${join(specs, ".project-spec-transaction.json")}`);
    const artifact = events.indexOf(`rename:${join(specs, "api-design/spec-v1.md")}`);
    const index = events.indexOf(`rename:${join(specs, "index.json")}`);
    assert.ok(
      events.slice(journal + 1, artifact).includes(`sync:${specs}`),
      "Journal publication must be durable before artifact replacement",
    );
    assert.ok(
      events.slice(artifact + 1, index).includes(`sync:${join(specs, "api-design")}`),
      "Artifact publication must be durable before metadata commit",
    );
    assert.ok(
      events.slice(index + 1).includes(`sync:${specs}`),
      "Index commit must be durable before recovery journal removal",
    );
  } finally {
    vi.mocked(fs.open).mockImplementation(originalOpen);
    vi.mocked(fs.rename).mockImplementation(originalRename);
    await f.cleanup();
  }
});

test("index-commit failure restores old review and metadata with no journal or temporary leaks", async () => {
  const f = await fixture();
  try {
    await f.pm.initSpec(input);
    const checklist = await f.tl.writeChecklist(input);
    const review = await f.tl.writeReview({
      ...input,
      spec_version: "v1",
      checklist_sha256: checklist.sha256,
    });
    const index = join(f.projects, "atlas/specs/index.json");
    const before = await fs.readFile(index);
    const original = vi.mocked(fs.rename).getMockImplementation()!;
    let fail = true;
    vi.mocked(fs.rename).mockImplementation(async (from, to) => {
      if (to === index && fail) {
        fail = false;
        throw new Error("disk full");
      }
      return original(from, to);
    });
    await assert.rejects(
      f.tl.writeReview({
        ...input,
        content: "Replacement",
        spec_version: "v1",
        checklist_sha256: checklist.sha256,
      }),
      /disk full/,
    );
    assert.deepEqual(await fs.readFile(index), before);
    assert.equal(await fs.readFile(review.path, "utf8"), input.content);
    assert.deepEqual((await fs.readdir(join(f.projects, "atlas/specs"))).sort(), [
      "api-design",
      "index.json",
    ]);
    assert.deepEqual((await fs.readdir(join(f.projects, "atlas/specs/api-design"))).sort(), [
      "checklist.md",
      "review.md",
      "spec-v1.md",
    ]);
    vi.mocked(fs.rename).mockImplementation(original);
  } finally {
    vi.mocked(fs.rename).mockRestore();
    await f.cleanup();
  }
});

test("failure during initial file write removes its temporary file", async () => {
  const f = await fixture();
  const original = vi.mocked(fs.open).getMockImplementation()!;
  try {
    let fail = true;
    vi.mocked(fs.open).mockImplementation(async (...args) => {
      const handle = await original(...args);
      if (fail && String(args[0]).includes(".project-spec-")) {
        fail = false;
        handle.writeFile = () => Promise.reject(new Error("write failed"));
      }
      return handle;
    });
    await assert.rejects(f.pm.initSpec(input), /write failed/);
    const files = await fs.readdir(join(f.projects, "atlas/specs"));
    assert.ok(!files.some((file) => file.endsWith(".tmp")), `Leaked files: ${files.join(", ")}`);
    assert.equal((await f.pm.inspectSpecs("atlas")).specs.length, 0);
  } finally {
    vi.mocked(fs.open).mockImplementation(original);
    await f.cleanup();
  }
});

test("restart recovers an uncommitted document replacement from a durable journal", async () => {
  const f = await fixture();
  try {
    await f.pm.initSpec(input);
    const saved = await f.tl.writeChecklist(input);
    const specs = join(f.projects, "atlas/specs");
    const index = await fs.readFile(join(specs, "index.json"));
    await fs.writeFile(
      join(specs, ".project-spec-transaction.json"),
      JSON.stringify({
        previous_index: { bytes: index.toString("base64"), mode: 0o600 },
        next_index: '{"schema_version":1,"specs":[]}',
        files: [
          {
            path: "api-design/checklist.md",
            previous: { bytes: Buffer.from(input.content).toString("base64"), mode: 0o600 },
          },
        ],
      }),
    );
    await fs.writeFile(saved.path, "Interrupted replacement");
    assert.equal((await f.pm.inspectSpecs("atlas")).specs.length, 1);
    assert.equal(await fs.readFile(saved.path, "utf8"), input.content);
    await assert.rejects(fs.stat(join(specs, ".project-spec-transaction.json")), /ENOENT/);
  } finally {
    await f.cleanup();
  }
});
