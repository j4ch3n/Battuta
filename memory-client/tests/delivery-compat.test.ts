import { expect, test } from "vitest";
import {
  normalizePersistedCheckpoint,
  normalizePersistedRecord,
  normalizePersistedRequest,
} from "../delivery-compat.ts";
import { capturePayloadDigest, digest } from "../canonical.ts";
import { memoryRecordSchema } from "../records.ts";
import { record } from "./fixtures/record.ts";

test("persisted-only adapters copy scope without changing frozen identities or arbitrary metadata", () => {
  const old = {
    name: "memory_remember",
    args: {
      content: "Fact",
      scope: { global: false, projects: ["atlas", "beacon"] },
      idempotency_key: "frozen",
      custom: { scope: "unchanged" },
    },
  };
  const normalized = normalizePersistedRequest(old);
  expect(normalized.args).toEqual({
    content: "Fact",
    projects: ["atlas", "beacon"],
    idempotency_key: "frozen",
    custom: { scope: "unchanged" },
  });
  expect(old.args.scope).toEqual({ global: false, projects: ["atlas", "beacon"] });
  const rest: Record<string, unknown> = { ...record() };
  delete rest.projects;
  const legacy = { ...rest, scope: { global: true, projects: [] } };
  expect(normalizePersistedRecord(legacy)).toMatchObject({ projects: ["global"] });
  expect(memoryRecordSchema.safeParse(legacy).success).toBe(false);
});

test.each([1, 2, 3])(
  "adapts only saved checkpoint v%s and preserves its frozen operation identity",
  (version) => {
    const state = {
      version,
      run_id: "2026-11-08T03:00:00Z",
      records: [{ ref: "a".repeat(64), scope: { global: false, projects: ["atlas"] } }],
      requests: {
        write: {
          name: "memory_remember",
          args: {
            scope: { global: false, projects: ["atlas"] },
            idempotency_key: "dream:original:write",
          },
        },
      },
      results: [{ id: "acknowledged", result: { ref: "b".repeat(64) } }],
    };
    const before = JSON.stringify(state);
    expect(normalizePersistedCheckpoint(state)).toMatchObject({
      run_id: state.run_id,
      records: [{ projects: ["atlas"] }],
      requests: {
        write: {
          catalog: ["atlas"],
          args: { projects: ["atlas"], idempotency_key: "dream:original:write" },
        },
      },
      results: state.results,
    });
    expect(JSON.stringify(state)).toBe(before);
  },
);
test("capture digest preserves historical scope representation and lowercases new labels", () => {
  const old = {
    batch_id: "frozen",
    items: [
      {
        item_id: "same",
        scope: { global: false, projects: ["atlas", "beacon"] },
        sources: ["same"],
      },
    ],
  };
  const current = {
    batch_id: "frozen",
    items: [{ item_id: "same", projects: ["Beacon", "Atlas"], sources: ["same"] }],
  };
  expect(capturePayloadDigest(current)).toBe(digest(old));
});

test("capture digest orders non-BMP project names like Python's Unicode sorting", () => {
  expect(capturePayloadDigest({ items: [{ projects: ["😀", "\ue000"] }] })).toBe(
    digest({ items: [{ scope: { global: false, projects: ["\ue000", "😀"] } }] }),
  );
});
