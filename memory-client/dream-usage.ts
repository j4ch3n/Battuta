import { chmod, mkdir, open } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

const count = z.number().finite().nonnegative().optional();
const usageSchema = z.object({
  input: count,
  output: count,
  cacheRead: count,
  cacheWrite: count,
  totalTokens: count,
  cost: z
    .object({ input: count, output: count, cacheRead: count, cacheWrite: count, total: count })
    .optional(),
});

// Children have no durable session journal. Retain only known numeric usage
// fields, never provider metadata, evidence, prompts, or generated text.
export async function recordDreamUsage(directory: string, usage: unknown) {
  const safe = usageSchema.parse(usage);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const file = await open(join(directory, "dream-usage.jsonl"), "a", 0o600);
  try {
    await file.chmod(0o600);
    await file.writeFile(
      JSON.stringify({ timestamp: new Date().toISOString(), usage: safe }) + "\n",
    );
    await file.sync();
  } finally {
    await file.close();
  }
  return safe;
}
