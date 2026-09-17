"use client";

import { useEffect, useRef } from "react";

/**
 * The light the landing page sits in.
 *
 * The page was one flat #0a0a0b from the fold to the footer, so every section
 * read as the same distance away and the long gaps between them looked like
 * nothing rather than like space. This is the cheapest honest fix: a few very
 * large, very dim pools of colour behind everything, which give the dark a
 * direction and let a section arrive somewhere rather than simply appear.
 *
 * It is decoration and it behaves like it. Fixed, `pointer-events: none`,
 * painted below every section, no layout, no text, nothing to read. The
 * movement is deliberately slower than the eye tracks: the point is that the
 * background is not a flat sheet, not that anything is happening.
 *
 * Two inputs, both written as CSS variables so the animation stays on the
 * compositor and React never re-renders:
 *  - the pointer, eased, which gives the orbs a little parallax depth;
 *  - scroll progress, which drifts them as the page advances so the Earn
 *    section is not lit exactly like the hero.
 *
 * Off entirely under `prefers-reduced-motion`, and the pointer half is off on
 * coarse pointers, where there is no cursor to follow and the listener would
 * only cost battery.
 */
export function LandingAtmosphere() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const fine = window.matchMedia("(pointer: fine)").matches;
    let frame = 0;
    /* Target is where the pointer is; current is where the light has got to.
       Easing between them is what stops the orbs snapping to the cursor and
       turning a background into a toy. */
    let targetX = 0;
    let targetY = 0;
    let currentX = 0;
    let currentY = 0;
    let scroll = 0;
    let running = true;

    const onPointer = (event: PointerEvent) => {
      targetX = event.clientX / window.innerWidth - 0.5;
      targetY = event.clientY / window.innerHeight - 0.5;
    };

    const onScroll = () => {
      const span = document.body.scrollHeight - window.innerHeight;
      scroll = span > 0 ? Math.min(window.scrollY / span, 1) : 0;
    };

    const tick = () => {
      if (!running) return;
      currentX += (targetX - currentX) * 0.045;
      currentY += (targetY - currentY) * 0.045;
      root.style.setProperty("--ax", currentX.toFixed(4));
      root.style.setProperty("--ay", currentY.toFixed(4));
      root.style.setProperty("--sy", scroll.toFixed(4));
      frame = requestAnimationFrame(tick);
    };

    /* A hidden tab should not be animating. The page is long and people leave
       it open; a background that keeps painting off-screen is pure waste. */
    const onVisibility = () => {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(frame);
      } else if (!running) {
        running = true;
        frame = requestAnimationFrame(tick);
      }
    };

    onScroll();
    if (fine) window.addEventListener("pointermove", onPointer, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    frame = requestAnimationFrame(tick);

    return () => {
      running = false;
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <div className="atmos" ref={ref} aria-hidden="true">
      <span className="atmos-orb atmos-orb-a" />
      <span className="atmos-orb atmos-orb-b" />
      <span className="atmos-orb atmos-orb-c" />
      <span className="atmos-orb atmos-orb-d" />
      <span className="atmos-grain" />
      <span className="atmos-vignette" />
    </div>
  );
}
