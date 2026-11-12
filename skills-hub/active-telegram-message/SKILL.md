---
name: active-telegram-message
description: Use when preparing Telegram button markup, attaching screenshots, or delivering an authorized proactive message through the Telegram bridge.
---

# Telegram communication with the owner

## Objective

Deliver an understandable, actionable message to the owner through one authorized
Telegram route. The owner is the human recipient; loading this skill does not
identify the sender as a Project Manager or grant access to the bridge.

## Capabilities and boundaries

Use the existing `@llblab/pi-telegram` bridge when it is available and has an
authorized target. This skill owns bridge operations and delivery mechanics; it does not
authorize a proactive delivery, create an owner decision, or replace a normal
reply when the owner is already in an active Telegram turn.

## Ownership and delivery route

The CoS's dedicated instructions own its everyday voice, phone-readable replies,
and choice of plain conversation versus a bounded decision. This skill supplies
the technical contract when an authorized sender needs Telegram controls or tools;
it does not require loading a skill for an ordinary reply or confer the CoS role.

- During an active Telegram turn, give the normal reply. Do not also call
  `telegram_message` for the same content.
- Outside an active turn, use `telegram_message` only with delivery authority
  and an authorized target. A normal autonomous final answer may also be
  projected to that target: choose one delivery route for each piece of content.
- When the host supplies completed intermediate assistant segments, the bridge
  can deliver those before the final reply. Do not repeat an intermediate in the
  final. Paragraph breaks alone are not separate-message commands; if only a
  final reply is available, keep topic chunks within it. Never insert dummy tool
  calls or extra proactive sends just to force a split.
- Never start a second Telegram polling client. Report returned delivery status
  honestly; do not blindly resend an uncertain operation.

One route avoids duplicate notifications; tool availability alone is not
permission to contact the owner.

## Screenshot attachments

When an authorized owner conversation needs browser evidence, use the
`browser-evidence` skill to save a PNG first. Confirm the file exists, then call
`telegram_attach` with its absolute path and provide a concise explanation of
what the screenshot shows. Never expose credentials or unrelated private content.

During an active Telegram turn, the attachment may be queued for final-turn
delivery: give the normal reply rather than duplicating it with
`telegram_message`. Outside an active turn, use the bridge only with explicit
delivery authority and an authorized target. A saved file or queued attachment is
not confirmed delivery; report the returned status honestly and never blindly
resend an uncertain upload. Keep the file until delivery is settled.

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

- Supply two to four concrete choices. The visible message must make sense without buttons and accept a typed answer.
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

### Avoid duplicate delivery

Do not send `telegram_message` and a normal reply for the same active turn.
Use the normal reply; outside an active turn, check authority and the target
before choosing the proactive route. **Why:** the owner should receive one
understandable copy, not competing notifications.
