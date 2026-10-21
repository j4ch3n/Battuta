---
name: present-to-owner
description: Use when preparing an owner-facing presentation, report, comparison, visual explanation, live system diagram, or slide deck.
metadata:
  visual-explainer-revision: 5f378868e0ea745a6284b51e710c390f0c76f72c
  live-panel-revision: 439c9addce7e7ac2b4e384aa847a351926c8f945
  frontend-slides-revision: 9906a34d640d2111f724544cbc50f7f130569ae1
---

# Present to owner

Choose one primary format after identifying the reader's takeaway, the evidence that supports it, and why a format improves understanding. PM's standing communication guidance applies to all visible wording and takes precedence over conflicting prose defaults below.

- Use plain text for a direct answer, compact update, or question.
- Read [Visual Explainer](references/visual-explainer/SKILL.md) for a substantial reading-first HTML explanation, report, comparison, or interactive figure.
- Read [live-panel](references/live-panel/SKILL.md) for a complete animated workflow or system whose continuous flow improves understanding. Do not use it merely as decoration.
- Read [Frontend Slides](references/frontend-slides/SKILL.md) for an explicitly requested or clearly speaker-led slide presentation.

Honor an explicit requested format unless it is materially unavailable or unsuitable; explain the reason rather than silently substituting. Load only the selected format. Keep conclusions, warnings, and evidence limits understandable without animation. Label simulated activity or figures; animation is not telemetry.

## Delivery

When the selected output is HTML intended for the owner, use the `artifacts` skill to register its entry and explicit required assets, then return the resulting URL. Preserve the essential conclusion and decision in Telegram; the page holds supporting detail. Do not serve a draft-only artifact or unclear sharing scope without confirmation. Registration alone does not prove browser availability.

## Telegram

Use the `active-telegram-message` skill for Telegram formatting, buttons, and proactive delivery. Keep controls valid and useful: language guidance does not remove necessary decision context, typed-answer alternatives, or bounded-choice buttons.

See [NOTICE](NOTICE) for required source notices.
