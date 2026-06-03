"use client";

// seq export bot — the visible "Export" toolbar dropdown for the sequence
// editor. The editor had no export; this is its discoverable home (the
// right-click menu stays scoped to Edit ops).
//
// Calm-by-convention: inline SVG only (no emojis), no em-dashes, the same menu
// shell as EditMenuDropdown. All serialize/slice/translate/rasterize logic
// lives in lib/sequences/export.ts; this component only renders the list and
// fires the (parent-supplied) handlers.

import { useEffect, useRef, useState } from "react";

/** A single Export-menu action. Mirrors EditMenuItem but export-scoped. */
export interface ExportMenuItem {
  id: string;
  label: string;
  /** Right-aligned hint (e.g. ".gb"). Optional. */
  hint?: string;
  enabled: boolean;
  /** Start of a new visual group (renders a divider before it). */
  group?: boolean;
  onRun: () => void;
}

function Chevron({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function IconExport({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

/** The visible "Export" toolbar dropdown. */
export function ExportMenuDropdown({ items }: { items: ExportMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    // Capture phase so a click on the sequence (whose mousedown SeqViz stops
    // from propagating) still closes the menu, matching Esc.
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="sequence-export-button"
        className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-body font-medium transition-colors ${
          open ? "bg-gray-100 text-gray-800" : "text-gray-600 hover:bg-gray-100"
        }`}
      >
        <IconExport className="h-4 w-4" />
        <span className="hidden sm:inline">Export</span>
        <Chevron className="h-3.5 w-3.5" />
      </button>
      {open ? (
        <div
          role="menu"
          data-testid="sequence-export-menu"
          className="absolute left-0 top-full z-50 mt-1 w-64 rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
        >
          {items.map((it) => (
            <div key={it.id}>
              {it.group ? <div className="my-1 h-px bg-gray-100" /> : null}
              <button
                role="menuitem"
                type="button"
                disabled={!it.enabled}
                onClick={() => {
                  if (!it.enabled) return;
                  it.onRun();
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between gap-6 px-3 py-1.5 text-left text-body transition-colors ${
                  !it.enabled
                    ? "cursor-not-allowed text-gray-300"
                    : "text-gray-700 hover:bg-gray-50"
                }`}
              >
                <span className="truncate">{it.label}</span>
                {it.hint ? (
                  <span className={`shrink-0 text-meta ${it.enabled ? "text-gray-400" : "text-gray-300"}`}>
                    {it.hint}
                  </span>
                ) : null}
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
