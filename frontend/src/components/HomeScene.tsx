import { lazy, Suspense, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { HomeSceneDirection } from './homeSceneDirection';
import './ReadingCatCompanion.css';
import './HomeScene.css';

const Cat = lazy(() => import('./ReadingCatIllustration').then(module => ({ default: module.ReadingCatIllustration })));
const Sky = lazy(() => import('./HomeSky').then(module => ({ default: module.HomeSky })));

export function HomeScene({ direction }: { direction: HomeSceneDirection }) {
  const [paused, setPaused] = useState(false);
  const [hidden, setHidden] = useState(() => document.hidden);
  const { i18n } = useTranslation();
  const chinese = i18n.resolvedLanguage?.startsWith('zh');
  const label = chinese ? paused ? '播放插画' : '暂停插画' : paused ? 'Play illustration' : 'Pause illustration';
  useEffect(() => {
    const update = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return <>
    <div className={`home-scene home-scene--${direction} reading-cat-companion`} data-paused={paused || hidden} aria-hidden="true">
      <Suspense fallback={null}><Sky direction={direction} /><div className="home-scene-cat"><Cat /></div></Suspense>
    </div>
    <button className="home-scene-motion reading-cat-motion" type="button" aria-label={label} title={label} aria-pressed={paused} onClick={() => setPaused(value => !value)}>
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">{paused ? <path d="m7 4 9 6-9 6Z" /> : <path d="M7 4v12M13 4v12" />}</svg>
    </button>
  </>;
}
