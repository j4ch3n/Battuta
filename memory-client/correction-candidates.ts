import { z } from "zod";
import { abortable } from "./abortable.ts";
import type { MemoryMcpClient } from "./mcp-client.ts";
import { memoryRecordSchema } from "./records.ts";
import { normalizedProjects } from "./projects.ts";

export function boundedQuery(text: string, bytes = 256) {
  let result = "";
  for (const character of text.trim()) {
    if (Buffer.byteLength(result + character) > bytes) break;
    result += character;
  }
  return result;
}
export async function prepareCorrectionCandidates(
  projects: readonly string[],
  text: string,
  client: Pick<MemoryMcpClient, "call">,
  signal: AbortSignal,
) {
  const query = boundedQuery(text);
  if (!query) return [];
  const names = projects.filter((p) => p !== "global");
  const catalog = new Set(normalizedProjects(projects));
  const result = z
    .object({
      records: z.array(memoryRecordSchema).max(20),
      validation_evidence: z.array(memoryRecordSchema).optional(),
    })
    .parse(
      await abortable(
        client.call(
          "memory_recall",
          {
            semantic_query: query,
            selector: names.length ? "projects" : "global",
            projects: names,
            include_global: true,
            include_expired: true,
            limit: 20,
          },
          signal,
        ),
        signal,
      ),
    );
  return [
    ...new Map(
      [...result.records, ...(result.validation_evidence ?? [])]
        .filter((r) => r.projects.every((p) => catalog.has(p)))
        .map((r) => [r.ref, r]),
    ).values(),
  ].slice(0, 40);
}
