import { AssignmentRefusalError } from "./client.ts";
import type { Claim } from "./types.ts";

export interface Heartbeat {
  start(claim: Claim): void;
  stop(): void;
}

/**
 * Renews the bound claim's lease every interval while the worker process is alive. The database chooses the
 * lease length; a refused renewal means the claim is lost, while a failed call is retried on the next tick.
 */
export function createHeartbeat(options: {
  renew: (claim: Claim) => Promise<unknown>;
  intervalMs: number;
  onLost: (reason: string) => void;
  diagnostics: (event: string, error?: unknown) => void;
}): Heartbeat {
  let timer: ReturnType<typeof setInterval> | undefined;
  let generation = 0;
  let renewing = false;
  const stop = () => {
    if (timer) clearInterval(timer);
    timer = undefined;
    generation++;
  };
  return {
    start(claim) {
      stop();
      const current = generation;
      timer = setInterval(() => {
        if (renewing) return;
        renewing = true;
        options
          .renew(claim)
          .catch((error: unknown) => {
            if (current !== generation) return;
            if (error instanceof AssignmentRefusalError) {
              stop();
              options.onLost(`Lease renewal refused: ${error.message}`);
            } else options.diagnostics("Lease renewal failed; retrying on the next tick", error);
          })
          .finally(() => (renewing = false));
      }, options.intervalMs);
    },
    stop,
  };
}
