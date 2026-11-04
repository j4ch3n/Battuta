import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createClient, type RealtimeChannel } from "@supabase/supabase-js";
import { localEnv, rpc, withDatabaseTest } from "./helpers.ts";

async function subscribed(channel: RealtimeChannel) {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Realtime subscription timed out")), 5000);
    channel.subscribe((state) => {
      if (state === "SUBSCRIBED") {
        clearTimeout(timer);
        resolve();
      }
      if (state === "CHANNEL_ERROR" || state === "TIMED_OUT") {
        clearTimeout(timer);
        reject(new Error(`Realtime ${state}`));
      }
    });
  });
}
async function observed(check: () => boolean) {
  const end = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > end) throw new Error("Committed availability signal not received");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
function authenticatedToken() {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const input =
    encode({ alg: "HS256", typ: "JWT" }) +
    "." +
    encode({
      role: "authenticated",
      sub: crypto.randomUUID(),
      exp: Math.floor(Date.now() / 1000) + 300,
    });
  return (
    input +
    "." +
    createHmac("sha256", localEnv("SUPABASE_TEST_JWT_SECRET")).update(input).digest("base64url")
  );
}

Deno.test(
  "backend secret receives only committed availability while anonymous/users receive no rows",
  () =>
    withDatabaseTest(async (sql, project) => {
      const url = localEnv("SUPABASE_URL"),
        anonKey = localEnv("SUPABASE_ANON_KEY");
      const config = { auth: { persistSession: false, autoRefreshToken: false } };
      const admin = createClient(url, localEnv("SUPABASE_SECRET_KEY"), config);
      const anon = createClient(url, anonKey, config);
      const token = authenticatedToken();
      const user = createClient(url, anonKey, {
        ...config,
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      await user.realtime.setAuth(token);
      const received: number[][] = [[], [], []];
      const deniedRows: Record<string, unknown>[] = [];
      const clients = [admin, anon, user];
      try {
        for (let i = 0; i < clients.length; i++) {
          const channel = clients[i]
            .channel(`assignment-availability-test-${crypto.randomUUID()}`)
            .on(
              "postgres_changes",
              { event: "UPDATE", schema: "public", table: "assignment_availability" },
              (event) => {
                if (i > 0) deniedRows.push(event.new);
                if (event.new.revision !== undefined) received[i].push(Number(event.new.revision));
              },
            );
          await subscribed(channel);
        }
        assert.equal((await admin.from("assignment_availability").select("revision")).error, null);
        for (const client of [anon, user]) {
          assert.notEqual(
            (await client.from("assignment_availability").select("revision")).error,
            null,
          );
        }
        const revision = async () =>
          Number(
            (await sql`select revision::text from public.assignment_availability`)[0].revision,
          );
        const created = await rpc(sql, "assignment_create", [project, "Signal", ["Step"], "", []]);
        const published = await revision();
        await observed(() => received[0].includes(published));
        const rollback = new Error("rollback");
        await assert.rejects(
          sql.begin(async (tx) => {
            await rpc(tx, "assignment_create", [
              project,
              "Rolled back",
              ["No publication"],
              "",
              [],
            ]);
            throw rollback;
          }),
          (error) => error === rollback,
        );
        assert.equal(await revision(), published);
        const claim = await rpc(sql, "assignment_claim", [project, created.assignment.id]);
        await rpc(sql, "assignment_block", [
          project,
          created.assignment.id,
          claim.assignment.claimed_at,
          "Temporary missing input",
        ]);
        await rpc(sql, "assignment_reactivate", [project, created.assignment.id]);
        const reactivated = await revision();
        await observed(() => received[0].includes(reactivated));
        const next = await rpc(sql, "assignment_claim", [project, created.assignment.id]);
        const started = await rpc(sql, "assignment_start_todo", [
          project,
          created.assignment.id,
          next.assignment.claimed_at,
          1,
          next.todos[0].updated_at,
        ]);
        await rpc(sql, "assignment_record_todo_result", [
          project,
          created.assignment.id,
          next.assignment.claimed_at,
          1,
          started.todo.updated_at,
          "completed",
          "Verified",
          [],
          null,
        ]);
        await rpc(sql, "assignment_finish", [
          project,
          created.assignment.id,
          next.assignment.claimed_at,
        ]);
        const finished = await revision();
        await observed(() => received[0].includes(finished));
        assert.deepEqual(received[0], [published, reactivated, finished]);
        assert.deepEqual(received[1], []);
        assert.deepEqual(received[2], []);
        for (const row of deniedRows) assert.deepEqual(row, {});
      } finally {
        await Promise.all(clients.map((client) => client.removeAllChannels()));
      }
    }),
);
