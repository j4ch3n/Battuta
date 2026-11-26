import { z } from "zod";
import type { MemoryApi } from "./mcp-client.ts";
import { redact } from "./privacy.ts";

const profileSchema = z.union([
  z.object({ status: z.literal("ok"), body: z.string() }),
  z.object({ status: z.literal("not_written") }),
]);
const descriptionsSchema = z.object({ descriptions: z.record(z.string(), z.string().nullable()) });

export const PROJECT_HINT =
  "If a project is mentioned that isn't listed here, look it up before assuming it doesn't exist.";

/** The runtime owner card: the global overview plus a cached project list. Never throws. */
export async function ownerCard(
  client: MemoryApi,
  projects: readonly string[],
  signal: AbortSignal,
): Promise<string> {
  const listed = projects.filter((name) => name !== "global");
  try {
    const profile = profileSchema.parse(await client.call("memory_profile", {}, signal));
    const { descriptions } = descriptionsSchema.parse(
      await client.call("memory_project_descriptions", { projects: listed }, signal),
    );
    const owner =
      profile.status === "ok" && profile.body.trim()
        ? profile.body.trim()
        : "No owner profile yet.";
    const lines = listed.map(
      (name) => `- ${name} — ${descriptions[name] ?? "(no description yet)"}`,
    );
    return redact(
      [
        "# Owner",
        owner,
        "",
        "## Projects",
        ...(lines.length ? lines : ["- (none yet)"]),
        PROJECT_HINT,
      ].join("\n"),
    );
  } catch {
    return `Owner profile unavailable: memory query failed. Projects: ${listed.join(", ") || "(unknown)"}. ${PROJECT_HINT}`;
  }
}
