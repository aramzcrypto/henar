"use client";

import { useEffect } from "react";

/**
 * Scroll-linked depth for the landing page.
 *
 * `ScrollReveal` answers "has this arrived yet", which is a switch. This
 * answers "how far has the reader travelled", which is a dial, and it is what
 * makes a page feel like it has depth rather than a list of things that fade
 * in. Elements marked `data-scroll-depth` get a `--depth` of 0 while they sit
 * at rest and 1 once they have left the top of the viewport; the stylesheet
 * decides what to do with it, so nothing about the look lives here.
 *
 * Three rules keep it cheap. The listener is passive and coalesced into one
 * animation frame, so a fast scroll writes once per paint rather than once per
 * event. An observer stops the work entirely while the element is off screen,
 * which for a hero is most of the page. And reduced motion opts out before any
 * of it is installed, leaving the page in its resting state.
 */
export function LandingMotion() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const targets = [...document.querySelectorAll<HTMLElement>("[data-scroll-depth]")];
    if (!targets.length) return;

    const visible = new Set<HTMLElement>();
    let frame = 0;

    const write = () => {
      frame = 0;
      for (const target of visible) {
        const rect = target.getBoundingClientRect();
        /* Travel is measured against the element's own height, so the effect
           lands the same way on a short viewport as a tall one. */
        const span = rect.height || window.innerHeight;
        const depth = Math.min(1, Math.max(0, -rect.top / span));
        target.style.setProperty("--depth", depth.toFixed(4));
      }
    };

    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(write);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const target = entry.target as HTMLElement;
          if (entry.isIntersecting) visible.add(target);
          else {
            visible.delete(target);
            /* Leave it at the end state rather than mid-move, so scrolling
               back to it does not reveal a half-finished pose. */
            target.style.setProperty("--depth", entry.boundingClientRect.top < 0 ? "1" : "0");
          }
        }
        schedule();
      },
      { threshold: [0, 0.01, 1] },
    );
    for (const target of targets) observer.observe(target);

    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    schedule();

    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) window.cancelAnimationFrame(frame);
      for (const target of targets) target.style.removeProperty("--depth");
    };
  }, []);

  return null;
}
