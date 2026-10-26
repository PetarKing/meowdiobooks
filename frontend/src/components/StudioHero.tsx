import { useContext, type ReactNode } from "react";
import { HomeSceneDirectionContext } from "./homeSceneDirection";
import { HomeScene } from "./HomeScene";
import sanctuary from "../assets/brand/matcha-kami-sanctuary.webp";

/** The scene frames the real import action; workflow state stays in the page. */
export function StudioHero({ eyebrow, title, description, children, compact = false }: { eyebrow: string; title: ReactNode; description: string; children?: ReactNode; compact?: boolean }) {
  const direction = useContext(HomeSceneDirectionContext);
  const hybrid = direction.startsWith('hybrid');
  return <section className={`studio-hero studio-hero--${direction}${direction === 'hybrid-dithercn' ? ' studio-hero--hybrid' : ''}${compact ? " studio-hero--compact" : hybrid ? " studio-empty-layout" : ""}`}>
    <div className={`studio-hero-copy${hybrid && !compact ? " studio-empty-copy" : ""}`}>
      <div className="studio-heading-line"><span className="studio-kicker">{eyebrow}</span></div>
      <h1>{title}</h1><p>{description}</p>
      {children}
    </div>
    {hybrid && <div className="sanctuary-art" aria-hidden="true"><img src={sanctuary} alt="" fetchPriority="high" /></div>}
    <HomeScene direction={direction} />
  </section>;
}
