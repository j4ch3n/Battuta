import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { StoredMessage, validate, type Message, type MessageReference } from "../schemas.ts";

let config: Record<string, string> | undefined;
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
  config = JSON.parse(execFileSync("supabase", ["status", "-o", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
}
export const url = process.env.SUPABASE_URL || config?.API_URL || "";
export const secret = process.env.SUPABASE_SECRET_KEY || config?.SECRET_KEY || "";
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname)) {
  throw new Error("Mail integration tests require isolated local Supabase");
}
if (!secret) throw new Error("Local Supabase secret key is missing");
export const db = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
export function ok<T>({ data, error }: { data: T | null; error: { message: string } | null }): T {
  if (error) throw new Error(error.message);
  if (data === null) throw new Error("Empty Supabase test response");
  return data;
}
export const row = async (ref: MessageReference) => validate(StoredMessage, ok(await db.from("agent_messages").select("*")
  .eq("conversation_id", ref.conversation_id).eq("id", ref.id).single()));
export const invoke = async <T = Message>(body: Record<string, unknown>): Promise<T> =>
  ok(await db.functions.invoke<{ data: T }>("agent-mail", { body })).data;
export async function cleanup(conversations: string[]) {
  // Remove descendants before roots because of the composite parent foreign key.
  for (const conversation of conversations) {
    const rows = ok(await db.from("agent_messages").select("id,in_reply_to").eq("conversation_id", conversation)
      .returns<{ id: string; in_reply_to: string | null }[]>());
    while (rows.length) {
      const leaves = rows.filter((item) => !rows.some((other) => other.in_reply_to === item.id));
      if (!leaves.length) throw new Error("Cyclic mail test data");
      ok(await db.from("agent_messages").delete().eq("conversation_id", conversation).in("id", leaves.map((item) => item.id)).select("id"));
      for (const leaf of leaves) rows.splice(rows.indexOf(leaf), 1);
    }
  }
}
export async function wait(predicate: () => boolean | Promise<boolean>, attempts = 200) {
  for (let i = 0; i < attempts; i++) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for agent mail");
}
