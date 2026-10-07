import { createServer } from "node:http";
import { once } from "node:events";
import { writeFile } from "node:fs/promises";
import type {
  SessionInfo,
  SessionMessageInfo,
  SessionInboxInfo,
  JsonValue,
} from "@opencode/client";
import type { TerminalReport } from "../../../supabase/functions/_shared/task-contracts.ts";

/** Test-owned V2 2.0.24 HTTP boundary; no model, tools, or service lifecycle. */
export async function fakeOpenCode(serviceFile: string, report: TerminalReport) {
  const sessions = new Map<string, SessionInfo>();
  const prompts = new Map<string, Extract<SessionInboxInfo, { type: "user" }>>();
  const requests: { method: string; path: string; body: unknown }[] = [];
  const authorization = `Basic ${Buffer.from("opencode:test-only").toString("base64")}`;
  const server = createServer((request, response) => {
    void (async () => {
      if (request.headers.authorization !== authorization) {
        response.writeHead(401).end();
        return;
      }
      let text = "";
      for await (const chunk of request) text += String(chunk);
      const body: unknown = text ? JSON.parse(text) : undefined;
      const url = new URL(request.url!, "http://fixture");
      const path = url.pathname;
      requests.push({ method: request.method!, path: path + url.search, body });
      const sessionID = path.split("/")[3];
      let value: unknown;
      if (path === "/api/info")
        value = { version: "2.0.24", pid: process.pid, urls: [], paths: {} };
      else if (path === "/api/event") {
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.write('data: {"type":"server.connected"}\n\n');
        return;
      } else if (path === "/api/config") value = [];
      else if (path === "/api/session/active") value = { data: {} };
      else if (path === "/api/session" && request.method === "POST") {
        const input = body as Pick<
          SessionInfo,
          "agent" | "model" | "location" | "metadata" | "permissions"
        >;
        const session: SessionInfo = {
          ...input,
          id: `ses_fixture${sessions.size + 1}`,
          projectID: "proj_fixture",
          agent: "build",
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: 1, updated: 1 },
        };
        sessions.set(session.id, session);
        value = { data: session };
      } else if (path === "/api/session") value = { data: [...sessions.values()], cursor: {} };
      else if (sessions.has(sessionID)) {
        const prompt = prompts.get(sessionID);
        const operation = path.split("/")[4];
        if (!operation) value = { data: sessions.get(sessionID) };
        else if (["permission", "form", "inbox"].includes(operation)) value = { data: [] };
        else if (operation === "message") {
          const data: SessionMessageInfo[] = prompt
            ? [
                {
                  id: prompt.id,
                  type: "user",
                  time: { created: 10 },
                  text: prompt.payload.text,
                  metadata: prompt.payload.metadata,
                },
                {
                  id: `msg_result${sessionID}`,
                  type: "assistant",
                  time: { created: 20, completed: 21 },
                  agent: "build",
                  model: { id: "fake", providerID: "fake" },
                  content: [
                    {
                      type: "text",
                      text: `\`\`\`battuta-result\n${JSON.stringify(report)}\n\`\`\``,
                    },
                  ],
                  finish: "stop",
                },
              ]
            : [];
          value = { data, cursor: {} };
        } else if (operation === "prompt" && request.method === "POST") {
          const input = body as {
            id: string;
            text: string;
            metadata: Record<string, JsonValue>;
            delivery: "queue";
            resume: boolean;
          };
          const admitted: Extract<SessionInboxInfo, { type: "user" }> = {
            id: input.id,
            sessionID,
            type: "user",
            time: { created: 10 },
            payload: { text: input.text, metadata: input.metadata },
            delivery: input.delivery,
          };
          prompts.set(sessionID, admitted);
          value = { data: admitted };
        }
      }
      if (value === undefined) {
        response.writeHead(404).end("unsupported fixture route");
        return;
      }
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(value));
    })().catch(() => response.writeHead(500).end("fixture error"));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture port");
  const url = `http://127.0.0.1:${address.port}`;
  await writeFile(
    serviceFile,
    JSON.stringify({ url, pid: process.pid, version: "2.0.24", password: "test-only" }),
  );
  return {
    sessions,
    prompts,
    requests,
    url,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
