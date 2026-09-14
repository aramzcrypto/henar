/**
 * A slowly turning ring of text closing the page. Only the top of the circle
 * sits inside the frame, fading out as it curves away, so it reads as a band
 * arcing across the foot of the page rather than a badge.
 *
 * Class names carry the landing prefix: a bare `.ring` collides with
 * Tailwind's ring utility, which paints a 1px box-shadow over the element.
 *
 * Geometry is in the SVG's own user units. The circumference is 2 * pi * R,
 * so the repeated phrase is pinned to exactly that and closes with no seam.
 */
const R = 78;
const PHRASE = "Henar · Solana · Stocks · ";

export function LandingRing() {
  return (
    <div className="lring" aria-hidden="true">
      <svg viewBox="0 0 200 200" className="lring-svg">
        <defs>
          <path
            id="lring-path"
            fill="none"
            d={`M 100,100 m -${R},0 a ${R},${R} 0 1,1 ${R * 2},0 a ${R},${R} 0 1,1 -${R * 2},0`}
          />
        </defs>
        <text
          className="lring-text"
          textLength={2 * Math.PI * R}
          lengthAdjust="spacing"
        >
          <textPath href="#lring-path" startOffset="0">
            {PHRASE.repeat(2)}
          </textPath>
        </text>
      </svg>
    </div>
  );
}
