"use client";

import { useEffect, useRef, useState } from "react";
import createGlobe, { type Globe } from "cobe";

/**
 * A dotted globe anchored to the bottom of the hero.
 *
 * Rendered by cobe (MIT, ~19 KB), which rotates the sphere about its polar
 * axis on a real projection rather than spinning a flat image.
 *
 * cobe v2 drives state imperatively, so rotation runs on our own frame loop.
 * If WebGL is unavailable the canvas never fades in and the hero reads fine
 * without it, so there is no fallback artwork to maintain.
 */
export function HeroGlobe() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const node = canvas.current;
    if (!node) return;

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let width = node.offsetWidth || 900;
    let phi = 4.1;
    let frame = 0;
    let globe: Globe | null = null;

    const size = () => Math.max(width, 1) * 2;
    const onResize = () => {
      width = node.offsetWidth || width;
      globe?.update({ width: size(), height: size() });
    };

    try {
      globe = createGlobe(node, {
        devicePixelRatio: Math.min(window.devicePixelRatio || 1, 2),
        width: size(),
        height: size(),
        phi,
        theta: 0.22,
        dark: 1,
        diffuse: 1.7,
        mapSamples: 17000,
        mapBrightness: 14,
        baseColor: [0.34, 0.36, 0.43],
        markerColor: [0.27, 0.7, 0.66],
        glowColor: [0.17, 0.21, 0.27],
      });
    } catch {
      return; // No WebGL context; leave the canvas hidden.
    }

    window.addEventListener("resize", onResize);
    requestAnimationFrame(() => setReady(true));

    /* The globe is a WebGL draw on every frame. It sits in the hero, so once
       the reader has scrolled past it there is nothing to see and no reason to
       keep drawing: park the loop when it leaves the viewport or the tab goes
       to the background. */
    const spin = () => {
      phi += 0.0016;
      globe?.update({ phi });
      frame = requestAnimationFrame(spin);
    };
    const start = () => {
      if (still || frame) return;
      frame = requestAnimationFrame(spin);
    };
    const stop = () => {
      if (!frame) return;
      cancelAnimationFrame(frame);
      frame = 0;
    };

    /* Scroll-linked exit: the sphere swells and dissolves as the hero leaves,
       so it reads as passing the reader rather than sliding away. Written as
       custom properties on the wrapper, which composes them with the static
       centring transform in CSS. */
    /* closest(), not parentElement: cobe wraps the canvas in a div of its own
       at runtime, so the painted box is two levels up. */
    const stage = node.closest<HTMLElement>(".hero-globe");
    const hero = stage?.closest<HTMLElement>("section");
    let scrollFrame = 0;
    let lastStep = -1;

    const drift = () => {
      scrollFrame = 0;
      if (!stage) return;
      const span = Math.max(1, (hero?.offsetHeight ?? window.innerHeight) * 0.8);
      const progress = Math.min(Math.max(window.scrollY / span, 0), 1);
      /* Quantised: below a percent of travel the change is invisible, and
         this runs on every scroll frame. */
      const step = Math.round(progress * 100);
      if (step === lastStep) return;
      lastStep = step;
      const eased = progress * progress;
      stage.style.setProperty("--globe-scale", `${1 + eased * 0.95}`);
      stage.style.setProperty("--globe-dim", `${1 - progress}`);
    };

    const onScroll = () => {
      if (still || scrollFrame) return;
      scrollFrame = window.requestAnimationFrame(drift);
    };

    let onScreen = true;
    const watcher = new IntersectionObserver(
      ([entry]) => {
        onScreen = entry.isIntersecting;
        if (onScreen && !document.hidden) {
          start();
          window.addEventListener("scroll", onScroll, { passive: true });
        } else {
          stop();
          window.removeEventListener("scroll", onScroll);
        }
      },
      { threshold: 0 },
    );
    watcher.observe(node);

    const onVisibility = () => {
      if (!document.hidden && onScreen) start();
      else stop();
    };
    document.addEventListener("visibilitychange", onVisibility);
    start();
    if (!still) {
      window.addEventListener("scroll", onScroll, { passive: true });
      drift();
    }

    return () => {
      stop();
      if (scrollFrame) cancelAnimationFrame(scrollFrame);
      window.removeEventListener("scroll", onScroll);
      watcher.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("resize", onResize);
      globe?.destroy();
    };
  }, []);

  return (
    <div className="hero-globe" aria-hidden="true">
      <canvas
        ref={canvas}
        className={ready ? "is-ready" : undefined}
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  );
}
