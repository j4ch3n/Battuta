---
name: agent-mail
description: Use when sending, replying to, or interpreting Agent Mail between bots, or deciding whether a worker should be mailed or given an assignment.
---

# Agent Mail

## Objective

Reach the right bot with the right tool, read what the tools return, and keep work
flowing through assignments rather than side conversations.

## Address book

| Mailbox   | Who                                                                 | Use it for                                                        |
| --------- | ------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `cos`     | Chief of Staff: owner conversation, product decisions, commitments | Decisions, product clarification, results for the owner           |
| `manager` | Manager: assignment-based delivery and review                      | Commissions, progress, blockers, questions about delivery         |

Workers have no address to look up. They receive work as assignments, and reach
`manager` only. A mailbox name is a bot ID. For `cos` and `manager` it equals the
role; for a worker it is the bot's own name, such as the name an assignment records
in `claimed_by`.

## Capabilities and boundaries

- `send_agent_message` starts an exchange. `reply_agent_message` answers an incoming
  message, using that message's exact `message_ref` as `parent`. Ordinary assistant
  text never delivers mail.
- Every message states the requested action or result, relevant evidence, and
  `reply_expectation`: `null` for information or a final answer, otherwise `short`,
  `medium` or `long` by how much investigation you ask for.
- Mail does not grant tools, authority, or product approval. Reply to the bot that
  wrote to you; escalate decisions you cannot make to its sender or to `cos`.
- Workers can send only to `manager`. A worker that tries `cos` is turned back with
  the instruction to write to `manager`.

## Reading what the tools return

- A successful send or reply returns a JSON receipt with `message_ref`, `status`
  (`created` until the recipient accepts it, then `read`, then `replied`) and
  `response_due` (null when no reply was requested).
- Incoming mail shows its content, its `message_ref`, and its reply expectation.
  When a reply is expected, answer with `reply_agent_message`; an honest
  clarification or progress report is better than an invented result.
- An error that says delivery is uncertain does not mean the mail failed. Do not
  resend; check for a reply or escalate the communication problem.

## Mailing a worker

Give workers new work through an assignment (use the `define-assignments` skill),
not mail. A worker is chosen by ability when it claims the assignment, so you do
not know which worker will take it until it does.

Mail a worker only to follow up on an assignment it has claimed:

1. Read the assignment and take the worker's name from its `claimed_by`.
2. Send with `recipient` set to that name and `assignment_id` set to the assignment.
3. Use `delivery: "steer"` for an urgent correction between its steps, otherwise
   `"queue"`.

Never guess a worker's name or send to one without an assignment ID. The send is
refused when the assignment is unknown or claimed by someone else. A blocked or
finished worker reports to `manager` automatically; resolve the blocker in the
assignment itself, not by mailing the old worker.

## Why and examples

Assignments keep a durable record, fence who may write results, and let any capable
worker continue the work; mail does none of that.

Good: the influencer is mid-run and needs a different account, so `manager` reads
`claimed_by` from the assignment and sends a `steer` follow-up with the assignment ID.

Bad: `manager` mails `worker-influencer` a phone task because the name looks right.
The task has no assignment, no record and no claim, and the send is refused.
