import { validateReport } from "../supabase/functions/_shared/task-contracts.ts";
import type {
  TaskInstruction,
  TaskRow,
  TerminalReport,
} from "../supabase/functions/_shared/task-contracts.ts";

export function buildPrompt(task: TaskRow): string {
  return `Execute only the following delegated instruction in this task's isolated worktree.
Do not look up or update Linear. The optional ticket is traceability only.
Preserve user work. Do not push, deploy, cancel other work, or change shared services.
If context is missing, use the native question tool/form and wait for the human; never fabricate answers.
Return your terminal report only in the final assistant text, in exactly one fenced battuta-result JSON block.
The report has schema_version: 1, state: completed | failed, summary, checks: [{criterion_id, result: passed | failed | not_verified, evidence: [{locator, description}]}], artifacts: [{locator, description}], failure: string | null.
Completed requires every acceptance criterion exactly once, passed with meaningful evidence, and failure null. Failed requires an honest nonempty failure. Runtime success without a report is not completion.
Instruction (exact JSON):
${JSON.stringify(task.instruction, null, 2)}`;
}
export function parseReport(text: string, instruction: TaskInstruction): TerminalReport {
  // Recognize fences only at the start of unquoted lines, and never inside another fence.
  let fence: string | undefined;
  let body: string[] = [];
  const reports: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (fence === undefined) {
      const opening = /^(`{3,}|~{3,})([^`~]*)$/.exec(line);
      if (opening) {
        fence = opening[1];
        body = [opening[2].trim()];
      }
    } else if (line === fence) {
      if (body[0] === "battuta-result" && fence.startsWith("`"))
        reports.push(body.slice(1).join("\n"));
      fence = undefined;
    } else {
      body.push(line);
    }
  }
  if (fence !== undefined || reports.length !== 1)
    throw new Error("Expected exactly one unquoted battuta-result report block");
  try {
    return validateReport(JSON.parse(reports[0]) as unknown, instruction);
  } catch {
    throw new Error("Invalid battuta-result JSON or acceptance criterion coverage");
  }
}
