# Choose a format

Honor an explicit viable format request. Otherwise choose the least complexity
sufficient to teach the point, not a default aesthetic or a table-size threshold.
Use the artifacts skill for template choices, initialization and commands.

| Reader need                                                                              | Format             |
| ---------------------------------------------------------------------------------------- | ------------------ |
| A direct fact, status, narrow source check, small decision or bounded comparison         | Plain text         |
| A substantial report, connected explanation, self-paced evidence or interactive scenario | Reading-first HTML |
| An explicitly requested deck or presenter-guided sequence                                | Slides             |
| An illustrative system-state diagram with optional playback                              | Animated panel     |

Choose one primary format. Plain text does not need HTML merely because it has
several rows. Reuse confirmed design preferences; ask only consequential missing
questions, not a mandatory style-preview or discovery ceremony.

## Reading-first HTML: compose the explanation

Preserve a readable prose column and connected argument, not caption-only panels.
Shape the page to its content: a concept can move from question → intuition →
mechanism → edge cases; a review from verdict → evidence → risks; a comparison
from visible differences → trade-offs → recommendation. Merge or drop sections
that do not help. Bullets express parallel facts; ordered lists express sequences.

Choose pieces by the relationship they explain:

| Need                                                            | Piece and when to read                                                                                                                                                                                                                                  |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Architecture, paths, sequences, schema or before/after          | Read [drawing guidance](visual-explainer/references/diagrams.md) for SVG nodes, verb-labelled edges, boundaries, callouts and linked highlighting. Draw the changed edge or box, not just option names.                                                 |
| A small consequential detail                                    | Enlarge that part and label its actual fields/values. Avoid a whole-system diagram when a close-up teaches the claim.                                                                                                                                   |
| Scenarios, failure modes or cases                               | Use small multiples with the same visual grammar; avoid a table of paragraphs when the difference can be drawn.                                                                                                                                         |
| Quantities                                                      | Match encoding to the claim: line for trend, sorted bars for rank/size, diverging bars for deviation, stack/waffle for share, histogram/strip for spread, scatter for association. Use shared scales/units for comparisons.                             |
| Reusable visual primitives                                      | Read [kit parts](visual-explainer/references/kit.md) for tables, chips, data tags and flow markup when adopting those components. Their classes/custom elements require the corresponding kit CSS/JS; they are not built into every initialized bundle. |
| Process, steps, queue, state change or an assumption to explore | Read [motion patterns](visual-explainer/references/motion.md) for steppers, replays and live figures. Script one claim per step; change the picture with the explanation. Use 3D only when depth carries information.                                   |
| Visual identity or an explicit theme request                    | Read [style guidance](visual-explainer/references/style-guide.md); consult [themes](visual-explainer/references/themes.md) only when relevant. User/project guidance takes precedence; registers and palettes are choices, not requirements.            |
| A visual implementation plan                                    | Read [plan guidance](visual-explainer/references/plans.md) for plan-specific explanation and feedback, not as authority to start implementation.                                                                                                        |
| Supplied Mermaid or a requested specialist visual               | Consult [extras](visual-explainer/references/extras.md) selectively. Do not introduce another renderer just because a reference mentions it.                                                                                                            |

The initialized bundle already supplies working plots and 3D. Adapt selected
pieces into that working presentation rather than rebuilding the entire upstream
renderer. If borrowing a kit component, carry its actual local dependencies and
explicit sharing mappings; a marker such as `data-ve-kit` does not install them.
Scenarios, assumption controls and replays can belong inside a report; they do not
automatically make it a panel. Check mobile reflow, long paths/code overflow and
caption/table consistency with the data. Preserve list markers; escape `<` inside
HTML-embedded math so it is not parsed as a tag.

## Slides: compose a guided sequence

Give each slide one consequential point and a place in the argument. Infer purpose,
length and density from supplied context; ask only a consequential missing question.
Speaker-led decks favor large type, fewer words and more slides; asynchronous decks
can carry self-contained tables and annotations without becoming document dumps.
Split overfull slides instead of shrinking text indefinitely. When enhancing an
existing deck, inspect its density before adding text or images and preserve its
working interaction and visual system.

- For structure or fitting changes, read [HTML architecture](frontend-slides/html-template.md)
  and [stage CSS](frontend-slides/viewport-base.css). The supplied 1920×1080 stage
  scales as a unit with letterboxing; keep authored geometry stable on phones.
  Treat these as implementation patterns, not an instruction to replace working
  bundled navigation or inline every file. Verify visibility/inertness so inactive
  slides cannot cover the current slide or receive keyboard focus.
