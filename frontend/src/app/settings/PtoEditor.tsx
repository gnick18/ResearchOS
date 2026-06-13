"use client";

import { useCallback, useEffect, useState } from "react";
import Tooltip from "@/components/Tooltip";
import {
  patchStreak,
  readStreak,
  type StreakSidecar,
} from "@/lib/streak/streak-sidecar";

// Inline SVGs — codebase has no icon library installed (Lucide / Heroicons
// aren't dependencies). Sized to match the surrounding text scale.
function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

/**
 * PTO editor — Phase S4 of the Streak-and-Milestones arc.
 *
 * Reads + writes `pto_dates` via the S0 sidecar's atomic patchStreak.
 * One of three entry points for managing PTO (proposal §6.3 / L8):
 *   (a) Gantt right-click on a day (S4 — sibling surface)
 *   (b) Calendar event tagged PTO (S5 — deferred)
 *   (c) THIS editor in Settings
 *
 * Discipline:
 *   - Manual picker is FUTURE-DATES ONLY. Past dates can be added
 *     programmatically by other surfaces (Calendar sync in S5) but the
 *     manual picker enforces "today or later" to discourage retroactive
 *     streak gaming (proposal §6.3).
 *   - Soft cap at 500 entries: WARNS but does not block. Users with
 *     legitimately huge PTO lists (sabbatical, multi-year planning)
 *     can keep adding past the cap.
 *   - The sidecar's normalize() function sorts + dedupes pto_dates on
 *     every persist, so we don't have to defensively re-sort in render.
 */

interface Props {
  /** Active username — required so we can read/write the per-user sidecar. */
  username: string;
}

const SOFT_CAP = 500;

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Format YYYY-MM-DD into a human row label like "Mon, May 25, 2026". */
function formatRowLabel(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const date = new Date(y, mo - 1, d);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function PtoEditor({ username }: Props) {
  const [sidecar, setSidecar] = useState<StreakSidecar | null>(null);
  const [pendingDate, setPendingDate] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Initial load. Re-read whenever username changes so a user-switch
  // doesn't leave the old user's PTO list visible.
  useEffect(() => {
    let cancelled = false;
    setSidecar(null);
    if (!username) return;
    readStreak(username).then((sc) => {
      if (!cancelled) setSidecar(sc);
    });
    return () => {
      cancelled = true;
    };
  }, [username]);

  const handleAdd = useCallback(async () => {
    setError(null);
    if (!pendingDate) {
      setError("Pick a date first.");
      return;
    }
    // Future-dates-only via the manual picker (proposal §6.3).
    if (pendingDate < todayIso()) {
      setError("Past dates can't be added here. Add future dates only.");
      return;
    }
    if (!username) return;
    setLoading(true);
    try {
      const next = await patchStreak(username, (cur) => ({
        ...cur,
        // The sidecar's normalize() handles sort + dedupe on persist,
        // so naive append is safe — duplicates collapse on write.
        pto_dates: [...cur.pto_dates, pendingDate],
      }));
      setSidecar(next);
      setPendingDate("");
    } finally {
      setLoading(false);
    }
  }, [pendingDate, username]);

  const handleRemove = useCallback(
    async (iso: string) => {
      if (!username) return;
      setLoading(true);
      try {
        const next = await patchStreak(username, (cur) => ({
          ...cur,
          pto_dates: cur.pto_dates.filter((d) => d !== iso),
        }));
        setSidecar(next);
      } finally {
        setLoading(false);
      }
    },
    [username],
  );

  // Loading state — render a stable wrapper so test queries that assert
  // the header text don't have to wait on the async read.
  const ptoDates = sidecar?.pto_dates ?? [];
  const overSoftCap = ptoDates.length >= SOFT_CAP;

  return (
    <section
      data-testid="pto-editor"
      className="rounded-lg border border-border bg-surface-raised p-4"
    >
      <header className="mb-1">
        <h3 className="text-body font-semibold text-foreground">Days off (PTO)</h3>
        <p className="text-meta text-foreground-muted">
          Dates here are treated like weekends for your streak and for
          projects that skip weekends.
        </p>
      </header>

      {/* Add row */}
      <div className="mt-3 flex items-center gap-2">
        <input
          type="date"
          value={pendingDate}
          min={todayIso()}
          onChange={(e) => setPendingDate(e.target.value)}
          disabled={loading || !username}
          data-testid="pto-editor-date-input"
          className="rounded border border-border px-2 py-1 text-body"
        />
        <button
          type="button"
          onClick={handleAdd}
          disabled={loading || !username || !pendingDate}
          data-testid="pto-editor-add-button"
          className="rounded bg-brand-action px-3 py-1 text-body font-medium text-white hover:bg-brand-action/90 disabled:opacity-50"
        >
          Add
        </button>
      </div>
      {error && (
        <p className="mt-1 text-meta text-red-600" role="alert">
          {error}
        </p>
      )}

      {/* Soft cap warning */}
      {overSoftCap && (
        <p
          className="mt-2 text-meta text-amber-700"
          role="status"
          data-testid="pto-editor-soft-cap-warning"
        >
          You have {ptoDates.length} PTO days. That&apos;s a lot, double
          check the list.
        </p>
      )}

      {/* Entries list */}
      <div className="mt-3">
        {ptoDates.length === 0 ? (
          <div
            className="flex flex-col items-center gap-2 rounded border border-dashed border-border py-6 text-foreground-muted"
            data-testid="pto-editor-empty"
          >
            <CalendarIcon className="h-6 w-6" />
            <p className="text-meta">
              No PTO days yet. Add dates you won&apos;t be working.
            </p>
          </div>
        ) : (
          <ul
            className="divide-y divide-border rounded border border-border"
            data-testid="pto-editor-list"
          >
            {ptoDates.map((iso) => (
              <li
                key={iso}
                data-testid={`pto-editor-entry-${iso}`}
                className="flex items-center justify-between px-3 py-1.5"
              >
                <span className="text-body text-foreground">
                  <span className="font-mono text-meta text-foreground-muted">{iso}</span>
                  <span className="ml-2 text-foreground-muted">
                    {formatRowLabel(iso)}
                  </span>
                </span>
                <Tooltip label="Remove" placement="left">
                  <button
                    type="button"
                    onClick={() => handleRemove(iso)}
                    disabled={loading}
                    aria-label={`Remove ${iso}`}
                    data-testid={`pto-editor-remove-${iso}`}
                    className="rounded p-1 text-foreground-muted hover:bg-surface-sunken hover:text-foreground"
                  >
                    <XIcon className="h-4 w-4" />
                  </button>
                </Tooltip>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
