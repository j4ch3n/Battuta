import postgres from "postgres";

export interface Assignment {
  id: string;
  project: string;
  goal: string;
  constraints: string;
  status: string;
  notes_path: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  claimed_at: string | null;
  claimed_by: string | null;
  require_abilities: string[];
  lease_expired_at: string | null;
  lease_expired: boolean;
  blocker: string | null;
  dependencies: { assignment_id: string; project: string; status: string }[];
  ready: boolean;
}
export interface Todo {
  assignment_id: string;
  position: number;
  description: string;
  status: string;
  outcome: string;
  evidence: string[];
  blocker: string | null;
  created_at: string;
  updated_at: string;
}
export interface Result {
  ok: boolean;
  code?: string;
  assignment: Assignment;
  assignments: Assignment[];
  todos: Todo[];
  todo: Todo;
  unfinished: Todo[];
  notes_ref: string | null;
  notes_path: string | null;
  editable: boolean;
  reason?: string;
  nextStep?: string;
  missing_assignment_ids?: string[];
  message?: string;
}
export function localEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing explicit ${name}`);
  if (
    name.endsWith("URL") &&
    !["127.0.0.1", "localhost", "[::1]"].includes(new URL(value).hostname)
  ) {
    throw new Error("Assignment integration requires local loopback endpoints");
  }
  return value;
}

export async function withDatabaseTest(run: (sql: postgres.Sql, project: string) => Promise<void>) {
  const sql = postgres(localEnv("SUPABASE_DB_URL"), { max: 8, onnotice: () => {} });
  const project = `assignment-test-${crypto.randomUUID()}`;
  try {
    await applySettings(sql);
    await run(sql, project);
  } finally {
    try {
      if ((await sql`select to_regclass('public.assignments') as relation`)[0].relation) {
        await sql.begin(async (tx) => {
          if (
            (await tx`select to_regclass('public.assignment_dependencies') as relation`)[0].relation
          ) {
            await tx`delete from public.assignment_dependencies where assignment_id in (select id from public.assignments where project = ${project}) or prerequisite_assignment_id in (select id from public.assignments where project = ${project})`;
          }
          await tx`delete from public.todos where assignment_id in (select id from public.assignments where project = ${project})`;
          await tx`delete from public.assignments where project = ${project}`;
        });
      }
    } finally {
      await sql.end();
    }
  }
}

export async function rpc(
  sql: postgres.Sql | postgres.TransactionSql,
  name: string,
  args: unknown[],
): Promise<Result> {
  if (!/^assignment_[a-z_]+$/.test(name)) throw new Error("Invalid test RPC name");
  // Default identity for tests whose subject is the existing execution lifecycle.
  args = [...args];
  if (name === "assignment_claim" && args.length === 2) args.push("test-worker", ["research"]);
  if (name === "assignment_claim" && args.length === 4) args.push(crypto.randomUUID());
  const ownerPosition: Record<string, number> = {
    assignment_start_todo: 5,
    assignment_record_todo_result: 9,
    assignment_block: 4,
    assignment_finish: 3,
    assignment_renew: 3,
  };
  const owner = ownerPosition[name];
  if (owner !== undefined && args.length <= owner) {
    while (args.length < owner) args.push(null);
    args.push("test-worker");
  }
  // postgres.js serializes inferred timestamptz parameters through Date (milliseconds).
  const tokens: Record<string, number[]> = {
    assignment_update_todo: [3],
    assignment_start_todo: [2, 4],
    assignment_record_todo_result: [2, 4],
    assignment_block: [2],
    assignment_finish: [2],
    assignment_renew: [2],
  };
  const placeholders = args
    .map((_, i) => `$${i + 1}${tokens[name]?.includes(i) ? "::text::timestamptz" : ""}`)
    .join(",");
  const rows = await sql.unsafe(
    `select public.${name}(${placeholders}) as result`,
    args as postgres.ParameterOrJSON<never>[],
  );
  return rows[0].result;
}

const message = (objective: string, body: string) => ({ objective, body });
/** The stored settings shape: durations in integer seconds, as the sync writes them. */
export function testSettings(
  overrides: { lease?: number; heartbeat?: number; check?: number; report?: number } = {},
) {
  return {
    lease: { duration: overrides.lease ?? 600 },
    heartbeat: { interval: overrides.heartbeat ?? 60 },
    expiry: { check_interval: overrides.check ?? 60 },
    progress: { report_after: overrides.report ?? 600 },
    ask: { chase_after: 1800 },
    roles: { manager: "manager" },
    messages: {
      expiry_blocker: message("Lease expired for {worker}", "Claim version: {claimed_at}."),
      manager_expiry_notice: message(
        "Assignment {assignment_id} blocked: lease expired for {worker}",
        "assignment_id: {assignment_id}. Claim version: {claimed_at}.",
      ),
      progress_request: message(
        "Report your status on assignment {assignment_id}",
        "Tell the Manager now.",
      ),
      idle_reminder: message("TODO {position} has no report", "Continue or report."),
      no_report_blocker: message("No report for TODO {position}", "Stopped twice."),
      ask_chase: message(
        "Waiting for your answer on assignment {assignment_id}",
        "{worker} waits.",
      ),
    },
  };
}
export async function applySettings(
  sql: postgres.Sql | postgres.TransactionSql,
  settings: unknown = testSettings(),
) {
  await sql`select public.assignment_settings_apply(${sql.json(settings as postgres.JSONValue)})`;
}
