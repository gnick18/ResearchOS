"use client";

// Cross-boundary sharing, the received-from provenance badge.
//
// Renders WHO sent an imported note so a received note is visually distinct from
// a native one. It reads the additive provenance fields a cross-boundary import
// stamps onto a Note, received_from / received_from_fingerprint / received_at
// (see note-transfer.ts importNoteBundle). The badge self-hides when received_from
// is absent, so a native note (the common case) renders nothing.
//
// TRUST. received_from is the sender's own verified email, embedded inside the
// sealed bundle and signed by the sender (see BundleSender in bundle.ts). When it
// is a real email we say "verified" and show it. Older imports (built before the
// sender block existed) stored only a relay key hash here, in which case we show
// the shortened identifier without the verified-email claim.
//
// On-brand look. Native / shared-with-lab pills are emerald; this uses a sky
// palette so an imported item reads as "came from outside" at a glance. Inline
// SVG icons only (project rule, no emoji / no icon-font deps).

import Tooltip from "@/components/Tooltip";

interface ReceivedFromBadgeProps {
  /** The sender identifier stamped on import (verified email, or a hash fallback). */
  receivedFrom: string | null | undefined;
  /** The sender's key fingerprint, surfaced in the hover for verification. */
  fingerprint?: string | null;
  /** ISO 8601 import timestamp, surfaced in the hover. */
  receivedAt?: string | null;
  /** Compact pill for dense list rows / cards. Default false (full inline row). */
  small?: boolean;
}

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/** Shorten a long fingerprint / hash for display, keeping the leading group. */
function shorten(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 18) return trimmed;
  return `${trimmed.slice(0, 18)}…`;
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

export default function ReceivedFromBadge({
  receivedFrom,
  fingerprint,
  receivedAt,
  small = false,
}: ReceivedFromBadgeProps) {
  // Self-hide on a native note so card grids / rows don't render an empty chip.
  if (!receivedFrom) return null;

  const isEmail = looksLikeEmail(receivedFrom);
  const display = isEmail ? receivedFrom : shorten(receivedFrom);

  // The hover surfaces the full attribution, the email (or hash), the key
  // fingerprint, and when it was imported, so the recipient can verify the
  // sender out of band.
  const tooltipParts = [
    isEmail ? `Received from ${receivedFrom}` : `Received from ${display}`,
    fingerprint ? `Key fingerprint ${shorten(fingerprint)}` : null,
    receivedAt ? `Imported ${formatDate(receivedAt)}` : null,
  ].filter(Boolean) as string[];
  const tooltipLabel = isEmail ? "Verified sender" : "Received item";
  const tooltipBody = tooltipParts.join("\n");

  if (small) {
    return (
      <Tooltip label={tooltipLabel} body={tooltipBody}>
        <span className="inline-flex flex-shrink-0 items-center gap-1 px-2 py-0.5 text-meta font-medium rounded-full bg-sky-100 text-sky-700">
          <InboxDownIcon className="w-3 h-3" />
          Received
        </span>
      </Tooltip>
    );
  }

  return (
    <Tooltip label={tooltipLabel} body={tooltipBody}>
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-meta font-medium rounded-md border border-sky-200 bg-sky-50 text-sky-800">
        <InboxDownIcon className="w-3.5 h-3.5 flex-shrink-0 text-sky-600" />
        <span className="truncate">Received from {display}</span>
        {isEmail && (
          <span className="inline-flex items-center gap-0.5 text-sky-600">
            <ShieldCheckIcon className="w-3.5 h-3.5 flex-shrink-0" />
            verified
          </span>
        )}
      </span>
    </Tooltip>
  );
}

// ─── Inline SVG icons (project rule: no emoji / no icon-font deps) ────────────

function InboxDownIcon({ className }: { className?: string }) {
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
      <path d="M4 13l3 5h10l3-5" />
      <path d="M4 13l2.5-8h11L20 13" />
      <path d="M12 4v6m0 0 2.5-2.5M12 10 9.5 7.5" />
    </svg>
  );
}

function ShieldCheckIcon({ className }: { className?: string }) {
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
      <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}
