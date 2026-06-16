"use client";

// TableFormatControl (subcolumn UI). The Column-table toolbar control that
// switches a table between raw replicates and the two Prism summary-entry modes
// (Mean + SD + N, Mean + SEM + N). A researcher who only has the published /
// already-calculated group descriptives, not the raw replicates, enters them
// directly in summary mode and every graph + the summary-compatible tests draw
// from those entered numbers.
//
// The control is a popover opened from a toolbar button (the toolbar items are
// icon-and-label buttons, and a dropdown wants its own surface). The format
// chooser is a Seg so all three modes read at a glance. Switching that destroys
// data (replicates to a summary drops the raw values; a summary to replicates
// cannot recover them) shows an inline confirm that states exactly what is lost
// before it happens. Switching SD <-> SEM is lossless and applies immediately.
// The popover is always closeable (click-away / Escape / Cancel), never a
// soft-lock.
//
// House style: <Icon> only, Tooltip on the icon button, no native <select>,
// no emojis / em-dashes / mid-sentence colons.

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import Tooltip from "@/components/Tooltip";
import type { EntryFormat } from "@/lib/datahub/model/types";

const FORMAT_OPTIONS: { value: EntryFormat; label: string }[] = [
  { value: "replicates", label: "Replicates" },
  { value: "mean-sd-n", label: "Mean + SD + N" },
  { value: "mean-sem-n", label: "Mean + SEM + N" },
];

/** A short label for one entry format (for the confirm copy and the trigger). */
function formatLabel(format: EntryFormat): string {
  const found = FORMAT_OPTIONS.find((o) => o.value === format);
  return found ? found.label : "Replicates";
}

/** Whether a format is one of the two summary modes. */
function isSummary(format: EntryFormat): boolean {
  return format === "mean-sd-n" || format === "mean-sem-n";
}

/**
 * Classify a switch from one format to another so the popover knows whether to
 * apply it straight away (lossless) or confirm a destructive reshape first.
 *   - "lossless"  replicates -> replicates (no-op) or SD <-> SEM (converted).
 *   - "to-summary"  replicates -> a summary mode (computes the summary, drops
 *                   the raw replicate values).
 *   - "to-replicates"  a summary mode -> replicates (the spread + n are dropped,
 *                      raw values cannot be recovered, the means seed row 1).
 */
function classifySwitch(
  from: EntryFormat,
  to: EntryFormat,
): "lossless" | "to-summary" | "to-replicates" {
  if (from === to) return "lossless";
  if (!isSummary(from) && isSummary(to)) return "to-summary";
  if (isSummary(from) && !isSummary(to)) return "to-replicates";
  // summary <-> summary (SD <-> SEM) is a lossless spread conversion.
  return "lossless";
}

export default function TableFormatControl({
  format,
  onChange,
}: {
  /** The table's current entry format ("replicates" when absent upstream). */
  format: EntryFormat;
  /** Apply a chosen format. The page reshapes the grid + writes the new format
   *  through Loro in one commit. Lossy switches are confirmed before this fires. */
  onChange: (next: EntryFormat) => void;
}) {
  const [open, setOpen] = useState(false);
  // The format the user picked that needs a destructive-switch confirm, or null
  // when no confirm is pending. A lossless pick applies immediately and never
  // sets this.
  const [pending, setPending] = useState<EntryFormat | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Click-away and Escape both close the popover (and drop any pending confirm),
  // so the control is never a trap.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setPending(null);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        setPending(null);
      }
    }
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function pick(next: EntryFormat) {
    const kind = classifySwitch(format, next);
    if (kind === "lossless") {
      // A no-op pick (same format) just closes; a real SD <-> SEM conversion
      // applies and closes. Either way no confirm is needed.
      if (next !== format) onChange(next);
      setOpen(false);
      setPending(null);
      return;
    }
    // Destructive reshape: stage it for an inline confirm rather than applying.
    setPending(next);
  }

  function confirmPending() {
    if (pending) onChange(pending);
    setPending(null);
    setOpen(false);
  }

  return (
    <div ref={rootRef} className="relative">
      <Tooltip label="Switch between raw replicates and entering already-calculated summary stats (Mean, SD or SEM, N), so you can plot published values you do not have the raw data for.">
        <button
          type="button"
          onClick={() => {
            setOpen((v) => !v);
            setPending(null);
          }}
          aria-haspopup="dialog"
          aria-expanded={open}
          className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-meta font-medium text-foreground transition-colors hover:bg-surface-sunken"
          data-testid="datahub-table-format-trigger"
        >
          <Icon name="table" className="h-3.5 w-3.5" />
          <span>Format: {formatLabel(format)}</span>
          <Icon name="chevronDown" className="h-3 w-3 opacity-70" />
        </button>
      </Tooltip>

      {open ? (
        <div
          role="dialog"
          aria-label="Table format"
          className="absolute left-0 top-full z-50 mt-1 w-72 rounded-lg border border-border bg-surface-overlay p-3 shadow-lg"
          data-testid="datahub-table-format-popover"
        >
          <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-foreground">
            Table format
          </p>
          <p className="mb-2.5 text-[11px] leading-snug text-foreground-muted">
            Replicates holds your raw measurements. The summary modes let you
            enter the group mean, spread, and n directly when that is all you
            have, like values pulled from a paper.
          </p>

          <div
            className="flex flex-col gap-1"
            role="group"
            aria-label="Entry format"
          >
            {FORMAT_OPTIONS.map((o) => {
              const active = o.value === format;
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => pick(o.value)}
                  aria-pressed={active}
                  data-testid={`datahub-table-format-option-${o.value}`}
                  className={`flex items-center justify-between rounded-md border px-2.5 py-1.5 text-meta font-medium transition-colors ${
                    active
                      ? "border-accent/40 bg-accent-soft text-accent"
                      : "border-border bg-surface-raised text-foreground hover:bg-surface-sunken"
                  }`}
                >
                  <span>{o.label}</span>
                  {active ? <Icon name="check" className="h-3.5 w-3.5" /> : null}
                </button>
              );
            })}
          </div>

          {pending ? (
            <div
              className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-2.5 dark:border-amber-500/40 dark:bg-amber-500/10"
              data-testid="datahub-table-format-confirm"
            >
              <p className="text-[11px] leading-snug text-foreground">
                {classifySwitch(format, pending) === "to-summary"
                  ? "This computes each group's mean, spread, and n from its replicates, then replaces the raw values with those three numbers. The raw replicates are removed."
                  : "This switches back to raw replicates, but a mean and spread cannot be turned back into the original measurements. The spread and n are dropped, and each group's mean is kept as a single replicate."}
              </p>
              <div className="mt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPending(null)}
                  className="ros-btn-neutral px-2.5 py-1 text-[11px] font-medium"
                  data-testid="datahub-table-format-cancel"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmPending}
                  className="rounded-md bg-amber-600 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-amber-700"
                  data-testid="datahub-table-format-apply"
                >
                  {classifySwitch(format, pending) === "to-summary"
                    ? "Convert to summary"
                    : "Switch to replicates"}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
