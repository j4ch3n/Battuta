# Mermaid

Select `--vendor mermaid` for static flowcharts, sequence/class diagrams and other
text-defined relationships. Use live-diagram instead for status/replay on flowcharts
or state machines. Init links `vendor/mermaid.css`; use its `.artifact-mermaid` host.

In authored HTML:

```html
<figure>
  <div id="flow" class="artifact-mermaid"></div>
  <figcaption>The receiver saves a request before the worker reads it.</figcaption>
</figure>
```

In `index.js` (example structure is illustrative, not evidence):

```js
import mermaid from "mermaid";

mermaid.initialize({
  startOnLoad: false,
  securityLevel: "strict",
  flowchart: { htmlLabels: false },
});
const { svg } = await mermaid.render("request-flow", "flowchart LR\nReceiver --> Store --> Worker");
document.querySelector("#flow").innerHTML = svg;
```

Use unique render IDs per mount. Render only trusted author source, keep strict
security, and provide an equivalent text explanation. When sharing a page with
live-diagram, use compatible strict/SVG-label settings on their shared Mermaid
instance. On rendering/CDN failure keep the explanation visible; do not weaken
security or introduce UMD/global scripts to bypass the error.
