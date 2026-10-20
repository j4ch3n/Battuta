import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { clientConfig } from "./config.ts";
import { profilePrompt } from "./profile-loader.ts";

export default function memoryClient(pi: ExtensionAPI) {
  pi.on("before_agent_start", async (event, ctx) => {
    try {
      const config = clientConfig();
      const profile = await profilePrompt(config.role, config.directory);
      if (profile) return { systemPrompt: `${event.systemPrompt}\n\n${profile}` };
    } catch {
      ctx.ui.notify("Owner profile unavailable; continuing without it", "warning");
    }
  });
}
