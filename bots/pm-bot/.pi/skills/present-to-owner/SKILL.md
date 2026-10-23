---
name: present-to-owner
description: Use when preparing a durable owner-facing research presentation, report, visual explanation, live system diagram, or slide deck.
metadata:
  visual-explainer-revision: 5f378868e0ea745a6284b51e710c390f0c76f72c
  live-panel-revision: 439c9addce7e7ac2b4e384aa847a351926c8f945
  frontend-slides-revision: 9906a34d640d2111f724544cbc50f7f130569ae1
---

# Present to owner

Use this skill for a durable research presentation, report, visual explanation, workflow/system view, or slides—not routine short research or a compact bounded comparison. PM's standing communication guidance owns the response route, content, and evidence policy; this skill selects the presentation format and construction approach.

A research presentation preserves the decision question, source-backed evidence for each viable option, direct decision-critical trade-offs, recommendation, material uncertainty, and any decision required. Keep the evidence that changes the decision visible; make methods, full source detail, and supporting material available without obscuring the conclusion. Follow the standing `web_search` and `web_fetch` requirements before relying on current, external, or owner-provided sources.

| Reader need                                                                                        | Primary format                 | Load                                                     |
| -------------------------------------------------------------------------------------------------- | ------------------------------ | -------------------------------------------------------- |
| A direct answer, compact status, question, short research result, or bounded comparison            | Plain text                     | No presentation reference                                |
| A reader will work through evidence, a report, comparison, or interactive figure at their own pace | Reading-first HTML explanation | [Visual Explainer](references/visual-explainer/SKILL.md) |
| Understanding depends on seeing a complete workflow or system's ongoing state and flow             | Animated system/workflow panel | [live-panel](references/live-panel/SKILL.md)             |
| A presenter will guide the audience through a sequence, or the owner explicitly asks for slides    | Speaker-led deck               | [Frontend Slides](references/frontend-slides/SKILL.md)   |

Choose one primary format and load only its reference. Honor an explicit viable format request; otherwise prefer the least complex format that makes the point clear. Do not use a visual format or animation as decoration. Keep conclusions, warnings, evidence limits, and simulated figures understandable without animation.

Each selected package retains its upstream relative layout under `references/`; use its local files rather than an upstream checkout. These packages are presentation support, not independently activated skills.

## Telegram

Use the `active-telegram-message` skill for Telegram formatting, buttons, and proactive delivery. Keep controls valid and useful: language guidance does not remove necessary decision context, typed-answer alternatives, or bounded-choice buttons.

See [NOTICE](NOTICE) for required source notices.
