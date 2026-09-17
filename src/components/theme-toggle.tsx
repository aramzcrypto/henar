"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

export type ThemeChoice = "system" | "light" | "dark";

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

export function applyTheme(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
  try {
    if (choice === "system") localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    /* Private windows and blocked storage: the choice still applies to this
       page, it simply will not be remembered. That is a better outcome than
       refusing to switch. */
  }
}

const OPTIONS: { value: ThemeChoice; label: string; Icon: typeof Sun }[] = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "system", label: "System", Icon: Monitor },
  { value: "dark", label: "Dark", Icon: Moon },
];

/**
 * Three states, not two.
 *
 * A two-way switch cannot express "follow my system", which is what most
 * people actually want and what the product does before anyone touches it.
 * Collapsing that into a boolean means the first click permanently opts the
 * user out of their own operating system's setting without saying so.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const [choice, setChoice] = useState<ThemeChoice>("system");

  useEffect(() => {
    try {
      const stored = localStorage.getItem(THEME_STORAGE_KEY);
      if (stored === "light" || stored === "dark") setChoice(stored);
    } catch {
      /* Unreadable storage just means the control opens on System. */
    }
  }, []);

  const pick = (next: ThemeChoice) => {
    setChoice(next);
    applyTheme(next);
  };

  return (
    <div className={className ? `theme-toggle ${className}` : "theme-toggle"} role="radiogroup" aria-label="Colour theme">
      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={choice === value}
          aria-label={label}
          title={label}
          data-on={choice === value ? "" : undefined}
          onClick={() => pick(value)}
        >
          <Icon size={14} strokeWidth={1.7} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
