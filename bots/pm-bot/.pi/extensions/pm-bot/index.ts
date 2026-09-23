import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function pmBot(pi: ExtensionAPI) {
  pi.registerCommand("pm-status", {
    description: "Show the PM bot development status",
    handler: async (_args, ctx) => {
      ctx.ui.notify("PM bot extension loaded. Connect Telegram with /telegram-connect.", "info");
    },
  });
}
