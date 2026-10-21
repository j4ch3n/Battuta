(() => {
  const list = document.getElementById("artifacts");
  const status = document.getElementById("status");
  const count = document.getElementById("artifact-count");
  const empty = document.getElementById("empty-state");
  const template = document.getElementById("artifact-template");
  const dates = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  let pending = false;
  let repeat = false;

  function text(element, value) {
    if (element.textContent !== value) element.textContent = value;
  }

  function render(artifacts) {
    const focused = document.activeElement;
    const hadFocus = list.contains(focused);
    const existing = new Map(Array.from(list.children, (row) => [row.dataset.slug, row]));
    for (const [index, artifact] of artifacts.entries()) {
      const row = existing.get(artifact.slug) || template.content.firstElementChild.cloneNode(true);
      existing.delete(artifact.slug);
      row.dataset.slug = artifact.slug;
      const link = row.querySelector(".artifact-link");
      link.href = artifact.url;
      text(row.querySelector(".artifact-title"), artifact.title);
      text(row.querySelector(".artifact-description"), artifact.description);
      const time = row.querySelector("time");
      time.dateTime = artifact.updated_at;
      text(time, dates.format(new Date(artifact.updated_at)));
      // Leave unchanged nodes connected: polling must not reset keyboard focus.
      if (list.children[index] !== row) {
        list.insertBefore(row, list.children[index] || null);
      }
    }
    for (const row of existing.values()) row.remove();
    text(count, `${artifacts.length} ${artifacts.length === 1 ? "work" : "works"}`);
    empty.hidden = artifacts.length > 0;
    if (hadFocus || focused === empty) {
      let destination = empty;
      if (artifacts.length) {
        destination =
          focused === empty
            ? list.children[0].querySelector(".artifact-link")
            : list.contains(focused)
              ? focused
              : list;
      }
      if (document.activeElement !== destination) {
        destination.focus({ preventScroll: true });
      }
    }
  }

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
      render(artifacts);
      text(status, "");
    } catch {
      text(status, "Catalog unavailable; retrying automatically.");
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
      text(status, "Live connection interrupted; checking periodically.");
    };
    window.addEventListener("pagehide", () => events.close());
  }
  // Also covers proxies buffering a nominally connected event stream.
  setInterval(refresh, 5000);
})();
