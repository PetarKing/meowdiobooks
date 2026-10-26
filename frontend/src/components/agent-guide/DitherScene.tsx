import { ReadingCatIllustration } from '../ReadingCatIllustration';
import { useEffect, useId, useState } from 'react';
import { ditherPath } from './ditherPattern';

/** Guide-only SVG scenery. CSS animates transforms; hidden tabs and reduced motion stay still. */
export function DitherScene({ paused }: { paused: boolean }) {
  const id = useId().replace(/:/g, '');
  const [hidden, setHidden] = useState(() => document.hidden);
  useEffect(() => {
    const update = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return <div className="guide-scene" data-paused={paused || hidden} aria-hidden="true">
    <svg className="guide-scene-sky" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" fill="none" focusable="false">
      <defs>
        <pattern id={`${id}-sky`} width="12" height="12" patternUnits="userSpaceOnUse"><path d={ditherPath(0.3)} transform="scale(3)" fill="currentColor" /></pattern>
        <pattern id={`${id}-mist`} width="12" height="12" patternUnits="userSpaceOnUse"><path d={ditherPath(0.12)} transform="scale(3)" fill="currentColor" /></pattern>
      </defs>
      <g className="guide-sky-halo"><circle cx="1280" cy="390" r="470" fill={`url(#${id}-mist)`} /><circle cx="1280" cy="390" r="320" stroke="currentColor" strokeDasharray="2 12" /></g>
      <g className="guide-sky-ribbons" fill={`url(#${id}-mist)`}>
        <path d="M-180 760Q100 430 420 700T1080 660T1780 440V1000H-180Z" />
        <path d="M-180 900Q170 570 490 820T1150 720T1780 620V1000H-180Z" />
      </g>
      <g className="guide-sky-stars" fill="currentColor">{[[1040,100],[1430,520],[180,780],[850,830],[1380,850],[720,170]].map(([x,y]) => <path key={x} d={`M${x} ${y-10}l3 7 7 3-7 3-3 7-3-7-7-3 7-3Z`} />)}</g>
      <g className="guide-sky-sheets" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
        {[[930,230,-18],[1460,670,16],[760,900,-10]].map(([x,y,angle]) => <g key={x} transform={`translate(${x} ${y}) rotate(${angle})`}><path d="M0 0h40v54H0Z" fill="var(--paper)" /><path d="M8 14h24M8 23h24M8 32h18" /><path d="M0 0h40v54H0Z" fill={`url(#${id}-mist)`} /></g>)}
      </g>
    </svg>
    <ReadingCatIllustration />
  </div>;
}
