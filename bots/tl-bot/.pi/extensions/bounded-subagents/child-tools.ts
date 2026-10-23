import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { scopedPath, type Profile } from "./policy.ts";

export interface ToolGrant {
  profile: Profile;
  inputs: string[];
  writable: string[];
}
export function registerScopedTools(pi: ExtensionAPI, root: string, grant: ToolGrant) {
  const selected = [
    "bounded_files",
    "bounded_read",
    ...(grant.profile === "worker" ? ["bounded_write"] : []),
  ];
  pi.on("session_start", () => {
    pi.setActiveTools(selected);
  });
  pi.on("tool_call", (event) => {
    if (!selected.includes(event.toolName))
      return { block: true, reason: "Tool is not granted to this child" };
  });
  const readable = [
    ...new Set([...grant.inputs, ...(grant.profile === "worker" ? grant.writable : [])]),
  ];
  const result = (text: string) => ({ content: [{ type: "text" as const, text }], details: {} });
  pi.registerTool({
    name: "bounded_files",
    label: "Granted files",
    description: "List the exact files granted to this task.",
    parameters: Type.Object({}),
    execute() {
      return Promise.resolve(
        result(
          JSON.stringify({ readable, writable: grant.profile === "worker" ? grant.writable : [] }),
        ),
      );
    },
  });
  pi.registerTool({
    name: "bounded_read",
    label: "Read granted file",
    description: "Read a granted snapshot file, not the original repository.",
    parameters: Type.Object({ path: Type.String() }),
    execute(_id, args) {
      const path = scopedPath(root, args.path, readable);
      const data = readFileSync(path);
      if (data.length > 262144) throw new Error("File size limit exceeded");
      return Promise.resolve(result(data.toString("utf8")));
    },
  });
  if (grant.profile === "worker")
    pi.registerTool({
      name: "bounded_write",
      label: "Write granted file",
      description:
        "Replace a writable file only in this disposable snapshot. TL must verify and apply changes separately.",
      parameters: Type.Object({ path: Type.String(), content: Type.String({ maxLength: 262144 }) }),
      execute(_id, args) {
        if (Buffer.byteLength(args.content) > 262144) throw new Error("File size limit exceeded");
        const path = scopedPath(root, args.path, grant.writable);
        mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
        writeFileSync(path, args.content, { mode: 0o600 });
        return Promise.resolve(result(`Snapshot updated: ${args.path}`));
      },
    });
}
export default function (pi: ExtensionAPI) {
  // This file is loaded explicitly by upstream only inside the private child.
  const grant = JSON.parse(
    readFileSync(join(process.env.PI_CODING_AGENT_DIR!, "grant.json"), "utf8"),
  ) as ToolGrant;
  registerScopedTools(pi, process.cwd(), grant);
}
