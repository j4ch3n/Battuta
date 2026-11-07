import { z } from "zod";
import { abortable } from "./abortable.ts";
import type { MemoryMcpClient } from "./mcp-client.ts";
import { inRequestScope, memoryRecordSchema } from "./records.ts";

export function boundedQuery(text: string, bytes = 256) {
  let result = "";
  for (const character of text.trim()) {
    if (Buffer.byteLength(result + character) > bytes) break;
    result += character;
  }
  return result;
}
export async function prepareCorrectionCandidates(project: string | null,text: string,
  client: Pick<MemoryMcpClient,"call">,signal:AbortSignal) {
  const query=boundedQuery(text);
  if (!query) return [];
  const result=z.object({records:z.array(memoryRecordSchema).max(20),validation_evidence:z.array(memoryRecordSchema).optional()}).parse(
    await abortable(client.call("memory_recall",{semantic_query:query,
      selector:project ? "projects":"global",projects:project ? [project]:[],include_global:true,include_expired:true,limit:20},signal),signal));
  return [...new Map([...result.records,...(result.validation_evidence??[])].filter(r=>inRequestScope(r,project)).map(r=>[r.ref,r])).values()];
}
