"use client";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, X } from "lucide-react";

type Option = { value: string; label: string; disabled?: boolean };
/** Shared select: an app-styled menu on desktop and a bottom sheet on phones. */
export function AppSelect({
  value,
  onChange,
  options,
  label,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  label: string;
  disabled?: boolean;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({
    left: 0,
    top: 0,
    width: 200,
    maxHeight: 300,
  });
  const search = useRef({ value: "", at: 0 });
  const selected = options.find((o) => o.value === value);
  function close() {
    setOpen(false);
    trigger.current?.focus();
  }
  function show() {
    const rect = trigger.current!.getBoundingClientRect();
    const width = Math.min(Math.max(rect.width, 200), window.innerWidth - 24);
    const height = Math.min(options.length * 48 + 16, 320);
    const below = window.innerHeight - rect.bottom - 16;
    const above = rect.top - 16;
    const up = below < height && above > below;
    const maxHeight = Math.max(80, Math.min(320, up ? above : below));
    setPosition({
      left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
      top: up
        ? Math.max(12, rect.top - Math.min(height, maxHeight) - 6)
        : rect.bottom + 6,
      width,
      maxHeight,
    });
    setOpen(true);
  }
  useEffect(() => {
    if (!open) return;
    panel.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.focus();
    if (!panel.current?.contains(document.activeElement))
      panel.current?.querySelector<HTMLElement>('[role="option"]')?.focus();
    const resize = () => {
      setOpen(false);
      trigger.current?.focus();
    };
    const overflow = document.body.style.overflow;
    const mobile = window.matchMedia("(max-width: 600px)").matches;
    if (mobile) document.body.style.overflow = "hidden";
    const scroll = (event: Event) => {
      if (
        !mobile &&
        event.target instanceof Node &&
        !panel.current?.contains(event.target)
      )
        setOpen(false);
    };
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("scroll", scroll, true);
      if (mobile) document.body.style.overflow = overflow;
    };
  }, [open]);
  return (
    <span className="app-select">
      <button
        type="button"
        ref={trigger}
        className="app-select-trigger"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        disabled={disabled || !options.length}
        onClick={() => (open ? close() : show())}
        onKeyDown={(e) => {
          if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
            e.preventDefault();
            show();
          }
        }}
      >
        <span>{selected?.label ?? "Select"}</span>
        <ChevronDown size={15} />
      </button>
      {open &&
        createPortal(
          <span
            className="app-select-overlay"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              close();
            }}
          >
            <span
              ref={panel}
              className="app-select-panel"
              style={position}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Escape") {
                  e.preventDefault();
                  close();
                  return;
                }
                const items = Array.from(
                  panel.current?.querySelectorAll<HTMLButtonElement>(
                    '[role="option"]',
                  ) ?? [],
                );
                const index = items.indexOf(
                  document.activeElement as HTMLButtonElement,
                );
                if (e.key === "Tab") {
                  e.preventDefault();
                  close();
                  return;
                }
                if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
                  e.preventDefault();
                  const next =
                    e.key === "Home"
                      ? 0
                      : e.key === "End"
                        ? items.length - 1
                        : (index +
                            (e.key === "ArrowDown" ? 1 : -1) +
                            items.length) %
                          items.length;
                  items[next]?.focus();
                } else if (e.key.length === 1 && e.key !== " ") {
                  search.current = {
                    value:
                      (Date.now() - search.current.at < 700
                        ? search.current.value
                        : "") + e.key.toLowerCase(),
                    at: Date.now(),
                  };
                  items
                    .find((item) =>
                      item.textContent
                        ?.toLowerCase()
                        .startsWith(search.current.value),
                    )
                    ?.focus();
                }
              }}
            >
              <span className="app-select-heading">
                <span>{label}</span>
                <button
                  type="button"
                  aria-label={`Close ${label}`}
                  onClick={close}
                >
                  <X size={18} />
                </button>
              </span>
              <span
                id={id}
                role="listbox"
                aria-label={label}
                className="app-select-options"
              >
                {options.map((option) => (
                  <button
                    type="button"
                    key={option.value}
                    role="option"
                    aria-selected={value === option.value}
                    aria-disabled={option.disabled || undefined}
                    className={option.disabled ? "app-select-option-disabled" : undefined}
                    tabIndex={-1}
                    onClick={() => {
                      if (option.disabled) return;
                      onChange(option.value);
                      close();
                    }}
                  >
                    <span>{option.label}</span>
                    {value === option.value && <Check size={16} />}
                  </button>
                ))}
              </span>
            </span>
          </span>,
          document.body,
        )}
    </span>
  );
}
