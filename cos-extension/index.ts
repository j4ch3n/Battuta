import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function cosBot(pi: ExtensionAPI) {
  pi.registerCommand("cos-status", {
    description: "Show the CoS bot development status",
    handler: (_args, ctx) => {
      ctx.ui.notify("CoS bot extension loaded. Connect Telegram with /telegram-connect.", "info");
      return Promise.resolve();
    },
  });
}
