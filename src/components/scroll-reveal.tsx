"use client";

import { useEffect } from "react";

/**
 * One observer for the whole page rather than a wrapper component per element:
 * the sections stay server components and the markup stays flat. Elements opt
 * in with data-reveal and are marked data-in once, so nothing re-animates when
 * the reader scrolls back up.
 */
/* Transition is 0.75s; the longest stagger in use is 0.27s. */
const SETTLE_MS = 1300;

export function ScrollReveal() {
  useEffect(() => {
    const targets = document.querySelectorAll<HTMLElement>(
      "[data-reveal]:not([data-in])",
    );
    if (!targets.length) return;

    const timers: number[] = [];

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduced.matches) {
      for (const target of targets) {
        target.dataset.in = "";
        target.dataset.settled = "";
      }
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const target = entry.target as HTMLElement;
          target.dataset.in = "";
          observer.unobserve(target);
          /* Release the compositor layer once the move is over. On a timer
             rather than transitionend, which does not fire for a transition
             the browser skips or interrupts - and a layer that is never handed
             back is the thing worth avoiding. */
          timers.push(
            window.setTimeout(() => {
              target.dataset.settled = "";
            }, SETTLE_MS),
          );
        }
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.08 },
    );
    for (const target of targets) observer.observe(target);
    return () => {
      observer.disconnect();
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, []);

  return null;
}
