import { expect, it, vi } from "vitest";
import { smokeTaskClient } from "../scripts/smoke.ts";
import { task, report } from "./fixtures.ts";
import type { DaemonOptions } from "../daemon.ts";

function setup(outcome: "target" | "null" | "error" | "wrong" = "target") {
  const target = { ...task, opencode_session_id: null };
  const unrelated = {
    ...target,
    id: "22345678-1234-1234-1234-123456789abc",
    claimed_by: null,
    claimed_at: null,
  };
  const queue = [unrelated, target, { ...unrelated, id: "32345678-1234-1234-1234-123456789abc" }];
  const client: DaemonOptions["tasks"]["client"] = {
    claim: vi.fn((_projects, _signal, taskId?: string) => {
      if (outcome === "error") return Promise.reject(new Error("uncertain"));
      if (outcome === "null") return Promise.resolve(null);
      const selected = queue.find((row) => taskId === undefined || row.id === taskId)!;
      selected.claimed_by = task.claimed_by;
      selected.claimed_at = task.claimed_at;
      return Promise.resolve(outcome === "wrong" ? { ...selected, id: unrelated.id } : selected);
    }),
    listOwned: () =>
      Promise.resolve({ tasks: queue.filter((row) => row.claimed_by !== null), next: null }),
    bind: vi.fn((id: string, session: string) =>
      Promise.resolve({ ...target, id, opencode_session_id: session }),
    ),
    finalize: vi.fn((id: string) => Promise.resolve({ ...target, id })),
  };
  return {
    client,
    queue,
    target,
    isolated: smokeTaskClient(client, target.id, target.project, target.claimed_by!),
  };
}
it.each([undefined, null, "", "not-a-task"])(
  "refuses missing/malformed exact ID %j before any claim",
  (id) => {
    const { client, target } = setup();
    expect(() =>
      smokeTaskClient(client, id as string, target.project, target.claimed_by!),
    ).toThrow();
    expect(client.claim).not.toHaveBeenCalled();
  },
);
it("leaves unrelated prior/after queue rows unclaimed and targets exactly one admission", async () => {
  const { client, queue, target, isolated } = setup();
  const signal = new AbortController().signal;
  expect(await isolated.claim([target.project], signal)).toEqual(target);
  expect(client.claim).toHaveBeenCalledWith([target.project], signal, target.id);
  expect(await isolated.claim([target.project], signal)).toBeNull();
  expect(client.claim).toHaveBeenCalledTimes(1);
  expect(queue[0].claimed_by).toBeNull();
  expect(queue[2].claimed_by).toBeNull();
});
it.each(["null", "error", "wrong"] as const)(
  "never falls back or retries after targeted %s",
  async (outcome) => {
    const { client, queue, target, isolated } = setup(outcome);
    const result = isolated.claim([target.project]).catch((error: unknown) => error);
    if (outcome === "null") expect(await result).toBeNull();
    else expect(await result).toBeInstanceOf(Error);
    expect(await isolated.claim([target.project])).toBeNull();
    expect(client.claim).toHaveBeenCalledTimes(1);
    expect(queue[0].claimed_by).toBeNull();
    expect(queue[2].claimed_by).toBeNull();
  },
);
it("blocks wrong project, aborted deadline and unrelated owned/mutation identities without writes", async () => {
  const { client, target, isolated } = setup();
  await expect(isolated.claim(["Other"])).rejects.toThrow();
  const signal = AbortSignal.abort();
  await expect(isolated.claim([target.project], signal)).rejects.toThrow();
  expect(client.claim).not.toHaveBeenCalled();
  await expect(isolated.bind("other", "ses_other")).rejects.toThrow();
  expect(client.bind).not.toHaveBeenCalled();
  await expect(
    isolated.finalize("other", {
      schema_version: 1,
      state: "failed",
      summary: "Failed",
      checks: [],
      artifacts: [],
      failure: "Failure",
    }),
  ).rejects.toThrow();
  expect(client.finalize).not.toHaveBeenCalled();
});
it("monitors and mutates only the target, refusing an unrelated owned row", async () => {
  const { client, queue, target, isolated } = setup();
  await isolated.claim([target.project]);
  expect(await isolated.listOwned()).toEqual({ tasks: [target], next: null });
  const signal = new AbortController().signal;
  await isolated.bind(target.id, "ses_smoke", signal);
  expect(client.bind).toHaveBeenCalledWith(target.id, "ses_smoke", signal);
  await isolated.finalize(target.id, report, signal);
  expect(client.finalize).toHaveBeenCalledWith(target.id, report, signal);
  expect(await isolated.claim([target.project])).toBeNull();
  expect(client.claim).toHaveBeenCalledTimes(1);
  queue[0].claimed_by = target.claimed_by;
  queue[0].claimed_at = target.claimed_at;
  await expect(isolated.listOwned()).rejects.toThrow("unrelated owned");
});
it.each([{ project: "Other" }, { claimed_by: "other-worker" }, { terminal_report: report }])(
  "rejects unsafe same-ID claim acknowledgement %j without subsequent admission",
  async (patch) => {
    const { client, target } = setup();
    client.claim = vi.fn(() => Promise.resolve({ ...target, ...patch }));
    const isolated = smokeTaskClient(client, target.id, target.project, target.claimed_by!);
    await expect(isolated.claim([target.project])).rejects.toThrow("uncertain");
    expect(await isolated.claim([target.project])).toBeNull();
    expect(client.claim).toHaveBeenCalledTimes(1);
  },
);
