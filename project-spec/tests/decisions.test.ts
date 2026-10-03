import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseMetadata } from "../store/metadata.ts";
import { test } from "vitest";
import { fixture, input } from "./fixtures.ts";

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

test("metadata rejects malformed or impossible terminal timestamps", async () => {
  const f = await fixture();
  try {
    await f.pm.initSpec(input);
    await f.pm.finalizeSpec({
      project: "atlas",
      name: input.name,
      decision: "go",
      rationale: "Selected scope",
    });
    const path = join(f.projects, "atlas/specs/index.json");
    const metadata = parseMetadata(await readFile(path));
    for (const timestamp of [
      "not-a-date",
      "2026-02-31T00:00:00.000Z",
      "2026-13-01T00:00:00.000Z",
    ]) {
      metadata.specs[0].decision!.recorded_at = timestamp;
      await writeFile(path, JSON.stringify(metadata));
      await assert.rejects(f.pm.readProjectMetadata("atlas"), /timestamp/);
    }
  } finally {
    await f.cleanup();
  }
});

for (const outcome of ["go", "no-go"] as const) {
  test(`${outcome} saves rationale, snapshots exact bytes, and locks all further authoring`, async () => {
    const f = await fixture();
    try {
      const spec = await f.pm.initSpec(input);
      const checklist = await f.tl.writeChecklist({ ...input, content: "C1: criterion" });
      const review = await f.tl.writeReview({
        ...input,
        content: "C1: failed; unresolved",
        spec_version: "v1",
        checklist_sha256: checklist.sha256,
      });
      const result = await f.pm.finalizeSpec({
        project: "atlas",
        name: input.name,
        decision: outcome,
        rationale: "Scope tradeoff accepted.\r\n",
      });
      const metadata = (await f.pm.describeSpec("atlas", input.name)).spec.decision!;
      assert.equal(metadata.outcome, outcome);
      assert.deepEqual(metadata.sha256, {
        spec: sha(await readFile(spec.path)),
        checklist: sha(await readFile(checklist.path)),
        review: sha(await readFile(review.path)),
        decision: sha(await readFile(result.path)),
      });
      assert.match(await readFile(result.path, "utf8"), /Scope tradeoff accepted/);
      for (const path of [spec.path, checklist.path, review.path, result.path])
        assert.equal((await stat(path)).mode & 0o222, 0);
      for (const operation of [
        () => f.pm.updateSpec(input),
        () => f.tl.writeChecklist(input),
        () =>
          f.tl.writeReview({ ...input, spec_version: "v1", checklist_sha256: checklist.sha256 }),
        () =>
          f.pm.finalizeSpec({
            project: "atlas",
            name: input.name,
            decision: outcome,
            rationale: "Changed",
          }),
      ])
        await assert.rejects(operation(), /finalized.*cannot.*changed/i);
    } finally {
      await f.cleanup();
    }
  });
}

test("finalization has no optional-artifact gate and accepts stale review snapshots", async () => {
  const f = await fixture();
  try {
    await f.pm.initSpec(input);
    await f.pm.finalizeSpec({
      project: "atlas",
      name: input.name,
      decision: "go",
      rationale: "Proceed without review.",
    });
    const snapshot = (await f.pm.describeSpec("atlas", input.name)).spec.decision!.sha256;
    assert.equal(snapshot.checklist, null);
    assert.equal(snapshot.review, null);
    await f.pm.initSpec({ ...input, project: "harbor" });
    const checklist = await f.tl.writeChecklist({ ...input, project: "harbor" });
    await f.tl.writeReview({
      ...input,
      project: "harbor",
      spec_version: "v1",
      checklist_sha256: checklist.sha256,
    });
    await f.pm.updateSpec({ ...input, project: "harbor" });
    await f.pm.finalizeSpec({
      project: "harbor",
      name: input.name,
      decision: "no-go",
      rationale: "Do not proceed.",
    });
    assert.equal((await f.pm.describeSpec("harbor", input.name)).review_status, "stale");
  } finally {
    await f.cleanup();
  }
});

test("TL cannot finalize and blank content/rationale never creates artifacts", async () => {
  const f = await fixture();
  try {
    await assert.rejects(f.pm.initSpec({ ...input, content: "  " }), /content/);
    await f.pm.initSpec(input);
    await assert.rejects(
      f.tl.finalizeSpec({
        project: "atlas",
        name: input.name,
        decision: "go",
        rationale: "No authority",
      }),
      /PM/,
    );
    await assert.rejects(
      f.pm.finalizeSpec({ project: "atlas", name: input.name, decision: "go", rationale: " " }),
      /rationale/,
    );
    assert.equal((await f.pm.describeSpec("atlas", input.name)).spec.decision, null);
  } finally {
    await f.cleanup();
  }
});
