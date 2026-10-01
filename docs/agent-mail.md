# Agent mail protocol and architecture

Agent mail connects the Project Manager (`pm`) and Tech Lead (`tl`) through their running Pi agents. It supports focused questions, technical assessments, work handoffs, progress updates, and verified results without forwarding every exchange to the human owner.

Messages are addressed to a role rather than a particular Pi session. Both agents use the same structured content contract, exposed directly through two tools: **`send_agent_message`** and **`reply_agent_message`**. Ordinary assistant text does not send mail.

## How it works

```text
Sender's Pi tool → Supabase Edge Function → PostgreSQL
                                               ↓
                              Realtime → Recipient's Pi context
```

- **Pi** validates outgoing content and presents incoming messages to the recipient, starting an agent turn. The tool definitions guide the main LLM; no separate composition LLM is needed.
- **Supabase** provides transport, durable storage, reply linking, and response deadlines. It stores content as a JSON object without duplicating the business schema.
- **Delivery and recovery** combine Realtime with periodic reconciliation. A message becomes read when Pi accepts it into its conversation. Unanswered requests survive restarts, and missing replies receive bounded correction prompts.

Agent mail is for internal coordination; use the connected Telegram tool when a human decision or escalation is needed. See the shared [command reference](commands.md) for setup and launch entry points.

## Send a request

Use `send_agent_message` for a new exchange. Choose the recipient, explain the action and expected answer, and include the context needed to act. The tool describes the content fields; unused lists are empty and unused sections are null.

For example, the Project Manager can ask the Tech Lead to inspect delivery behavior:

```json
{
  "recipient": "tl",
  "message_type": "chat",
  "content": {
    "schema_version": 1,
    "summary": "Explain when incoming mail is marked read.",
    "context": ["We need to distinguish receipt from acceptance into the agent conversation."],
    "findings": [],
    "options": [],
    "recommendation": null,
    "request": {
      "action": "Inspect incoming mail delivery.",
      "requirements": ["Explain when a message is marked read."],
      "expected_response": "Report the finding with supporting evidence."
    },
    "result": null,
    "uncertainties": [],
    "references": [],
    "related_messages": []
  },
  "reply_expectation": { "window": "medium" }
}
```

Use `reply_expectation: null` when no answer is needed. Otherwise choose `short` for a quick acknowledgement or clarification, `medium` for a bounded investigation, or `long` for a deeper review. This is an expectation for a response, not a commitment to finish the work within that window.

## Answer incoming mail

Incoming mail includes a **`message_ref`**. Copy that entire reference into the reply tool's `parent`; do not copy `in_reply_to`, which identifies an earlier message.

The Tech Lead could answer the request above with the following call. The parent shown is illustrative—use the actual incoming reference and evidence you inspected.

```json
{
  "parent": {
    "conversation_id": "550e8400-e29b-41d4-a716-446655440000",
    "id": "a7c91e3b4d62"
  },
  "message_type": "chat",
  "content": {
    "schema_version": 1,
    "summary": "Mail is marked read after Pi accepts it, rather than on socket receipt.",
    "context": [],
    "findings": [
      {
        "statement": "The message_start handler acknowledges acceptance of agent mail.",
        "basis": "observed",
        "evidence": [
          {
            "locator": "agent-mail/index.ts",
            "note": "The acceptance handler invokes the read acknowledgement."
          }
        ]
      }
    ],
    "options": [],
    "recommendation": null,
    "request": null,
    "result": null,
    "uncertainties": [],
    "references": [],
    "related_messages": []
  },
  "reply_expectation": null
}
```

A reply may instead ask a clarification or report honest progress. If it asks another question, give it a reply expectation.

One direct reply is allowed per message. After an initial progress reply, send later results as new messages linked to the original request through `related_messages`. Use `chat` for ordinary discussion and `chase` only for an intentional follow-up. If a send result is uncertain, reconcile or escalate rather than blindly sending again.

## Development

The content contract and field descriptions live in [`content.ts`](../agent-mail/content.ts). Tool definitions and argument validation live in [`schemas.ts`](../agent-mail/schemas.ts). Bot instructions describe responsibilities and communication behavior, rather than repeating the schema.

Run checks from the repository root:

```sh
make setup-checks
make check
pnpm test:integration
```

The root integration command starts and stops a separate local Supabase stack, replays migrations, checks database permissions, and runs the Edge Function/plugin integration tests. Docker is required. See the shared [command reference](commands.md) for tooling entry points and links to verification guidance.
