/**
 * A dotted hemisphere anchored to the bottom of the hero.
 *
 * Points are laid out on a real sphere and projected orthographically, so the
 * density falls off toward the limb the way it should rather than being faked
 * with a radial gradient. Only the front face is drawn. Everything is inline
 * SVG — no WebGL, no dependency, crisp at any width — and the single animation
 * rotates the point field about the polar axis.
 */
const SIZE = 1200;
const R = SIZE / 2;
const RINGS = 56;
const TILT = (-18 * Math.PI) / 180;

type Dot = { x: number; y: number; r: number; o: number };

/** Even-area point distribution: more points per ring near the equator. */
function sphereDots(): Dot[] {
  const dots: Dot[] = [];
  for (let i = 0; i < RINGS; i++) {
    const phi = (Math.PI * (i + 0.5)) / RINGS; // 0..π from pole to pole
    const y0 = Math.cos(phi);
    const ringRadius = Math.sin(phi);
    const count = Math.max(6, Math.round(RINGS * 2.6 * ringRadius));
    for (let j = 0; j < count; j++) {
      const theta = (2 * Math.PI * j) / count;
      const x0 = ringRadius * Math.cos(theta);
      const z0 = ringRadius * Math.sin(theta);
      // Tilt about the x axis so the pole sits slightly away from the viewer.
      const y = y0 * Math.cos(TILT) - z0 * Math.sin(TILT);
      const z = y0 * Math.sin(TILT) + z0 * Math.cos(TILT);
      if (z < 0) continue; // back face
      const depth = z; // 0 at the limb, 1 facing us
      dots.push({
        x: R + x0 * (R - 14),
        y: R - y * (R - 14),
        r: 1 + depth * 1.35,
        o: 0.08 + depth * 0.46,
      });
    }
  }
  return dots;
}

const DOTS = sphereDots();

// Unit positions on the visible cap; not real geography.
const VENUES = [
  { x: 0.3, y: 0.34, hue: "#46b3a8" },
  { x: 0.52, y: 0.22, hue: "#e0a355" },
  { x: 0.71, y: 0.4, hue: "#8b7fd4" },
];

export function HeroGlobe() {
  return (
    <div className="hero-globe" aria-hidden="true">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="presentation">
        <defs>
          <radialGradient id="globe-body" cx="50%" cy="34%" r="68%">
            <stop offset="0%" stopColor="#191921" />
            <stop offset="70%" stopColor="#101015" />
            <stop offset="100%" stopColor="#08080a" />
          </radialGradient>
          <radialGradient id="globe-bloom" cx="50%" cy="50%" r="50%">
            <stop offset="72%" stopColor="rgba(70,179,168,0)" />
            <stop offset="93%" stopColor="rgba(70,179,168,0.18)" />
            <stop offset="100%" stopColor="rgba(70,179,168,0)" />
          </radialGradient>
          <linearGradient id="globe-ring" x1="0" y1="0" x2="0.35" y2="1">
            <stop offset="0%" stopColor="#5ad0c3" />
            <stop offset="42%" stopColor="#8b7fd4" />
            <stop offset="100%" stopColor="rgba(139,127,212,0.15)" />
          </linearGradient>
        </defs>

        {/* Outer bloom, then the body, then the lit rim. */}
        <circle cx={R} cy={R} r={R} fill="url(#globe-bloom)" />
        <circle cx={R} cy={R} r={R - 10} fill="url(#globe-body)" />

        <g className="globe-field">
          {DOTS.map((d, i) => (
            <circle key={i} cx={d.x} cy={d.y} r={d.r} fill="#8fa3c4" opacity={d.o} />
          ))}
        </g>

        <circle
          cx={R}
          cy={R}
          r={R - 10}
          fill="none"
          stroke="url(#globe-ring)"
          strokeWidth="3"
          className="globe-ring"
        />

        {VENUES.map((v, i) => (
          <g key={i} className="globe-venue" style={{ animationDelay: `${i * 1.4}s` }}>
            <circle cx={v.x * SIZE} cy={v.y * SIZE} r="22" fill={v.hue} opacity="0.1" />
            <circle cx={v.x * SIZE} cy={v.y * SIZE} r="7" fill="#0a0a0b" />
            <circle cx={v.x * SIZE} cy={v.y * SIZE} r="4.5" fill={v.hue} />
          </g>
        ))}
      </svg>
    </div>
  );
}
