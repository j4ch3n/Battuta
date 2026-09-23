---
name: active-telegram-message
description: Send an explicit, proactive Telegram message from the PM's connected Pi session when asked to notify the human outside the normal reply to a Telegram turn.
---

# Active Telegram message

Use the existing `@llblab/pi-telegram` bridge for an intentional outbound update. This skill is for an explicit request to send a message, not for every internal agent-mail exchange.

1. If answering the human's active Telegram turn, write the response normally. The bridge delivers that reply; do not also call `telegram_message` for the same target.
2. When the request calls for a separate message from a local or autonomous Pi turn, use the bridge's `telegram_message` tool. Check that the bridge is connected and has a current authorized target; do not invent a chat ID or thread. Report delivery failure instead of claiming it was sent.
3. For a progress note, say what is being checked and why a response may take time. For a substantive result, briefly summarize the finding, any decision needed, and the next step. Do not forward raw agent mail or duplicate a message already projected by the bridge's connected companion delivery.

`telegram_message` is direct delivery; a final answer from an autonomous Pi turn may also be projected to the same Telegram target. Choose one route for each piece of content to avoid duplicates. Never start a second Telegram polling client.
