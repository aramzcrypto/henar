"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { EquityLogo } from "./equity-logo";

/**
 * A fanned deck of real companies that drifts as the section travels through
 * the viewport. The page never pins: scrolling moves the page and the deck at
 * the same time.
 *
 * Position is continuous rather than stepped, so the deck is written straight
 * to the DOM inside a rAF callback. Re-rendering nine tiles every frame would
 * be wasted work; React state only carries the nearest company, which changes
 * a handful of times across the whole section.
 */
export type FanCompany = {
  ticker: string;
  name: string;
  logo: string | null;
  issuers: number;
};

const MAX_LEAN = 4;

export function LandingCompanies({ companies }: { companies: FanCompany[] }) {
  const root = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const tiles = useRef<(HTMLButtonElement | null)[]>([]);
  const [nearest, setNearest] = useState(0);

  /* Measured from the deck's own centre crossing the screen: 0 when it sits on
     the bottom edge, 1 on the top edge, so the sweep takes one screen of
     scrolling and the middle company shows while the deck is centred. Taking
     the whole element's traverse instead would spend the deck before the
     section had finished passing. */
  const progressOf = useCallback((element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    const centre = rect.top + rect.height / 2;
    return Math.min(
      Math.max((window.innerHeight - centre) / window.innerHeight, 0),
      1,
    );
  }, []);

  useEffect(() => {
    const element = root.current;
    if (!element || companies.length < 2) return;

    const last = companies.length - 1;
    const centre = last / 2;
    let frame = 0;
    let painted = Number.NaN;

    const paint = () => {
      frame = 0;
      const position = progressOf(element) * last;
      /* A scroll of a few pixels moves the deck by a fraction of a tile. Below
         that the writes are invisible, so skip the whole pass rather than
         touching 9 elements x 4 properties for nothing. */
      if (Math.abs(position - painted) < 0.004) return;
      painted = position;

      if (track.current) {
        track.current.style.setProperty("--fan-shift", `${centre - position}`);
      }
      tiles.current.forEach((tile, index) => {
        if (!tile) return;
        const offset = index - position;
        const lean = Math.max(-MAX_LEAN, Math.min(MAX_LEAN, offset));
        const distance = Math.min(Math.abs(offset), MAX_LEAN);
        const focus = Math.max(0, 1 - Math.abs(offset));
        tile.style.setProperty("--fan-rotate", `${lean * 6}deg`);
        tile.style.setProperty("--fan-lift", `${distance * 16 - focus * 10}px`);
        tile.style.setProperty("--fan-scale", `${1 + focus * 0.2}`);
        tile.style.setProperty(
          "--fan-fade",
          `${Math.max(0.16, 1 - distance * 0.24)}`,
        );
      });

      const index = Math.round(position);
      setNearest((current) => (current === index ? current : index));
    };

    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(paint);
    };

    paint();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [companies.length, progressOf]);

  /* Clicking scrolls the page to where that company sits, so the control moves
     the same thing the wheel does. */
  const scrollTo = (index: number) => {
    const element = root.current;
    if (!element) return;
    const target = index / Math.max(1, companies.length - 1);
    const delta = (progressOf(element) - target) * window.innerHeight;
    window.scrollTo({ top: window.scrollY + delta, behavior: "smooth" });
  };

  const current = companies[Math.min(nearest, companies.length - 1)];

  return (
    <div className="fan" ref={root}>
      <div className="fan-deck">
        {/* The deck slides so the nearest company sits in the middle, rather
            than the highlight travelling along a static row. */}
        <div className="fan-track" ref={track}>
          {companies.map((company, index) => (
            <button
              key={company.ticker}
              type="button"
              className="fan-tile"
              ref={(node) => {
                tiles.current[index] = node;
              }}
              aria-label={`${company.name} (${company.ticker})`}
              onClick={() => scrollTo(index)}
            >
              <EquityLogo
                logo={company.logo}
                ticker={company.ticker}
                size={62}
              />
            </button>
          ))}
        </div>
      </div>
      <p className="fan-caption" aria-live="polite">
        <b>{current.name}</b>
        <i>
          {current.ticker} · {current.issuers} issuer representations
        </i>
      </p>
    </div>
  );
}
