"use client";

// Shared visual kit for BeakerBot inline chat widgets (BeakerAI lane, 2026-06-15).
//
// ONE design language across every widget the assistant renders: a calm card,
// caps section headers, and selectable rows that lead with a small tinted icon
// tile. The tint encodes the object's DOMAIN FAMILY (not a per-item rainbow), so
// related things read as related and a mixed list stays calm:
//
//   bio (purple)      sequence, molecule, tree/phylo
//   data (teal)       Data Hub, dataset, graphs
//   protocol (blue)   method, experiment, task, analysis
//   org (gray)        project, collection, note, file
//   commerce (amber)  purchase, inventory
//
// The tint lives ONLY in the 22-26px tile; row backgrounds stay neutral. Status
// (plan-card running/done) keeps its semantic colors and is NOT a domain tint.
//
// Icon-guard: every glyph comes from @/components/icons (the established
// registry). This kit never hand-draws an inline icon nor adds a new glyph.

import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons";

export type WidgetTint =
  | "bio"
  | "data"
  | "protocol"
  | "org"
  | "commerce"
  | "macro"
  | "neutral";

// Light + dark, theme-aware. The org/neutral families reuse the surface token so
// they never fight the chat; the colored families use a 50/950 fill pair.
const TINT_TILE: Record<WidgetTint, string> = {
  bio: "bg-purple-50 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300",
  data: "bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300",
  protocol: "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
  commerce: "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300",
  macro: "bg-purple-50 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300",
  org: "bg-surface-sunken text-foreground-muted",
  neutral: "bg-surface-sunken text-foreground-muted",
};

// Strong enough to read as a colored dot next to uppercase muted labels (the
// 400 tones were too faint at 7px). org/neutral stay border-toned on purpose.
const TINT_DOT: Record<WidgetTint, string> = {
  bio: "bg-purple-500",
  data: "bg-teal-500",
  protocol: "bg-blue-500",
  commerce: "bg-amber-500",
  macro: "bg-purple-500",
  org: "bg-foreground-muted/40",
  neutral: "bg-foreground-muted/40",
};

/** The family dot's color class, for section labels rendered outside WidgetSection
 *  (e.g. the composer dropdowns, which keep their own header padding). */
export function tintDotClass(tint: WidgetTint): string {
  return TINT_DOT[tint];
}

// Object-type -> domain family. Keyed by the string values shared across
// RecordSetRowType and the global-index entry types so every widget resolves the
// same identity from the same place. Unknown types fall back to the calm org
// family rather than inventing a color.
export function tintForObjectType(type: string): WidgetTint {
  switch (type) {
    case "sequence":
    case "molecule":
    case "tree":
    case "phylo":
      return "bio";
    case "datahub":
    case "dataset":
      return "data";
    case "method":
    case "experiment":
    case "task":
    case "analysis":
      return "protocol";
    case "purchase":
    case "inventory":
      return "commerce";
    default:
      return "org";
  }
}

const TILE_SIZE = { sm: "h-[22px] w-[22px]", md: "h-[26px] w-[26px]" } as const;
const TILE_ICON = { sm: "h-3.5 w-3.5", md: "h-4 w-4" } as const;

/** The core new primitive: a small rounded icon chip tinted by domain family. */
export function WidgetIconTile({
  icon,
  tint = "neutral",
  size = "md",
  className = "",
}: {
  icon: IconName;
  tint?: WidgetTint;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <span
      className={`flex flex-none items-center justify-center rounded-md ${TILE_SIZE[size]} ${TINT_TILE[tint]} ${className}`}
    >
      <Icon name={icon} className={TILE_ICON[size]} />
    </span>
  );
}

/** Root class for a pick-list card. Full-width when inline in chat, else fixed. */
export function widgetCardClass(inline?: boolean): string {
  return `@container overflow-hidden rounded-2xl border border-border bg-surface-raised shadow-xl ${
    inline ? "w-full" : "w-[440px] max-w-full"
  }`;
}

/** Header bar: a tinted icon badge (or a bare accent glyph), a title, an optional close. */
export function WidgetHeader({
  icon,
  tint,
  title,
  onClose,
  trailing,
}: {
  icon: IconName;
  tint?: WidgetTint;
  title: ReactNode;
  onClose?: () => void;
  trailing?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
      {tint ? (
        <WidgetIconTile icon={icon} tint={tint} size="sm" />
      ) : (
        <Icon name={icon} className="h-4 w-4 shrink-0 text-accent" />
      )}
      <div className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
        {title}
      </div>
      {trailing ?? null}
      {onClose ? (
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="text-foreground-muted hover:text-foreground"
        >
          <Icon name="x" className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}

/** Caps section label with an optional family dot. */
export function WidgetSection({
  label,
  tint,
  children,
  className = "",
}: {
  label: ReactNode;
  tint?: WidgetTint;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`mb-1 ${className}`}>
      <div className="flex items-center gap-1.5 px-1 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-wide text-foreground-muted">
        {tint ? (
          <span
            className={`h-[7px] w-[7px] shrink-0 rounded-full ${TINT_DOT[tint]}`}
          />
        ) : null}
        {label}
      </div>
      {children}
    </div>
  );
}

/** 1 column on a narrow panel, 2 columns once the card is wide enough. */
export function WidgetOptionGrid({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`grid grid-cols-1 gap-1.5 @sm:grid-cols-2 ${className}`}>
      {children}
    </div>
  );
}

/**
 * Selectable row that leads with a tinted icon tile. Used by every pick-list and
 * the composer pickers. `active` is the keyboard/hover-highlighted state; the
 * hint wraps to two lines rather than truncating since two-column rows are
 * narrower.
 */
export function WidgetRow({
  icon,
  tint = "neutral",
  label,
  hint,
  trailing,
  active = false,
  disabled = false,
  onClick,
  onMouseEnter,
  title,
  testId,
  compact = false,
}: {
  icon?: IconName;
  tint?: WidgetTint;
  label: ReactNode;
  hint?: ReactNode;
  trailing?: ReactNode;
  active?: boolean;
  /** Greys the row + blocks the click (constraint-aware "unavailable" rows). */
  disabled?: boolean;
  onClick?: () => void;
  onMouseEnter?: () => void;
  title?: string;
  /** Passes through to data-testid so existing row hooks survive the refactor. */
  testId?: string;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      title={title}
      data-testid={testId}
      disabled={disabled}
      className={`flex w-full items-center gap-2 rounded-lg border px-2.5 text-left transition-colors ${
        compact ? "py-1.5" : "py-2"
      } ${
        disabled
          ? "cursor-not-allowed border-border bg-surface opacity-50"
          : active
            ? "border-brand bg-surface-raised"
            : "border-border bg-surface hover:border-brand hover:bg-surface-raised"
      }`}
    >
      {icon ? (
        <WidgetIconTile icon={icon} tint={tint} size={compact ? "sm" : "md"} />
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-foreground">
          {label}
        </span>
        {hint ? (
          <span className="mt-0.5 block line-clamp-2 text-[11px] text-foreground-muted">
            {hint}
          </span>
        ) : null}
      </span>
      {trailing ?? null}
    </button>
  );
}
