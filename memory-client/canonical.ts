import { createHash } from "node:crypto";

export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
    .join(",")}}`;
}
export const digest = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex");

export const normalizedProjects = (projects: readonly string[]) =>
  [...new Set(projects.map((p) => p.toLowerCase()))].sort((a, b) =>
    Buffer.compare(Buffer.from(a), Buffer.from(b)),
  );

export function capturePayloadDigest(payload: Record<string, unknown>): string {
  const items = (payload.items as Record<string, unknown>[]).map((item) => {
    if (!Array.isArray(item.projects)) return item;
    const { projects: names, ...rest } = item;
    const projects = normalizedProjects(names as string[]);
    return {
      ...rest,
      scope: {
        global: projects.length === 1 && projects[0] === "global",
        projects: projects[0] === "global" ? [] : projects,
      },
    };
  });
  return digest({ ...payload, items });
}
