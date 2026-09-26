import { useRef, type ReactNode } from "react";
import { SoundField } from "./SoundField";
import artwork from "../assets/brand/nocturne-pantheon.webp";

/** Art is decorative; the heading and all product controls remain live HTML. */
export function StudioHero({ eyebrow, title, description }: { eyebrow: string; title: ReactNode; description: string }) {
  const scene = useRef<HTMLDivElement>(null);
  function move(event: React.PointerEvent<HTMLElement>) {
    if (event.pointerType !== "mouse" || (!window.matchMedia || window.matchMedia("(prefers-reduced-motion: reduce)").matches)) return;
    const rect = event.currentTarget.getBoundingClientRect();
    scene.current?.style.setProperty("--scene-x", `${((event.clientX - rect.left) / rect.width - .5) * 12}px`);
    scene.current?.style.setProperty("--scene-y", `${((event.clientY - rect.top) / rect.height - .5) * 8}px`);
  }
  function reset() {
    scene.current?.style.setProperty("--scene-x", "0px");
    scene.current?.style.setProperty("--scene-y", "0px");
  }
  return <section className="studio-hero" onPointerMove={move} onPointerLeave={reset}>
    <div className="studio-art" ref={scene} aria-hidden="true">
      <img src={artwork} alt="" fetchPriority="high" />
      <SoundField />
      <div className="studio-stardust"><i /><i /><i /><i /><i /></div>
    </div>
    <div className="studio-hero-copy">
      <span className="studio-kicker"><i aria-hidden="true" />{eyebrow}</span>
      <h1>{title}</h1><p>{description}</p>
      <div className="studio-wave" aria-hidden="true">{Array.from({length:27},(_,i)=><i key={i} style={{"--wave-height":`${7 + Math.sin(i * .65) ** 2 * 22}px`,"--wave-delay":`${i * -85}ms`} as React.CSSProperties} />)}</div>
    </div>
    <span className="studio-art-caption" aria-hidden="true">MEOWDIOBOOKS — VOL. 01</span>
  </section>;
}
