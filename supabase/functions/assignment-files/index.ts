import { withSupabase } from "@supabase/server";
import { createFileOperations } from "./files.ts";
import { createFileHandler } from "./server.ts";

export default {
  fetch: withSupabase({ auth: "secret" }, (request, context) =>
    createFileHandler(createFileOperations(context.supabaseAdmin))(request),
  ),
};
