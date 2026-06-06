"use client";

import type { ReactNode } from "react";

/**
 * Customizable PI sidebar (#146 customizable PI sidebar manager,
 * 2026-05-23): the shared placeholder template every `SidebarTile`
 * uses for Phase A wiring.
 *
 * The customizable sidebar (`<CustomizableSidebar>`) is a narrow
 * vertical column (~256px wide) — the snapshot canvas tile's square
 * `<StatTile>` shape doesn't fit. `SidebarStatTile` is the slim
 * horizontal variant: icon + label + stat in a single row, designed
 * to stack densely down a narrow rail.
 *
 * Visual contract (intentionally distinct from `<StatTile>`):
 *   - one horizontal row, not a stack
 *   - icon on the LEFT (16-18px)
 *   - label fills the middle, truncated
 *   - stat (the headline value) right-aligned with tabular numerals
 *   - whole row is the click target — the parent passes `onClick`
 *   - hover affordance (background tint) so the row reads as
 *     interactive
 *
 * The wrapper renders no border / shadow — the surrounding sidebar
 * frame owns chrome. `SidebarStatTile` is just the inner row layout
 * primitive. Phase B chips replace each widget's `SidebarTile` with a
 * unique design (mini-feed, sparkline, etc.) without touching this
 * template.
 */
export interface SidebarStatTileProps {
  /** Inline SVG (or any ReactNode) for the icon slot. ~14-18px. */
  icon: ReactNode;
  /** Optional tone class applied to the icon wrapper (e.g.
   *  `"text-blue-500"`). Defaults to muted gray. */
  iconClassName?: string;
  /** Short label (e.g. "Activity", "Pending"). Truncates. */
  label: string;
  /** Headline value — typically a count or short string. Falls back
   *  to em-dash when the widget hasn't loaded yet so the row never
   *  collapses to empty space. */
  stat: ReactNode;
  /** Optional secondary text shown below the row (e.g. "2 overdue").
   *  Kept off the main row so the slim band stays at-a-glance
   *  scannable; secondary surfaces in a quieter color. */
  sub?: ReactNode;
  /** Whole-tile click handler — wired by the sidebar surface to open
   *  the widget's expanded popup. */
  onClick?: () => void;
}

export default function SidebarStatTile({
  icon,
  iconClassName,
  label,
  stat,
  sub,
  onClick,
}: SidebarStatTileProps) {
  const interactive = !!onClick;
  return (
    <div
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
      className={`w-full flex flex-col gap-0.5 px-2.5 py-2 rounded-md transition-colors ${
        interactive
          ? "cursor-pointer hover:bg-surface-sunken focus:bg-surface-sunken focus:outline-none"
          : ""
      }`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span
          aria-hidden="true"
          className={`flex items-center justify-center flex-shrink-0 ${
            iconClassName ?? "text-foreground-muted"
          }`}
        >
          {icon}
        </span>
        <span className="text-meta font-medium text-foreground truncate flex-1 min-w-0">
          {label}
        </span>
        <span className="text-body font-semibold text-foreground tabular-nums flex-shrink-0">
          {stat}
        </span>
      </div>
      {sub !== undefined && sub !== null && sub !== "" && (
        <div className="text-meta text-foreground-muted truncate pl-6">{sub}</div>
      )}
    </div>
  );
}
