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
import Tooltip from "@/components/Tooltip";

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
  /** Marks a TOGGLE row: when set, a trailing eye indicator is shown (open eye
   *  when true / shown, slashed eye when false / hidden). `onRun` flips state.
   *  Non-toggle rows leave this undefined and render no indicator. */
  checked?: boolean;
  /** Optional leading color swatch (e.g. a feature-type color dot). */
  color?: string;
  /** Marks a SWATCH-ROW item: instead of a normal label button, render a compact
   *  row of preset color chips (the feature quick-recolor affordance). `onRun` is
   *  ignored for these rows; each chip calls `swatches.onPick(color)`. */
  swatches?: {
    /** The preset colors to offer, left to right. */
    colors: string[];
    /** The currently applied color (ringed so the user sees the active one). */
    current?: string;
    /** Apply a chosen color. The menu closes after, like any other item. */
    onPick: (color: string) => void;
  };
  onRun: () => void;
}

function Chevron({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

// Eye / slashed-eye for TOGGLE rows (the show-hide indicator relocated from the
// rail flyouts). Mirrors the IconEye / IconEyeOff glyphs in SequenceDisplayStrip.
function IconEye({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
function IconEyeOff({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

/** Shared item-list renderer used by both the dropdown and the context menu. */
function MenuItems({ items, onAfterRun }: { items: EditMenuItem[]; onAfterRun: () => void }) {
  return (
    <>
      {items.map((it) => (
        <div key={it.id}>
          {it.group ? <div className="my-1 h-px bg-surface-sunken" /> : null}
          {it.swatches ? (
            <div className="flex flex-wrap items-center gap-1.5 px-3 py-1.5" role="group" aria-label={it.label}>
              {it.swatches.colors.map((c) => {
                const active =
                  !!it.swatches!.current &&
                  it.swatches!.current.trim().toLowerCase() === c.trim().toLowerCase();
                return (
                  <button
                    key={c}
                    role="menuitemradio"
                    type="button"
                    aria-checked={active}
                    aria-label={`Set color ${c}`}
                    disabled={!it.enabled}
                    onClick={() => {
                      if (!it.enabled) return;
                      it.swatches!.onPick(c);
                      onAfterRun();
                    }}
                    style={{ backgroundColor: c }}
                    className={`h-5 w-5 rounded-full transition-transform ${
                      it.enabled ? "hover:scale-110" : "cursor-not-allowed opacity-40"
                    } ${
                      active
                        ? "ring-2 ring-sky-500 ring-offset-1"
                        : "seq-swatch-border"
                    }`}
                  />
                );
              })}
            </div>
          ) : (
          <button
            role="menuitem"
            type="button"
            disabled={!it.enabled}
            onClick={() => {
              if (!it.enabled) return;
              it.onRun();
              onAfterRun();
            }}
            className={`flex w-full items-center justify-between gap-6 px-3 py-1.5 text-left text-body transition-colors ${
              !it.enabled
                ? "cursor-not-allowed text-foreground-muted"
                : it.destructive
                  ? "text-rose-600 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-500/20"
                  : "text-foreground hover:bg-surface-sunken"
            }`}
          >
            <span className="flex min-w-0 items-center gap-2">
              {it.color ? (
                <span
                  aria-hidden="true"
                  className="h-2.5 w-2.5 shrink-0 rounded-full seq-swatch-border"
                  style={{ backgroundColor: it.color }}
                />
              ) : null}
              <span className="truncate">{it.label}</span>
            </span>
            {it.checked !== undefined ? (
              it.checked ? (
                <IconEye className="h-3.5 w-3.5 shrink-0 text-sky-600 dark:text-sky-300" />
              ) : (
                <IconEyeOff className="h-3.5 w-3.5 shrink-0 text-foreground-muted" />
              )
            ) : it.shortcut ? (
              <span className={`shrink-0 text-meta ${it.enabled ? "text-foreground-muted" : "text-foreground-muted"}`}>
                {it.shortcut}
              </span>
            ) : null}
          </button>
          )}
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
  primaryAction,
}: {
  items: EditMenuItem[];
  label?: string;
  icon?: ReactNode;
  testId?: string;
  width?: string;
  /** seq editops bot — optional SPLIT-BUTTON mode. When set, the trigger renders
   *  as two regions: a primary button (icon + label) that runs `onRun` on click,
   *  and a caret that opens the item menu. The label text comes from
   *  `primaryAction.label`; the dropdown `label` prop is then used only for the
   *  caret's tooltip / aria text. */
  primaryAction?: {
    label: string;
    onRun: () => void;
    disabled?: boolean;
    /** Tooltip on the primary button (e.g. "Copy (Cmd+C)"). */
    tooltip?: string;
  };
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

  const menu = open ? (
    <div
      role="menu"
      className={`absolute left-0 top-full z-50 mt-1 ${width} rounded-lg border border-border bg-surface-raised py-1 shadow-lg`}
    >
      <MenuItems items={items} onAfterRun={() => setOpen(false)} />
    </div>
  ) : null;

  // SPLIT-BUTTON mode: a primary action button joined to a caret that opens the
  // item menu. Mirrors the toolbar button chrome so it sits flush with the rest.
  if (primaryAction) {
    return (
      <div ref={ref} className="relative inline-flex items-stretch">
        <Tooltip label={primaryAction.tooltip ?? primaryAction.label}>
          <button
            type="button"
            onClick={primaryAction.onRun}
            disabled={primaryAction.disabled}
            data-testid={testId}
            className="inline-flex items-center gap-1.5 rounded-l-md px-2.5 py-1.5 text-body font-medium text-foreground-muted transition-colors hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
          >
            {icon ?? null}
            <span className="hidden sm:inline">{primaryAction.label}</span>
          </button>
        </Tooltip>
        <Tooltip label={`More ${label.toLowerCase()} options`}>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label={`More ${label.toLowerCase()} options`}
            data-testid={testId ? `${testId}-caret` : undefined}
            className={`inline-flex items-center rounded-r-md border-l border-border px-1.5 py-1.5 transition-colors ${
              open ? "bg-surface-sunken text-foreground" : "text-foreground-muted hover:bg-surface-sunken"
            }`}
          >
            <Chevron className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
        {menu}
      </div>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid={testId}
        className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-body font-medium transition-colors ${
          open ? "bg-surface-sunken text-foreground" : "text-foreground-muted hover:bg-surface-sunken"
        }`}
      >
        {icon ?? null}
        <span>{label}</span>
        <Chevron className="h-3.5 w-3.5" />
      </button>
      {menu}
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
      className="fixed z-[60] w-60 rounded-lg border border-border bg-surface-raised py-1 shadow-xl"
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
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-sm overflow-hidden rounded-2xl bg-surface-raised shadow-2xl">
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-title font-semibold text-foreground">{title}</h2>
        </div>
        <div className="space-y-2 px-5 py-4">
          <label htmlFor={inputId} className="block text-body text-foreground">
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
            className="w-full rounded-lg border border-border px-3 py-2 text-body outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
          />
          {helper ? <p className="text-meta text-foreground-muted">{helper}</p> : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-border bg-surface-sunken px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-body text-foreground-muted transition-colors hover:bg-surface-sunken"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!valid}
            className="ros-btn-raise rounded-lg bg-brand-action px-4 py-2 text-body font-medium text-white transition-colors hover:bg-brand-action/90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
