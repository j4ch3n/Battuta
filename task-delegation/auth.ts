import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { validatePrincipal, type Principal } from "../supabase/functions/_shared/task-contracts.ts";
import { boundedSignal, TaskClient } from "./client.ts";

export async function createTaskConnection(options: {
  url: string;
  publishableKey: string;
  email: string;
  password: string;
}): Promise<{
  client: TaskClient;
  supabase: SupabaseClient;
  principal: Principal;
  close(): Promise<void>;
}> {
  const supabase = createClient(options.url, options.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false },
    global: {
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          signal: boundedSignal(
            init?.signal ?? (input instanceof Request ? input.signal : undefined),
          ),
        }),
    },
  });
  let unsubscribe: (() => void) | undefined;
  let closed = false;
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => {
    if (closing) return closing;
    closed = true;
    closing = (async () => {
      unsubscribe?.();
      try {
        await supabase.auth.stopAutoRefresh();
      } finally {
        await supabase.realtime.disconnect();
      }
    })();
    return closing;
  };
  try {
    const { data: signedIn, error: signInError } = await supabase.auth.signInWithPassword({
      email: options.email,
      password: options.password,
    });
    if (signInError || !signedIn.session) throw new Error("Sign-in rejected");
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw new Error("User verification rejected");
    const principal = validatePrincipal(data.user.app_metadata.battuta);
    await supabase.realtime.setAuth(signedIn.session.access_token);
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      // Do not await Supabase calls inside an auth callback (Auth holds a lock).
      if (event === "TOKEN_REFRESHED" && session && !closed) {
        void supabase.realtime.setAuth(session.access_token).catch(() => {
          void close().catch(() => undefined);
        });
      }
    });
    unsubscribe = () => listener.subscription.unsubscribe();
    return { client: new TaskClient(supabase), supabase, principal, close };
  } catch {
    await close().catch(() => undefined);
    // Auth errors can contain credentials or token-bearing URLs; do not propagate them.
    throw new Error("Task authentication failed");
  }
}
