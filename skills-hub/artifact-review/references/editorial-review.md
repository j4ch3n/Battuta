# Editorial review and concrete repairs

Read the commission and opening, then ask what a reader could explain without
consulting the author. Check the question, takeaway, mechanism, strongest alternative,
material uncertainty and what would change the conclusion.

Inspect consequential claims against original evidence. Distinguish observations,
source assertions, calculations, inference and simulation. Reproduce important
calculations; keep costs/limits next to the claim. Unverified specificity is not
credibility. Attractive storytelling must not invent people, scenes or causal links.

## Repair the reader's path

| Observed issue                        | Concrete repair                                                                       |
| ------------------------------------- | ------------------------------------------------------------------------------------- |
| Answer buried under history           | Move the supported takeaway first; retain only background needed to understand it.    |
| Disconnected specialist sections      | Reorder by the reader's questions or causal dependencies; add the missing transition. |
| Too much detail before a mental model | Split overview from mechanism/example/limits; expose depth after orientation.         |
| Repeated claims                       | Merge, retaining the strongest evidence and relevant qualifiers.                      |
| Abstract jargon                       | Name the actor and action; define terms at first use and keep terminology stable.     |
| Topic-only headings                   | Replace with supported findings, not stronger promotional claims.                     |
| Uneven comparison                     | Use common criteria/scales and expose the relevant trade-off.                         |

Before: “The platform guarantees reliable processing through resilient orchestration.”

After: “The receiver saves requests before acknowledging them (source A). Workers
can retry the saved requests later. We have not established whether retries can
produce duplicate effects.”

The edit preserves the observed mechanism while removing an unsupported guarantee.
Keep actual evidence references, not the illustrative placeholder above. Supply a
proposed outline or replacement sentence when it makes a correction actionable.
Judge clarity in context, not against fixed word counts, drama or mandatory actions.

Example finding: **Required, opening paragraph** — “guarantees” exceeds source A;
readers may mistake persistence for duplicate-safe execution. Replace with the
qualified wording above. Recheck against the implementation/source and keep the
unknown visible in the diagram caption too.
