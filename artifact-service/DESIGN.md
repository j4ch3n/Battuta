---
name: Artifact index
description: A Sienna-inspired working library with a small hero and continuous timeline.
colors:
  canvas: "hsl(37deg 47% 93%)"
  ink: "hsl(28deg 16% 13%)"
  muted: "hsl(25deg 14% 26%)"
  accent: "hsl(17deg 60% 34%)"
  rule: "#d9cfb9"
typography:
  display:
    fontFamily: '"Newsreader", "Iowan Old Style", Georgia, serif'
    fontSize: "clamp(2.5rem, 6vw, 3.5rem)"
    fontWeight: 500
  title:
    fontFamily: '"Newsreader", "Iowan Old Style", Georgia, serif'
    fontSize: "1.375rem"
    fontWeight: 500
  body:
    fontFamily: '"Newsreader", "Iowan Old Style", Georgia, serif'
    fontSize: "1.125rem"
    lineHeight: 1.6
  metadata:
    fontFamily: '"Inter", system-ui, sans-serif'
    fontSize: "0.75rem"
---

# Artifact index design

Local to this index, not project-wide branding. The owner selected
[Astro Sienna](https://anjay-goel.github.io/astro-sienna/) after rejecting the cobalt design.
Its palette and timeline styling are adapted under MIT; the pinned source and license
are retained in [SIENNA-LICENSE.txt](src/battuta_artifacts/SIENNA-LICENSE.txt).

## Composition

- Warm paper canvas, brown-black serif content and restrained rust interactions.
- A compact hero contains “Artifacts,” one short context line and the live work count.
- No navigation menu, long introduction, images, avatars, cards or format groups.
- A 46rem column carries a continuous timeline with a 7rem date rail and 2.25rem gap.
- At 45rem and below, dates sit above content, timeline dots disappear and fine horizontal rules separate entries.
- The first/newest title is 1.875rem; other titles are 1.375rem. Descriptions remain complete.
- A quiet footer reads “© 2026 Fiscum Technology,” separated by a fine rule. It stays at the bottom on short pages without covering content.

## Interaction and ownership

Native links, visible rust focus outlines, underline feedback, reduced-motion and
forced-color support remain. Live updates reuse nodes and retain meaningful keyboard
focus through changes, removal and repopulation. No backend or CLI behavior changes.

[catalog.css](src/battuta_artifacts/assets/catalog.css) owns the actual tokens and
responsive rules. Newsreader and Inter are self-hosted; font sources and licenses
are recorded under [fonts](src/battuta_artifacts/assets/fonts/).
