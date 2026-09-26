import { useEffect, useRef } from "react";

/** A paper-to-sound sculpture. Static CSS pages are always available behind it. */
export function SoundField() {
  const hostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.dataset.renderState = "static";
    if (typeof window.matchMedia !== "function" || typeof ResizeObserver !== "function" || typeof IntersectionObserver !== "function") return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let disposed = false;
    let release: (() => void) | undefined;
    async function start() {
      if (motion.matches || disposed || release || !host!.getBoundingClientRect().width) return;
      const THREE = await import("three");
      if (motion.matches || disposed || release || !host!.getBoundingClientRect().width) return;
      let renderer: InstanceType<typeof THREE.WebGLRenderer>;
      try {
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("webgl2", { alpha: true, antialias: true, powerPreference: "low-power" });
        if (!context) return;
        renderer = new THREE.WebGLRenderer({ canvas, context, alpha: true, antialias: true, powerPreference: "low-power" });
      } catch { return; }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
      renderer.setClearColor(0, 0);
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(36, 1, .1, 30);
      camera.position.set(3.5, 4.6, 5.8); camera.lookAt(0, .2, 0);
      scene.add(new THREE.HemisphereLight(0xfff8df, 0x526768, 3));
      const light = new THREE.DirectionalLight(0xffe0b3, 2.4); light.position.set(-3, 5, 2); scene.add(light);
      const sculpture = new THREE.Group(); scene.add(sculpture);
      const geometries: InstanceType<typeof THREE.BufferGeometry>[] = [];
      const materials: InstanceType<typeof THREE.Material>[] = [];
      const paper = new THREE.MeshStandardMaterial({ color: 0xfff4da, roughness: .92, metalness: 0, side: THREE.DoubleSide });
      const cover = new THREE.MeshStandardMaterial({ color: 0x31534f, roughness: .75 });
      const print = new THREE.LineBasicMaterial({ color: 0x777967, transparent: true, opacity: .48 });
      const signal = new THREE.LineBasicMaterial({ color: 0xd35a3b, transparent: true, opacity: .8 });
      materials.push(paper, cover, print, signal);
      for (const side of [-1, 1]) {
        for (let leaf = 0; leaf < 7; leaf++) {
          const vertices: number[] = []; const indices: number[] = [];
          const sample = (u: number, v: number) => new THREE.Vector3(side * u * 1.75, .06 + leaf * .018 + Math.sin(u * Math.PI) * (.22 + leaf * .025) + u * leaf * .024, (v - .5) * 2.35);
          for (let row = 0; row <= 16; row++) for (let col = 0; col <= 24; col++) { const p = sample(col / 24, row / 16); vertices.push(p.x, p.y, p.z); }
          for (let row = 0; row < 16; row++) for (let col = 0; col < 24; col++) { const a = row * 25 + col; indices.push(a, a + 1, a + 25, a + 1, a + 26, a + 25); }
          const geometry = new THREE.BufferGeometry(); geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3)); geometry.setIndex(indices); geometry.computeVertexNormals(); geometries.push(geometry);
          sculpture.add(new THREE.Mesh(geometry, paper));
          if (leaf === 6) for (let line = 0; line < 13; line++) {
            const points = Array.from({ length: 20 }, (_, col) => { const p = sample(.16 + col / 19 * (.7 - (line % 4 === 0 ? .12 : 0)), .15 + line * .053); p.y += .008; return p; });
            const g = new THREE.BufferGeometry().setFromPoints(points); geometries.push(g); sculpture.add(new THREE.Line(g, print));
          }
        }
        const g = new THREE.BoxGeometry(1.85, .075, 2.48); geometries.push(g);
        const mesh = new THREE.Mesh(g, cover); mesh.position.set(side * .925, -.025, 0); sculpture.add(mesh);
      }
      const waves: InstanceType<typeof THREE.Line>[] = [];
      for (let row = 0; row < 4; row++) {
        const points = Array.from({length: 100}, (_, i) => { const x = i / 99; return new THREE.Vector3((x - .5) * 4.7, .9 + Math.sin(x * Math.PI * 7 + row * .6) * .16 * Math.sin(x * Math.PI), -.5 - row * .18); });
        const g = new THREE.BufferGeometry().setFromPoints(points); geometries.push(g);
        const wave = new THREE.Line(g, signal); sculpture.add(wave); waves.push(wave);
      }
      host!.append(renderer.domElement); host!.dataset.renderState = "active";
      let frame = 0; let stopped = false; let visible = true; let lastRender = 0;
      function draw(time: number) {
        if (disposed || stopped || !visible || document.hidden) { frame = 0; return; }
        frame = requestAnimationFrame(draw); if (time - lastRender < 33) return;
        lastRender = time; sculpture.rotation.y = -.13 + Math.sin(time * .00015) * .08;
        sculpture.position.y = Math.sin(time * .00045) * .035;
        waves.forEach((line, index) => { line.position.y = Math.sin(time * .0007 + index) * .06; });
        renderer.render(scene, camera);
      }
      function resume() { if (!stopped && visible && !document.hidden && !frame) frame = requestAnimationFrame(draw); }
      const size = new ResizeObserver(() => { const {width,height} = host!.getBoundingClientRect(); if (!width || !height) return; camera.aspect = width / height; camera.updateProjectionMatrix(); renderer.setSize(width,height); resume(); }); size.observe(host!);
      const observer = new IntersectionObserver(entries => { visible = entries[0]?.isIntersecting ?? false; resume(); }); observer.observe(host!);
      document.addEventListener("visibilitychange", resume);
      release = () => { stopped = true; cancelAnimationFrame(frame); size.disconnect(); observer.disconnect(); document.removeEventListener("visibilitychange", resume); geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); host!.dataset.renderState = "static"; };
      resume();
    }
    function preference() { if (motion.matches) { release?.(); release = undefined; } else void start().catch(() => { host!.dataset.renderState = "static"; }); }
    const layout = new ResizeObserver(() => {
      if (!host!.getBoundingClientRect().width) { release?.(); release = undefined; }
      else preference();
    });
    layout.observe(host);
    motion.addEventListener("change", preference); preference();
    return () => { disposed = true; layout.disconnect(); motion.removeEventListener("change", preference); release?.(); };
  }, []);
  return <div ref={hostRef} className="sound-field" aria-hidden="true" />;
}
