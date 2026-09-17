"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "henar.theme.v1";

/**
 * The script that runs before the first paint.
 *
 * Without it the page renders in the default theme and then corrects itself
 * once React has mounted, which on a dark-default product means a white flash
 * for anyone who chose light, and a black one for anyone who chose dark on a
 * light system. Reading the choice and stamping the attribute synchronously in
 * `<head>` is the only way to avoid that.
 *
 * It must never throw: storage access alone raises in a locked-down browser,
 * and a failure here would block the whole document.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var c=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(c==="light"||c==="dark"){document.documentElement.setAttribute("data-theme",c)}}catch(e){}})()`;

/** What the page is painting right now, chosen or inherited from the system. */
export function currentTheme(): Theme {
  const explicit = document.documentElement.getAttribute("data-theme");
  if (explicit === "light" || explicit === "dark") return explicit;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

/**
 * Switch the theme with every transition suppressed.
 *
 * Two reasons, one cosmetic and one a real bug. Cosmetically, the product
 * transitions `color`, `background` and `border-color` on buttons and links,
 * so flipping the theme cross-fades the entire page for 150ms and looks like
 * a glitch rather than a switch.
 *
 * The bug is worse. A transitioned property whose value comes from `var()`
 * does not reliably pick up a change to the custom property itself: switching
 * to dark left the Connect button with its light background while its text
 * went light, so the button vanished. Suppressing transitions across the flip
 * makes the change a plain recalculation, which cannot go stale.
 *
 * The flag is removed two frames later — one to let the new values paint,
 * one because a single frame is sometimes still inside the same style pass.
 */
function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.setAttribute("data-theme-switching", "");
  root.setAttribute("data-theme", theme);
  /* Read a layout property to force the suppression into effect before the
     theme change is painted; without it both land in the same recalculation
     and the suppression does nothing. */
  void root.offsetHeight;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => root.removeAttribute("data-theme-switching"));
  });
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* Private windows and blocked storage: the choice still applies to this
       page, it simply will not be remembered. Better than refusing to switch. */
  }
}

/**
 * One button that shows the theme you are in and switches to the other.
 *
 * Until someone touches it the page still follows the operating system — that
 * is the `prefers-color-scheme` block in the stylesheet, and this control
 * reads whichever theme that produced. The first click is what turns an
 * inherited theme into a chosen one.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>("dark");
  /* Until this mounts we do not know what the system prefers, and rendering a
     sun when the page is dark is worse than rendering nothing for a frame. */
  const [known, setKnown] = useState(false);

  useEffect(() => {
    setTheme(currentTheme());
    setKnown(true);
    /* While no explicit choice exists the page follows the system, so the
       control has to follow it too or it will claim the wrong state. */
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const sync = () => {
      if (!document.documentElement.getAttribute("data-theme")) setTheme(currentTheme());
    };
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  const next: Theme = theme === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      className={className ? `theme-toggle ${className}` : "theme-toggle"}
      onClick={() => {
        setTheme(next);
        applyTheme(next);
      }}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      data-known={known ? "" : undefined}
    >
      {theme === "dark" ? (
        <Moon size={15} strokeWidth={1.7} aria-hidden="true" />
      ) : (
        <Sun size={15} strokeWidth={1.7} aria-hidden="true" />
      )}
    </button>
  );
}
