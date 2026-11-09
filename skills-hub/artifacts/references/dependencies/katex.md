# KaTeX

Select `--vendor katex` for mathematical notation. Init links `vendor/katex.css`,
which imports pinned upstream CSS and fonts. Retain meaningful surrounding prose
and source notation when CDN/font rendering fails. Math notation is not proof.

```html
<div id="formula" class="artifact-math">E = mc²</div>
<p>The expression relates energy, mass and the speed of light.</p>
```

```js
import katex from "katex";

katex.render("E = mc^2", document.querySelector("#formula"), {
  displayMode: true,
  throwOnError: false,
  trust: false,
});
```

For author-controlled delimiter markup, import `renderMathInElement` from
`katex/contrib/auto-render` and call it on the smallest containing element with
`{ trust: false, throwOnError: false }`; do not rescan unrelated controls. Use
`displayMode: false` for inline math. Never enable trusted HTML/URL commands for
untrusted expressions; inspect invalid input and font/overflow behavior.
