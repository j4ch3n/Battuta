import { z } from "zod";

const object = z.record(z.string(), z.unknown());
const oldScope = z
  .object({ global: z.boolean(), projects: z.array(z.string()).default([]) })
  .strict()
  .refine((scope) => (scope.global ? scope.projects.length === 0 : scope.projects.length > 0));

export function normalizePersistedRecord(value: unknown): Record<string, unknown> {
  const record = object.parse(value);
  if (!("scope" in record)) return { ...record };
  if ("projects" in record) throw new Error("Ambiguous persisted membership");
  const { scope: raw, ...rest } = record;
  const scope = oldScope.parse(raw);
  return { ...rest, projects: scope.global ? ["global"] : [...scope.projects].sort() };
}

export function normalizePersistedRequest(request: {
  name: string;
  args: Record<string, unknown>;
  catalog?: string[];
}) {
  return {
    ...request,
    args:
      request.name === "memory_remember"
        ? normalizePersistedRecord(request.args)
        : { ...request.args },
  };
}

export function normalizePersistedCapture(batch: Record<string, unknown>) {
  const items = z.array(object).parse(batch.items).map(normalizePersistedRecord);
  return { ...batch, items };
}

export function normalizePersistedCheckpoint(value: unknown): Record<string, unknown> {
  const state = object.parse(value);
  const rawRecords = z.array(object).parse(state.records);
  const legacyRecords = rawRecords.some((r) => "scope" in r);
  const records = rawRecords.map(normalizePersistedRecord);
  const result: Record<string, unknown> = { ...state, records };
  if (legacyRecords && (state.version === 1 || state.version === 2))
    result.project_catalog = [
      ...new Set(records.flatMap((r) => z.array(z.string()).parse(r.projects))),
    ].sort();
  if (state.requests) {
    result.requests = Object.fromEntries(
      Object.entries(object.parse(state.requests)).map(([id, raw]) => {
        const request = z
          .object({ name: z.string(), args: object, catalog: z.array(z.string()).optional() })
          .parse(raw);
        const normalized = normalizePersistedRequest(request);
        if (request.name === "memory_remember" && "scope" in request.args)
          normalized.catalog = z.array(z.string()).parse(normalized.args.projects);
        return [id, normalized];
      }),
    );
  }
  return result;
}
