---
name: Artifact index
description: A continuous ruled working library of published artifacts.
colors:
  canvas: "#f3f6ff"
  ink: "#14234b"
  muted: "#53617e"
  accent: "#2346e8"
  on-accent: "#ffffff"
  rule: "#c8d1e7"
  active: "#e8eeff"
  notice: "#7a3c14"
  marker: "#d8ee79"
typography:
  display:
    fontFamily: '"Public Sans", system-ui, sans-serif'
    fontSize: "clamp(2.75rem, 6vw, 5rem)"
    fontWeight: 600
    lineHeight: 1.05
    letterSpacing: "-0.04em"
  title:
    fontFamily: '"Public Sans", system-ui, sans-serif'
    fontSize: "clamp(1.25rem, 2.2vw, 1.75rem)"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.025em"
  body:
    fontFamily: '"Public Sans", system-ui, sans-serif'
    fontSize: "1rem"
    lineHeight: 1.5
  label:
    fontFamily: '"Public Sans", system-ui, sans-serif'
    fontSize: "0.875rem"
    lineHeight: 1.5
spacing:
  "1": "0.25rem"
  "2": "0.5rem"
  "3": "0.75rem"
  "4": "1rem"
  "6": "1.5rem"
  "8": "2rem"
---

# Design System: Artifact index

## Overview

**Creative North Star: "Working library"**

This document describes only the built artifact index, not Battuta's product identity or other rendered pages. A cobalt masthead and count introduce a continuous, ruled list on pale blue-white, with navy text and restrained metadata. Work remains the focus: no cards or format grouping.

**Key Characteristics:**

- Continuous ruled rows, not separate tiles.
- One self-hosted type family with clear title and metadata roles.
- Responsive dates and visible keyboard interaction.

Source of truth: [catalog.css](src/battuta_artifacts/assets/catalog.css), with [template](src/battuta_artifacts/templates/index.html) and [client behavior](src/battuta_artifacts/assets/catalog.js). This is a record of that implementation; resolve future discrepancies against the source.

## Colors

### Primary

- **Cobalt** (`accent`): masthead, row arrows, interactive titles and focus outlines; **white** (`on-accent`) supplies masthead text.
- **Lime marker** (`marker`): the decorative heading stop and text selection, not a second action color.

### Neutral

- **Pale blue-white** (`canvas`): the page ground.
- **Navy** (`ink`): primary text and the list's opening rule.
- **Slate** (`muted`): descriptions, dates, captions and empty state.
- **Blue-gray rule** (`rule`): row separators; **pale active blue** (`active`): pressed-row and tap feedback.
- **Warm notice** (`notice`): connection and retry status text.

## Typography

Public Sans serves every role; the variable normal face supports weights 100–900, with `font-display: swap` and system sans fallbacks. It is preloaded and served locally from `/artifacts/fonts/public-sans-latin.woff2`: no external font network requests. Provenance and OFL license live in [assets/fonts](src/battuta_artifacts/assets/fonts/).

The frontmatter records the desktop display, row title, body and metadata roles. At the narrow breakpoint, the display becomes `clamp(2rem, 11vw, 2.75rem)`. Descriptions stop at 68ch; count and dates use tabular numerals. Titles and descriptions wrap long unbroken content. The count uses body size, not metadata size.

## Layout

The shared content width is capped at 76rem, with symmetric gutters of `clamp(1.25rem, 5vw, 5rem)`. Masthead title and count share a baseline. List rows and captions align to three columns: flexible copy, an 8.5rem date column, and a 1.5rem arrow column. Desktop column gaps and row block padding use spacing step 8.

At `max-width: 40rem`, captions disappear, the masthead wraps, and row layout becomes copy plus arrow with spacing step 4 gaps. Dates move below the copy with a visible “Updated” label and can wrap; the arrow stays at the top right. Masthead, library and row block padding use step 6. The list remains continuous at every width.

## Elevation & Depth

Flat throughout: no shadows or elevated containers. Solid masthead color, the opening navy rule and lighter row separators establish hierarchy.

## Shapes

Square, unboxed rows with one-pixel horizontal rules; no card radii or pill treatments.

## Components

- **Masthead:** a single heading, decorative lime stop hidden from assistive technology, and a politely announced live work count.
- **Artifact row:** one native link wraps the title, description, semantic date and decorative, assistive-technology-hidden SVG arrow. Hover-capable devices and keyboard focus turn the title cobalt and reveal its underline. Only underline color transitions (`160ms ease-out`); reduced-motion preference removes that transition. Pressing a row applies the active background.
- **Focus:** links, the list fallback target and the empty state receive a cobalt 2px outline with spacing step 1 offset. Do not clip this outline. The semantic list explicitly retains `role="list"` despite suppressed markers.
- **Live states:** empty copy explains that published work will appear here; connection/retry messages use a status region. Refreshes reuse rows and preserve keyboard focus; removing a focused row sends focus to the list, or to the empty state if no work remains. A newly populated list restores focus from the empty state to its first link. Dates display day, abbreviated month and year in UTC.
- **Forced colors:** title underlines use `LinkText` so link identification survives color overrides.

## Do's and Don'ts

- **Do** preserve the continuous ruled list and responsive date placement.
- **Do** keep native links, semantic dates, visible focus and reduced-motion support.
- **Do** serve Public Sans locally with its provenance and license.
- **Don't** introduce cards, format grouping or external font requests on this index.
- **Don't** apply these local decisions as project-wide branding or rules for other pages.
