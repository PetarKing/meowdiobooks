import { lazy, Suspense, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import './ReadingCatCompanion.css';

const ReadingCat = lazy(() => import('./ReadingCatIllustration').then(module => ({ default: module.ReadingCatIllustration })));

/** Decorative only: never delays navigation, import, or Library controls. */
export function ReadingCatCompanion({ variant }: { variant: 'library' | 'empty' }) {
  const { i18n } = useTranslation();
  const quiet = variant === 'library';
  const [paused, setPaused] = useState(quiet);
  const [hidden, setHidden] = useState(() => document.hidden);
  const chinese = i18n.resolvedLanguage?.startsWith('zh');
  const label = chinese ? paused ? '播放插画' : '暂停插画' : paused ? 'Play illustration' : 'Pause illustration';
  useEffect(() => {
    const update = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return <div className={`reading-cat-companion reading-cat-companion--${variant}`} data-paused={paused || hidden}>
    <div className="reading-cat-companion-art" aria-hidden="true"><Suspense fallback={null}><ReadingCat /></Suspense></div>
    {!quiet && <button className="reading-cat-motion" type="button" onClick={() => setPaused(value => !value)} aria-label={label} title={label} aria-pressed={paused}>
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">{paused ? <path d="m7 4 9 6-9 6Z" /> : <path d="M7 4v12M13 4v12" />}</svg>
    </button>}
  </div>;
}
