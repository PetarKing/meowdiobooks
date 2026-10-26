import type { ReactNode } from "react";
import { HomeScene } from "./HomeScene";
import sanctuary from "../assets/brand/matcha-kami-sanctuary.webp";

/** The scene frames the real import action; workflow state stays in the page. */
export function StudioHero({ eyebrow, title, description, children, compact = false }: { eyebrow: string; title: ReactNode; description: string; children?: ReactNode; compact?: boolean }) {
  return <section className={`studio-hero studio-hero--hybrid${compact ? " studio-hero--compact" : " studio-empty-layout"}`}>
    <div className={`studio-hero-copy${!compact ? " studio-empty-copy" : ""}`}>
      <div className="studio-heading-line"><span className="studio-kicker">{eyebrow}</span></div>
      <h1>{title}</h1><p>{description}</p>
      {children}
    </div>
    <div className="sanctuary-art" aria-hidden="true"><img src={sanctuary} alt="" fetchPriority="high" /></div>
    <HomeScene />
  </section>;
}
