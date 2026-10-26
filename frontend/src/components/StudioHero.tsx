import { useContext, type ReactNode } from "react";
import { HomeSceneDirectionContext } from "./homeSceneDirection";
import { HomeScene } from "./HomeScene";

/** The scene frames the real import action; workflow state stays in the page. */
export function StudioHero({ eyebrow, title, description, children, compact = false }: { eyebrow: string; title: ReactNode; description: string; children?: ReactNode; compact?: boolean }) {
  const direction = useContext(HomeSceneDirectionContext);
  return <section className={`studio-hero studio-hero--${direction}${compact ? " studio-hero--compact" : ""}`}>
    <div className="studio-hero-copy">
      <div className="studio-heading-line"><span className="studio-kicker">{eyebrow}</span></div>
      <h1>{title}</h1><p>{description}</p>
      {children}
    </div>
    <HomeScene direction={direction} />
  </section>;
}
