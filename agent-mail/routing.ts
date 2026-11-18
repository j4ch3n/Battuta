// Mailboxes that exist once; every other sender or recipient is a worker bot.
const COORDINATORS = ["cos", "manager"];

export async function checkSendRoute(input: {
  sender: string;
  recipient: string;
  assignmentId?: string;
  claimant: (assignmentId: string) => Promise<string | null>;
}): Promise<void> {
  const { sender, recipient, assignmentId, claimant } = input;
  if (!COORDINATORS.includes(sender)) {
    if (recipient === "manager") return;
    throw new Error(
      "Workers send agent mail to manager only. Send this to manager; manager contacts cos when needed.",
    );
  }
  if (COORDINATORS.includes(recipient)) return;
  const guidance =
    "Give workers new work by creating an assignment. Follow up with a worker only by passing an assignment_id that this worker has claimed.";
  if (!assignmentId) throw new Error(`No assignment_id for worker ${recipient}. ${guidance}`);
  if ((await claimant(assignmentId)) !== recipient)
    throw new Error(`Assignment is not claimed by ${recipient}. ${guidance}`);
}
