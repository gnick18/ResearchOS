"use client";

// seq editops bot — the shared "Edit menu" surface for the sequence editor.
//
// One declarative action list (built by SequenceEditView) is rendered in THREE
// homes:
//   1. EditMenuDropdown    — the visible "Edit" toolbar dropdown (discoverability).
//   2. SequenceContextMenu — the right-click menu over the sequence/selection.
//   3. (keyboard shortcuts live in SequenceEditView; the hints are shown here.)
//
// Plus two tiny prompt dialogs (Select Range / Go To) and an inline Find box.
//
// Calm by convention: inline SVG only (no emojis), no em-dashes, the Tooltip
// component for any icon-only control. Destructive actions are simply omitted
// from the list by the caller in readOnly mode (we render whatever we are given).

import { type ReactNode, useEffect, useId, useRef, useState } from "react";

/** A single Edit-menu action. Groups draw a divider before the next group. */
export interface EditMenuItem {
  id: string;
  label: string;
  /** Right-aligned shortcut hint, e.g. "Cmd C". Optional. */
  shortcut?: string;
  /** Disabled (greyed, non-clickable) when false-y. */
  enabled: boolean;
  /** Visually flag a destructive action (rose text). */
  destructive?: boolean;
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

function IconSearch({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}
function IconClose({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
function IconUp({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <polyline points="18 15 12 9 6 15" />
    </svg>
  );
}
function IconDown({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

/** Shared item-list renderer used by both the dropdown and the context menu. */
function MenuItems({ items, onAfterRun }: { items: EditMenuItem[]; onAfterRun: () => void }) {
  return (
    <>
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
              onAfterRun();
            }}
            className={`flex w-full items-center justify-between gap-6 px-3 py-1.5 text-left text-sm transition-colors ${
              !it.enabled
                ? "cursor-not-allowed text-gray-300"
                : it.destructive
                  ? "text-rose-600 hover:bg-rose-50"
                  : "text-gray-700 hover:bg-gray-50"
            }`}
          >
            <span className="truncate">{it.label}</span>
            {it.shortcut ? (
              <span className={`shrink-0 text-xs ${it.enabled ? "text-gray-400" : "text-gray-300"}`}>
                {it.shortcut}
              </span>
            ) : null}
          </button>
        </div>
      ))}
    </>
  );
}

/**
 * The visible toolbar dropdown. Defaults to the "Edit" menu, but the label, an
 * optional leading icon, a test id, and the trigger width can be overridden so
 * the same shell powers the "Feature" and "Primer" menus next to it (feature/
 * primer menus bot). `MenuItems` already greys out and blocks any item whose
 * `enabled` is false-y, which is the selection gating Grant asked for.
 */
export function EditMenuDropdown({
  items,
  label = "Edit",
  icon,
  testId,
  width = "w-60",
}: {
  items: EditMenuItem[];
  label?: string;
  icon?: ReactNode;
  testId?: string;
  width?: string;
}) {
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
    // Capture phase: the SeqViz selection handler calls stopPropagation on
    // mousedown, so a bubble-phase listener never sees clicks on the sequence.
    // Capturing fires before that, so clicking anywhere outside closes the menu.
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
        data-testid={testId}
        className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors ${
          open ? "bg-gray-100 text-gray-800" : "text-gray-600 hover:bg-gray-100"
        }`}
      >
        {icon ?? null}
        <span>{label}</span>
        <Chevron className="h-3.5 w-3.5" />
      </button>
      {open ? (
        <div
          role="menu"
          className={`absolute left-0 top-full z-50 mt-1 ${width} rounded-lg border border-gray-200 bg-white py-1 shadow-lg`}
        >
          <MenuItems items={items} onAfterRun={() => setOpen(false)} />
        </div>
      ) : null}
    </div>
  );
}

/** The right-click context menu, positioned at the cursor. `at` null = closed. */
export function SequenceContextMenu({
  at,
  items,
  onClose,
}: {
  at: { x: number; y: number } | null;
  items: EditMenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(at);

  useEffect(() => {
    setPos(at);
  }, [at]);

  // Keep the menu inside the viewport once it has measured.
  useEffect(() => {
    if (!at || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const maxX = window.innerWidth - r.width - 8;
    const maxY = window.innerHeight - r.height - 8;
    setPos({ x: Math.min(at.x, Math.max(8, maxX)), y: Math.min(at.y, Math.max(8, maxY)) });
  }, [at]);

  useEffect(() => {
    if (!at) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onScroll = () => onClose();
    // Capture phase: the SeqViz selection handler calls stopPropagation on
    // mousedown, so a bubble-phase listener never sees clicks on the sequence.
    // Capturing fires before that, so clicking anywhere outside closes the menu.
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [at, onClose]);

  if (!at || !pos) return null;

  return (
    <div
      ref={ref}
      role="menu"
      data-testid="sequence-context-menu"
      className="fixed z-[60] w-60 rounded-lg border border-gray-200 bg-white py-1 shadow-xl"
      style={{ left: pos.x, top: pos.y }}
    >
      <MenuItems items={items} onAfterRun={onClose} />
    </div>
  );
}

/**
 * A tiny single-field prompt dialog used by Select Range and Go To. Validates
 * input live and only enables the confirm button when `parse` returns non-null.
 */
export function SequencePromptDialog<T>({
  open,
  title,
  label,
  placeholder,
  helper,
  initialValue = "",
  confirmLabel,
  parse,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  label: string;
  placeholder?: string;
  helper?: string;
  initialValue?: string;
  confirmLabel: string;
  parse: (raw: string) => T | null;
  onConfirm: (value: T) => void;
  onClose: () => void;
}) {
  const [raw, setRaw] = useState(initialValue);
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setRaw(initialValue);
      // focus after paint
      const t = setTimeout(() => inputRef.current?.select(), 0);
      return () => clearTimeout(t);
    }
  }, [open, initialValue]);

  if (!open) return null;
  const parsed = parse(raw);
  const valid = parsed !== null;

  const submit = () => {
    if (parsed === null) return;
    onConfirm(parsed);
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="border-b border-gray-100 px-5 py-4">
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
        </div>
        <div className="space-y-2 px-5 py-4">
          <label htmlFor={inputId} className="block text-sm text-gray-700">
            {label}
          </label>
          <input
            id={inputId}
            ref={inputRef}
            type="text"
            value={raw}
            placeholder={placeholder}
            onChange={(e) => setRaw(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                onClose();
              }
            }}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
          />
          {helper ? <p className="text-xs text-gray-500">{helper}</p> : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-100 bg-gray-50 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-200"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!valid}
            className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The inline Find box. Lives anchored top-right of the viewer. Drives the
 * `query` upward; the parent feeds back the match count + current index for the
 * "n of m" readout and the prev/next cycling.
 */
export function SequenceFindBox({
  query,
  onQueryChange,
  matchCount,
  activeIndex,
  onPrev,
  onNext,
  onClose,
}: {
  query: string;
  onQueryChange: (q: string) => void;
  matchCount: number;
  /** 0-based active match index, or -1 when there is none. */
  activeIndex: number;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      data-testid="sequence-find-box"
      className="absolute right-3 top-3 z-40 flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-1.5 shadow-lg"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <IconSearch className="h-4 w-4 text-gray-400" />
      <input
        ref={inputRef}
        type="text"
        value={query}
        placeholder="Find bases"
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (e.shiftKey) onPrev();
            else onNext();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
        className="w-40 bg-transparent text-sm outline-none placeholder:text-gray-400"
      />
      <span className="min-w-[3.5rem] text-right text-xs tabular-nums text-gray-400">
        {query.length < 2 ? "" : matchCount === 0 ? "0 / 0" : `${activeIndex + 1} / ${matchCount}`}
      </span>
      <button
        type="button"
        onClick={onPrev}
        disabled={matchCount === 0}
        aria-label="Previous match"
        className="rounded p-1 text-gray-500 transition-colors hover:bg-gray-100 disabled:opacity-30"
      >
        <IconUp className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={onNext}
        disabled={matchCount === 0}
        aria-label="Next match"
        className="rounded p-1 text-gray-500 transition-colors hover:bg-gray-100 disabled:opacity-30"
      >
        <IconDown className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close find"
        className="rounded p-1 text-gray-500 transition-colors hover:bg-gray-100"
      >
        <IconClose className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
