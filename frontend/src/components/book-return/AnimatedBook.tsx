import { useEffect, useRef } from "react";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

// Procedural decoration: no external models, images, fonts, or requests.
const PAGE_WIDTH = 1.22;
const PAGE_DEPTH = 1.78;
const SEGMENTS = 48;
const ROWS = 12;
const PERIOD = 3.6;
const liftHeight = (progress: number) => .009 * Math.sin(progress * Math.PI);

function pageTexture(seed: number) {
  const canvas = document.createElement("canvas");
  canvas.width = 512; canvas.height = 768;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#f8f3e6"; ctx.fillRect(0, 0, 512, 768);
  ctx.fillStyle = "#b0aa95";
  // Decorative typesetting: short strokes, rather than invented book content.
  ctx.fillRect(205, 114, 102, 3);
  let n = seed;
  const random = () => { n = (n * 16807) % 2147483647; return n / 2147483647; };
  for (let row = 0; row < 20; row++) {
    const y = 167 + row * 22;
    const end = row % 7 === 6 ? 310 + random() * 110 : 434;
    for (let x = row % 7 === 0 ? 95 : 78; x < end;) {
      const width = Math.min(8 + random() * 26, end - x);
      ctx.fillRect(x, y, width, 2.6); x += width + 5 + random() * 5;
    }
  }
  ctx.fillRect(247, 681, 18, 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function clothTexture() {
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#888"; ctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 128; i += 4) {
    ctx.fillStyle = "#aaa"; ctx.fillRect(i, 0, 1, 128);
    ctx.fillStyle = "#777"; ctx.fillRect(0, i, 128, 1);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(5, 7);
  return texture;
}

function contactShadowTexture() {
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(128, 128, 25, 128, 128, 128);
  gradient.addColorStop(0, "rgba(24, 31, 20, .18)");
  gradient.addColorStop(.5, "rgba(24, 31, 20, .10)");
  gradient.addColorStop(1, "rgba(24, 31, 20, 0)");
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(canvas);
}

function makePageGeometry() {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array((SEGMENTS + 1) * (ROWS + 1) * 3);
  const uvs = new Float32Array((SEGMENTS + 1) * (ROWS + 1) * 2);
  const indices: number[] = [];
  for (let row = 0; row <= ROWS; row++) for (let col = 0; col <= SEGMENTS; col++) {
    const index = row * (SEGMENTS + 1) + col;
    uvs[index * 2] = col / SEGMENTS; uvs[index * 2 + 1] = 1 - row / ROWS;
    if (row < ROWS && col < SEGMENTS) {
      const a = index, b = a + 1, c = a + SEGMENTS + 1, d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

// Integrate the sheet from its fixed hinge. Its outer edge trails the turn,
// so the page bows and unfurls instead of rotating as a rigid rectangle.
function shapePage(geometry: THREE.BufferGeometry, progress: number, height: number) {
  const positions = geometry.getAttribute("position") as THREE.BufferAttribute;
  const angle = progress * Math.PI;
  const lift = Math.sin(angle);
  for (let row = 0; row <= ROWS; row++) {
    const v = row / ROWS;
    let x = 0, y = height;
    for (let col = 0; col <= SEGMENTS; col++) {
      const u = col / SEGMENTS;
      if (col > 0) {
        const bend = -.94 * lift * Math.pow(u, 1.25);
        const twist = .13 * lift * Math.sin(Math.PI * u) * (v - .5);
        const localAngle = angle + bend + twist;
        x += Math.cos(localAngle) * PAGE_WIDTH / SEGMENTS;
        y += Math.sin(localAngle) * PAGE_WIDTH / SEGMENTS;
      }
      const arch = .065 * Math.sin(Math.PI * u) * (1 - .55 * lift);
      positions.setXYZ(row * (SEGMENTS + 1) + col, x, y + arch, (v - .5) * PAGE_DEPTH);
    }
  }
  positions.needsUpdate = true; geometry.computeVertexNormals(); geometry.computeBoundingSphere();
}

export default function AnimatedBook({ appearance }: { appearance: "light" | "dark" }) {
  const mount = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = mount.current!;
    if (typeof window.matchMedia !== "function" || typeof WebGL2RenderingContext === "undefined") { host.dataset.renderer = "fallback"; return; }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    host.dataset.renderer = "fallback";
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); }
    catch { host.dataset.renderer = "fallback"; return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(300, 260);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.VSMShadowMap;
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1.9, 1.9, 1.647, -1.647, .1, 30);
    camera.position.set(.25, 5, 6); camera.lookAt(0, .42, 0);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x868674, 2));
    const key = new THREE.DirectionalLight(0xfff6df, 3.1);
    key.position.set(-3, 6, 3); key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024); key.shadow.camera.left = key.shadow.camera.bottom = -2.2;
    key.shadow.camera.right = key.shadow.camera.top = 2.2;
    key.shadow.bias = -.0005; key.shadow.normalBias = .01; key.shadow.radius = 4; key.shadow.blurSamples = 8;
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, .6); fill.position.set(3, 2, -3); scene.add(fill);
    // Soft contact under the stationary book; the turning leaf casts onto the
    // spread itself, avoiding a distracting detached shadow on the background.
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(3.8, 3.1), new THREE.MeshBasicMaterial({ map: contactShadowTexture(), transparent: true, depthWrite: false, opacity: appearance === "dark" ? .8 : 1 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -.035; scene.add(ground);
    const book = new THREE.Group(); book.rotation.y = -.13; scene.add(book);

    const cloth = clothTexture();
    const coverMaterial = new THREE.MeshStandardMaterial({ color: 0x40563c, roughness: .9, bumpMap: cloth, bumpScale: .014 });
    const paperEdge = new THREE.MeshStandardMaterial({ color: 0xe5ddc7, roughness: 1 });
    for (const side of [-1, 1]) {
      const cover = new THREE.Mesh(new RoundedBoxGeometry(1.35, .065, 1.98, 3, .035), coverMaterial);
      cover.position.set(side * .66, .017, 0); cover.castShadow = cover.receiveShadow = true; book.add(cover);
      const block = new THREE.Mesh(new RoundedBoxGeometry(1.21, .135, 1.8, 2, .02), paperEdge);
      block.position.set(side * .614, .128, 0); block.castShadow = block.receiveShadow = true; book.add(block);
      // Thin actual layers make the fore-edge read as paper, not a white slab.
      for (let layer = 0; layer < 6; layer++) {
        const geometry = makePageGeometry(); shapePage(geometry, side === 1 ? 0 : 1, .2 + layer * .008);
        const material = new THREE.MeshStandardMaterial({ color: layer % 2 ? 0xf3ebd8 : 0xe4dcc8, roughness: 1, side: THREE.DoubleSide });
        const leaf = new THREE.Mesh(geometry, material); leaf.receiveShadow = true; book.add(leaf);
      }
      const geometry = makePageGeometry(); shapePage(geometry, side === 1 ? 0 : 1, .251);
      const material = new THREE.MeshStandardMaterial({ map: pageTexture(23), roughness: .93, side: THREE.DoubleSide });
      const page = new THREE.Mesh(geometry, material); page.castShadow = page.receiveShadow = true; book.add(page);
    }
    const spine = new THREE.Mesh(new RoundedBoxGeometry(.105, .055, 1.96, 3, .02), coverMaterial);
    spine.position.y = .025; book.add(spine);

    // The ribbon emerges from below the page stack, then folds over the fore-edge.
    const ribbonGeometry = new THREE.BufferGeometry();
    ribbonGeometry.setAttribute("position", new THREE.Float32BufferAttribute([
      .79, .214, .77, .96, .214, .77, .79, .21, .92, .96, .21, .92,
      .79, .035, 1.12, .96, .035, 1.12, .79, .008, 1.24, .96, .008, 1.24, .875, .008, 1.185,
    ], 3));
    ribbonGeometry.setIndex([0, 2, 1, 1, 2, 3, 2, 4, 3, 3, 4, 5, 4, 6, 8, 4, 8, 5, 5, 8, 7]);
    ribbonGeometry.computeVertexNormals();
    const ribbon = new THREE.Mesh(ribbonGeometry, new THREE.MeshStandardMaterial({ color: 0xa73552, roughness: .65, side: THREE.DoubleSide }));
    ribbon.castShadow = true; book.add(ribbon);

    const movingGeometry = makePageGeometry();
    const movingMaterial = new THREE.MeshStandardMaterial({ map: pageTexture(23), roughness: .94, side: THREE.DoubleSide });
    const movingPage = new THREE.Mesh(movingGeometry, movingMaterial);
    movingPage.castShadow = movingPage.receiveShadow = true; book.add(movingPage);
    let frame = 0, disposed = false, contextLost = false;
    let started = 0;
    const draw = (seconds: number) => {
      const phase = ((seconds % PERIOD) + PERIOD) % PERIOD / PERIOD;
      const raw = THREE.MathUtils.clamp((phase - .1) / .74, 0, 1);
      const progress = raw * raw * (3 - 2 * raw);
      movingPage.visible = !reduced.matches && raw > 0 && raw < 1;
      shapePage(movingGeometry, progress, .254 + liftHeight(progress));
      renderer.render(scene, camera);
    };
    const animate = () => {
      if (disposed || contextLost || reduced.matches || document.hidden) return;
      draw((performance.now() - started) / 1000); frame = requestAnimationFrame(animate);
    };
    const restart = () => {
      cancelAnimationFrame(frame);
      if (contextLost || disposed) return;
      // Keep the canvas hidden through shader compilation and the first render.
      // Start motion from rest only after that frame is ready to reveal.
      draw(0);
      host.dataset.renderer = "webgl";
      started = performance.now();
      if (!reduced.matches && !document.hidden) frame = requestAnimationFrame(animate);
    };
    const onContextLost = () => {
      contextLost = true; cancelAnimationFrame(frame); host.dataset.renderer = "fallback";
      renderer.domElement.hidden = true;
    };
    renderer.domElement.addEventListener("webglcontextlost", onContextLost);
    reduced.addEventListener("change", restart); document.addEventListener("visibilitychange", restart);
    restart();
    return () => {
      disposed = true; cancelAnimationFrame(frame); host.dataset.renderer = "fallback";
      reduced.removeEventListener("change", restart); document.removeEventListener("visibilitychange", restart);
      scene.traverse(object => { if (object instanceof THREE.Mesh) { object.geometry.dispose(); for (const material of Array.isArray(object.material) ? object.material : [object.material]) { for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose(); material.dispose(); } } });
      renderer.domElement.removeEventListener("webglcontextlost", onContextLost);
      renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
    };
  }, [appearance]);
  return <div ref={mount} className="book-return-3d" aria-hidden="true"></div>;
}
