import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { z } from "zod";

const requestBindingSchema = z
  .object({
    request_id: z.string().trim().min(1).max(200),
    conversation_id: z.string().trim().min(1).max(200),
    session_id: z.string().trim().min(1).max(200),
    project: z
      .string()
      .regex(/^[a-z0-9][a-z0-9_-]{0,63}$/)
      .nullable(),
    origin: z.enum(["owner", "mail", "internal"]),
    admitted_at: z.string().datetime({ offset: true }),
  })
  .strict();
export type RequestBinding = z.infer<typeof requestBindingSchema>;

async function real(path: string, directory = false) {
  const s = await lstat(path);
  if (s.isSymbolicLink() || (directory ? !s.isDirectory() : !s.isFile()))
    throw new Error("Invalid project registration");
}
export async function resolveRequestBinding(value: unknown, root: string): Promise<RequestBinding> {
  const binding = requestBindingSchema.parse(value);
  const name = binding.project;
  if (name === null) return binding;
  await real(root, true);
  const folder = join(root, name);
  const config = join(folder, "project.yaml");
  await real(folder, true);
  await real(config);
  await real(join(folder, "code"), true);
  const p = parse(await readFile(config, "utf8")) as {
    version?: unknown;
    project?: { name?: unknown; path?: unknown };
  };
  if (p.version !== 1 || p.project?.name !== name || p.project.path !== join(folder, "code"))
    throw new Error("Invalid project registration");
  return binding;
}
