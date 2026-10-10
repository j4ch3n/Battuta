import { createClient } from "@supabase/supabase-js";
import { createHandler } from "./handler.ts";

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(30000) }),
    },
  },
);
export default {
  fetch: createHandler({
    getUser: (token) => admin.auth.getUser(token),
    rpc: (name, args) => admin.rpc(name, args),
  }),
};
