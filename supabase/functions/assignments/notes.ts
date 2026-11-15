import type { NotesResult } from "./contracts.ts";

export function noteGuidance(result: NotesResult): string {
  if (!result.editable)
    return "Assignment closed: notes and drafts are frozen. Read existing files only; do not create or edit them.";
  return `Resolve the relative notes_ref ${JSON.stringify(result.notes_ref)} under your own local ~/.battuta root, with home expanded. Never use assignment.notes_path as a local write target; it may belong to another host. Worker code prepares the local assignment workspace before execution; other callers must inspect path safety, create only missing directories/files, and preserve existing content. Edit findings, sources, decisions, and limits, not a tool-call diary. Drafts may live beside the local note. Local notes are not synchronized: put complete handoff results in TODO outcomes and evidence. Call locate_notes before later edits and never edit after closure. The server has not created or inspected any local file.`;
}
