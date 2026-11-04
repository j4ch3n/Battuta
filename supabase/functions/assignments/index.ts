import { withSupabase } from "@supabase/server";
import { createAssignmentHandler } from "./server.ts";

export default {
  fetch: withSupabase({ auth: "secret" }, (request, context) =>
    createAssignmentHandler(async (name, args) => await context.supabaseAdmin.rpc(name, args))(
      request,
    ),
  ),
};
