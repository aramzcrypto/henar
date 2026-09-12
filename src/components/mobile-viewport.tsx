"use client";
import { useEffect } from "react";

export function MobileViewport() {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const root = document.documentElement;
    const media = window.matchMedia("(max-width: 760px)");
    const update = () => {
      const mobile = media.matches;
      const inset = Math.max(
        0,
        window.innerHeight - viewport.height - viewport.offsetTop,
      );
      const editing = document.activeElement?.matches(
        "input, textarea, select",
      );
      const keyboard = mobile && !!editing && inset > 120;
      root.style.setProperty("--mobile-visible-height", `${viewport.height}px`);
      root.style.setProperty(
        "--mobile-keyboard-inset",
        keyboard ? `${inset}px` : "0px",
      );
      root.classList.toggle("mobile-keyboard-open", keyboard);
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update, { passive: true });
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
      root.classList.remove("mobile-keyboard-open");
      root.style.removeProperty("--mobile-visible-height");
      root.style.removeProperty("--mobile-keyboard-inset");
    };
  }, []);
  return null;
}
