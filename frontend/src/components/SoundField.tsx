import { useEffect, useRef } from "react";

/** Progressive enhancement: the finished illustration is always the fallback. */
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
      if (motion.matches || disposed || release) return;
      const THREE = await import("three");
      if (motion.matches || disposed || release) return;
      let renderer: InstanceType<typeof THREE.WebGLRenderer>;
      try {
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("webgl2", { alpha: true, antialias: false, powerPreference: "low-power" });
        if (!context) { host!.dataset.renderState = "static"; return; }
        renderer = new THREE.WebGLRenderer({ canvas, context, alpha: true, antialias: false, powerPreference: "low-power" });
      } catch { host!.dataset.renderState = "static"; return; }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
      renderer.setClearColor(0, 0);
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(40, 1, .1, 30);
      camera.position.z = 7;
      const field = new THREE.Group();
      scene.add(field);
      const geometry = new THREE.BufferGeometry();
      const positions = new Float32Array(180 * 3);
      // A deterministic celestial field; all vertices have real depth.
      for (let i = 0; i < 180; i++) {
        positions[i * 3] = Math.sin(i * 127.1) * 3.6;
        positions[i * 3 + 1] = Math.cos(i * 311.7) * 2.4;
        positions[i * 3 + 2] = Math.sin(i * 74.7) * 2;
      }
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      const material = new THREE.PointsMaterial({ color: 0xe6c8ff, size: .012, transparent: true, opacity: .45, depthWrite: false });
      field.add(new THREE.Points(geometry, material));
      const ribbons: InstanceType<typeof THREE.Line>[] = [];
      for (let n = 0; n < 3; n++) {
        const points = Array.from({length: 100}, (_, i) => {
          const angle = i / 99 * Math.PI * 2;
          return new THREE.Vector3(Math.cos(angle) * (1.4 + n * .16), Math.sin(angle) * .28, Math.sin(angle) * .7);
        });
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: n === 1 ? 0xf3baab : 0xd7b4ff, transparent: true, opacity: .15, depthWrite: false }));
        line.rotation.z = -.24 + n * .15;
        line.position.y = -.28;
        field.add(line); ribbons.push(line);
      }
      host!.append(renderer.domElement);
      host!.dataset.renderState = "active";
      let frame = 0;
      let stopped = false;
      let visible = true;
      let lastRender = 0;
      function draw(time: number) {
        if (disposed || stopped || !visible || document.hidden) { frame = 0; return; }
        frame = requestAnimationFrame(draw);
        if (time - lastRender < 33) return; // 30fps cap for a decorative surface.
        lastRender = time;
        field.rotation.y = Math.sin(time * .00005) * .1;
        ribbons.forEach((line, i) => { line.rotation.y = time * .00002 + i * .2; line.position.y = -.28 + Math.sin(time * .0003 + i) * .035; });
        renderer.render(scene, camera);
      }
      function resume() {
        if (!stopped && visible && !document.hidden && !frame) frame = requestAnimationFrame(draw);
      }
      const size = new ResizeObserver(() => {
        const { width, height } = host!.getBoundingClientRect();
        if (!width || !height) return;
        camera.aspect = width / height; camera.updateProjectionMatrix();
        renderer.setSize(width, height); resume();
      });
      size.observe(host!);
      const observer = new IntersectionObserver(entries => { visible = entries[0]?.isIntersecting ?? false; resume(); });
      observer.observe(host!);
      document.addEventListener("visibilitychange", resume);
      release = () => {
        stopped = true;
        cancelAnimationFrame(frame); size.disconnect(); observer.disconnect();
        document.removeEventListener("visibilitychange", resume);
        geometry.dispose(); material.dispose();
        ribbons.forEach(line => { line.geometry.dispose(); (line.material as InstanceType<typeof THREE.LineBasicMaterial>).dispose(); });
        renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
        host!.dataset.renderState = "static";
      };
      resume();
    }
    function preference() {
      if (motion.matches) { release?.(); release = undefined; }
      else void start().catch(() => { host!.dataset.renderState = "static"; });
    }
    host.dataset.renderState = "static";
    motion.addEventListener("change", preference);
    preference();
    return () => { disposed = true; motion.removeEventListener("change", preference); release?.(); };
  }, []);
  return <div ref={hostRef} className="sound-field" aria-hidden="true" />;
}
