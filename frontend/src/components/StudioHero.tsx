import type { ReactNode } from "react";
import { SoundField } from "./SoundField";

/** The artwork accompanies the import action; it never precedes the work. */
export function StudioHero({ eyebrow, title, description, children }: { eyebrow: string; title: ReactNode; description: string; children?: ReactNode }) {
  return <section className="studio-hero">
    <div className="studio-hero-copy">
      <div className="studio-heading-line"><span className="studio-kicker">{eyebrow}</span><svg className="folio-mobile-emblem" viewBox="0 0 94 70" fill="none" aria-hidden="true"><path d="M8 24c13-5 25-4 35 3v35c-11-6-22-7-35-3V24Z" fill="var(--paper)" stroke="var(--line-strong)"/><path d="M43 27c11-7 23-8 36-3v35c-13-4-24-3-36 3V27Z" fill="var(--paper)" stroke="var(--line-strong)"/><path d="M15 35h19m-19 7h19m-19 7h13m24-14h19m-19 7h19m-19 7h13" stroke="var(--muted)" opacity=".5"/><path d="M3 17h13l3-5 4 10 4-16 4 17 4-9 4 4h12l3-8 4 12 4-17 4 20 4-12 4 5h16" stroke="var(--poppy)" strokeLinecap="round"/></svg></div>
      <h1>{title}</h1><p>{description}</p>
      {children}
    </div>
    <div className="folio-installation" aria-hidden="true">
      <div className="folio-grid" />
      <div className="folio-book-fallback"><div className="folio-page left"><i /><i /><i /><i /><i /></div><div className="folio-page right"><i /><i /><i /><i /><i /></div></div>
      <SoundField />
      <div className="folio-installation-label"><span>01 — MANUSCRIPT</span><span>02 — VOICE</span><span>03 — AUDIO</span></div>
    </div>
  </section>;
}
