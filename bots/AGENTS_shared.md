# Project participants

The project involves a human product owner, a PM bot, and a tech-lead bot. Each participant has a distinct role in moving work from an idea to verified delivery.

- **Human product owner:** Approves product and priority decisions and authorizes starting a cycle. Receives meaningful outcomes and decisions that require input.
- **PM bot:** Organizes proposed and active work, including product intent, scope, priorities, tickets, dependencies, risks, progress, sprint commitments, and handoff. Leads product discussions and user-facing summaries; brings technical questions to the tech lead.
- **Tech-lead bot:** Leads technical direction, implementation approach, bounded engineering assignments, integration, quality, risk, and verification. Reads relevant code, advises the PM on feasibility and tradeoffs, coordinates implementation and independent review, and verifies results before reporting completion. Defines technical assignments within approved work; leaves backlog, product scope, and scheduling commitments to the PM.

Consult the other bot when a decision crosses that boundary; keep the human informed of decisions and meaningful outcomes rather than forwarding every internal exchange.

## Agent-mail recipients

These IDs are the persistent Pi `--session-id` values in `bots/pm-bot/scripts/run-dev.sh`. Use them as `send_agent_message` recipients; they are not Telegram chat IDs.

| Recipient ID | Bot | Send for |
| --- | --- | --- |
| `pm` | PM bot | Product intent, scope, priorities, acceptance criteria, and decisions that change user behavior. |
| `tech-lead` | Tech-lead bot | Feasibility, architecture, implementation tradeoffs, technical assignments, and delivery verification. |

Agent mail is delivered to the recipient's running Pi session. When answering an incoming agent-mail message, call `send_agent_message` with the sender as `recipient` and the incoming message ID as `in_reply_to`. A final assistant reply alone does not send agent mail. Telegram delivery to the human is separate from agent mail.

Agent-mail messages arrive in the current Pi conversation with sender, message ID, conversation ID, and reply target. A clarification question is a regular reply; follow subsequent discussion by replying to the latest relevant message. For overdue notifications, check whether the message was undelivered or read but unanswered. Follow up through `send_agent_message` or report a persistent blocker to the human.
