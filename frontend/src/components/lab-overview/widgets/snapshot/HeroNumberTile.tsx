"use client";

import type { ReactNode } from "react";

/**
 * Phase B Batch B1 (Phase B Batch B1 manager, 2026-05-23): shared
 * "hero number" snapshot primitive for data-heavy widgets.
 *
 * Every SnapshotTile in Batch B1 (MetricsWidget, LabPurchasesWidget,
 * LabActivityWidget) reads the same way at a glance: a TOP row with a
 * small icon + eyebrow label, a MIDDLE row that's a single dominant
 * number (the trigger that makes a PI click), and a BOTTOM row of
 * quieter secondary text. Rather than reimplement that pattern three
 * times we factor it here.
 *
 * This is intentionally distinct from `<StatTile>`:
 *   - `<StatTile>` is the generic placeholder Phase A used for every
 *     widget (icon + label + headline + sub). It still backs widgets
 *     that don't yet have a custom snapshot design.
 *   - `<HeroNumberTile>` is the iOS-home-screen-style "one big number"
 *     variant: the primary value reads at a much larger size and an
 *     `accent` color gates urgency (amber for pending, gray for calm).
 *
 * Visual contract:
 *   - icon: ~16px, top-left, takes accent color
 *   - label: uppercase eyebrow text next to the icon
 *   - primary: the big number / short token (`text-4xl` ish). Renders
 *     in the accent color so the urgency colors the whole tile.
 *   - secondary: optional one-line quiet text under the primary.
 *
 * The wrapper renders no chrome. The surrounding `<Widget>` /
 * snapshot canvas frame already supplies the card. This is just the
 * inner layout primitive.
 */
export type HeroAccent = "calm" | "amber" | "blue" | "emerald" | "rose";

export interface HeroNumberTileProps {
  /** Inline SVG (or any ReactNode) for the icon slot. ~14-18px. */
  icon: ReactNode;
  /** Short eyebrow label (e.g. "This month", "Pending"). */
  label: string;
  /** The dominant value. Number-like (`12`, `"$1.2k"`, `"—"`). */
  primary: ReactNode;
  /** Optional secondary text under the hero number. */
  secondary?: ReactNode;
  /** Accent — drives icon + primary number color so the urgency reads
   *  at the tile level. Defaults to `"calm"` (muted gray + gray-900). */
  accent?: HeroAccent;
}

const ACCENT_ICON_CLASS: Record<HeroAccent, string> = {
  calm: "text-gray-400",
  amber: "text-amber-600",
  blue: "text-blue-500",
  emerald: "text-emerald-600",
  rose: "text-rose-600",
};

const ACCENT_NUMBER_CLASS: Record<HeroAccent, string> = {
  calm: "text-gray-900",
  amber: "text-amber-700",
  blue: "text-blue-700",
  emerald: "text-emerald-700",
  rose: "text-rose-700",
};

export default function HeroNumberTile({
  icon,
  label,
  primary,
  secondary,
  accent = "calm",
}: HeroNumberTileProps) {
  return (
    <div className="flex flex-col h-full min-h-0 gap-1.5">
      <div className="flex items-center gap-2 min-w-0">
        <span
          aria-hidden="true"
          className={`flex items-center justify-center flex-shrink-0 ${ACCENT_ICON_CLASS[accent]}`}
        >
          {icon}
        </span>
        <span className="text-meta uppercase tracking-wide text-gray-500 font-medium truncate">
          {label}
        </span>
      </div>
      <div className="flex-1 flex flex-col justify-center min-h-0">
        <div
          className={`text-4xl font-semibold leading-none tabular-nums truncate ${ACCENT_NUMBER_CLASS[accent]}`}
        >
          {primary}
        </div>
        {secondary !== undefined && secondary !== null && secondary !== "" && (
          <div className="text-meta text-gray-500 mt-1.5 truncate">{secondary}</div>
        )}
      </div>
    </div>
  );
}
