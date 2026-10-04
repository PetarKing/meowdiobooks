import type { ReactNode } from "react";
import sanctuary from "../assets/brand/matcha-kami-sanctuary.webp";

/** The sanctuary frames the real import action; workflow state stays in the page. */
export function StudioHero({ eyebrow, title, description, children, compact = false }: { eyebrow: string; title: ReactNode; description: string; children?: ReactNode; compact?: boolean }) {
  return <section className={`studio-hero${compact ? " studio-hero--compact" : ""}`}>
    <div className="studio-hero-copy">
      <div className="studio-heading-line"><span className="studio-kicker">{eyebrow}</span></div>
      <h1>{title}</h1><p>{description}</p>
      {children}
    </div>
    <div className="sanctuary-art" aria-hidden="true">
      <img src={sanctuary} alt="" fetchPriority="high" />
    </div>
  </section>;
}
