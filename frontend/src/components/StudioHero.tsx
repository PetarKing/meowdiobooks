import type { ReactNode } from "react";
import sanctuary from "../assets/brand/matcha-kami-sanctuary.webp";

/** The sanctuary frames the real import action; workflow state stays in the page. */
export function StudioHero({ eyebrow, title, description, children }: { eyebrow: string; title: ReactNode; description: string; children?: ReactNode }) {
  return <section className="studio-hero">
    <div className="studio-hero-copy">
      <div className="studio-heading-line"><span className="studio-kicker">{eyebrow}</span><span className="sanctuary-seal" aria-hidden="true">✦</span></div>
      <h1>{title}</h1><p>{description}</p>
      {children}
      <div className="sanctuary-copy-ornament" aria-hidden="true"><span /><b>✦</b><span /></div>
    </div>
    <div className="sanctuary-art" aria-hidden="true">
      <img src={sanctuary} alt="" fetchPriority="high" />
      <div className="sanctuary-art-border" />
    </div>
  </section>;
}
