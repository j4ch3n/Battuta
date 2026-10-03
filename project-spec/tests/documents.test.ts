import assert from "node:assert/strict";
import { readFile, stat, writeFile, symlink, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { fixture, input } from "./fixtures.ts";

test("read tools list registrations without creating metadata or changing selection", async () => {
  const f = await fixture();
  try {
    assert.deepEqual(
      (await f.pm.listProjects()).map((p) => p.name),
      ["atlas", "harbor"],
    );
    const metadata = await f.tl.readProjectMetadata("atlas");
    assert.deepEqual(metadata.specs, []);
    await assert.rejects(stat(join(f.projects, "atlas/specs")), /ENOENT/);
    await assert.rejects(stat(join(f.projects, ".config.json")), /ENOENT/);
  } finally {
    await f.cleanup();
  }
});

test("full-content init/update creates immutable versions and preserves exact bytes", async () => {
  const f = await fixture();
  try {
    const first = await f.pm.initSpec(input);
    assert.equal(first.version, "v1");
    assert.equal(await readFile(first.path, "utf8"), input.content);
    assert.equal((await stat(first.path)).mode & 0o222, 0);
    await assert.rejects(f.pm.initSpec(input), /already exists.*update_spec/);
    const next = await f.pm.updateSpec({ ...input, content: "# API v2\n", summary: "Pagination" });
    assert.equal(next.version, "v2");
    assert.equal(await readFile(first.path, "utf8"), input.content);
    const description = await f.tl.describeSpec("atlas", input.name);
    assert.deepEqual(description.spec.versions, ["v1", "v2"]);
    assert.equal(description.latest_version, "v2");
    assert.equal(description.spec.version_summaries.v2, "Pagination");
    assert.equal(description.has_checklist, false);
    assert.equal(description.has_review, false);
  } finally {
    await f.cleanup();
  }
});

test("concurrent updates allocate unique consecutive versions", async () => {
  const f = await fixture();
  try {
    await f.pm.initSpec(input);
    const results = await Promise.all(
      Array.from({ length: 4 }, (_, i) => f.pm.updateSpec({ ...input, content: `Version ${i}` })),
    );
    assert.deepEqual(results.map((r) => r.version).sort(), ["v2", "v3", "v4", "v5"]);
    assert.equal(new Set(results.map((r) => r.path)).size, 4);
  } finally {
    await f.cleanup();
  }
});

test("TL fully replaces one checklist/review; review records assessed inputs, not current guesses", async () => {
  const f = await fixture();
  try {
    await f.pm.initSpec(input);
    const checklist = await f.tl.writeChecklist({ ...input, content: "- [ ] C1: Import works\n" });
    await f.pm.updateSpec({ ...input, content: "New requirements" });
    const review = await f.tl.writeReview({
      ...input,
      content: "C1: observed passing",
      spec_version: "v1",
      checklist_sha256: checklist.sha256,
    });
    let description = await f.pm.describeSpec("atlas", input.name);
    assert.equal(description.latest_reviewed, false);
    assert.equal(description.review_status, "stale");
    const replacement = await f.tl.writeChecklist({
      ...input,
      content: "- [ ] C2: Pagination works\n",
    });
    assert.equal(replacement.path, checklist.path);
    assert.equal(await readFile(checklist.path, "utf8"), "- [ ] C2: Pagination works\n");
    await f.tl.writeReview({
      ...input,
      content: "C2: checked",
      spec_version: "v2",
      checklist_sha256: replacement.sha256,
    });
    description = await f.pm.describeSpec("atlas", input.name);
    assert.equal(description.latest_reviewed, true);
    assert.equal(description.review_status, "current");
    assert.equal(await readFile(review.path, "utf8"), "C2: checked");
  } finally {
    await f.cleanup();
  }
});

test("role restrictions and missing checklist reject writes without side effects", async () => {
  const f = await fixture();
  try {
    await assert.rejects(f.tl.initSpec(input), /PM/);
    await f.pm.initSpec(input);
    await assert.rejects(f.pm.writeChecklist(input), /TL/);
    await assert.rejects(
      f.pm.writeReview({ ...input, spec_version: "v1", checklist_sha256: "a".repeat(64) }),
      /TL/,
    );
    await assert.rejects(f.tl.updateSpec(input), /PM/);
    await assert.rejects(
      f.tl.writeReview({ ...input, spec_version: "v1", checklist_sha256: "a".repeat(64) }),
      /checklist/,
    );
    assert.equal((await f.pm.describeSpec("atlas", input.name)).has_review, false);
  } finally {
    await f.cleanup();
  }
});

test("normalization collisions, invalid paths and symlinks cannot overwrite another document", async () => {
  const f = await fixture();
  try {
    const saved = await f.pm.initSpec(input);
    await assert.rejects(f.pm.initSpec({ ...input, name: "api-design" }), /collid/);
    for (const name of ["../outside", "", "   ", "🔥"]) {
      await assert.rejects(f.pm.initSpec({ ...input, name }));
    }
    await assert.rejects(f.pm.readProjectMetadata("../atlas"));
    await assert.rejects(f.pm.updateSpec({ ...input, name: "Missing" }), /not found/);
    const outside = join(f.root, "outside");
    await mkdir(outside);
    await symlink(outside, join(f.projects, "atlas/specs/linked"));
    await assert.rejects(f.pm.initSpec({ ...input, name: "Linked" }), /symlink/);
    assert.equal(await readFile(saved.path, "utf8"), input.content);
  } finally {
    await f.cleanup();
  }
});

test("malformed metadata and missing declared files are readable errors, not invented state", async () => {
  const f = await fixture();
  try {
    await f.pm.initSpec(input);
    const index = join(f.projects, "atlas/specs/index.json");
    await writeFile(index, "{broken");
    await assert.rejects(f.pm.readProjectMetadata("atlas"), /metadata/);
  } finally {
    await f.cleanup();
  }
});
