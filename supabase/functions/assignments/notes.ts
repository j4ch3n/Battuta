import type { NotesResult } from "./contracts.ts";

export function noteGuidance(result: NotesResult): string {
  if (!result.editable)
    return "Assignment closed: notes and drafts are frozen. Read existing files only; do not create or edit them.";
  return `Use your built-in file tools at ${JSON.stringify(result.notes_path)}. Inspect local path safety, create directories and the file only if absent, and preserve existing content. Edit findings, sources, decisions, and limits, not a tool-call diary. Drafts may live beside this file. Call locate_notes before later edits to check closure; never edit notes or drafts after closure. The server has not created or inspected any local file.`;
}
