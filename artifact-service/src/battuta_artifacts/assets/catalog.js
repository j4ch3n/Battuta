(() => {
  const body = document.getElementById("artifacts");
  const status = document.getElementById("status");
  let pending = false;
  let repeat = false;

  async function refresh() {
    if (pending) {
      repeat = true;
      return;
    }
    pending = true;
    try {
      const response = await fetch("/artifacts/catalog", { cache: "no-store" });
      if (!response.ok) throw new Error("Catalog unavailable");
      const { artifacts } = await response.json();
      const rows = artifacts.map((artifact) => {
        const row = document.createElement("tr");
        const title = document.createElement("td");
        const link = document.createElement("a");
        link.href = artifact.url;
        link.textContent = artifact.title;
        title.append(link);
        row.append(title);
        for (const key of ["description", "format", "updated_at"]) {
          const cell = document.createElement("td");
          cell.textContent = artifact[key];
          row.append(cell);
        }
        return row;
      });
      if (!rows.length) {
        const row = document.createElement("tr");
        const cell = document.createElement("td");
        cell.colSpan = 4;
        cell.textContent = "No artifacts registered.";
        row.append(cell);
        rows.push(row);
      }
      body.replaceChildren(...rows);
      status.textContent = "";
    } catch {
      status.textContent = "Catalog unavailable; retrying automatically.";
    } finally {
      pending = false;
      if (repeat) {
        repeat = false;
        void refresh();
      }
    }
  }

  if (typeof EventSource !== "undefined") {
    const events = new EventSource("/artifacts/events");
    events.addEventListener("catalog-changed", refresh);
    events.onopen = refresh;
    events.onerror = () => {
      status.textContent = "Live connection interrupted; checking periodically.";
    };
    window.addEventListener("pagehide", () => events.close());
  }
  // Also covers proxies buffering a nominally connected event stream.
  setInterval(refresh, 5000);
})();
