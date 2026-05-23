"use client";

import type { ReactNode } from "react";

/**
 * Widget canvas Phase A (Phase A redispatch manager, 2026-05-23):
 * shared placeholder template every snapshot tile uses.
 *
 * The snapshot canvas (a 2-col CSS grid of tiles, not a free-grid) is
 * intentionally low-info-density: each widget's tile shows an icon, a
 * short label, and ONE headline stat. The whole tile is the click
 * target — clicking opens the popup with the widget's full
 * `ExpandedView`. Tiles must be flat, scannable, and uniform so the
 * dashboard reads as a dashboard, not a wall of mini-apps.
 *
 * Phase A ships every widget through `<StatTile>` so the snapshot
 * canvas works end-to-end with zero per-widget design churn. Phase B
 * chips replace each widget's `SnapshotTile` with a unique design
 * (sparklines, mini-feeds, etc.) without touching the contract here.
 *
 * Visual contract:
 *   - icon: 20px-ish, tinted, top-left
 *   - label: small uppercase eyebrow text
 *   - stat: large numerals (or short string) — the primary signal
 *   - sub: optional one-line secondary text under the stat
 *
 * The wrapper deliberately renders no border / shadow / background.
 * The `<Widget>` frame already supplies card chrome. `StatTile` is
 * just the inner layout primitive.
 */
export interface StatTileProps {
  /** Inline SVG (or any ReactNode) for the icon slot. ~14-20px square. */
  icon: ReactNode;
  /** Optional tone class applied to the icon wrapper (e.g.
   *  `"text-blue-500"`). Defaults to a muted gray so unset icons read
   *  as quiet rather than absent. */
  iconClassName?: string;
  /** Short eyebrow label (e.g. "Lab notes", "Recent activity"). */
  label: string;
  /** Headline value — typically a count like `12` or a short token
   *  like `"4 today"`. Falls back to `—` when the widget hasn't
   *  loaded yet so the tile never collapses to empty layout. */
  stat: ReactNode;
  /** Optional secondary text under the stat (e.g. "2 overdue"). */
  sub?: ReactNode;
}

export default function StatTile({
  icon,
  iconClassName,
  label,
  stat,
  sub,
}: StatTileProps) {
  return (
    <div className="flex flex-col h-full min-h-0 gap-1.5">
      <div className="flex items-center gap-2 min-w-0">
        <span
          aria-hidden="true"
          className={`flex items-center justify-center flex-shrink-0 ${
            iconClassName ?? "text-gray-400"
          }`}
        >
          {icon}
        </span>
        <span className="text-[10px] uppercase tracking-wide text-gray-500 font-medium truncate">
          {label}
        </span>
      </div>
      <div className="flex-1 flex flex-col justify-center min-h-0">
        <div className="text-2xl font-semibold text-gray-900 leading-none tabular-nums truncate">
          {stat}
        </div>
        {sub !== undefined && sub !== null && sub !== "" && (
          <div className="text-xs text-gray-500 mt-1 truncate">{sub}</div>
        )}
      </div>
    </div>
  );
}
