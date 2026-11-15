import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { listInput, listOutput, downloadInput, downloadOutput } from "./contracts.ts";
import type { createFileOperations } from "./files.ts";

async function hasFileContentType(request: Request): Promise<boolean> {
  const contentType = request.headers.get("content-type") ?? "";
  const boundary = /(?:^|;)\s*boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  const value = boundary?.[1] ?? boundary?.[2];
  if (!value || value.length > 70) return false;
  const bytes = new Uint8Array(await request.clone().arrayBuffer());
  const marker = new TextEncoder().encode(`--${value}`);
  const separator = new Uint8Array([13, 10, 13, 10]);
  const find = (needle: Uint8Array, from: number) => {
    for (let i = from; i <= bytes.length - needle.length; i++) {
      if (needle.every((byte, index) => bytes[i + index] === byte)) return i;
    }
    return -1;
  };
  let start = find(marker, 0);
  while (start !== -1) {
    const headersStart = start + marker.length + 2;
    const headersEnd = find(separator, headersStart);
    if (headersEnd < 0) break;
    const headers = new TextDecoder().decode(bytes.subarray(headersStart, headersEnd));
    if (/^content-disposition:\s*form-data\s*;[^\r\n]*\bname="file"/im.test(headers)) {
      return /^content-type:\s*\S[^\r\n]*$/im.test(headers);
    }
    start = find(marker, headersEnd + separator.length);
  }
  return false;
}

export function publicDownloadUrl(request: Request, signedUrl: string): string {
  const host = request.headers.get("x-forwarded-host") ?? "";
  const port = request.headers.get("x-forwarded-port") ?? "";
  const proto = request.headers.get("x-forwarded-proto") ?? "";
  if (
    !/^[a-z0-9.-]+$/i.test(host) ||
    !/^\d{1,5}$/.test(port) ||
    !["http", "https"].includes(proto) ||
    (proto === "http" && !["localhost", "127.0.0.1"].includes(host))
  )
    throw new Error("Invalid gateway origin");
  const url = new URL(signedUrl);
  url.protocol = `${proto}:`;
  url.hostname = host;
  url.port = port;
  return url.toString();
}

export function createFileHandler(
  operations: ReturnType<typeof createFileOperations>,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const path = new URL(request.url).pathname.replace(/\/$/, "");
    if (path.endsWith("/upload")) {
      if (request.method !== "POST")
        return Response.json({ reason: "Use POST to upload a file." }, { status: 405 });
      if (!request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data;"))
        return Response.json({ reason: "Expected multipart form data." }, { status: 400 });
      try {
        if (!(await hasFileContentType(request)))
          return Response.json(
            { reason: "The file part must include a MIME Content-Type." },
            { status: 400 },
          );
        const form = await request.formData();
        const ids = form.getAll("assignmentId");
        const files = form.getAll("file");
        if (
          ids.length !== 1 ||
          typeof ids[0] !== "string" ||
          files.length !== 1 ||
          !(files[0] instanceof File) ||
          [...form.keys()].some((key) => !["assignmentId", "file"].includes(key))
        ) {
          return Response.json(
            { reason: "Provide one assignmentId and one file." },
            { status: 400 },
          );
        }
        const result = await operations.upload(ids[0], files[0]);
        if ("reason" in result) {
          const status = result.reason.includes("smaller")
            ? 413
            : result.reason.includes("not found")
              ? 404
              : result.reason.startsWith("Unable")
                ? 500
                : 400;
          return Response.json(result, { status });
        }
        return Response.json(result);
      } catch {
        return Response.json({ reason: "Invalid multipart upload." }, { status: 400 });
      }
    }
    if (!path.endsWith("/assignment-files"))
      return Response.json({ reason: "Not found." }, { status: 404 });
    const handler = createMcpHandler(() => {
      const server = new McpServer({ name: "assignment-files", version: "0.1.0" });
      server.registerTool(
        "list_assignment_files",
        {
          description: "List an assignment's remote files, optionally by type.",
          inputSchema: listInput,
          outputSchema: listOutput,
          annotations: { readOnlyHint: true, destructiveHint: false },
        },
        async (args) => {
          const result = await operations.list(args);
          return {
            structuredContent: result,
            content: [{ type: "text" as const, text: JSON.stringify(result) }],
            isError: "reason" in result,
          };
        },
      );
      server.registerTool(
        "download_assignment_file",
        {
          description: "Create a temporary download link for an assignment file.",
          inputSchema: downloadInput,
          outputSchema: downloadOutput,
          annotations: { readOnlyHint: true, destructiveHint: false },
        },
        async (args) => {
          let result = await operations.download(args);
          if ("downloadUrl" in result) {
            try {
              result = { ...result, downloadUrl: publicDownloadUrl(request, result.downloadUrl) };
            } catch {
              result = { reason: "Unable to create a download link. Contact the operator." };
            }
          }
          return {
            structuredContent: result,
            content: [{ type: "text" as const, text: JSON.stringify(result) }],
            isError: "reason" in result,
          };
        },
      );
      return server;
    });
    return handler.fetch(request);
  };
}
