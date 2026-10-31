/* Render on demand: no animation loop, including off-screen slides or reduced motion. */
for (const figure of document.querySelectorAll("[data-scene]")) {
  const status = figure.querySelector(".figure-status");
  try {
    const THREE = await import("./vendor/three.module.js");
    const host = figure.querySelector(".scene");
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    host.append(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    camera.position.set(4, 3, 5);
    camera.lookAt(0, 0, 0);
    const group = new THREE.Group();
    const envelope = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(2.5, 2.5, 2.5)),
      new THREE.LineBasicMaterial({ color: 0x185e81 }),
    );
    const working = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 1.6, 1.6),
      new THREE.MeshNormalMaterial(),
    );
    group.add(envelope, working);
    scene.add(group);
    function render() {
      const width = host.clientWidth || 640,
        height = host.clientHeight || 320;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
    }
    figure.querySelectorAll("[data-turn]").forEach((button) =>
      button.addEventListener("click", () => {
        group.rotation.y += (Number(button.dataset.turn) * Math.PI) / 8;
        render();
      }),
    );
    new ResizeObserver(render).observe(host);
    renderer.domElement.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      status.textContent = "3D context lost. Reload to retry; the caption describes the model.";
    });
    render();
    figure.dataset.state = "ready";
  } catch {
    figure.dataset.state = "error";
    status.textContent =
      "3D unavailable in this browser. Capacity contains a smaller working set plus unused headroom.";
    figure.querySelectorAll("button").forEach((button) => {
      button.disabled = true;
    });
  }
}
