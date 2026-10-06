import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import bridge from "../index.ts";
import { registryFixture } from "./fixtures.ts";

test.each([true, false])(
  "profile capability is explicitly configured (%s) and composable",
  async (ownerProfile) => {
    const fixture = await registryFixture();
    const agentDirectory = join(fixture.directory, "agent");
    await mkdir(agentDirectory);
    await writeFile(
      join(agentDirectory, "settings.json"),
      JSON.stringify({ battutaMemory: { ownerProfile } }),
    );
    await writeFile(
      join(agentDirectory, "ME.md"),
      "# About Human Product Owner\n\n## Life context and interests\n\nHiking.\n",
    );
    type Hook = (event: object, ctx: ExtensionContext) => Promise<unknown>;
    const hooks = new Map<string, Hook>();
    const tools: string[] = [];
    const pi = {
      registerTool: (tool: { name: string }) => tools.push(tool.name),
      registerCommand: () => undefined,
      on: (event: string, hook: Hook) => hooks.set(event, hook),
    } as unknown as ExtensionAPI;
    const ctx = {
      sessionManager: { getSessionId: () => "profile", getBranch: () => [] },
      ui: { notify: () => undefined, setStatus: () => undefined },
    } as unknown as ExtensionContext;
    try {
      await bridge(pi, {
        databasePath: join(fixture.directory, "memory.db"),
        projectsRoot: fixture.root,
        agentDirectory,
      });
      expect(tools.includes("profile_update")).toBe(ownerProfile);
      const sections: Record<string, string> = { another_extension: "Preserve me" };
      const event = {
        prompt: "hello",
        systemPrompt: "original",
        systemPromptOptions: { sections },
      };
      expect(await hooks.get("before_agent_start")!(event, ctx)).toBeUndefined();
      expect(sections.another_extension).toBe("Preserve me");
      expect(sections.battuta_memory).toContain("atlas");
      expect(sections.battuta_owner_profile?.includes("Hiking")).toBe(
        ownerProfile ? true : undefined,
      );
      if (ownerProfile) {
        await writeFile(
          join(agentDirectory, "ME.md"),
          "# About Human Product Owner\n\n## Interests\n\nCycling.\n",
        );
        await hooks.get("before_agent_start")!(event, ctx);
        expect(sections.battuta_owner_profile).toContain("Cycling");
        expect(sections.battuta_owner_profile).not.toContain("Hiking");
      }
      await writeFile(
        join(agentDirectory, "settings.json"),
        JSON.stringify({ battutaMemory: { ownerProfile: !ownerProfile } }),
      );
      await hooks.get("before_agent_start")!(event, ctx);
      expect(Boolean(sections.battuta_owner_profile)).toBe(ownerProfile);
      expect(tools.includes("profile_update")).toBe(ownerProfile);
      await hooks.get("session_shutdown")!({}, ctx);
      hooks.clear();
      tools.length = 0;
      await bridge(pi, {
        databasePath: join(fixture.directory, "memory.db"),
        projectsRoot: fixture.root,
        agentDirectory,
      });
      await hooks.get("before_agent_start")!(event, ctx);
      expect(Boolean(sections.battuta_owner_profile)).toBe(!ownerProfile);
      expect(tools.includes("profile_update")).toBe(!ownerProfile);
    } finally {
      await hooks.get("session_shutdown")!({}, ctx);
      await fixture.cleanup();
    }
  },
);
