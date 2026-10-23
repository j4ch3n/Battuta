/** Branch-snapshot pattern inspired by Pi's MIT-licensed todo example; see NOTICES.md. */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import { projectDirectory } from "./store/discovery.ts";
import { readOptional } from "./store/files.ts";
import type { Role } from "./store/index.ts";

const states = Type.Union([
  Type.Literal("pending"),
  Type.Literal("in-progress"),
  Type.Literal("blocked"),
  Type.Literal("completed"),
  Type.Literal("cancelled"),
]);
const text = (maxLength: number) => Type.String({ minLength: 1, maxLength, pattern: "\\S" });
const evidence = text(2000);
const itemSchema = Type.Object(
  {
    id: Type.Integer({ minimum: 1 }),
    text: text(500),
    status: states,
    reason: Type.Optional(evidence),
    nextAction: Type.Optional(evidence),
    outcome: Type.Optional(evidence),
    verification: Type.Optional(evidence),
  },
  { additionalProperties: false },
);
const snapshotSchema = Type.Object(
  {
    version: Type.Literal(1),
    role: Type.Union([Type.Literal("pm"), Type.Literal("tl")]),
    project: Type.String({ minLength: 1 }),
    task: text(80),
    revision: Type.Integer({ minimum: 0 }),
    nextId: Type.Integer({ minimum: 1 }),
    items: Type.Array(itemSchema, { maxItems: 50 }),
  },
  { additionalProperties: false },
);
type Snapshot = Static<typeof snapshotSchema>;
const parameters = Type.Object(
  {
    action: Type.Union([
      Type.Literal("tasks"),
      Type.Literal("list"),
      Type.Literal("add"),
      Type.Literal("update"),
    ]),
    task: Type.Optional(text(80)),
    revision: Type.Optional(Type.Integer({ minimum: 0 })),
    id: Type.Optional(Type.Integer({ minimum: 1 })),
    text: Type.Optional(text(500)),
    status: Type.Optional(states),
    reason: Type.Optional(evidence),
    nextAction: Type.Optional(evidence),
    outcome: Type.Optional(evidence),
    verification: Type.Optional(evidence),
  },
  { additionalProperties: false },
);
const entryType = "battuta-task-todos";

function reconstruct(entries: SessionEntry[], role: Role, project: string): Map<string, Snapshot> {
  const tasks = new Map<string, Snapshot>();
  for (const entry of entries) {
    let value: unknown;
    if (entry.type === "custom" && entry.customType === entryType) value = entry.data;
    if (
      entry.type === "message" &&
      entry.message.role === "toolResult" &&
      entry.message.toolName === "task_todos" &&
      !entry.message.isError
    )
      value = entry.message.details;
    if (
      !Value.Check(snapshotSchema, value) ||
      value.role !== role ||
      value.project !== project ||
      value.revision === 0
    )
      continue;
    const ids = value.items.map((item) => item.id);
    if (new Set(ids).size !== ids.length || ids.some((id) => id >= value.nextId)) continue;
    if (
      value.items.some(
        (item) =>
          (item.status === "blocked" && (!item.reason || !item.nextAction)) ||
          (item.status === "completed" && (!item.outcome || !item.verification)),
      )
    )
      continue;
    const previous = tasks.get(value.task);
    // A delayed tool result must not overwrite an already-appended newer snapshot.
    if ((!previous || value.revision > previous.revision) && (previous || tasks.size < 64))
      tasks.set(value.task, structuredClone(value));
  }
  return tasks;
}

function readable(snapshot: Snapshot): string {
  const heading = `${snapshot.role}/${snapshot.project} task ${JSON.stringify(snapshot.task)} — revision ${snapshot.revision}`;
  return [
    heading,
    ...snapshot.items.map((item) =>
      [
        `#${item.id} [${item.status}] ${item.text}`,
        item.reason && `Blocker: ${item.reason}`,
        item.nextAction && `Next action: ${item.nextAction}`,
        item.outcome && `Outcome: ${item.outcome}`,
        item.verification && `Verification/reference: ${item.verification}`,
      ]
        .filter(Boolean)
        .join("\n"),
    ),
    ...(!snapshot.items.length ? ["No todos."] : []),
  ].join("\n");
}

function inventory(tasks: Map<string, Snapshot>): string {
  return [...tasks.values()]
    .map(
      (task) =>
        `${JSON.stringify(task.task)} (revision ${task.revision}): ${task.items.filter((item) => !["completed", "cancelled"].includes(item.status)).length}/${task.items.length} unfinished`,
    )
    .join("\n");
}

