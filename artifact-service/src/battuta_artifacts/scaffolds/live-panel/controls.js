const frame = document.querySelector("iframe");
if (frame) {
  const play = document.querySelector("#play"),
    time = document.querySelector("#time");
  const status = document.querySelector("#status");
  let running = false,
    last = 0;
  function seek() {
    document.querySelector("#position").textContent = `${Number(time.value).toFixed(1)} s`;
    const panel = frame.contentWindow;
    if (panel?.__error) {
      status.textContent = "Simulation unavailable. Use the text alternative below.";
      stop();
    } else if (panel?.seek) panel.seek(Number(time.value));
  }
  function stop() {
    running = false;
    play.textContent = "Play simulation";
    play.setAttribute("aria-pressed", "false");
  }
  function tick(now) {
    if (!running) return;
    time.value = String((Number(time.value) + (now - last) / 1000) % 30);
    last = now;
    seek();
    if (running) requestAnimationFrame(tick);
  }
  play.addEventListener("click", () => {
    if (running) stop();
    else {
      running = true;
      last = performance.now();
      play.textContent = "Pause simulation";
      play.setAttribute("aria-pressed", "true");
      requestAnimationFrame(tick);
    }
  });
  time.addEventListener("input", () => {
    stop();
    seek();
  });
  document.querySelector("#reset").addEventListener("click", () => {
    stop();
    time.value = "0";
    seek();
  });
  frame.addEventListener("load", seek);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
  });
  matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", stop);
  // Static by default, including for reduced-motion visitors; animation is opt-in.
}
