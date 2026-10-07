import assert from "node:assert/strict";
import { readFile, stat, writeFile, symlink, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { fixture, input } from "./fixtures.ts";

test("spec inventory returns only metadata without creating storage or changing selection", async () => {
  const f = await fixture();
  try {
    const metadata = await f.tl.inspectSpecs("atlas");
    assert.deepEqual(metadata, { schema_version: 1, specs: [] });
    await assert.rejects(stat(join(f.projects, "atlas/specs")), /ENOENT/);
    await assert.rejects(stat(join(f.projects, ".config.json")), /ENOENT/);
  } finally {
    await f.cleanup();
  }
});

test("spec operations do not require project configuration or checkout", async () => {
  const f = await fixture();
  try {
    await rm(join(f.projects, "atlas/code"), { recursive: true });
    await writeFile(join(f.projects, "atlas/project.yaml"), "not: valid: yaml");
    await f.pm.initSpec(input);
    const inventory = await f.tl.inspectSpecs("atlas");
    assert.deepEqual(Object.keys(inventory).sort(), ["schema_version", "specs"]);
    assert.equal(inventory.specs[0].name, "API Design");
    assert.deepEqual(inventory.specs[0].versions, ["v1"]);
    assert.equal(
      (await f.tl.describeSpec("atlas", input.name, true)).contents?.spec,
      input.content,
    );
    await f.pm.updateSpec({ ...input, summary: "Refined", content: "# Refined" });
    await f.tl.writeChecklist(input);
    const assessed = await f.tl.describeSpec("atlas", input.name);
    await f.tl.writeReview({
      ...input,
      spec_version: "v2",
      checklist_sha256: assessed.fingerprints.checklist!,
    });
    await f.pm.finalizeSpec({ ...input, decision: "go", rationale: "Approved scope" });
    assert.equal((await f.pm.inspectSpecs("atlas")).specs[0].decision?.outcome, "go");
  } finally {
    await f.cleanup();
  }
});

test("no-GitHub project supports spec authoring and retains documents after linking", async () => {
  const f = await fixture();
  try {
    const config = {
      version: 1,
      project: { name: "atlas", path: join(f.projects, "atlas/code") },
      github: { repository: null as string | null },
      linear: { project_id: null, team_id: null },
    };
    const path = join(f.projects, "atlas/project.yaml");
    await writeFile(path, JSON.stringify(config));
    await f.pm.initSpec(input);
    await f.tl.writeChecklist(input);
    assert.equal(
      (await f.tl.describeSpec("atlas", input.name, true)).contents?.spec,
      input.content,
    );
    config.github.repository = "team/other";
    await writeFile(path, JSON.stringify(config));
    const linked = await f.tl.describeSpec("atlas", input.name, true);
    assert.equal(linked.contents?.spec, input.content);
    assert.equal(linked.has_checklist, true);
    assert.deepEqual(linked.spec.versions, ["v1"]);
  } finally {
    await f.cleanup();
  }
});

test.each(["../atlas", "", " ", ".", "..", "atlas/code", "atlas\\code", "missing"])(
  "spec inventory rejects invalid or missing project %j without creating it",
  async (project) => {
    const f = await fixture();
    try {
      await assert.rejects(f.pm.inspectSpecs(project));
      await assert.rejects(stat(join(f.projects, "missing")), /ENOENT/);
    } finally {
      await f.cleanup();
    }
  },
);

test("spec inventory rejects a symlink project and preserves its target", async () => {
  const f = await fixture();
  try {
    await symlink(join(f.projects, "atlas"), join(f.projects, "alias"));
    await assert.rejects(f.pm.inspectSpecs("alias"), /symlink/);
    assert.deepEqual(await f.pm.inspectSpecs("atlas"), { schema_version: 1, specs: [] });
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
    await assert.rejects(f.pm.inspectSpecs("../atlas"));
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
    await assert.rejects(f.pm.inspectSpecs("atlas"), /metadata/);
  } finally {
    await f.cleanup();
  }
});
