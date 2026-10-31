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

## Format-specific choices and checks

- **Reading-first HTML:** Preserve a readable prose column and connected argument,
  rather than caption-only panels. Bullets express parallel facts; ordered lists
  express actual sequences. Introduce and interpret figures. Scenarios, assumption
  controls and replays can belong in a report; they do not automatically make it a
  panel. Check mobile reflow and keep plot captions/tables consistent with the data.
- **Slides:** Use for an explicit deck, not an ordinary asynchronous report. Give
  each slide one consequential point and a place in the argument. The supplied
  1920×1080 stage fits as a unit with letterboxing; split overfull slides instead of
  shrinking text indefinitely. Inspect every slide, inactive-slide isolation,
  keyboard/button navigation, focus, narrow-screen fitting and print behavior.
- **Animated panel:** Use stable system relationships and state changes to explain
  a mechanism, not as an interactive story engine or real telemetry. Keep simulation
  labels, a useful text alternative, opt-in play/pause and time controls. The
  existing runtime is deterministic; verify reset/replay, full-diagram visibility
  and configuration failures. Its optional semantic layout helper avoids manual
  coordinates; the supplied example is already runnable.

Shared evidence/accessibility checks live in the owning skill. Template examples
use HTML/CSS, native SVG plots, local Three.js for 3D and the existing live-panel
runtime; the artifacts skill owns the capability/selection summary. No imported
CDN, manual construction, global output path or third-party deployment recipe
overrides that workflow. Report unavailable verification honestly.
