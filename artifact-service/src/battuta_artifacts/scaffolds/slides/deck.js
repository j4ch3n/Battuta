const deck = document.querySelector("#deck");
if (deck) {
  const slides = [...deck.querySelectorAll(".slide")];
  let current = 0;
  const previous = document.querySelector("#previous"),
    next = document.querySelector("#next");
  function show(index) {
    current = Math.max(0, Math.min(index, slides.length - 1));
    slides.forEach((slide, i) => {
      slide.hidden = i !== current;
      slide.inert = i !== current;
    });
    previous.disabled = current <= 0;
    next.disabled = current >= slides.length - 1;
    document.querySelector("#position").textContent = slides.length
      ? `${current + 1} / ${slides.length}`
      : "No slides";
    const slide = slides[current];
    document.querySelector("#overflow").hidden =
      !slide || (slide.scrollHeight <= 1080 && slide.scrollWidth <= 1920);
  }
  function fit() {
    deck.style.setProperty(
      "--scale",
      Math.min(innerWidth / 1920, Math.max(1, innerHeight - 72) / 1080),
    );
    show(current);
  }
  previous.addEventListener("click", () => show(current - 1));
  next.addEventListener("click", () => show(current + 1));
  addEventListener("keydown", (event) => {
    if (
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.target.closest("button, a, input, textarea, select, [contenteditable]")
    )
      return;
    const keys = {
      ArrowRight: current + 1,
      PageDown: current + 1,
      " ": current + 1,
      ArrowLeft: current - 1,
      PageUp: current - 1,
      Home: 0,
      End: slides.length - 1,
    };
    if (event.key in keys) {
      event.preventDefault();
      show(keys[event.key]);
    }
  });
  addEventListener("resize", fit);
  new ResizeObserver(() => show(current)).observe(deck);
  if (document.fonts) document.fonts.ready.then(fit);
  fit();
}
