/** The only runtime import boundary for the reviewed Stone utility modules. */
import { createJiti } from "jiti";
import type { Stone, StoneDb } from "./stone-types.ts";
export type * from "./stone-types.ts";

let utilities: Promise<Stone> | undefined;
export function loadStone(): Promise<Stone> {
  utilities ??= (async () => {
    // No factory, tool registration, vault capture, or upstream skill is loaded.
    const loader = createJiti(import.meta.url);
    // Sequential imports share Stone's database singleton. Concurrent graph
    // evaluation can instantiate it twice through .ts/.js dependency paths.
    const db = await loader.import<StoneDb>("pi-memory-stone/src/db/index.ts");
    const retrieval = await loader.import<Stone["retrieval"]>(
      "pi-memory-stone/src/retrieval/index.ts",
    );
    const privacy = await loader.import<Stone["privacy"]>("pi-memory-stone/src/privacy/index.ts");
    const parser = await loader.import<Stone["parser"]>("pi-memory-stone/src/indexing/parser.ts");
    const visibility = await loader.import<Stone["visibility"]>(
      "pi-memory-stone/src/session-state/index.ts",
    );
    return { db, retrieval, privacy, parser, visibility };
  })();
  return utilities;
}
