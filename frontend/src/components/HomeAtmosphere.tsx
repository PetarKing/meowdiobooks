import { useId } from 'react';
import './HomeAtmosphere.css';

/** Bounded SVG layers: distant haze, wind contours, then a few nearby petals and notes. */
export function HomeAtmosphere({ waves = true }: { waves?: boolean }) {
  const id = useId().replace(/:/g, '');
  return <svg className="home-atmosphere" viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" fill="none" focusable="false">
    <defs>
      <linearGradient id={`${id}-wind`} x1="0" y1="500" x2="1920" y2="800" gradientUnits="userSpaceOnUse"><stop stopColor="var(--folio-border-strong)" stopOpacity=".15" /><stop offset=".42" stopColor="var(--folio-border-strong)" stopOpacity=".7" /><stop offset="1" stopColor="var(--poppy)" stopOpacity=".45" /></linearGradient>
      <linearGradient id={`${id}-breeze`} x1="0" y1="300" x2="1920" y2="300" gradientUnits="userSpaceOnUse"><stop stopColor="var(--folio-border-strong)" stopOpacity="0" /><stop offset=".22" stopColor="var(--folio-border-strong)" stopOpacity=".55" /><stop offset=".56" stopColor="var(--folio-border-strong)" stopOpacity=".85" /><stop offset=".83" stopColor="var(--poppy)" stopOpacity=".42" /><stop offset="1" stopColor="var(--poppy)" stopOpacity="0" /></linearGradient>
      <path id={`${id}-petal`} d="M0 0C-9-15-20-3-13 7c3 5 9 7 13 8C8 7 11-6 0 0Z" />
      <g id={`${id}-flower`}>{[0,72,144,216,288].map(angle=><path key={angle} transform={`rotate(${angle})`} d="M0 0C-10-7-13-18-6-22l6 4 6-4C13-18 10-7 0 0Z" />)}<circle r="3" fill="var(--paper)" /></g>
      <g id={`${id}-note`} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 22V2l19-4v20M4 7l19-4" /><ellipse cx="0" cy="23" rx="5" ry="3.5" fill="currentColor" stroke="none" /><ellipse cx="19" cy="19" rx="5" ry="3.5" fill="currentColor" stroke="none" /></g>
      <path id={`${id}-sparkle`} d="m0-10 2.6 7.4L10 0 2.6 2.6 0 10l-2.6-7.4L-10 0l7.4-2.6Z" />
    </defs>
    <g className="hybrid-distant" fill="var(--poppy)">
      <g transform="translate(1780 240) scale(1.8)"><use href={`#${id}-flower`} className="hybrid-float-slow" /></g>
      <g transform="translate(150 840) scale(2.2) rotate(-24)"><use href={`#${id}-petal`} className="hybrid-float-slow" /></g>
      <g transform="translate(1120 910) scale(1.6)"><use href={`#${id}-note`} className="hybrid-float-slow" /></g>
    </g>
    {waves && <><g className="hybrid-water-wash"><path d="M-200 920Q160 690 640 910T1400 850T2100 750V1180H-200Z" fill="var(--matcha-soft)" /></g>
    <g className="hybrid-wind hybrid-wind-far" stroke={`url(#${id}-breeze)`} strokeWidth="1.05" strokeLinecap="round">
      {[0,6,14,23,33,44,57,71,86,104,124].map((offset,i)=><path key={offset} opacity={.3+.65*Math.sin(Math.PI*i/10)} d={`M-180 ${340+offset*.35}C150 ${110+offset*.8} 450 ${650+offset*.3} 860 ${420+offset*.7}S1460 ${90+offset*.8} 2080 ${270+offset*.3}`} />)}
    </g>
    <g className="hybrid-wind hybrid-wind-near" stroke={`url(#${id}-wind)`} strokeWidth="1.2">
      {Array.from({length:14},(_,i)=><path key={i} d={`M-150 ${970+i*9}C300 ${610+i*13} 610 ${1140+i*4} 1050 ${880+i*10}S1550 ${690+i*9} 2100 ${780+i*13}`} />)}
    </g>
    </>}
    <g className="hybrid-petals" fill="var(--poppy)">{[[90,330,.7,-25],[320,100,.5,35],[690,660,.6,70],[970,200,.7,-20],[1360,980,.8,40],[1830,580,.8,-35],[480,1000,.5,20],[1680,140,.5,60]].map(([x,y,scale,angle],i)=><g key={x} transform={`translate(${x} ${y}) rotate(${angle}) scale(${scale})`}><use href={`#${id}-petal`} className="hybrid-petal-drift" style={{animationDelay:`-${i*2.4}s`}} /></g>)}</g>
    <g className="hybrid-blossoms" fill="var(--poppy)"><g transform="translate(70 670) scale(.6)"><use href={`#${id}-flower`} className="hybrid-float-slow" /></g><g transform="translate(1790 900) scale(.8) rotate(18)"><use href={`#${id}-flower`} className="hybrid-float-slow" /></g></g>
    <g className="hybrid-notes" color="var(--poppy)">{[[75,570,.8,-12],[800,850,.8,14],[1850,750,.9,-8],[1440,160,.6,15]].map(([x,y,scale,angle],i)=><g key={x} transform={`translate(${x} ${y}) rotate(${angle}) scale(${scale})`}><use href={`#${id}-note`} className="hybrid-float-slow" style={{animationDelay:`-${i*3}s`}} /></g>)}</g>
    <g className="hybrid-sparkles" fill="var(--poppy)">{[[85,480,.6],[630,240,.45],[1560,180,.6],[1830,730,.7],[890,1020,.4],[1080,110,.4]].map(([x,y,scale],i)=><use key={x} href={`#${id}-sparkle`} transform={`translate(${x} ${y}) scale(${scale})`} style={{animationDelay:`-${i*1.7}s`}} />)}</g>
  </svg>;
}
