import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { Type } from "typebox";
import { loadStone } from "../stone.ts";
import { requireSafeMemory } from "../privacy.ts";
import { handle, result } from "../tools/common.ts";
import { OwnerProfile } from "./storage.ts";

const resource = (name: string) =>
  new URL(`../../shared-skills/memory/references/${name}`, import.meta.url);

export function registerProfileTools(pi: ExtensionAPI, profile: OwnerProfile) {
  pi.registerTool({
    name: "profile_read",
    label: "Read owner profile",
    description:
      "Read PM's high-level owner profile in ME.md and its revision. Report a missing profile without creating it. Does not read detailed memory.",
    parameters: Type.Object({}),
    execute: async () =>
      handle(async () => {
        const current = await profile.read();
        return result(current.exists ? current.content : "No owner profile exists yet.", current);
      }),
  });
  pi.registerTool({
    name: "profile_update",
    label: "Update owner profile",
    description:
      "Remember, correct, or remove confirmed high-level personal understanding in PM's ME.md using owner evidence and labelled interpretation. Does not change detailed memory; project-specific facts do not belong in the owner profile.",
    parameters: Type.Object({
      message: Type.String({ minLength: 1, maxLength: 16000 }),
      interpretation: Type.String({ maxLength: 8000 }),
      operation: Type.Union(
        ["remember", "correct", "retire", "delete"].map((value) => Type.Literal(value)),
      ),
      expectedRevision: Type.String(),
    }),
    execute: async (_id, params, signal, _update, ctx) =>
      handle(async () => {
        signal?.throwIfAborted();
        if (!ctx.model) throw new Error("No configured model is available for profile rewriting");
        const current = await profile.read();
        if (current.revision !== params.expectedRevision)
          throw new Error("Owner profile revision changed; read again");
        const stone = await loadStone();
        const safe = (text: string) => requireSafeMemory(stone, text);
        safe(params.message);
        safe(params.interpretation);
        const template = await readFile(resource("ME.template.md"), "utf8");
        const existingDocument = current.exists ? current.content : template;
        safe(existingDocument);
        const response = await ctx.modelRegistry.complete(
          ctx.model,
          {
            systemPrompt: `${await readFile(resource("profile-rewrite-prompt.md"), "utf8")}\n## Canonical owner profile template\n\n${template}`,
            messages: [
              {
                role: "user",
                content: JSON.stringify({
                  existingDocument,
                  ownerMessage: params.message,
                  interpretation: params.interpretation,
                  operation: params.operation,
                }),
                timestamp: Date.now(),
              },
            ],
          },
          { signal },
        );
        signal?.throwIfAborted();
        if (response.stopReason !== "stop")
          throw new Error(`Profile completion did not finish: ${response.stopReason}`);
        const content = response.content
          .map((part) => (part.type === "text" ? part.text : ""))
          .join("");
        safe(content);
        const saved = await profile.write(content, current.revision, signal);
        return result(
          "Updated high-level ME.md. SQLite is unchanged. The next request loads this profile.",
          {
            store: "ME.md",
            updated: true,
            path: saved.path,
            revision: saved.revision,
            usage: response.usage,
          },
        );
      }),
  });
}