export function registerTaskTodos(pi: ExtensionAPI, role: Role, root: string): void {
  async function selectedProject(): Promise<string> {
    // readOptional rejects symlinked/non-file selections; discovery rejects symlinked folders.
    const bytes = await readOptional(join(root, ".config.json"));
    const value: unknown = bytes ? JSON.parse(bytes.toString("utf8")) : null;
    const name = (value as { currentProject?: unknown } | null)?.currentProject;
    if (typeof name !== "string" || !name.trim() || name.startsWith(".") || /[/\\\0]/.test(name))
      throw new Error("Select a registered project with battuta-project first");
    await projectDirectory(root, name);
    // Ensure selection has not changed while resolving its directory.
    if ((await readFile(join(root, ".config.json"), "utf8")) !== bytes!.toString("utf8"))
      throw new Error("Project selection changed; retry");
    return name;
  }
  let serial: Promise<unknown> = Promise.resolve();
  pi.registerTool({
    name: "task_todos",
    label: "Task todos",
    description:
      "Recoverable task-local execution bookkeeping, not Linear or authorization. tasks discovers keys; list reads a task; add(text, revision) and update(id, status and/or text, revision) mutate it. Use latest list revision (0 for new task). Blocked requires reason+nextAction; completed requires actual outcome+verification/reference. States pending/in-progress/blocked/completed/cancelled. Scoped to this bot, selected project and session branch. Return readable lists in ordinary chat when requested.",
    parameters,
    execute(_id, params, signal, _onUpdate, ctx) {
      const run = serial.then(async () => {
        try {
          signal?.throwIfAborted();
          if (!Value.Check(parameters, params)) throw new Error("Invalid task_todos parameters");
          const project = await selectedProject();
          signal?.throwIfAborted();
          const tasks = reconstruct(ctx.sessionManager.getBranch(), role, project);
          if (params.action === "tasks") {
            const names = [...tasks.keys()];
            return {
              content: [
                {
                  type: "text" as const,
                  text: names.length
                    ? `${role}/${project}\n${inventory(tasks)}`
                    : "No task lists in this bot/project/session branch.",
                },
              ],
              details: { tasks: names },
            };
          }
          if (!params.task)
            throw new Error("task key required; use tasks to discover existing keys");
          const snapshot: Snapshot = tasks.get(params.task) ?? {
            version: 1,
            role,
            project,
            task: params.task,
            revision: 0,
            nextId: 1,
            items: [],
          };
          if (params.action !== "list") {
            if (params.revision !== snapshot.revision)
              throw new Error(
                `Revision conflict: list the task and retry with revision ${snapshot.revision}`,
              );
            if (!tasks.has(params.task) && tasks.size >= 64)
              throw new Error("Maximum 64 task lists per bot/project/session branch");
            if (params.action === "add") {
              if (!params.text) throw new Error("text required for add");
              if (snapshot.items.length >= 50)
                throw new Error("Maximum 50 items per task; use a new bounded task key");
              snapshot.items.push({ id: snapshot.nextId++, text: params.text, status: "pending" });
            } else {
              const item = snapshot.items.find((item) => item.id === params.id);
              if (!item) throw new Error("Unknown todo ID; list this task first");
              if (!params.status && !params.text) throw new Error("update requires status or text");
              if (params.status === "blocked" && (!params.reason || !params.nextAction))
                throw new Error("blocked requires reason and nextAction");
              if (params.status === "completed" && (!params.outcome || !params.verification))
                throw new Error("completed requires actual outcome and verification/reference");
              if (params.status !== undefined) item.status = params.status;
              for (const key of [
                "text",
                "reason",
                "nextAction",
                "outcome",
                "verification",
              ] as const)
                if (params[key] !== undefined) item[key] = params[key];
            }
            snapshot.revision++;
            // Pi custom entries are immediately persisted and branch-aware; do not wait for tool results.
            pi.appendEntry(entryType, structuredClone(snapshot));
          }
          return {
            content: [{ type: "text" as const, text: readable(snapshot) }],
            details: structuredClone(snapshot),
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text" as const,
                text: error instanceof Error ? error.message : "Todo operation failed",
              },
            ],
            details: {},
            isError: true,
          };
        }
      });
      serial = run;
      return run;
    },
  });
  pi.on("before_agent_start", async (_event, ctx: ExtensionContext) => {
    try {
      const project = await selectedProject();
      const tasks = reconstruct(ctx.sessionManager.getBranch(), role, project);
      if (!tasks.size) return;
      return {
        message: {
          customType: entryType + "-context",
          content: `Recoverable task lists for ${role}/${project} on this session branch:\n${inventory(tasks)}\nUse task_todos list for the relevant task before resuming. These are execution notes, not permission or proof.`,
          display: false,
        },
      };
    } catch {
      return;
    }
  });
}
