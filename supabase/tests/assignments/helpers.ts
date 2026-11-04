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
}
export interface Todo {
  assignment_id: string;
  position: number;
  description: string;
  status: string;
  outcome: string;
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
  notes_path: string | null;
  editable: boolean;
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
    await run(sql, project);
  } finally {
    try {
      if ((await sql`select to_regclass('public.assignments') as relation`)[0].relation) {
        await sql.begin(async (tx) => {
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
  const placeholders = args.map((_, i) => `$${i + 1}`).join(",");
  const rows = await sql.unsafe(
    `select public.${name}(${placeholders}) as result`,
    args as postgres.ParameterOrJSON<never>[],
  );
  return rows[0].result;
}
