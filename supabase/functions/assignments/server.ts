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
      "Commission work for an explicit registered project; at most one active assignment per project. Inspect before repeating an uncertain write.",
  },
  list_assignments: {
    rpc: "assignment_list",
    description: "List active or historical assignments for an explicit project, newest first.",
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
      "Edit any item in place using its position and unchanged expected_updated_at token. Inspect and reconcile stale conflicts.",
  },
  close_assignment: {
    rpc: "assignment_close",
    description:
      "Finish only when every TODO is done/cancelled, or cancel without changing item outcomes. Does not send Agent Mail or grant product acceptance.",
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
          try {
            const parsed = contract.input.parse(args);
            const params = Object.fromEntries(
              Object.entries(parsed).map(([field, value]) => [`p_${field}`, value]),
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
