import { useContext, useEffect, useRef, useState } from 'react';
import { Waves } from './dithercn/Waves';
import { PresentationBoundary } from './presentationContext';
import './DithercnAtmosphere.css';

/** Actual upstream Waves + DitherShader, with the same sanctuary and particles as the SVG comparison. */
export function DithercnAtmosphere() {
  const appearance = useContext(PresentationBoundary)?.appearance ?? 'light';
  const supported = typeof window.matchMedia === 'function' && typeof ResizeObserver === 'function' && typeof IntersectionObserver === 'function';
  const root = useRef<HTMLDivElement>(null);
  const [mask, setMask] = useState<string>();
  useEffect(() => {
    if (!supported) return;
    const element = root.current;
    const copy = element?.closest('[data-presentation-root]')?.querySelector('.studio-hero-copy');
    if (!element || !copy) return;
    const update = () => {
      const box = element.getBoundingClientRect();
      const text = copy.getBoundingClientRect();
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${box.width}" height="${box.height}"><defs><mask id="clear"><rect width="100%" height="100%" fill="white"/><rect x="${text.x-box.x-20}" y="${text.y-box.y-16}" width="${text.width+40}" height="${text.height+32}" rx="20" fill="black"/></mask></defs><rect width="100%" height="100%" fill="white" mask="url(#clear)"/></svg>`;
      setMask(`url("data:image/svg+xml,${encodeURIComponent(svg)}")`);
    };
    const observer = new ResizeObserver(update);
    observer.observe(element); observer.observe(copy);
    window.addEventListener('resize', update);
    update();
    return () => { observer.disconnect(); window.removeEventListener('resize', update); };
  }, [supported]);
  if (!supported) return <div className="dithercn-no-webgl" />;
  return <div className="dithercn-atmosphere" ref={root} style={{maskImage:mask}}><Waves key={appearance} className="dithercn-home-waves" variant="lines" layers={8} amplitude={.75}
    palette={['transparent', '--folio-border-strong']} matrix="bayer8" cell={3} speed={.18} fps={20} stillTime={5} /></div>;
}
