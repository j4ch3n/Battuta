# Chart.js

Select `--vendor chartjs` for standard quantitative charts, not relationships that
are better expressed in prose or a diagram. Init links `vendor/chartjs.css` and
maps Chart.js's required color dependency. Keep units, dates, source and a text/table
equivalent visible. Chart.js canvas alone is not an accessible explanation.

```html
<div class="artifact-chart" style="position: relative; height: 20rem">
  <canvas id="chart" role="img" aria-label="Illustrative values: A 2, B 3"></canvas>
</div>
<p>Illustrative values, not measured evidence: A = 2, B = 3.</p>
```

```js
import Chart from "chart.js/auto";

const chart = new Chart(document.querySelector("#chart"), {
  type: "bar",
  data: { labels: ["A", "B"], datasets: [{ label: "Illustrative units", data: [2, 3] }] },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    animation: !matchMedia("(prefers-reduced-motion: reduce)").matches,
  },
});
```

Use one chart per canvas and call `chart.destroy()` before reusing/removing it.
Preserve meaningful axes/scales and the evidence table on CDN/canvas failure.