- For motion that supports the chosen mood, consult [animation patterns](frontend-slides/animation-patterns.md).
  Prefer a coherent reveal over scattered effects, with reduced-motion alternatives.
- Reuse a confirmed style. **Only when style exploration is requested**, read
  [style presets](frontend-slides/STYLE_PRESETS.md) and the compact
  [selection index](frontend-slides/bold-template-pack/selection-index.json).
  Shortlist by mood, formality and density; read only shortlisted `preview.md`
  files. Present contrasting previews using the owner's actual title/content,
  never internal template names or process labels on the slide. After a choice,
  read only that template's `design.md`; use its `template.html` only for missing
  implementation detail. Expand the chosen typography, palette, spacing and layout
  grammar consistently; do not copy the demonstration's claims or content.
- For a supplied PowerPoint, use [the extraction helper](frontend-slides/scripts/extract-pptx.py)
  to inspect text, images and notes before conversion. Preserve slide order,
  substantive text, relevant images and speaker notes; resolve missing inputs
  instead of substituting invented material. Extra exports are opt-in; inspect
  [the PDF helper](frontend-slides/scripts/export-pdf.sh) only when PDF is requested,
  and explain that static export cannot preserve interactivity.
  It is not drop-in compatible with initialized decks: adapt/verify its slide
  navigation and `hidden` handling, then inspect every exported page for blanks.

Inspect every slide at desktop and phone sizes: text/card overflow, panel overlap,
image loading, aspect ratio, navigation/focus and print behavior. DOM dimensions
alone do not establish that panels are visually separate. Do not promise editing,
swipe navigation or export features unless the actual deck implements them.

## Animated panel: compose a complete system view

Use stable relationships and changing state to explain a mechanism, not as an
interactive story engine or real telemetry. Frame zero should already show the
complete diagram: state moves, layout does not. Collect boxes, relationships,
triggers, log messages and the source or simulation label of each number first.

- The initialized example already runs. Start with its semantic content and copied
  usage guide; use its optional scaffold for row/fan-out layouts instead of reasoning
  through pixel coordinates. Change a few elements, inspect, then iterate rather
  than writing an enormous config in one operation.
- Read [configuration keys](live-panel/references/config-schema.md) when changing
  boxes, wires, counters, theme or canvas. Compare the relevant configs under
  [examples](live-panel/examples/) for a suitable pattern; those examples are
  reference material, not evidence for the owner's system. Different aspect ratios
  need a verified layout, not merely a changed canvas size.
- Read [motion grammar](live-panel/references/motion-grammar.md) before choosing
  machines/periods. Fast packets, medium logs and slow triggers may coexist, but
  logs, bars, counters and highlighted triggers must describe the same state.
  Real fixed quantities stay fixed; simulated changing quantities remain labelled.
- For a layout beyond boxes and wires, consult [view patterns](live-panel/references/views.md)
  and the matching example/runtime before adopting one. That reference contains
  extension contracts and planned kinds as well as implemented ones: inspect what
  exists rather than assuming every named view is bundled or ready. Reusing a view
  requires its actual runtime code; adding a config kind alone is insufficient.
- Use [frame checks](live-panel/scripts/check_frames.py) when adapting the original
  config engine. Sample different cycle points and seek away/back to test replay;
  inspect resulting images as well as reported overflow/overlap. Read
  [view verification](live-panel/references/verify-view.md) only when extending a view.
  Geometry/determinism checks do not establish evidence or reader understanding.

Keep a useful text alternative, opt-in playback, pause and time controls. Verify
reset/replay, full-diagram visibility, narrow screens and configuration failures.
The runtime's `seek(t)` makes state deterministic; do not replace it with independent
wall-clock/random animation when synchronized state matters. Preserve source
author and full source-link attribution when recreating a supplied diagram, including
its visible credit, rather than presenting the recreation as original evidence.

## How to use the retained references

Read the linked pieces selectively, not every subfolder wholesale. Their drawing,
style, component and checking techniques remain useful; inherited mandatory
single-file builds, output paths, CDN/font installation, model-tool names and
third-party deployment recipes do not override the initialized local bundle or
the artifacts workflow. No additional render/build cycle is required to use the
supplied example. Shared evidence/accessibility checks live in the owning skill;
report unavailable tools or verification honestly.
