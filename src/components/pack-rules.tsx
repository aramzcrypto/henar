"use client";
import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, X } from "lucide-react";
export function PackRules({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);
  function close() {
    trigger.current?.focus();
    setOpen(false);
  }
  return (
    <div
      ref={root}
      className="pack-rules"
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") setOpen(true);
      }}
      onPointerLeave={(event) => {
        if (
          event.pointerType === "mouse" &&
          !root.current?.contains(document.activeElement)
        )
          setOpen(false);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          close();
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="pack-rules-trigger"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-haspopup="dialog"
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
      >
        Odds &amp; rules <ChevronDown size={13} aria-hidden="true" />
      </button>
      {open && (
        <div
          id={id}
          role="dialog"
          aria-label="Pack odds and rules"
          className="pack-rules-panel"
        >
          <div className="pack-rules-head">
            <strong>Odds &amp; rules</strong>
            <button
              type="button"
              aria-label="Close odds and rules"
              onClick={close}
            >
              <X size={16} />
            </button>
          </div>
          {children}
        </div>
      )}
    </div>
  );
}
