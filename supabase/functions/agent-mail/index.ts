import { withSupabase } from "@supabase/server";
import { parseRequest, rpcRequest } from "./schema.ts";

// Modern secret keys are not JWTs. Authenticate the apikey inside the handler.
export default {
  fetch: withSupabase({ auth: "secret" }, async (req, ctx) => {
    if (req.method !== "POST") return Response.json({ error: "Use POST" }, { status: 405 });
    let request;
    try { request = parseRequest(await req.json()); }
    catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Invalid agent-mail request" }, { status: 400 }); }
    const { name, args } = rpcRequest(request);
    const { data, error } = await ctx.supabaseAdmin.rpc(name, args);
    if (error) {
      const status = error.code === "22023" || error.code.startsWith("23") ? 400 : 500;
      if (status === 500) console.error("Agent-mail RPC failed", error);
      return Response.json({ error: status === 400 ? error.message : "Agent-mail operation failed" }, { status });
    }
    return Response.json({ data });
  }),
};
