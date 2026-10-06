import type { MemoryRecord, RecordKind, Scope, Stone } from "./stone.ts";

/** Filter scope/status in SQL before limiting FTS candidates. Stone's generic
 * retrieve helper post-filters scopes, which can starve a requested scope. */
export function searchScope(
  stone: Stone,
  projectId: string | null,
  query: string,
  scope: Scope,
  limit: number,
  kind?: RecordKind,
) {
  const terms = stone.db.buildFtsQuery(query);
  if (!terms) return [];
  const rows = stone.db
    .getDb()
    .prepare(
      `
    SELECT r.*, fts.rank AS rank FROM record_fts fts
    JOIN records r ON r.rowid = fts.rowid
    WHERE record_fts MATCH ? AND r.status = 'active'
      AND r.scope = ? AND r.project_id IS ?
      AND (? IS NULL OR r.kind = ?)
    ORDER BY rank LIMIT ?
  `,
    )
    .all(
      terms,
      scope,
      projectId,
      kind ?? null,
      kind ?? null,
      Math.min(200, limit * 10),
    ) as unknown as (MemoryRecord & { rank: number })[];
  // FTS5's negative BM25 values are not reciprocal-rank inputs. Supply ordinal
  // ranks to Stone's existing project/kind/recency/importance weighting.
  return stone.retrieval
    .rankAndFilter(
      rows.map((row, rank) => ({ ...row, rank })),
      projectId,
      scope === "global",
    )
    .slice(0, limit);
}
