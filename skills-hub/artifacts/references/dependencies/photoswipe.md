# PhotoSwipe

Select `--vendor photoswipe` when readers need to inspect image detail. Init links
`vendor/photoswipe.css` with pinned upstream controls. Images must be authorized
assets added explicitly to the runtime allowlist; captions/credits remain visible.

```html
<div id="gallery" class="artifact-gallery">
  <a href="figure.jpg" data-pswp-width="1600" data-pswp-height="1000">
    <img src="figure.jpg" alt="Describe the figure's relevant evidence" />
  </a>
</div>
```

Replace the illustrative image path and dimensions with the inspected image's
actual values, and register the image before publishing.

```js
import PhotoSwipeLightbox from "photoswipe/lightbox";

const lightbox = new PhotoSwipeLightbox({
  gallery: "#gallery",
  children: "a",
  pswpModule: () => import("photoswipe"),
  showHideAnimationType: matchMedia("(prefers-reduced-motion: reduce)").matches ? "none" : "zoom",
});
lightbox.init();
```

Check keyboard open/close/focus return and mobile zoom. Ordinary image links remain
usable without JS. Call `lightbox.destroy()` when removing the gallery; missing
images require fixing asset paths/allowlists, not broad folder sharing.
