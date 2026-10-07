import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DelegateInput } from "../../supabase/functions/_shared/task-contracts.ts";
import { task } from "./fixtures.ts";
import { runSmoke } from "../scripts/smoke.ts";

const state = vi.hoisted(() => ({
  close: vi.fn(() => Promise.resolve()),
  release: vi.fn(() => Promise.resolve()),
  open: vi.fn(() => Promise.resolve({ close: () => Promise.resolve() })),
  run: vi.fn(() => Promise.resolve()),
  completed: true,
  mail: true,
}));
vi.mock("../config.ts", () => ({
  loadConfig: () =>
    Promise.resolve({
      workerId: "worker-1",
      projects: { "isolated-smoke": {} },
      capacity: 1,
      model: { providerID: "fake", modelID: "fake" },
      lockPath: "/test/lock",
    }),
}));
vi.mock("../lock.ts", () => ({ acquireDaemonLock: () => Promise.resolve(state.release) }));
vi.mock("../opencode.ts", () => ({ createOpenCodeAdapter: state.open }));
vi.mock("../daemon.ts", () => ({ verifyAuthority: () => undefined, runDaemon: state.run }));
vi.mock("../../task-delegation/auth.ts", () => ({
  createTaskConnection: ({ email }: { email: string }) =>
    Promise.resolve({
      principal: email.startsWith("pm")
        ? { role: "pm", projects: ["isolated-smoke"] }
        : { role: "worker", worker_id: "worker-1", projects: ["isolated-smoke"] },
      close: state.close,
      supabase: {},
      client: {
        listOwned: () => Promise.resolve({ tasks: [] }),
        delegate: (input: DelegateInput) =>
          Promise.resolve({
            ...task,
            instruction: input.instruction,
            opencode_session_id: "ses_smoke",
            terminal_report: {
              schema_version: 1,
              state: state.completed ? "completed" : "failed",
              summary: "Read heading",
              checks: [
                {
                  criterion_id: "heading",
                  result: "passed",
                  evidence: [{ locator: "README.md", description: "# Test" }],
                },
              ],
              artifacts: [],
              failure: state.completed ? null : "Read failed",
            },
            result_message_ref: {
              conversation_id: "12345678-1234-1234-1234-123456789abc",
              id: "123456abcdef",
            },
          }),
      },
    }),
}));
const env = {
  BATTUTA_SMOKE_APPROVAL: "test-only-model-spend",
  BATTUTA_SMOKE_BUDGET_USD: "0.50",
  BATTUTA_SMOKE_PROJECT: "isolated-smoke",
  BATTUTA_SMOKE_CONFIG: "/private/smoke.json",
  BATTUTA_SMOKE_MAIL_SECRET_KEY: "test-admin",
  BATTUTA_SMOKE_DELEGATOR_EMAIL: "pm@test.local",
  BATTUTA_SMOKE_DELEGATOR_PASSWORD: "test-password",
  SUPABASE_URL: "http://test.local",
  SUPABASE_PUBLISHABLE_KEY: "public",
  WORKER_TASK_EMAIL: "worker@test.local",
  WORKER_TASK_PASSWORD: "test-password",
};
beforeEach(() => {
  vi.clearAllMocks();
  state.completed = true;
  state.mail = true;
  vi.stubGlobal("fetch", () =>
    Promise.resolve(
      Response.json(
        state.mail
          ? [
              {
                conversation_id: "12345678-1234-1234-1234-123456789abc",
                id: "123456abcdef",
                sender: "worker.worker-1",
                recipient: "pm",
                message_type: "chat",
                content: {
                  schema_version: 1,
                  kind: "worker_result",
                  state: "completed",
                  text: "Read heading",
                  references: [],
                },
                created_at: "2026-10-07T00:00:00Z",
                response_due: null,
                in_reply_to: null,
                status: "created",
                read_at: null,
                replied_at: null,
              },
            ]
          : [],
      ),
    ),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it("observes validated completion/mail and closes only local resources", async () => {
  await runSmoke(env);
  expect(state.open).toHaveBeenCalledOnce();
  expect(state.run).toHaveBeenCalledOnce();
  expect(state.close).toHaveBeenCalledTimes(2);
  expect(state.release).toHaveBeenCalledOnce();
});
it.each(["failed-report", "missing-mail"])(
  "refuses %s while releasing local resources",
  async (kind) => {
    if (kind === "failed-report") state.completed = false;
    else state.mail = false;
    await expect(runSmoke(env)).rejects.toThrow();
    expect(state.close).toHaveBeenCalledTimes(2);
    expect(state.release).toHaveBeenCalledOnce();
  },
);
it("does not begin daemon admission when the deadline expires during discovery", async () => {
  vi.useFakeTimers();
  state.open.mockImplementationOnce(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 1100));
    return { close: () => Promise.resolve() };
  });
  const result = runSmoke({ ...env, BATTUTA_SMOKE_DEADLINE_MS: "1000" }).catch(
    (error: unknown) => error,
  );
  await vi.advanceTimersByTimeAsync(1101);
  expect(await result).toBeInstanceOf(Error);
  expect(state.run).not.toHaveBeenCalled();
  expect(state.close).toHaveBeenCalledTimes(2);
  expect(state.release).toHaveBeenCalledOnce();
});
