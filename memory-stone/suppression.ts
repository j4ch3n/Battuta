import { createHash } from "node:crypto";
import type { RecordInput, MemoryRecord } from "./stone.ts";

// Content-free, scoped fingerprints. Keep suppression after retirement/deletion;
// only an intentional remember removes it. No ME.md linkage.
export function fingerprint(record: RecordInput | MemoryRecord): string {
  const scope = record.scope ?? "project";
  return createHash("sha256")
    .update(
      JSON.stringify([
        scope,
        scope === "global" ? null : record.project_id,
        record.kind,
        record.text.trim(),
      ]),
    )
    .digest("hex");
}
