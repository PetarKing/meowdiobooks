import { useId } from 'react';
import { ditherPath } from './agent-guide/ditherPattern';
import type { HomeSceneDirection } from './homeSceneDirection';

export function HomeSky({ direction }: { direction: HomeSceneDirection }) {
  const id = useId().replace(/:/g, '');
  return <svg className="home-sky" viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" fill="none" focusable="false">
    <defs>
      <pattern id={`${id}-mist`} width="16" height="16" patternUnits="userSpaceOnUse"><path d={ditherPath(.18)} transform="scale(4)" fill="var(--folio-border-strong)" /></pattern>
      <pattern id={`${id}-shade`} width="12" height="12" patternUnits="userSpaceOnUse"><path d={ditherPath(.4)} transform="scale(3)" fill="var(--poppy)" /></pattern>
    </defs>
    {direction === 'wide-sky' && <>
      <g className="home-sky-halo"><circle cx="1420" cy="400" r="610" fill={`url(#${id}-mist)`} /><ellipse cx="1420" cy="450" rx="650" ry="390" transform="rotate(-22 1420 450)" stroke="currentColor" strokeDasharray="2 12" /></g>
      <g className="home-sky-waves" fill={`url(#${id}-mist)`}><path d="M-180 870Q150 490 560 790T1400 770T2110 470V1200H-180Z" /><path d="M-180 1050Q260 650 680 940T1550 880T2110 700V1200H-180Z" /></g>
    </>}
    {direction === 'moonrise' && <>
      <g className="home-sky-moon"><circle cx="1440" cy="450" r="510" fill={`url(#${id}-shade)`} /><circle cx="1440" cy="450" r="557" stroke="currentColor" strokeDasharray="2 14" /><circle cx="1440" cy="450" r="610" stroke="currentColor" opacity=".35" /></g>
      <g className="home-sky-orbits" stroke="currentColor"><ellipse cx="1240" cy="490" rx="1020" ry="210" transform="rotate(-23 1240 490)" /><ellipse cx="1240" cy="490" rx="1100" ry="250" transform="rotate(-23 1240 490)" strokeDasharray="1 12" /></g>
      <path className="home-sky-waves" d="M-100 970Q440 730 1010 925T2020 770V1150H-100Z" fill={`url(#${id}-mist)`} />
    </>}
    {direction === 'storybook' && <>
      <g className="home-sky-moon"><circle cx="420" cy="530" r="560" fill={`url(#${id}-mist)`} /></g>
      <g className="home-sky-book" stroke="currentColor" strokeWidth="1.4"><path d="M-160 1040Q150 650 770 970Q1300 700 2090 930L1910 1230H-160Z" fill={`url(#${id}-mist)`} /><path d="M-130 1090Q270 780 770 1015Q1310 830 2050 990M-130 1130Q300 850 770 1055Q1320 900 2050 1040M-130 1170Q320 920 770 1095Q1330 970 2050 1090" /><path d="m770 970 5 240" /></g>
    </>}
    <g className="home-sky-stars" fill="currentColor">{[[120,420],[860,140],[1730,230],[1550,820],[270,940],[1000,900],[670,660],[1800,970]].map(([x,y])=><path key={x} d={`M${x} ${y-9}l3 6 6 3-6 3-3 6-3-6-6-3 6-3Z`} />)}</g>
    <g className="home-sky-sheets" stroke="currentColor" strokeWidth="1.3">{[[90,700,-16],[880,720,13],[1640,160,18],[1700,920,-12]].map(([x,y,a])=><g key={x} transform={`translate(${x} ${y}) rotate(${a})`}><path d="M0 0h34v46H0Z" fill="var(--canvas)" /><path d="M7 12h20M7 20h20M7 28h14" /></g>)}</g>
  </svg>;
}
