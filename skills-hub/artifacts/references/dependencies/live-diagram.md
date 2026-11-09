# live-diagram

Select `--vendor live-diagram` for node/edge state, badges and controlled replay.
Mermaid is included automatically. Flowcharts/state machines are supported, not
sequence/class diagrams. This renders state; it does not execute workflows.
Init links `vendor/live-diagram.css` and `vendor/mermaid.css`.

```html
<div id="diagram" class="artifact-live-diagram" style="height: 24rem"></div>
<p id="explanation">Illustrative: the receiver accepts a request, then the worker processes it.</p>
<button id="next" type="button">Next event</button>
<button id="reset" type="button">Reset replay</button>
```

```js
import mermaid from "mermaid";
import { LiveDiagram, mermaidRenderer } from "live-diagram";

const diagram = new LiveDiagram({
  mount: "#diagram",
  graph: "flowchart LR\nReceiver --> Worker",
  renderer: mermaidRenderer({ mermaid, config: { securityLevel: "strict" }, svgLabels: true }),
  controls: true,
});
const timeline = diagram.timeline([
  { t: 0, node: "Receiver", state: "success" },
  { t: 1000, node: "Worker", state: "success" },
]);
document.querySelector("#next").onclick = () => timeline.step();
document.querySelector("#reset").onclick = () => timeline.reset();
diagram.on("nodeClick", ({ id }) => {
  document.querySelector("#explanation").textContent =
    `Selected ${id}; this is an illustration, not live telemetry.`;
});
```

Use `patch({ Worker: { state: 'running', badge: 'Illustrative' } })` for authored
status changes and edge IDs such as `Receiver->Worker` for edge state. Use one
timeline as the source of captions, badges and graph state, not a second clock.
`seek(ms)` supports backward/forward scrubbing; `pause()` stops playback. Keep a
meaningful static state and labeled keyboard controls. Do not autoplay; honor
reduced motion in CSS and authored playback. Destroy diagrams when removing mounts.

Never size `.ld`'s SVG yourself: its inline width implements zoom. Anime.js must
not target managed graph SVG. For overlays prefer created DOM elements with
`textContent`, never untrusted HTML strings. Clicks are local explanation only;
remote actions, polling and persisted feedback require separate authority.
On failures keep the text explanation, inspect imports and strict renderer config,
and report unavailable verification instead of changing to loose security.
