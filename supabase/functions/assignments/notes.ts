import { z } from "zod";
import { join, relative } from "node:path/posix";
import { absolutePath, noteReferenceResult } from "./contracts.ts";

export const projectsRootHeader = z
  .string()
  .transform((value, context) => {
    try {
      return decodeURIComponent(value);
    } catch {
      context.addIssue({ code: "custom", message: "Malformed projects root encoding" });
      return z.NEVER;
    }
  })
  .pipe(absolutePath);

export function resolveNotePath(data: unknown, projectsRoot: string) {
  const result = noteReferenceResult.parse(data);
  if (!result.ok) return result;
  const { notes_ref, ...rest } = result;
  const notes_path = notes_ref === null ? null : join(projectsRoot, notes_ref);
  if (notes_path !== null && relative(projectsRoot, notes_path) !== notes_ref) {
    throw new Error("Note path must remain under the caller's projects root");
  }
  return { ...rest, notes_path };
}

export function noteGuidance(result: { editable: boolean; notes_path: string | null }): string {
  if (!result.editable) {
    return result.notes_path === null
      ? "No note location is available. The assignment is closed; notes and drafts are read-only and must not be created or edited."
      : `The assignment is closed. Read existing notes at ${result.notes_path} only; notes and drafts are read-only and must not be created or edited.`;
  }
  return `Read or edit notes at ${result.notes_path}. The path does not prove the file exists; inspect path safety, create only missing directories/files, and preserve existing content. Call locate_notes before later edits. Include complete handoff findings in the execution result and report inaccessible required inputs.`;
}
