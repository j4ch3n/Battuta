import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { toolContracts, type ToolName, type NotesResult } from "./contracts.ts";
import { noteGuidance } from "./notes.ts";

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
      "Prepare a shared note path under an absolute local Battuta root, normally ~/.battuta after local expansion. Returns instructions, not a filesystem write.",
  },
  locate_notes: {
    rpc: "assignment_locate_notes",
    description:
      "Get the shared local note path before editing; closed assignments return frozen/read-only guidance.",
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
          const input = contract.input.safeParse(args);
          if (!input.success) {
            const result = {
              ok: false,
              code: "invalid_input",
              message: input.error.issues
                .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
                .join("; "),
            };
            return {
              structuredContent: result,
              content: [{ type: "text" as const, text: JSON.stringify(result) }],
              isError: true,
            };
          }
          try {
            const params = Object.fromEntries(
              Object.entries(input.data).map(([field, value]) => [`p_${field}`, value]),
            );
            const { data, error } = await rpc(operations[name].rpc, params);
            if (error) throw new Error("RPC failed");
            result = contract.output.parse(data);
            if (result.ok && (name === "prepare_notes" || name === "locate_notes")) {
              result = { ...result, guidance: noteGuidance(result as NotesResult) };
            }
          } catch {
            result = {
              ok: false,
              code: "backend_error",
              message:
                "Operation could not be confirmed. Inspect the assignment before retrying any write.",
            };
          }
          return {
            structuredContent: result,
            content: [{ type: "text" as const, text: JSON.stringify(result) }],
            isError: result.ok === false,
          };
        },
      );
    }
    return server;
  });
  return (request) => handler.fetch(request);
}
