import { Type, type Static } from "typebox";
import type { WorkerResult } from "../supabase/functions/_shared/task-contracts.ts";
import { MAX_CONTENT_BYTES, type MessageContent } from "./content.ts";

const text = (maxLength: number) => Type.String({ minLength: 1, maxLength, pattern: "\\S" });
export const WorkerResultSchema = Type.Object(
  {
    schema_version: Type.Literal(1),
    kind: Type.Literal("worker_result"),
    state: Type.Union([Type.Literal("completed"), Type.Literal("failed")]),
    text: text(10000),
    references: Type.Array(
      Type.Object({ locator: text(2000), note: text(4000) }, { additionalProperties: false }),
      { maxItems: 30 },
    ),
  },
  { additionalProperties: false },
);
// Compile-time check that this receive-only schema consumes the shared contract.
type ReceivedWorkerResult = Static<typeof WorkerResultSchema>;
export function isWorkerResult(
  content: MessageContent | ReceivedWorkerResult,
): content is WorkerResult {
  return "kind" in content && content.kind === "worker_result";
}
export function validateWorkerMessage(message: {
  content: WorkerResult;
  sender: string;
  recipient: string;
  response_due: string | null;
  in_reply_to: string | null;
}) {
  if (
    !/^worker\.[A-Za-z0-9][A-Za-z0-9._-]*$/.test(message.sender) ||
    !["pm", "tl"].includes(message.recipient) ||
    message.response_due !== null ||
    message.in_reply_to !== null
  )
    throw new Error("Invalid worker result routing or reply expectation");
  // The shared formatter adds bounded task context to a report already bounded
  // to 64 KiB. Do not impose the ordinary bot-content limit on that combined result.
  const maxWorkerBytes = 2 * MAX_CONTENT_BYTES;
  if (new TextEncoder().encode(JSON.stringify(message.content)).length > maxWorkerBytes)
    throw new Error(`Worker result exceeds ${maxWorkerBytes} bytes`);
}
