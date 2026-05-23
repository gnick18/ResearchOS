"use client";

import { useEffect, useMemo, useState } from "react";
import { readAuditEntries, type PiAuditEntry } from "@/lib/lab/pi-audit";

interface AuditTrailNoticeProps {
  /** The record's owner — the user whose `_pi_audit.json` we read. */
  targetUser: string;
  /** Record type filter — "task" | "note" | "purchase_item" | etc. */
  recordType: string;
  /** Record id filter. Coerced to string for comparison so callers can
   *  pass `task.id` (number) or a string id without normalizing first. */
  recordId: string | number;
  /** When provided, only show entries that match this dot-path field.
   *  Used to anchor the notice underneath a specific field. Omit to
   *  show all entries for the record (used by a record-level "history"
   *  surface). */
  fieldPath?: string;
}

/**
 * Lab Head Phase 5 (lab head Phase 5 manager, 2026-05-23): inline
 * "Edited by PI on [date]" notice for read-only views.
 *
 * Renders nothing if there are no matching audit entries. Otherwise
 * shows a small collapsed line with the actor + date of the most
 * recent edit; expanding reveals each old→new pair. Multiple edits to
 * the same field show stacked oldest-to-newest.
 *
 * The reader is fire-and-forget — re-reads the audit file on mount and
 * on prop change. There's no subscription; if a save happens while
 * this notice is visible (rare; usually the popup is open in edit mode
 * during a save) the next mount will pick up the change. Cheap enough
 * that we don't need a query cache layer.
 */
export default function AuditTrailNotice({
  targetUser,
  recordType,
  recordId,
  fieldPath,
}: AuditTrailNoticeProps) {
  const [entries, setEntries] = useState<PiAuditEntry[] | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const all = await readAuditEntries(targetUser);
        if (cancelled) return;
        setEntries(all);
      } catch (err) {
        console.warn("[AuditTrailNotice] readAuditEntries failed", err);
        if (!cancelled) setEntries([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [targetUser]);

  const matched = useMemo(() => {
    if (!entries) return [];
    const ridStr = String(recordId);
    return entries.filter((e) => {
      if (e.record_type !== recordType) return false;
      if (String(e.record_id) !== ridStr) return false;
      if (fieldPath && e.field_path !== fieldPath) return false;
      return true;
    });
  }, [entries, recordType, recordId, fieldPath]);

  if (!entries) return null;
  if (matched.length === 0) return null;

  const latest = matched[matched.length - 1];
  const dateStr = formatAuditDate(latest.timestamp);

  return (
    <div className="mt-1 text-[11px] text-gray-500 italic">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="inline-flex items-center gap-1 hover:text-amber-700 hover:underline"
        aria-expanded={expanded}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M11 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5" />
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
        Edited by {latest.actor} on {dateStr}
        {matched.length > 1 ? ` (+${matched.length - 1} earlier)` : ""}
      </button>
      {expanded && (
        <ul className="mt-1 ml-3 space-y-1 not-italic">
          {matched.map((e) => (
            <li
              key={e.id}
              className="border-l-2 border-amber-300 pl-2 text-gray-600"
            >
              <div className="text-[10px] text-gray-500">
                <span className="font-medium text-amber-700">{e.actor}</span>{" "}
                — {formatAuditDate(e.timestamp)}
                {!fieldPath && (
                  <>
                    {" "}
                    — <span className="font-mono">{e.field_path}</span>
                  </>
                )}
              </div>
              <div className="text-[11px] mt-0.5">
                <span className="text-red-600 line-through">
                  {formatAuditValue(e.old_value)}
                </span>
                <span className="mx-1 text-gray-400">→</span>
                <span className="text-emerald-700">
                  {formatAuditValue(e.new_value)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatAuditDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function formatAuditValue(v: unknown): string {
  if (v === null || v === undefined) return "(empty)";
  if (typeof v === "string") return v || "(empty)";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    const json = JSON.stringify(v);
    // Truncate very long values so the inline diff stays readable. The
    // raw value is still on disk for whoever wants the full record.
    return json.length > 120 ? `${json.slice(0, 117)}…` : json;
  } catch {
    return "(unrenderable)";
  }
}
