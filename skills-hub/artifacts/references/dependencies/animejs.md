# Anime.js

Select `--vendor animejs` when motion explains a change in an author-owned element.
Init links `vendor/animejs.css`. Do not animate live-diagram's managed SVG/state or
chart internals. Keep the conclusion and controls useful without motion.

```html
<button id="replay" type="button">Replay emphasis</button>
<p id="finding" class="artifact-motion">The supported finding remains readable.</p>
```

```js
import { animate } from "animejs";

document.querySelector("#replay").onclick = () => {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  animate("#finding", { opacity: [0.5, 1], duration: 400 });
};
```

No autoplay or invisible-at-rest text. Supply pause/reset for sustained sequences;
use one event model for related captions/state. Stop active animations before
removing their elements. On import failure the static finding is still the result.
