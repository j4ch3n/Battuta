---
name: Artifact pages
description: A MINI-inspired paint-chip library, white page, black type and one solid colour per project.
colors:
  page: "#ffffff"
  ink: "#000000"
  muted: "#5c5c5c"
  surface: "#f3f3f1"
  rule: "#e2e2df"
  pull-quote: "#f6c800"
typography:
  display:
    fontFamily: '"Gabarito", "Helvetica Neue", Arial, sans-serif'
    fontSize: "clamp(2.75rem, 7vw, 5.75rem)"
    fontWeight: 900
  title:
    fontFamily: '"Gabarito", "Helvetica Neue", Arial, sans-serif'
    fontSize: "1.1875rem"
    fontWeight: 700
  body:
    fontFamily: '"Gabarito", "Helvetica Neue", Arial, sans-serif'
    fontSize: "1.15625rem"
    lineHeight: 1.62
  code:
    fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace'
---

# Artifact page design

Covers the home catalog, rendered Markdown, error pages and the starter that `init` copies into new
bundles. Local to the artifact service, not Battuta's product identity. The owner chose MINI's design
language as the reference after rejecting the Sienna look as dated, and rejected gradients, glass,
pastels and coloured page backgrounds as artificial.

## Colour

- White page, black type, light surface and fine rules; colour arrives as solid paint, never gradients.
- Each project owns one of twelve paints (Chili Red, Sunny Yellow, Ocean Green, Blazing Blue, Volcanic
  Orange, Zesty Lime, Rooftop Pink, Caribbean Aqua, Enigmatic Violet, Racing Green, Burgundy, Lilac),
  chosen from its name and paired with black or white text at 4.5:1 or better. Unassigned work is black.
- The project paint fills its home-page chip and, on its Markdown pages, the project pill swatch,
  section bars, bullets and link underlines. Pull quotes are always Sunny Yellow.
- No colour behind headline words or the drop cap.

## Home catalog

- Small header: "Artifacts", one context line, a work-count pill. Quiet footer "© 2026 Fiscum Technology".
- Projects sorted alphabetically; each is one grid of tiles (four columns, two on phones): the paint
  chip, the two newest works, then a fanned deck holding the rest with "+N Show all".
- The deck or the chip opens a project: the row grows, then cards fly out of the deck. The chip
  stacks them again: cards gather into the deck, then the empty rows close. Rows never stretch.
- No JavaScript: every work shows, no deck. Reduced motion: no flight.

## Markdown and starter pages

- Magazine layout: top bar with the hand-of-chips "All artifacts" link, project and date pills, huge
  heavy black title with the description as a standfirst, a contents panel for three or more headings,
  a plain black drop cap, tilted yellow pull quotes, code on black tiles, tables in rounded frames.
- The starter uses the same header and article styles without the server top bar.

## Error pages

- Three tumbling "4 0 4" tiles in Chili Red, Sunny Yellow and Blazing Blue drop in once; plain black
  heading, one sentence, a black "Browse all artifacts" button. Never reveal drafts.

## Interaction and ownership

Native links and buttons, visible black focus outlines, `aria-expanded` on the chip and deck, reduced
motion and forced colours. Live updates reuse nodes and keep open state and meaningful focus.
[theme.css](src/battuta_artifacts/assets/theme.css) owns tokens and shared styles;
[catalog.css](src/battuta_artifacts/assets/catalog.css) owns the home grid and deck. Gabarito is
self-hosted; its source and licence are recorded under [fonts](src/battuta_artifacts/assets/fonts/).
