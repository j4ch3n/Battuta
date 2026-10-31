/* Native SVG examples: each figure owns its data, status and failure fallback. */
export async function drawPlots(root = document, request = fetch) {
  await Promise.all(
    [...root.querySelectorAll("[data-plot]")].map(async (figure) => {
      const status = figure.querySelector(".figure-status");
      try {
        const response = await request(figure.dataset.plot);
        if (!response.ok) throw new Error("Plot data unavailable");
        const data = await response.json();
        if (
          !Array.isArray(data.values) ||
          !data.values.length ||
          data.values.some(
            (row) => typeof row.label !== "string" || !Number.isFinite(row.value) || row.value < 0,
          )
        )
          throw new Error("Invalid plot values");
        const ns = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(ns, "svg");
        const height = 30 + data.values.length * 60;
        svg.setAttribute("viewBox", `0 0 720 ${height}`);
        svg.setAttribute("role", "img");
        svg.setAttribute(
          "aria-label",
          data.values.map((row) => `${row.label}: ${row.value} ${data.unit || ""}`).join("; "),
        );
        const max = Math.max(1, ...data.values.map((row) => row.value));
        data.values.forEach((row, index) => {
          const y = 12 + index * 60;
          const label = document.createElementNS(ns, "text");
          label.setAttribute("x", "4");
          label.setAttribute("y", y + 25);
          label.setAttribute("fill", "#172c3e");
          label.textContent = row.label;
          const bar = document.createElementNS(ns, "rect");
          bar.setAttribute("x", "160");
          bar.setAttribute("y", y);
          bar.setAttribute("height", "36");
          bar.setAttribute("width", String((row.value / max) * 430));
          bar.setAttribute("fill", "#185e81");
          const value = document.createElementNS(ns, "text");
          value.setAttribute("x", "610");
          value.setAttribute("y", y + 25);
          value.setAttribute("fill", "#172c3e");
          value.textContent = `${row.value} ${data.unit || ""}`;
          svg.append(label, bar, value);
        });
        figure.querySelector(".plot").replaceChildren(svg);
        status.textContent = data.illustrative ? "Illustrative data — not measured evidence." : "";
        figure.dataset.state = "ready";
      } catch {
        figure.dataset.state = "error";
        status.textContent =
          "Plot unavailable. The caption and comparison table provide the values.";
      }
    }),
  );
}
if (typeof document !== "undefined") void drawPlots();
