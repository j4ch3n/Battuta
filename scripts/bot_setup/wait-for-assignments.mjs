import { setTimeout } from "node:timers/promises";
import { pathToFileURL } from "node:url";

export async function waitForAssignments(url, secretKey, attempts) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(new URL("/functions/v1/assignments", url), {
        headers: { apikey: secretKey },
        signal: AbortSignal.timeout(2000),
      });
      await response.arrayBuffer();
      // The authenticated MCP route rejects GET without claiming or running work.
      if (response.status === 405) return;
    } catch {
      // The local functions runtime may still be starting.
    }
    if (attempt + 1 < attempts) await setTimeout(1000);
  }
  throw new Error("Assignments did not become ready; inspect the services window.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await waitForAssignments(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, 30).catch(
    (error) => {
      console.error(error.message);
      process.exitCode = 1;
    },
  );
}
