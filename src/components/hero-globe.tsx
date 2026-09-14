"use client";

import { useEffect, useRef, useState } from "react";
import createGlobe, { type Globe } from "cobe";

/**
 * A dotted globe anchored to the bottom of the hero.
 *
 * Rendered by cobe (MIT, ~19 KB), which rotates the sphere about its polar
 * axis on a real projection rather than spinning a flat image. Markers sit on
 * the exchanges whose listings Henar mirrors onchain.
 *
 * cobe v2 drives state imperatively, so rotation runs on our own frame loop.
 * If WebGL is unavailable the canvas never fades in and the hero reads fine
 * without it, so there is no fallback artwork to maintain.
 */
const MARKERS: { location: [number, number]; size: number }[] = [
  { location: [40.7128, -74.006], size: 0.045 }, // New York
  { location: [51.5074, -0.1278], size: 0.032 }, // London
  { location: [35.6762, 139.6503], size: 0.032 }, // Tokyo
  { location: [1.3521, 103.8198], size: 0.026 }, // Singapore
  { location: [50.1109, 8.6821], size: 0.024 }, // Frankfurt
  { location: [-33.8688, 151.2093], size: 0.022 }, // Sydney
];

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
        diffuse: 1.35,
        mapSamples: 17000,
        mapBrightness: 8.5,
        baseColor: [0.2, 0.22, 0.27],
        markerColor: [0.27, 0.7, 0.66],
        glowColor: [0.12, 0.16, 0.2],
        markers: MARKERS,
      });
    } catch {
      return; // No WebGL context; leave the canvas hidden.
    }

    window.addEventListener("resize", onResize);
    requestAnimationFrame(() => setReady(true));

    if (!still) {
      const spin = () => {
        phi += 0.0016;
        globe?.update({ phi });
        frame = requestAnimationFrame(spin);
      };
      frame = requestAnimationFrame(spin);
    }

    return () => {
      cancelAnimationFrame(frame);
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
