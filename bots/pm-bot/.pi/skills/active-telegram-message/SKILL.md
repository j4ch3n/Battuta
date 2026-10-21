---
name: active-telegram-message
description: Use when the Project Manager needs Telegram buttons, rich Telegram formatting, or an explicit proactive Telegram message to the human owner.
---

# Telegram communication with the owner

Use the existing `@llblab/pi-telegram` bridge to make owner-facing Telegram communication clear, compact, and actionable. The default is a normal text reply; enrich it only when that reduces owner effort or makes a bounded decision clearer.

## Choose the message form

- **Plain text:** Use for direct answers, compact updates, open-ended discovery, personal reflection, or anything that needs the owner to explain in their own words.
- **Telegram buttons:** Use only for two to four concrete, mutually understandable choices: approve/edit a displayed draft, choose a bounded tradeoff, or choose a next discussion path. The visible text must always make sense without buttons and accept a typed answer.
- **Proactive `telegram_message`:** Use only when notifying the owner outside their active Telegram turn. Do not call it to duplicate the normal reply to an active Telegram turn.

Use bold for the decision or key finding, `code` for identifiers, and descriptive links to real evidence. Keep the message phone-sized: lead with the next action, decision, or outcome; avoid raw logs and repeated status.

## Telegram buttons

Place `telegram_button` markup on a top-level line after the visible message, without a code fence, list, or blockquote. It is an HTML comment containing a JSON matrix: nested arrays are one row and top-level entries are separate rows.

```md
**Proposed issue: Retry failed builds**

The task stays linked to the failure and returns to a fix queue. Does this draft reflect your intent?

<!-- telegram_button: [
  [
    {"label":"Approve draft","prompt":"I approve the displayed issue draft. Verify it is current, then create the Linear issue."},
    {"label":"Edit draft","prompt":"I want to edit the displayed issue draft. Ask what I would change."}
  ],
  {"label":"Discuss tradeoffs","prompt":"Discuss the open tradeoff in the displayed issue draft before I decide."}
] -->
```

- Give each button a short label and a self-contained prompt written as the owner's response.
- Recheck any referenced issue, draft, or plan after a click; a button is not proof that the earlier artifact remains current.
- Do not use buttons for an unbounded answer, a sensitive personal conversation, or a question that has no good default set of choices.

## Examples

### Bounded decision with buttons

Use buttons when the owner can genuinely choose now:

```md
**The import retry needs an owner.** The engineering evidence supports either option.

<!-- telegram_button: [
  [
    {"label":"Original engineer","prompt":"Assign failed import retries to the original engineer."},
    {"label":"Available engineer","prompt":"Assign failed import retries to an available engineer."}
  ],
  {"label":"Compare options","prompt":"Compare the retry-ownership options before I decide."}
] -->
```

### Plain-text reflective conversation

Do not offer preselected buttons when the owner needs room to think:

```md
It sounds as though this choice has real weight for you. What would you most want clarity on by the end of this conversation?
```

### Proactive outcome

Outside an active Telegram turn, call `telegram_message` only after checking the bridge has an authorized target. State the result, any decision needed, and the next action; report delivery failure honestly.

`telegram_message` is direct delivery; a final answer from an autonomous Pi turn may also be projected to the same Telegram target. Choose one route for each piece of content to avoid duplicates. Never start a second Telegram polling client.
