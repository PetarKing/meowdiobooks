import type { CSSProperties } from "react";

// Six decorative petals, deliberately sparse. CSS transforms share a 14.4-second
// wind cycle (four book turns), with different phases, depths, and orientations.
const petals = [
  { top: "12%", size: 15, delay: -1.5, angle: -32, rest: "-31%", blur: 0 },
  { top: "27%", size: 10, delay: -10.2, angle: 24, rest: "35%", blur: .6 },
  { top: "64%", size: 13, delay: -4.8, angle: -16, rest: "-33%", blur: .2 },
  { top: "82%", size: 18, delay: -8.4, angle: 48, rest: "27%", blur: .2 },
  { top: "93%", size: 11, delay: -12.1, angle: -46, rest: "-23%", blur: .7 },
  { top: "4%", size: 12, delay: -6.5, angle: 70, rest: "30%", blur: .4 },
];

export function SakuraAtmosphere() {
  return <div className="book-return-atmosphere" aria-hidden="true">
    {petals.map((petal, index) => <span key={index} className="sakura-wind" style={{
      "--petal-top": petal.top,
      "--petal-size": `${petal.size}px`,
      "--petal-delay": `${petal.delay}s`,
      "--petal-angle": `${petal.angle}deg`,
      "--petal-rest": petal.rest,
      "--petal-blur": `${petal.blur}px`,
    } as CSSProperties}>
      <svg viewBox="0 0 24 32" focusable="false">
        <path d="M12 29C6 23 1 17 3 9C4 4 9 2 12 5C15 2 20 4 21 9C23 17 18 23 12 29Z" />
      </svg>
    </span>)}
  </div>;
}
