// A small reusable custom dropdown for the Data Hub panels. The native OS
// <select> renders as an ugly platform popup (a macOS sheet that ignores the
// app theme), so the graph editor controls use this instead. It mirrors the
// look of the panel controls (rounded border, surface-overlay background) and
// drops a themed popover list under the trigger. Keyboard nav and click-away /
// Escape closing are built in, and the menu is always closeable (no soft-lock).

"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";

export type StyledSelectOption = { value: string; label: string };

export default function StyledSelect({
  value,
  options,
  onChange,
  ariaLabel,
  className,
}: {
  value: string;
  options: StyledSelectOption[];
  onChange: (value: string) => void;
  ariaLabel?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  // Which row the keyboard cursor sits on while the menu is open. Seeded to the
  // selected option each time we open so ArrowUp/ArrowDown start from there.
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value);
  const selectedLabel = selected ? selected.label : "";

  // Click-away closes the menu. A window mousedown listener checks whether the
  // event landed outside the component root, which also covers clicks on the
  // graph canvas or other panel controls.
  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    window.addEventListener("mousedown", onDocMouseDown);
    return () => window.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  function openMenu() {
    const current = options.findIndex((o) => o.value === value);
    setActiveIndex(current >= 0 ? current : 0);
    setOpen(true);
  }

  function selectAt(index: number) {
    const opt = options[index];
    if (opt) {
      onChange(opt.value);
    }
    setOpen(false);
  }

  function onTriggerKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!open) {
      // Arrow / Enter / Space open the menu when it is closed.
      if (
        e.key === "ArrowDown" ||
        e.key === "ArrowUp" ||
        e.key === "Enter" ||
        e.key === " "
      ) {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      selectAt(activeIndex);
    }
  }

  return (
    <div ref={rootRef} className={`relative ${className ?? ""}`}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onTriggerKeyDown}
        className="flex w-full items-center justify-between gap-2 rounded-md border border-border bg-surface-overlay px-2 py-1 text-meta text-foreground focus:border-sky-400 focus:outline-none"
      >
        <span className="truncate">{selectedLabel}</span>
        <Icon name="chevronDown" className="h-3.5 w-3.5 shrink-0 opacity-70" />
      </button>

      {open ? (
        <ul
          role="listbox"
          aria-label={ariaLabel}
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-60 overflow-auto rounded-md border border-border bg-surface-overlay py-1 ros-popover-shadow"
        >
          {options.map((o, i) => {
            const isSelected = o.value === value;
            const isActive = i === activeIndex;
            return (
              <li
                key={o.value}
                role="option"
                aria-selected={isSelected}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => selectAt(i)}
                className={`flex cursor-pointer items-center justify-between gap-2 px-2 py-1 text-meta text-foreground ${
                  isActive ? "bg-surface-sunken" : ""
                } ${isSelected && !isActive ? "bg-surface-sunken/60" : ""}`}
              >
                <span className="truncate">{o.label}</span>
                {isSelected ? (
                  <Icon name="check" className="h-3.5 w-3.5 shrink-0" />
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
