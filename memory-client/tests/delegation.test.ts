import { expect, test } from "vitest";
import { prepareDelegation } from "../delegation.ts";
import { record } from "./fixtures/record.ts";
import { requestContent } from "../../agent-mail/tests/fixtures.ts";
import type { RequestBinding } from "../binding.ts";

const binding: RequestBinding = {
  request_id: "commission",
  conversation_id: "owner",
  session_id: "s",
  origin: "owner",
  project: null,
  admitted_at: "2026-11-06T00:00:00Z",
};

test("selected task constraint keeps provenance and expiry without forwarding unrelated personal context", async () => {
  const selected = record();
  selected.content = "Owner requires low-maintenance calendar tooling";
  selected.memory_metadata!.expires_at = "2030-01-01T00:00:00Z";
  const privateFact = { ...record("b".repeat(64)), content: "Unrelated private stress event" };
  const client = {
    call: (name: string, args: Record<string, unknown>) =>
      Promise.resolve(
        name === "memory_get"
          ? args.ref === selected.ref
            ? selected
            : privateFact
          : { records: [selected, privateFact] },
      ),
  };
  const result = await prepareDelegation(
    binding,
    requestContent("Propose a calendar integration"),
    [selected.ref],
    client,
    new AbortController().signal,
  );
  expect(JSON.stringify(result)).toContain("low-maintenance");
  expect(JSON.stringify(result)).toContain("confirmed");
  expect(JSON.stringify(result)).toContain("2030-01-01");
  expect(JSON.stringify(result)).toContain("sources");
  expect(JSON.stringify(result)).not.toContain(privateFact.content);
  expect(result.references.some((r) => r.locator === `memory:${selected.ref}`)).toBe(true);
});

test.each(["stale", "scope"])("%s selection is rejected instead of widened", async (failure) => {
  const r = record();
  const client = {
    call: (name: string) =>
      Promise.resolve(
        name === "memory_get"
          ? { ...r, revision: "c".repeat(64) }
          : {
              records: [
                failure === "scope" ? { ...r, scope: { global: false, projects: ["other"] } } : r,
              ],
            },
      ),
  };
  await expect(
    prepareDelegation(
      binding,
      requestContent("Select tooling"),
      [r.ref],
      client,
      new AbortController().signal,
    ),
  ).rejects.toThrow("Selected memory");
});

test("commission requires selection or none-relevant declaration; declared none never auto-forwards search hits", async () => {
  const r = record();
  const client = {
    call: (name: string) => Promise.resolve(name === "memory_get" ? r : { records: [r] }),
  };
  await expect(
    prepareDelegation(
      binding,
      requestContent("Investigate"),
      [],
      client,
      new AbortController().signal,
    ),
  ).rejects.toThrow("declaration");
  const content = requestContent("Investigate");
  content.context.push("memory-context:none-relevant");
  const result = await prepareDelegation(
    binding,
    content,
    [],
    client,
    new AbortController().signal,
  );
  expect(JSON.stringify(result)).not.toContain(r.content);
  expect(result.context).toContain("memory-context:none-relevant");
});

test("timeout produces an honest unavailable brief and no unverified memory locators", async () => {
  const r = record();
  const content = requestContent("Investigate");
  content.references.push({ locator: `memory:${r.ref}`, note: "Selected constraint" });
  const result = await prepareDelegation(
    binding,
    content,
    [r.ref],
    { call: () => new Promise<unknown>(() => {}) },
    AbortSignal.timeout(10),
  );
  expect(result.context.some((c) => c.startsWith("memory-context:unavailable"))).toBe(true);
  expect(result.references.some((r) => r.locator.startsWith("memory:"))).toBe(false);
  expect(JSON.stringify(result)).not.toContain(r.content);
});

test("a selected hypothesis cannot disclose unselected counterevidence", async () => {
  const support = record(),
    counter = record("b".repeat(64));
  const hypothesis = {
    ...record("c".repeat(64)),
    memory_metadata: {
      ...support.memory_metadata!,
      knowledge_type: "hypothesis" as const,
      confidence: "tentative" as const,
      rationale: "A possible pattern",
      evidence: [
        {
          ref: support.ref,
          revision: support.revision,
          relation: "supports" as const,
          requirement: "historical" as const,
        },
        {
          ref: counter.ref,
          revision: counter.revision,
          relation: "contradicts" as const,
          requirement: "historical" as const,
        },
      ],
    },
  };
  const records = [hypothesis, support, counter];
  const client = {
    call: (name: string, args: Record<string, unknown>) =>
      Promise.resolve(
        name === "memory_get" ? records.find((r) => r.ref === args.ref) : { records },
      ),
  };
  await expect(
    prepareDelegation(
      binding,
      requestContent("Compare options"),
      [hypothesis.ref],
      client,
      new AbortController().signal,
    ),
  ).rejects.toThrow("counterevidence");
});

test("a selected constraint is never silently dropped to fit the narrower delegation budget", async () => {
  const r = { ...record(), content: "x".repeat(1500) };
  const client = {
    call: (name: string) => Promise.resolve(name === "memory_get" ? r : { records: [r] }),
  };
  await expect(
    prepareDelegation(
      binding,
      requestContent("Compare options"),
      [r.ref],
      client,
      new AbortController().signal,
    ),
  ).rejects.toThrow("budget");
});
