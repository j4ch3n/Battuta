const frame = document.querySelector("iframe");
if (frame) {
  const play = document.querySelector("#play"),
    time = document.querySelector("#time");
  const status = document.querySelector("#status");
  let running = false,
    last = 0,
    elapsed = Number(time.value);
  function seek() {
    time.value = String(elapsed);
    document.querySelector("#position").textContent = `${elapsed.toFixed(1)} s`;
    const panel = frame.contentWindow;
    if (panel?.__error) {
      status.textContent = "Simulation unavailable. Use the text alternative below.";
      stop();
    } else if (panel?.seek) panel.seek(elapsed);
  }
  function stop() {
    running = false;
    play.textContent = "Play simulation";
    play.setAttribute("aria-pressed", "false");
  }
  function tick(now) {
    if (!running) return;
    elapsed = (elapsed + (now - last) / 1000) % 30;
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
    elapsed = Number(time.value);
    seek();
  });
  document.querySelector("#reset").addEventListener("click", () => {
    stop();
    elapsed = 0;
    seek();
  });
  frame.addEventListener("load", seek);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
  });
  matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", stop);
  // Static by default, including for reduced-motion visitors; animation is opt-in.
}
