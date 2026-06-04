"use client";

// restore audit bot (2026-06-04): the restored-from-Trash provenance badge.
//
// Renders a small amber "Restored" pill when a record was brought back from
// Trash, so a restored item reads as distinct from a never-deleted one. It reads
// the additive `_restore_audit` blob the restore path stamps (deleted_at /
// deleted_by / restored_at / restored_by, see trash-reader.ts). The badge
// self-hides when the blob is absent, so a native sequence (the common case)
// renders nothing.
//
// The hover surfaces the full provenance on ONE line:
//   "Deleted {date} by {name} · Restored {date} by {name}"
// The `·` separator is intentional (no em-dash, no mid-sentence colon, per the
// house copy rules). Names resolve through the lab profile map so a username
// becomes a friendly display name when one is known.
//
// On-brand look. Received pills are sky, native/shared-with-lab are emerald;
// this uses an amber palette so a recovered item reads at a glance. Inline SVG
// only (project rule, no emoji / no icon-font deps); wrapped in <Tooltip>.

import Tooltip from "@/components/Tooltip";
import { resolveDisplayName } from "@/components/AttributionChip";
import { useLabUserProfileMap } from "@/hooks/useLabUserProfiles";
import type { SequenceRestoreAudit } from "@/lib/types";

interface RestoredBadgeProps {
  /** The deleted/restored audit blob stamped on restore. Self-hides when absent. */
  audit: SequenceRestoreAudit | null | undefined;
  /** Compact pill for dense list rows. Default false (slightly larger inline). */
  small?: boolean;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function RestoredBadge({ audit, small = false }: RestoredBadgeProps) {
  const profileMap = useLabUserProfileMap();
  // Self-hide on a never-restored record so list rows / headers stay clean.
  if (!audit) return null;

  const deletedBy = resolveDisplayName(audit.deleted_by, profileMap).label;
  const restoredBy = resolveDisplayName(audit.restored_by, profileMap).label;
  const deletedDate = formatDate(audit.deleted_at);
  const restoredDate = formatDate(audit.restored_at);

  // ONE line, `·` separated. Guard each half so a malformed timestamp degrades
  // to "Deleted by X" rather than "Deleted  by X".
  const deletedPart = deletedDate
    ? `Deleted ${deletedDate} by ${deletedBy}`
    : `Deleted by ${deletedBy}`;
  const restoredPart = restoredDate
    ? `Restored ${restoredDate} by ${restoredBy}`
    : `Restored by ${restoredBy}`;
  const tooltipBody = `${deletedPart} · ${restoredPart}`;

  return (
    <Tooltip label="Restored from Trash" body={tooltipBody}>
      <span
        className={
          small
            ? "inline-flex flex-shrink-0 items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-meta font-medium text-amber-700"
            : "inline-flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1 text-meta font-medium text-amber-800"
        }
        data-testid="restored-badge"
      >
        <RestoreIcon
          className={small ? "h-3 w-3" : "h-3.5 w-3.5 flex-shrink-0 text-amber-600"}
        />
        Restored
      </span>
    </Tooltip>
  );
}

// ─── Inline SVG icon (project rule: no emoji / no icon-font deps) ─────────────

function RestoreIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M3 3v5h5" />
      <path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}
