import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { toolContracts, type ToolName } from "./contracts.ts";
import { noteGuidance, projectsRootHeader, resolveNotePath } from "./notes.ts";
import { unknownAbilities } from "./abilities.ts";

export type Rpc = (
  name: string,
  args: Record<string, unknown>,
) => Promise<{
  data: unknown;
  error: { code?: string; message: string } | null;
}>;
const operations: Record<ToolName, { rpc: string; description: string }> = {
  create_assignment: {
    rpc: "assignment_create",
    description:
      "Atomically commission a complete initial TODO plan with existing immutable prerequisite IDs. Inspect before repeating an uncertain write.",
  },
  list_assignments: {
    rpc: "assignment_list",
    description:
      "List active or historical assignments, optionally filtered by project, newest first with dependency readiness.",
  },
  get_assignment: {
    rpc: "assignment_get",
    description:
      "Read assignment details and every TODO in position order, including exact update tokens.",
  },
  append_todos: {
    rpc: "assignment_append_todos",
    description:
      "Append ordered TODOs with immutable positions. Inspect before repeating an uncertain write; no reordering.",
  },
  update_todo: {
    rpc: "assignment_update_todo",
    description:
      "Edit unfinished descriptions or cancel unfinished TODOs on active/blocked assignments using exact update tokens. Execution progress requires a claim.",
  },
  close_assignment: {
    rpc: "assignment_close",
    description:
      "Cancel a nonterminal assignment without changing TODO evidence. Completion uses claim-bound finish_assignment.",
  },
  prepare_notes: {
    rpc: "assignment_prepare_notes",
    description:
      "Prepare assignment notes and return their full local path and editing guidance. Files are not synchronized or created by the server.",
  },
  locate_notes: {
    rpc: "assignment_locate_notes",
    description:
      "Get the full local note path before editing. Closed assignments return frozen/read-only guidance.",
  },
  claim_assignment: {
    rpc: "assignment_claim",
    description:
      "Atomically claim a ready active assignment. Lease timestamp is informational only; no expiry reclaim.",
  },
  start_todo: {
    rpc: "assignment_start_todo",
    description:
      "Code-owned execution: start the first unfinished TODO using the current claim and exact item token.",
  },
  record_todo_result: {
    rpc: "assignment_record_todo_result",
    description:
      "Code-owned execution: record a completed/blocked result; blocked result also blocks the assignment atomically.",
  },
  block_assignment: {
    rpc: "assignment_block",
    description:
      "Code-owned execution: record an honest runtime blocker against the current claim.",
  },
  finish_assignment: {
    rpc: "assignment_finish",
    description:
      "Code-owned execution: complete a nonempty assignment only when all TODOs are done/cancelled, using the current claim regardless of its age.",
  },
  reactivate_assignment: {
    rpc: "assignment_reactivate",
    description:
      "Reactivate blocked work after resolving/cancelling unfinished blockers and adding remaining TODOs; invalidates the former claim.",
  },
};

export function createAssignmentHandler(rpc: Rpc): (request: Request) => Promise<Response> {
  return (request) => {
    const handler = createMcpHandler(() => {
      const server = new McpServer({ name: "battuta-assignments", version: "0.1.0" });
      for (const [key, contract] of Object.entries(toolContracts)) {
        const name = key as ToolName;
        server.registerTool(
          name,
          {
            description: operations[name].description,
            inputSchema: contract.input,
            outputSchema: contract.output,
            annotations: {
              readOnlyHint: ["list_assignments", "get_assignment", "locate_notes"].includes(name),
              destructiveHint: false,
            },
          },
          async (args: Record<string, unknown>) => {
            let result: Record<string, unknown>;
            const isNotes = name === "prepare_notes" || name === "locate_notes";
            const noteReply = (value: unknown) => {
              const output = toolContracts.prepare_notes.output.parse(value);
              return {
                structuredContent: output,
                content: [{ type: "text" as const, text: JSON.stringify(output) }],
                isError: !output.ok,
              };
            };
            const input = contract.input.safeParse(args);
            if (!input.success) {
              if (isNotes)
                return noteReply({
                  ok: false,
                  reason: "Invalid note request.",
                  nextStep: "Check the project and assignment ID and try again.",
                });
              const result = {
                ok: false,
                code: "invalid_input",
                message: input.error.issues
                  .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
                  .join("; "),
              };
              return {
                structuredContent: result,
                content: [{ type: "text" as const, text: result.message }],
                isError: true,
              };
            }
            const root = isNotes
              ? projectsRootHeader.safeParse(request.headers.get("X-Battuta-Projects-Root"))
              : undefined;
            if (root && !root.success) {
              if (isNotes)
                return noteReply({
                  ok: false,
                  reason: "Local note storage is not configured correctly.",
                  nextStep:
                    "Ask the operator to refresh the assignment MCP configuration and restart. Do not guess a storage path.",
                });
              const result = {
                ok: false,
                code: "invalid_input",
                message:
                  "Local note storage is not configured correctly. Ask the operator to refresh the bot's assignment MCP configuration and restart it. Do not guess a storage path.",
              };
              return {
                structuredContent: result,
                content: [{ type: "text" as const, text: result.message }],
                isError: true,
              };
            }
            const proposals =
              "require_abilities" in input.data
                ? input.data.require_abilities
                : "abilities" in input.data
                  ? input.data.abilities
                  : [];
            const refusal = unknownAbilities(proposals as string[]);
            if (refusal) {
              const result = contract.output.parse(refusal);
              return {
                structuredContent: result,
                content: [{ type: "text" as const, text: refusal.message }],
                isError: true,
              };
            }
            try {
              const params = Object.fromEntries(
                Object.entries(input.data).map(([field, value]) => [`p_${field}`, value]),
              );
              const { data, error } = await rpc(operations[name].rpc, params);
              if (error) throw new Error("RPC failed");
              if (isNotes && root?.success) {
                const note = resolveNotePath(data, root.data);
                if (!note.ok) {
                  return noteReply({
                    ok: false,
                    reason: note.message,
                    ...(note.code === "notes_unprepared"
                      ? { nextStep: "Call prepare_notes before accessing these notes." }
                      : {}),
                  });
                }
                return noteReply({ ok: true, nextStep: noteGuidance(note) });
              }
              result = contract.output.parse(
                root?.success ? resolveNotePath(data, root.data) : data,
              );
            } catch {
              if (isNotes)
                return noteReply({
                  ok: false,
                  reason: "The note operation could not be confirmed.",
                  nextStep: "Inspect the assignment before retrying.",
                });
              result = {
                ok: false,
                code: "backend_error",
                message:
                  "Operation could not be confirmed. Inspect the assignment before retrying any write.",
              };
            }
            return {
              structuredContent: result,
              content: [
                {
                  type: "text" as const,
                  text: result.ok === false ? String(result.message) : JSON.stringify(result),
                },
              ],
              isError: result.ok === false,
            };
          },
        );
      }
      return server;
    });
    return handler.fetch(request);
  };
}
