import { lazy, Suspense, useEffect, useState } from 'react';
import './ReadingCatCompanion.css';

const Atmosphere = lazy(() => import('./HomeAtmosphere').then(module => ({ default: module.HomeAtmosphere })));
const ReadingCat = lazy(() => import('./ReadingCatIllustration').then(module => ({ default: module.ReadingCatIllustration })));

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
    {!quiet && <div className="library-atmosphere" aria-hidden="true"><Suspense fallback={null}><Atmosphere /></Suspense></div>}
    <div className="reading-cat-companion-art" aria-hidden="true"><Suspense fallback={null}><ReadingCat /></Suspense></div>
  </div>;
}
