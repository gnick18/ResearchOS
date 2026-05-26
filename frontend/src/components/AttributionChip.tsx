"use client";

import { useMemo } from "react";
import {
  useLabUserProfileMap,
  type LabUserProfileMap,
} from "@/hooks/useLabUserProfiles";
import Tooltip from "@/components/Tooltip";

/**
 * VCP R3 attribution stamps (VCP R3 attribution stamps, 2026-05-26):
 * the inline last-edited chip + popup stamps-row primitive. Surfaces
 * `last_edited_by` / `last_edited_at` from any of the eight shareable
 * entity types in a consistent way:
 *
 *   - `showFull={false}` (default): compact card-footer chip.
 *     "Morgan, 2h ago"           — non-PI editor
 *     "Morgan (PI), 2h ago"      — lab_head editor
 *
 *   - `showFull={true}`: long-form popup stamps row.
 *     "Edited by Morgan on May 26"
 *     "Edited by Morgan (PI) on May 26"
 *
 * The lab_head detection routes through the existing
 * `useLabUserProfileMap` source: a user whose `settings.json` carries
 * `account_type: "lab_head"` gets the "(PI)" badge. Missing users
 * (departed lab members) render under their stored username with no
 * badge. The "(PI)" label is purely a render concern — the underlying
 * stored field is always the bare username, per OQ5.
 *
 * The chip wraps in `<Tooltip>` so hovering surfaces the full ISO
 * timestamp (per the wiki rule: every hover affordance uses the
 * Tooltip component, never native HTML `title=`).
 *
 * `username` falls back to the empty string when the entity has no
 * recorded editor (pre-R3 records on disk). The chip self-hides in
 * that case so card grids don't render "Edited by , Unknown".
 */
export interface AttributionChipProps {
  username: string | null | undefined;
  editedAt: string | null | undefined;
  /** Long-form ("Edited by X on Y") vs compact ("X, 2h ago"). Default false. */
  showFull?: boolean;
  /** Optional tighter sizing for very dense card footers. Default false. */
  small?: boolean;
  /** Test-only label override for the wrapping span — used by tests
   *  to assert on a specific chip without DOM scraping. */
  "data-testid"?: string;
}

export default function AttributionChip({
  username,
  editedAt,
  showFull = false,
  small = false,
  ...rest
}: AttributionChipProps) {
  const profileMap = useLabUserProfileMap();

  // Resolve display name + PI badge.
  const display = useMemo(
    () => resolveDisplayName(username, profileMap),
    [username, profileMap],
  );

  // Self-hide on missing data so card footers don't render an empty chip.
  if (!username || !editedAt) return null;

  const isoTimestamp = editedAt;
  const sizeClass = small
    ? "text-[11px] leading-4"
    : "text-xs leading-5";
  const colorClass = "text-stone-500 dark:text-stone-400";

  if (showFull) {
    const label = `Edited by ${display.label} on ${formatFullDate(editedAt)}`;
    return (
      <Tooltip label={isoTimestamp}>
        <span
          className={`${sizeClass} ${colorClass} inline-flex items-center gap-1`}
          data-testid={rest["data-testid"] ?? "attribution-chip-full"}
        >
          {label}
        </span>
      </Tooltip>
    );
  }

  const label = `${display.label}, ${formatRelative(editedAt)}`;
  return (
    <Tooltip label={`Edited ${formatFullDate(editedAt)} — ${isoTimestamp}`}>
      <span
        className={`${sizeClass} ${colorClass} inline-flex items-center gap-1`}
        data-testid={rest["data-testid"] ?? "attribution-chip"}
      >
        {label}
      </span>
    </Tooltip>
  );
}

interface ResolvedDisplay {
  /** What renders in the chip body — always the bare username with an
   *  optional "(PI)" suffix. */
  label: string;
  /** True when the resolved user is a lab_head (PI). */
  isPi: boolean;
}

/**
 * Look up the username's display name + account_type in the profile
 * map. Three cases:
 *   1. profile.account_type === "lab_head" → "X (PI)".
 *   2. profile present, account_type === "member" → "X".
 *   3. profile missing (departed user, or pre-onboarding) → "X" (no badge).
 *
 * Exported for direct testing — the hook indirection makes the
 * component itself hard to unit test without React Query plumbing.
 */
export function resolveDisplayName(
  username: string | null | undefined,
  profileMap: LabUserProfileMap,
): ResolvedDisplay {
  if (!username || username.length === 0) {
    return { label: "Unknown", isPi: false };
  }
  const profile = profileMap[username];
  const baseName =
    (profile?.displayName && profile.displayName.trim()) || username;
  if (profile?.account_type === "lab_head") {
    return { label: `${baseName} (PI)`, isPi: true };
  }
  return { label: baseName, isPi: false };
}

/**
 * "2 hours ago" / "3d ago" / fall-back date. Mirrors the formatter
 * used by CommentsThread and the lab-overview widgets so the chip
 * reads consistently across the app.
 */
export function formatRelative(iso: string): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const now = Date.now();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/**
 * Long-form "May 26, 2026" rendering for the popup stamps row.
 */
export function formatFullDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Helper for popup stamps rows that want a two-line "Created by X / Last
 * edited by Y" block. Keeps the lookup-resolved label logic in one place
 * so popups don't reimplement the lab_head detection.
 *
 * `createdBy` + `createdAt` are optional — when both are missing only
 * the edit line renders (or nothing, if that's missing too).
 */
export interface StampsRowProps {
  createdBy?: string | null;
  createdAt?: string | null;
  lastEditedBy?: string | null;
  lastEditedAt?: string | null;
}

export function StampsRow({
  createdBy,
  createdAt,
  lastEditedBy,
  lastEditedAt,
}: StampsRowProps) {
  const profileMap = useLabUserProfileMap();
  const created = useMemo(
    () => resolveDisplayName(createdBy ?? null, profileMap),
    [createdBy, profileMap],
  );
  const edited = useMemo(
    () => resolveDisplayName(lastEditedBy ?? null, profileMap),
    [lastEditedBy, profileMap],
  );

  const showCreated = !!createdBy && !!createdAt;
  const showEdited = !!lastEditedBy && !!lastEditedAt;
  if (!showCreated && !showEdited) return null;

  return (
    <div className="flex flex-col gap-0.5 text-xs text-stone-500 dark:text-stone-400">
      {showCreated && (
        <Tooltip label={createdAt as string}>
          <div className="inline-flex items-center gap-1">
            <span>Created by {created.label} on {formatFullDate(createdAt as string)}</span>
          </div>
        </Tooltip>
      )}
      {showEdited && (
        <Tooltip label={lastEditedAt as string}>
          <div className="inline-flex items-center gap-1">
            <span>Last edited by {edited.label} on {formatFullDate(lastEditedAt as string)}</span>
          </div>
        </Tooltip>
      )}
    </div>
  );
}
