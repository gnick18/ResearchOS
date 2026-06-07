"use client";

// The chunk 3 health strip (Option A: three stat tiles) that sits at the top of
// /inventory, above the search bar (design 2.4 / 10, approved mockup
// docs/mockups/2026-06-07-inventory-signals-mockup.html). Each tile shows a
// count, a label, a one-line subtext, and a category-colored icon. Clicking a
// tile toggles the active signal filter; the active tile shows a brand outline.
//
// When all three counts are zero the strip becomes the calm "Nothing needs
// attention" all-clear panel instead of three zero tiles.
//
// House style: <Icon> only (amber expiring / slate stale / rose low), semantic
// dark-mode tokens, no emojis / em-dashes / mid-sentence colons.

import { Icon } from "@/components/icons";
import type { IconName } from "@/components/icons";
import type {
  InventorySignalKind,
  InventorySignals,
} from "./inventory-ui";

interface TileSpec {
  kind: InventorySignalKind;
  count: number;
  label: string;
  sub: string;
  icon: IconName;
  /** Color classes for the icon chip (matches the mockup swatches). */
  iconWrap: string;
}

export default function InventoryHealth({
  signals,
  activeKind,
  onSelect,
}: {
  signals: InventorySignals;
  activeKind: InventorySignalKind | null;
  onSelect: (kind: InventorySignalKind) => void;
}) {
  if (signals.allClear) {
    return (
      <div className="mb-5 flex items-center gap-3.5 rounded-xl border border-border bg-emerald-50 px-4 py-4 dark:bg-emerald-500/10">
        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
          <Icon name="check" className="h-5 w-5" />
        </span>
        <div>
          <div className="text-title font-semibold text-foreground">
            Nothing needs attention
          </div>
          <p className="mt-0.5 text-meta text-foreground-muted">
            Nothing expiring, stale, or low. The signals appear here when
            something does.
          </p>
        </div>
      </div>
    );
  }

  const tiles: TileSpec[] = [
    {
      kind: "expiring",
      count: signals.expiring.length,
      label: "Expiring soon",
      sub: "within 30 days, plus expired",
      icon: "alarmClock",
      iconWrap:
        "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
    },
    {
      kind: "stale",
      count: signals.stale.length,
      label: "Stale",
      sub: "untouched 6+ months",
      icon: "hourglass",
      iconWrap:
        "bg-slate-200 text-slate-600 dark:bg-slate-500/25 dark:text-slate-300",
    },
    {
      kind: "low",
      count: signals.low.length,
      label: "Low or empty",
      sub: "below your threshold",
      icon: "dropletLow",
      iconWrap:
        "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300",
    },
  ];

  return (
    <div className="mb-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {tiles.map((tile) => {
          const active = activeKind === tile.kind;
          return (
            <button
              key={tile.kind}
              type="button"
              onClick={() => onSelect(tile.kind)}
              aria-pressed={active}
              className={`flex items-start gap-3 rounded-xl border border-border bg-surface-raised px-4 py-3.5 text-left transition-colors hover:bg-surface-sunken ${
                active
                  ? "outline outline-2 -outline-offset-1 outline-brand-action"
                  : ""
              }`}
            >
              <span
                className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${tile.iconWrap}`}
              >
                <Icon name={tile.icon} className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-heading font-bold leading-none text-foreground">
                  {tile.count}
                </span>
                <span className="mt-1 block text-body font-semibold text-foreground">
                  {tile.label}
                </span>
                <span className="mt-0.5 block text-meta text-foreground-muted">
                  {tile.sub}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <p className="mt-2.5 text-meta text-foreground-muted">
        Click a tile to filter the list below to those records. The active tile
        is outlined.
      </p>
    </div>
  );
}
