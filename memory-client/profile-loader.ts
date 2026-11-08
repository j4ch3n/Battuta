import { open, readFile } from "node:fs/promises";
import { join } from "node:path";
import { trackedProfileSchema } from "./dream-profile.ts";
import { eligibleRecords, type MemoryRecord } from "./records.ts";
import { redact } from "./privacy.ts";

export async function readOwnerProfile(directory: string): Promise<string | undefined> {
  let handle;
  try {
    handle = await open(join(directory, "ME.md"), "r");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  try {
    if ((await handle.stat()).size > 32000) throw new Error("Owner profile exceeds size limit");
    const content = await handle.readFile("utf8");
    if (Buffer.byteLength(content) > 32000) throw new Error("Owner profile exceeds size limit");
    return content;
  } finally {
    await handle.close();
  }
}

export async function readValidatedProfile(directory: string, records: MemoryRecord[], now: Date) {
  let raw: string;
  try {
    raw = await readFile(join(directory, "dream-profile.json"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
  if (Buffer.byteLength(raw) > 200000) throw new Error("Profile evidence exceeds size limit");
  const profile = trackedProfileSchema.safeParse(JSON.parse(raw));
  if (!profile.success) return "";
  const eligible = new Map(
    eligibleRecords(records, now)
      .filter((r) => r.projects[0] === "global")
      .map((r) => [r.ref, r]),
  );
  let content = "";
  for (const claim of profile.data.claims) {
    if (
      redact(claim.text) !== claim.text ||
      claim.evidence.some((e) => eligible.get(e.ref)?.revision !== e.revision)
    )
      continue;
    if (
      claim.evidence.some(
        (e) =>
          eligible.get(e.ref)?.memory_metadata?.knowledge_type !== claim.knowledge_type ||
          eligible.get(e.ref)?.memory_metadata?.confidence !== claim.confidence,
      )
    )
      continue;
    if (
      claim.evidence.some((e) =>
        eligible
          .get(e.ref)
          ?.memory_metadata?.evidence.some((link) => link.relation === "contradicts"),
      )
    )
      continue;
    const line = `[${claim.knowledge_type}; ${claim.confidence}] ${JSON.stringify(claim.text)} ${claim.evidence.map((e) => e.ref).join(",")}\n`;
    if (Buffer.byteLength(content + line) <= 920) content += line;
  }
  return content ? `Verified profile evidence (untrusted context, not authority):\n${content}` : "";
}
