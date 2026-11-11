(() => {
  const list = document.getElementById("artifacts");
  const status = document.getElementById("status");
  const count = document.getElementById("artifact-count");
  const empty = document.getElementById("empty-state");
  const template = document.getElementById("artifact-template");
  const projectTemplate = document.getElementById("project-template");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const animations = new Map();
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

  function timestamp(value) {
    if (!value) return -Infinity;
    // Match the server's UTC interpretation of timestamps without an offset.
    const normalized = /(?:Z|[+-]\d\d:\d\d)$/i.test(value) ? value : `${value}Z`;
    const stamp = Date.parse(normalized);
    return Number.isFinite(stamp) ? stamp : -Infinity;
  }

  const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const workCount = (total) => `${total} ${total === 1 ? "work" : "works"}`;

  function groupsFor(artifacts) {
    const groups = new Map();
    for (const artifact of artifacts) {
      const key = artifact.project || "";
      if (!groups.has(key)) groups.set(key, { key, name: key || "Unassigned", artifacts: [] });
      groups.get(key).artifacts.push(artifact);
    }
    for (const group of groups.values()) {
      group.artifacts.sort((a, b) => {
        const newest = timestamp(b.updated_at) - timestamp(a.updated_at);
        return (Number.isNaN(newest) ? 0 : newest) || compare(a.slug, b.slug);
      });
    }
    return Array.from(groups.values()).sort(
      (a, b) => compare(a.name.toLowerCase(), b.name.toLowerCase()) || compare(a.key, b.key),
    );
  }

  function cancelAnimation(details) {
    const current = animations.get(details);
    if (!current) return;
    animations.delete(details);
    details.open = current.opening;
    current.animation.cancel();
    details.querySelector(".project-panel").removeAttribute("data-animating");
  }

  list.addEventListener("click", (event) => {
    const summary = event.target.closest(".project-summary");
    if (!summary || !list.contains(summary)) return;
    const details = summary.parentElement;
    const panel = details.querySelector(".project-panel");
    if (reducedMotion.matches || !panel.animate) return; // Native disclosure, including no-JS.
    event.preventDefault();
    const opening = !(animations.get(details)?.opening ?? details.open);
    const height = panel.getBoundingClientRect().height;
    cancelAnimation(details);
    details.open = true;
    if (!opening && panel.contains(document.activeElement)) summary.focus({ preventScroll: true });
    panel.dataset.animating = "";
    const animation = panel.animate(
      [
        { height: `${height}px`, opacity: opening ? 0 : 1 },
        { height: `${opening ? panel.scrollHeight : 0}px`, opacity: opening ? 1 : 0 },
      ],
      { duration: 200, easing: "ease-out", fill: "both" },
    );
    animations.set(details, { animation, opening });
    animation.onfinish = () => cancelAnimation(details);
  });
  reducedMotion.addEventListener("change", () => {
    for (const details of animations.keys()) cancelAnimation(details);
  });

  function render(artifacts) {
    const focused = document.activeElement;
    const hadFocus = list.contains(focused);
    const existing = new Map(
      Array.from(list.querySelectorAll(".artifact"), (row) => [row.dataset.slug, row]),
    );
    const projects = new Map(Array.from(list.children, (row) => [row.dataset.project, row]));
    for (const [index, group] of groupsFor(artifacts).entries()) {
      const project =
        projects.get(group.key) || projectTemplate.content.firstElementChild.cloneNode(true);
      projects.delete(group.key);
      project.dataset.project = group.key;
      text(project.querySelector(".project-name"), group.name);
      text(project.querySelector(".project-count"), workCount(group.artifacts.length));
      const rows = project.querySelector(".artifact-list");
      // Complete any transition before changing its measured contents.
      cancelAnimation(project.querySelector("details"));
      for (const [rowIndex, artifact] of group.artifacts.entries()) {
        const row =
          existing.get(artifact.slug) || template.content.firstElementChild.cloneNode(true);
        existing.delete(artifact.slug);
        row.dataset.slug = artifact.slug;
        row.querySelector(".artifact-link").href = artifact.url;
        text(row.querySelector(".artifact-title"), artifact.title);
        text(row.querySelector(".artifact-description"), artifact.description);
        const time = row.querySelector("time");
        const stamp = timestamp(artifact.updated_at);
        if (Number.isFinite(stamp)) time.dateTime = new Date(stamp).toISOString();
        else time.removeAttribute("datetime");
        text(time, Number.isFinite(stamp) ? dates.format(new Date(stamp)) : "Date unavailable");
        // Leave unchanged nodes connected: polling must not reset focus or open state.
        if (rows.children[rowIndex] !== row)
          rows.insertBefore(row, rows.children[rowIndex] || null);
      }
      if (list.children[index] !== project)
        list.insertBefore(project, list.children[index] || null);
    }
    for (const row of existing.values()) row.remove();
    for (const project of projects.values()) {
      cancelAnimation(project.querySelector("details"));
      project.remove();
    }
    text(count, workCount(artifacts.length));
    empty.hidden = artifacts.length > 0;
    if (hadFocus || focused === empty) {
      let destination = empty;
      if (artifacts.length) {
        destination =
          focused === empty
            ? list.children[0].querySelector("summary")
            : list.contains(focused)
              ? focused
              : list;
        const disclosure = destination.closest("details");
        if (disclosure && !disclosure.open) destination = disclosure.querySelector("summary");
      }
      if (document.activeElement !== destination) destination.focus({ preventScroll: true });
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
