# Reveal

Select `--vendor reveal` only for a guided deck. Init links `vendor/reveal.css`,
which imports pinned base CSS and supplies scoped host treatment, not a global
stock theme. Keep slide text readable, one consequential point per slide, and split
overflow. The ordinary page must remain readable alongside the deck.

```html
<div class="artifact-reveal" style="height: 28rem">
  <div id="deck" class="reveal">
    <div class="slides">
      <section>
        <h2>State the supported takeaway</h2>
        <p>Explain the evidence.</p>
      </section>
      <section>
        <h2>Show what changes the conclusion</h2>
        <p>Keep the qualification visible.</p>
      </section>
    </div>
  </div>
</div>
```

```js
import Reveal from "reveal.js";

const deck = new Reveal(document.querySelector("#deck"), {
  embedded: true,
  keyboardCondition: "focused",
  transition: matchMedia("(prefers-reduced-motion: reduce)").matches ? "none" : "slide",
});
await deck.initialize();
```

Do not add `reveal-viewport` to the document or import a global theme into a reading
page. Check every slide, focus/navigation and print output. On initialization
failure keep an ordinary text outline available; do not claim a deck was verified.
