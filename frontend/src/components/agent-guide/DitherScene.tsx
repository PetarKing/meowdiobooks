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
      <svg className="guide-scene-art" viewBox="0 0 400 340" fill="none" aria-hidden="true" focusable="false">
        <defs>
          {[0.12, 0.3, 0.55, 0.8].map((level, i) => <pattern key={i} id={`${id}-d${i}`} width="8" height="8" patternUnits="userSpaceOnUse"><path d={ditherPath(level)} transform="scale(2)" fill={i === 2 ? "var(--poppy)" : "currentColor"} /></pattern>)}
          <linearGradient id={`${id}-fade`} x2="0" y2="1"><stop stopColor="white" /><stop offset="1" stopColor="black" /></linearGradient>
          <mask id={`${id}-haze`}><rect width="400" height="340" fill={`url(#${id}-fade)`} /></mask>
        </defs>
        <g className="guide-scene-green" mask={`url(#${id}-haze)`}>
          <ellipse cx="204" cy="156" rx="160" ry="139" fill={`url(#${id}-d0)`} />
          <ellipse cx="204" cy="159" rx="126" ry="108" fill={`url(#${id}-d0)`} />
          <path d="M45 214Q90 160 142 185T255 155T365 176V275H45Z" fill={`url(#${id}-d1)`} />
        </g>
        <g className="guide-scene-orbit" stroke="currentColor" strokeWidth="1">
          <ellipse cx="205" cy="148" rx="162" ry="96" transform="rotate(-28 205 148)" strokeDasharray="2 7" />
          <path d="M67 82v16m-8-8h16M324 171v16m-8-8h16M273 28v12m-6-6h12" />
        </g>
        <g className="guide-scene-cherry"><circle cx="297" cy="78" r="35" fill={`url(#${id}-d1)`} /><path d="M310 46a35 35 0 0 0 17 55 35 35 0 1 1-17-55Z" fill={`url(#${id}-d2)`} /></g>
        <g className="guide-scene-pages" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
          <path d="m70 151 28-14 19 32-28 15Z" fill="var(--paper)" /><path d="m80 152 17-8m-13 15 17-8m-13 15 12-6" />
          <path d="m302 210 25 5-6 34-25-5Z" fill="var(--paper)" /><path d="m306 220 13 3m-15 5 13 3m-15 5 9 2" />
        </g>
        <ellipse cx="200" cy="306" rx="126" ry="15" className="guide-scene-green" fill={`url(#${id}-d1)`} />
        <g className="guide-scene-stack" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
          <path d="m102 281 175-9 25 18-177 12Z" fill="var(--paper)" /><path d="m125 302 177-12v10l-177 12-23-18v-13l23 21Z" fill="var(--surface-soft)" />
          <path d="m115 271 174-6 8 13-174 10Z" fill={`url(#${id}-d1)`} /><path d="m123 288 174-10M141 294l130-8" />
        </g>
        <g className="guide-scene-cat" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round">
          <path d="M245 245c58 31 95-15 60-43-22-17-36 5-17 15" strokeWidth="9" className="guide-scene-tail" />
          <path d="M144 231c-8-35 9-72 53-72 43 0 66 32 57 76l-16 28-82-1Z" fill="var(--surface-soft)" />
          <path d="M151 205c-2-24 11-35 29-40l-5 66-26 8Z" fill={`url(#${id}-d2)`} />
          <path d="m141 140-5-48 35 22c14-5 32-5 46 0l35-22-5 48c17 45-5 66-52 66s-69-23-54-66Z" fill="var(--paper)" />
          <path d="m144 108 5 24 12-12Z M244 108l-5 24-12-12Z" fill="var(--poppy)" stroke="none" />
          <path d="m146 143 22-20c7 27 32 30 32 30l-2-36c-12-3-19-1-27 0l-30-18 3 40Z" fill={`url(#${id}-d2)`} stroke="none" />
          <g className="guide-scene-sleep"><path d="M162 159q8 8 16 0m34 0q8 8 16 0" /></g>
          <g className="guide-scene-awake" fill="var(--ink)"><ellipse cx="170" cy="157" rx="4" ry="7" /><ellipse cx="220" cy="157" rx="4" ry="7" /><circle cx="171" cy="154" r="1.3" fill="var(--paper)" stroke="none" /><circle cx="221" cy="154" r="1.3" fill="var(--paper)" stroke="none" /></g>
          <path d="m190 171 5 4 5-4Z" fill="var(--poppy)" stroke="none" /><path d="M195 175v5m-9 0q5 5 9 0 4 5 9 0m-48-5-22-5m22 12-23 2m101-9 22-5m-22 12 23 2" strokeWidth="1.3" />
          <ellipse cx="159" cy="174" rx="8" ry="3" fill="var(--poppy)" opacity=".25" stroke="none" /><ellipse cx="231" cy="174" rx="8" ry="3" fill="var(--poppy)" opacity=".25" stroke="none" />
        </g>
        <g className="guide-scene-book" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
          <path d="M111 234q41-15 85 2 44-23 91-14l-17 52q-39-4-73 12-39-15-77-9Z" fill="var(--poppy)" /><path d="M118 224q40-10 78 11 41-26 83-22l-15 50q-36 0-67 17-34-15-72-13Z" fill="var(--paper)" />
          <path d="m196 235 1 45m-69-42q29-4 54 9m-51 1q29-3 51 8m-48 2q26-1 48 8m28-20q26-13 52-13m-52 23q23-12 49-13m-49 23q22-11 46-12" opacity=".45" />
          <path d="M118 224q40-10 78 11 41-26 83-22l-15 50q-36 0-67 17-34-15-72-13Z" fill={`url(#${id}-d0)`} stroke="none" />
        </g>
        <g className="guide-scene-paws" stroke="currentColor" strokeWidth="1.5" fill="var(--surface-soft)"><path d="M153 214c-14 0-13 22 0 21 16-1 15-21 0-21Zm84-4c-15 0-14 22 0 21 15 0 14-21 0-21Z" /><path d="m149 226 1 7m6-8 1 7m76-9 1 7m6-8 1 7" /></g>
        <g className="guide-scene-notes" fill="currentColor"><text x="68" y="208" fontSize="26">♪</text><text x="301" y="145" fontSize="22">♫</text><path d="m111 53 3 9 9 3-9 3-3 9-3-9-9-3 9-3Zm207 99 2 6 6 2-6 2-2 6-2-6-6-2 6-2Z" /></g>

      </svg>
  </div>;
}
