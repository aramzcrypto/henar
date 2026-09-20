"use client";

import { useId, useState } from "react";
import { Info } from "lucide-react";

/**
 * A small explanation attached to a label.
 *
 * Opens on hover and on focus, closes on Escape, and is announced through
 * `aria-describedby` rather than a `title` attribute — a native tooltip never
 * reaches a keyboard or a screen reader, and these carry the definition of a
 * number someone is being asked to read.
 *
 * Lifted out of the Earn products page, where it already served nine of
 * these, so the markup and styling stay in one place.
 */
export function InfoTip({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span
      className="earn-info"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") setOpen(false);
      }}
    >
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={() => setOpen(true)}
        onFocus={() => setOpen(true)}
      >
        <Info size={15} />
      </button>
      {open && (
        <span id={id} role="tooltip" className="earn-info-popover">
          {children}
        </span>
      )}
    </span>
  );
}
