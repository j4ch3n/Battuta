# Three.js

Select `--vendor three` only when depth/spatial relationships teach something a
2D figure cannot. Init links `vendor/three.css`; core and `three/addons/` share
compatible pinned mappings. WebGL availability is a runtime boundary.

```html
<div id="scene" class="artifact-three" aria-label="Illustrative cube"></div>
<p>A cube illustrates depth; it is not a measured model.</p>
```

```js
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const host = document.querySelector("#scene");
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(host.clientWidth, 320);
host.append(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, host.clientWidth / 320, 0.1, 100);
camera.position.z = 4;
scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshNormalMaterial()));
const controls = new OrbitControls(camera, renderer.domElement);
const render = () => renderer.render(scene, camera);
controls.addEventListener("change", render);
render();
```

Avoid perpetual animation. Add labeled keyboard alternatives for any consequential
view/control. Resize camera/renderer together, and dispose controls, renderer,
geometry and materials when removing the scene. Catch initialization failures in
production and retain a static/text alternative; a WebGL failure is not data loss.
