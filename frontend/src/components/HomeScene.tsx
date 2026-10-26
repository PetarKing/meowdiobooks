import { useEffect, useState } from 'react';
import { HomeAtmosphere } from './HomeAtmosphere';
import './ReadingCatCompanion.css';
import './HomeScene.css';
import './HomeHybrid.css';

/** Shared ambient SVG, ready on the first render and idle while the page is hidden. */
export function HomeScene() {
  const [hidden, setHidden] = useState(() => document.hidden);
  useEffect(() => {
    const update = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return <div className="home-scene home-scene--hybrid reading-cat-companion" data-paused={hidden} aria-hidden="true"><HomeAtmosphere /></div>;
}
