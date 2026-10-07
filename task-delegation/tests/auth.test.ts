import { expect, it, vi, beforeEach, afterEach } from "vitest";
import { createTaskConnection } from "../auth.ts";

const fake = vi.hoisted(() => {
  const auth = {
    signInWithPassword: vi.fn(),
    getUser: vi.fn(),
    onAuthStateChange: vi.fn(),
    stopAutoRefresh: vi.fn(),
  };
  return {
    auth,
    realtime: { setAuth: vi.fn(), disconnect: vi.fn() },
    createClient: vi.fn(),
    unsubscribe: vi.fn(),
  };
});
vi.mock("@supabase/supabase-js", () => ({ createClient: fake.createClient }));
const config = {
  url: "https://example.supabase.co",
  publishableKey: "public-key",
  email: "worker@example.com",
  password: "secret-password",
};
beforeEach(() => {
  vi.resetAllMocks();
  fake.createClient.mockReturnValue({ auth: fake.auth, realtime: fake.realtime });
  fake.auth.signInWithPassword.mockResolvedValue({
    data: { session: { access_token: "initial-token" } },
    error: null,
  });
  fake.auth.getUser.mockResolvedValue({
    data: {
      user: {
        app_metadata: { battuta: { role: "worker", projects: ["Battuta"], worker_id: "host-1" } },
        user_metadata: { battuta: { role: "pm", projects: [] } },
      },
    },
    error: null,
  });
  fake.auth.onAuthStateChange.mockReturnValue({
    data: { subscription: { unsubscribe: fake.unsubscribe } },
  });
  fake.realtime.setAuth.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllGlobals());
it("uses verified app metadata, in-memory refresh, and refreshes Realtime credentials", async () => {
  const connection = await createTaskConnection(config);
  expect(connection.principal).toEqual({
    role: "worker",
    projects: ["Battuta"],
    worker_id: "host-1",
  });
  const options = fake.createClient.mock.calls[0]?.[2] as {
    auth: { persistSession: boolean; autoRefreshToken: boolean };
    global: { fetch: typeof fetch };
  };
  expect(options.auth).toMatchObject({ persistSession: false, autoRefreshToken: true });
  expect(options.global.fetch).toBeTypeOf("function");
  expect(fake.auth.getUser).toHaveBeenCalledOnce();
  expect(fake.realtime.setAuth).toHaveBeenCalledWith("initial-token");
  const callback = fake.auth.onAuthStateChange.mock.calls[0]?.[0] as (
    event: string,
    session: { access_token: string } | null,
  ) => void;
  callback("TOKEN_REFRESHED", { access_token: "refreshed-token" });
  await Promise.resolve();
  expect(fake.realtime.setAuth).toHaveBeenCalledWith("refreshed-token");
  await connection.close();
  expect(fake.auth.stopAutoRefresh).toHaveBeenCalledOnce();
  expect(fake.unsubscribe).toHaveBeenCalledOnce();
  expect(fake.realtime.disconnect).toHaveBeenCalledOnce();
  await connection.close();
  expect(fake.auth.stopAutoRefresh).toHaveBeenCalledOnce();
});
it("bounds Auth network requests and preserves caller and Request abort signals", async () => {
  const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}"));
  vi.stubGlobal("fetch", transport);
  const connection = await createTaskConnection(config);
  const options = fake.createClient.mock.calls[0]?.[2] as { global: { fetch: typeof fetch } };
  const controller = new AbortController();
  const request = new Request("https://example.supabase.co/auth/v1/user", {
    signal: controller.signal,
  });
  await options.global.fetch(request);
  const actual = transport.mock.calls[0]?.[1]?.signal;
  expect(actual).toBeInstanceOf(AbortSignal);
  controller.abort();
  expect(actual?.aborted).toBe(true);
  await connection.close();
});
it("handles refresh failure and ignores refresh notifications after close", async () => {
  const connection = await createTaskConnection(config);
  const callback = fake.auth.onAuthStateChange.mock.calls[0]?.[0] as (
    event: string,
    session: { access_token: string } | null,
  ) => void;
  fake.realtime.setAuth.mockRejectedValueOnce(new Error("refreshed-token"));
  callback("TOKEN_REFRESHED", { access_token: "refreshed-token" });
  await vi.waitFor(() => expect(fake.auth.stopAutoRefresh).toHaveBeenCalledOnce());
  callback("SIGNED_OUT", null);
  callback("TOKEN_REFRESHED", { access_token: "ignored" });
  expect(fake.realtime.setAuth).not.toHaveBeenCalledWith("ignored");
  await connection.close();
});
it("awaits one complete cleanup for concurrent close calls", async () => {
  let finish: (() => void) | undefined;
  fake.auth.stopAutoRefresh.mockReturnValue(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  const connection = await createTaskConnection(config);
  const first = connection.close();
  let secondFinished = false;
  const second = connection.close().then(() => {
    secondFinished = true;
  });
  await Promise.resolve();
  expect(secondFinished).toBe(false);
  finish?.();
  await Promise.all([first, second]);
  expect(fake.realtime.disconnect).toHaveBeenCalledOnce();
});
it("still disconnects Realtime and sanitizes setup errors when cleanup fails", async () => {
  fake.auth.signInWithPassword.mockResolvedValue({
    data: { session: null },
    error: new Error("secret-password"),
  });
  fake.auth.stopAutoRefresh.mockRejectedValue(new Error("initial-token"));
  await expect(createTaskConnection(config)).rejects.toThrow("Task authentication failed");
  expect(fake.realtime.disconnect).toHaveBeenCalledOnce();
});
it.each(["signin", "verified-user", "metadata", "realtime"])(
  "cleans refresh resources on %s failure without leaking credentials",
  async (stage) => {
    if (stage === "signin")
      fake.auth.signInWithPassword.mockResolvedValue({
        data: { session: null },
        error: new Error("secret-password"),
      });
    if (stage === "verified-user")
      fake.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: new Error("initial-token"),
      });
    if (stage === "metadata")
      fake.auth.getUser.mockResolvedValue({
        data: {
          user: { app_metadata: {}, user_metadata: { battuta: { role: "pm", projects: [] } } },
        },
        error: null,
      });
    if (stage === "realtime") fake.realtime.setAuth.mockRejectedValue(new Error("initial-token"));
    await expect(createTaskConnection(config)).rejects.toThrow("Task authentication failed");
    expect(fake.auth.stopAutoRefresh).toHaveBeenCalledOnce();
  },
);
