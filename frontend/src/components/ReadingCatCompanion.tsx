import { useEffect, useState } from 'react';
import { HomeAtmosphere } from './HomeAtmosphere';
import { ReadingCatIllustration } from './ReadingCatIllustration';
import './ReadingCatCompanion.css';

/** Decorative only: never delays navigation, import, or Library controls. */
export function ReadingCatCompanion({ variant }: { variant: 'library' | 'empty' }) {
  const quiet = variant === 'library';
  const [hidden, setHidden] = useState(() => document.hidden);
  useEffect(() => {
    const update = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return <div className={`reading-cat-companion reading-cat-companion--${variant}`} data-paused={quiet || hidden}>
    {!quiet && <div className="library-atmosphere" aria-hidden="true"><HomeAtmosphere /></div>}
    <div className="reading-cat-companion-art" aria-hidden="true"><ReadingCatIllustration /></div>
  </div>;
}
