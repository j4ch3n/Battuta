import { z } from "zod";
import { join, relative } from "node:path/posix";
import { absolutePath, noteReferenceResult, type NotesResult } from "./contracts.ts";

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

export function noteGuidance(result: NotesResult): string {
  if (!result.editable)
    return "Assignment closed: notes and drafts are frozen. Read existing files only; do not create or edit them.";
  return `Read or edit the returned notes_path ${JSON.stringify(result.notes_path)} directly. A returned path does not prove the file exists; inspect path safety, create only missing directories/files, and preserve existing content. Record findings, sources, decisions, and limits. Drafts may live beside the note. Call locate_notes before later edits and write only while editable is true. Local files are not synchronized; include complete handoff findings in the execution result and report inaccessible required inputs.`;
}
