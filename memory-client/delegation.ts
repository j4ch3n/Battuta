import type { MessageContent } from "../agent-mail/content.ts";
import type { RequestBinding } from "./binding.ts";
import type { MemoryMcpClient } from "./mcp-client.ts";
import { memoryRefSchema } from "./records.ts";
import { prepareRecall, renderMemories } from "./recall.ts";

export async function prepareDelegation(
  binding: RequestBinding,
  content: MessageContent,
  selectedRefs: string[],
  client: Pick<MemoryMcpClient, "call">,
  signal: AbortSignal,
): Promise<MessageContent> {
  if (
    !content ||
    typeof content !== "object" ||
    !Array.isArray(content.context) ||
    !content.context.every((c) => typeof c === "string") ||
    !Array.isArray(content.references) ||
    !content.references.every(
      (r) => r && typeof r.locator === "string" && typeof r.note === "string",
    )
  )
    throw new Error("Invalid brief input");
  if (content.request === null) return content;
  const selected = [...new Set(selectedRefs)];
  if (selected.length > 10 || selected.some((ref) => !memoryRefSchema.safeParse(ref).success))
    throw new Error("Invalid memory selection");
  const none = content.context.includes("memory-context:none-relevant");
  if (!selected.length && !none)
    throw new Error("Commission needs memory selection or a none-relevant declaration");
  if (selected.length && none)
    throw new Error("Choose selected memories or a none-relevant declaration, not both");
  const original = structuredClone(content);
  const context = original.context.filter((c) => !c.startsWith("memory-context:"));
  const references = original.references.filter((r) => !r.locator.startsWith("memory:"));
  const packet = await prepareRecall(
    binding,
    `${content.summary} ${JSON.stringify(content.request)}`,
    [],
    client,
    signal,
  );
  if (packet.status === "unavailable" || (!selected.length && packet.status === "partial"))
    return {
      ...original,
      context: [
        ...context,
        "memory-context:unavailable — preparation could not verify current memory; no recalled facts are forwarded.",
      ],
      references,
    };
  if (!selected.length)
    return { ...original, context: [...context, "memory-context:none-relevant"], references };
  const now = new Date();
  const records = selected.map((ref) => packet.records.find((r) => r.ref === ref));
  if (
    records.some(
      (r) =>
        !r ||
        (r.memory_metadata?.expires_at &&
          now.getTime() >= Date.parse(r.memory_metadata.expires_at)),
    )
  )
    throw new Error("Selected memory is stale, outside scope or not verified for this task");
  const verified = records.map((r) => r!);
  if (
    verified.some((r) =>
      r.memory_metadata?.evidence.some(
        (e) => e.relation === "contradicts" && !selected.includes(e.ref),
      ),
    )
  )
    throw new Error("Select necessary counterevidence or omit its hypothesis");
  const brief = renderMemories(verified, packet.records, now, 1800);
  if (brief.truncated || selected.some((ref) => !brief.records.some((r) => r.ref === ref)))
    throw new Error("Selected memory brief exceeds budget; narrow the selection");
  for (const record of verified)
    references.push(
      original.references.find((r) => r.locator === `memory:${record.ref}`) ?? {
        locator: `memory:${record.ref}`,
        note: "Selected, revision-verified task context; ask CoS for updates.",
      },
    );
  return {
    ...original,
    context: [
      ...context,
      `memory-context:${packet.status}; project=${binding.project ?? "general"}; request=${binding.request_id}; prepared_at=${packet.prepared_at}\n${brief.content}`,
    ],
    references,
  };
}
