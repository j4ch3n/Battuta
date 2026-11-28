(() => {
  const list = document.getElementById("artifacts");
  const status = document.getElementById("status");
  const count = document.getElementById("artifact-count");
  const empty = document.getElementById("empty-state");
  const template = document.getElementById("artifact-template");
  const projectTemplate = document.getElementById("project-template");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const dates = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  const VISIBLE = 2; // newest works shown beside the chip; the rest wait in the deck
  const EASE = "cubic-bezier(.2,.8,.2,1)";
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

  const animated = () =>
    !reducedMotion.matches && typeof Element !== "undefined" && "animate" in Element.prototype;

  function setOpen(project, open) {
    project.classList.toggle("open", open);
    for (const control of project.querySelectorAll(".chip-toggle, .deck"))
      control.setAttribute("aria-expanded", String(open));
  }

  // Run `next` once, when the animations finish or after `ms` if one of them stalls.
  function settle(runs, ms, next) {
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      next();
    };
    Promise.all(runs).then(go, go);
    setTimeout(go, ms + 100);
  }

  // Animate the tile grid between heights so everything below slides instead of jumping.
  const resize = (tiles, from, duration, delay = 0) =>
    tiles.animate([{ height: `${from}px` }, { height: `${tiles.offsetHeight}px` }], {
      duration,
      delay,
      easing: "cubic-bezier(.4,0,.2,1)",
      fill: "backwards",
    }).finished;

  // Transform placing `card` onto `slot`, tilted in 3D like a card in flight.
  function flight(card, slot, index) {
    const rect = card.getBoundingClientRect();
    const tilt = (index % 2 ? 1 : -1) * (4 + index * 1.5);
    return `perspective(900px) translate(${slot.left - rect.left}px, ${slot.top - rect.top}px) scale(${slot.width / rect.width}) rotateZ(${tilt}deg)`;
  }

  // Where a gathered card rests: the front card flat, the next two fanned like the deck's layers.
  function resting(card, slot, index) {
    const rect = card.getBoundingClientRect();
    const [x, y, turn] = [
      [0, 0, 0],
      [7, -6, 2.5],
      [14, -12, 5],
    ][Math.min(index, 2)];
    return `translate(${slot.left - rect.left + x}px, ${slot.top - rect.top + y}px) rotate(${turn}deg)`;
  }

  function openProject(project) {
    if (project.dataset.busy || project.classList.contains("open")) return;
    const tiles = project.querySelector(".tiles");
    const slot = project.querySelector(".deck").getBoundingClientRect();
    const before = tiles.offsetHeight;
    const cards = Array.from(project.querySelectorAll(".extra"));
    setOpen(project, true);
    if (!animated()) return;
    project.dataset.busy = "";
    // Make room first, then deal the cards out of the deck into it.
    resize(tiles, before, 260);
    const runs = cards.map((card, index) => {
      card.style.zIndex = String(50 - index);
      const run = card.animate(
        [
          { transform: flight(card, slot, index) },
          {
            transform: "perspective(900px) translateY(-18px) scale(1.04) rotateX(14deg)",
            offset: 0.7,
          },
          { transform: "none" },
        ],
        { duration: 620, delay: 200 + index * 70, easing: EASE, fill: "backwards" },
      ).finished;
      return run.finally(() => (card.style.zIndex = ""));
    });
    settle(runs, 820 + cards.length * 70, () => delete project.dataset.busy);
  }

  function closeProject(project) {
    if (project.dataset.busy || !project.classList.contains("open")) return;
    const tiles = project.querySelector(".tiles");
    const cards = Array.from(project.querySelectorAll(".extra"));
    const collapse = () => {
      const before = tiles.offsetHeight;
      for (const card of cards) {
        for (const run of card.getAnimations?.() ?? []) run.cancel();
        card.style.zIndex = "";
      }
      if (cards.some((card) => card.contains(document.activeElement)))
        project.querySelector(".chip-toggle").focus({ preventScroll: true });
      setOpen(project, false);
      if (!animated()) return;
      // The deck takes the gathered cards' slot, then the empty rows close up.
      settle([resize(tiles, before, 320, 60)], 380, () => delete project.dataset.busy);
    };
    if (!animated() || !cards.length) return collapse();
    project.dataset.busy = "";
    // Gather every card into the deck's slot (the first hidden card's cell) before shrinking.
    const slot = cards[0].getBoundingClientRect();
    const runs = cards.map((card, index) => {
      card.style.zIndex = String(50 - index);
      return card.animate(
        [
          { transform: "none" },
          {
            transform: "perspective(900px) translateY(-14px) scale(1.03) rotateX(10deg)",
            offset: 0.35,
          },
          { transform: resting(card, slot, index), opacity: index > 2 ? 0 : 1 },
        ],
        {
          duration: 480,
          delay: (cards.length - 1 - index) * 60,
          easing: "cubic-bezier(.5,0,.2,1)",
          fill: "forwards",
        },
      ).finished;
    });
    settle(runs, 480 + cards.length * 60, collapse);
  }

  list.addEventListener("click", (event) => {
    const control = event.target.closest(".chip-toggle, .deck");
    if (!control || !list.contains(control)) return;
    const project = control.closest(".project");
    if (project.classList.contains("open")) closeProject(project);
    else openProject(project);
  });

  function renderDeck(project, works) {
    const deck = project.querySelector(".deck-tile");
    const toggle = project.querySelector(".chip-toggle");
    const stacked = works.length > VISIBLE;
    deck.hidden = !stacked;
    toggle.hidden = !stacked;
    if (!stacked) setOpen(project, false);
    const [first, second] = project.querySelectorAll(".deck-title");
    text(first, works[VISIBLE]?.title || "");
    text(second, works[VISIBLE + 1]?.title || "");
    text(project.querySelector(".deck-count b"), `+${Math.max(works.length - VISIBLE, 0)}`);
  }

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
      const colour = group.artifacts[0].colour || { paint: "#000000", ink: "#FFFFFF" };
      project.style.setProperty("--paint", colour.paint);
      project.style.setProperty("--ink", colour.ink);
      text(project.querySelector(".project-name"), group.name);
      text(project.querySelector(".project-count"), workCount(group.artifacts.length));
      project
        .querySelector(".chip-toggle")
        .setAttribute("aria-label", `All ${group.artifacts.length} ${group.name} works`);
      const tiles = project.querySelector(".tiles");
      const deck = project.querySelector(".deck-tile");
      for (const [rowIndex, artifact] of group.artifacts.entries()) {
        const row =
          existing.get(artifact.slug) || template.content.firstElementChild.cloneNode(true);
        existing.delete(artifact.slug);
        row.dataset.slug = artifact.slug;
        row.classList.toggle("extra", rowIndex >= VISIBLE);
        row.querySelector(".artifact-link").href = artifact.url;
        text(row.querySelector(".artifact-title"), artifact.title);
        text(row.querySelector(".artifact-description"), artifact.description);
        const time = row.querySelector("time");
        const stamp = timestamp(artifact.updated_at);
        if (Number.isFinite(stamp)) time.dateTime = new Date(stamp).toISOString();
        else time.removeAttribute("datetime");
        text(time, Number.isFinite(stamp) ? dates.format(new Date(stamp)) : "Date unavailable");
        // Leave unchanged nodes connected: polling must not reset focus or open state.
        // Tile 0 is the chip, so works start at tile 1; the deck stays last.
        if (tiles.children[rowIndex + 1] !== row)
          tiles.insertBefore(row, tiles.children[rowIndex + 1] || deck);
      }
      renderDeck(project, group.artifacts);
      if (list.children[index] !== project)
        list.insertBefore(project, list.children[index] || null);
    }
    for (const row of existing.values()) row.remove();
    for (const project of projects.values()) project.remove();
    text(count, workCount(artifacts.length));
    empty.hidden = artifacts.length > 0;
    if (hadFocus || focused === empty) {
      let destination = empty;
      if (artifacts.length) {
        destination =
          focused === empty
            ? list.children[0].querySelector(".chip-toggle")
            : list.contains(focused)
              ? focused
              : list;
        // Never leave focus on a card now hidden in a stacked deck, or on a hidden toggle.
        const project = destination.closest(".project");
        if (project && !project.classList.contains("open") && destination.closest(".extra"))
          destination = project.querySelector(".deck");
        if (destination.hidden) destination = project.querySelector(".artifact-link");
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
