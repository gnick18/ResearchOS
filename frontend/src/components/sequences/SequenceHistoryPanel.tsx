"use client";

// seq history bot (2026-06-03) — the HISTORY tab, now a REAL per-sequence
// version timeline backed by the shared delta-store engine (lib/history).
//
// Each explicit Save in the editor records a version (recordSequenceHistory,
// wired on the save path). This panel reads that history and renders a
// newest-first, day -> session grouped list (the SAME buildVersionList grouping
// the Notes / Task viewers use), with a sequence-appropriate SUMMARY per row.
//
// A sequence is NOT line-diffable like prose, so the per-row summary is a
// concise digest + delta: "3,400 bp, 8 features, circular" with a vs-previous
// delta like "+12 bp, +1 feature" (summarizeSequenceChange). One-click RESTORE
// loads an earlier version back into the editor (the parent owns the reverse-
// walk + write + reflect; this panel only surfaces the intent, inline-confirmed
// — no native confirm(), per the house rule).
//
// Inline SVG only (no emoji); no em-dashes; Tooltip not title=.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  historyEngine,
  sequenceAdapter,
  type HistoryRow,
  type SequenceProjection,
} from "@/lib/history";
import { SEQUENCES_ENTITY_TYPE } from "@/lib/history/sequences-history";
import {
  buildVersionList,
  sessionRangeLabel,
  type VersionEntry,
  type VersionListModel,
} from "@/lib/history/entity-viewer";
import {
  resolveDisplayName,
  formatRelative,
  formatFullDate,
} from "@/components/AttributionChip";
import { useLabUserProfileMap } from "@/hooks/useLabUserProfiles";
import UserAvatar from "@/components/UserAvatar";
import Tooltip from "@/components/Tooltip";

function IconHistory({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 4v4h4" />
      <path d="M12 8v4l3 2" />
    </svg>
  );
}

function IconRestore({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M3 3v5h5" />
      <path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function IconChevron({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M9 5l7 7-7 7" />
    </svg>
  );
}

export interface SequenceHistoryPanelProps {
  /** Numeric sequence id (the {id}.gb document key). */
  sequenceId: number;
  /** Owner folder the history file lives under (the sequence's user). */
  owner: string;
  /**
   * Canonical tracked state of the LIVE HEAD molecule (canonicalize of the live
   * editor doc, threaded down). The engine needs this to resolve a bare-genesis
   * anchor: a sequence that existed BEFORE its first tracked Save anchors genesis
   * at a non-empty pre-image, so reconstructState must reverse-walk from HEAD
   * (R4-prep 2c). Without it every reconstruct throws and the summaries go blank.
   */
  headCanonical: string;
  /**
   * True when the editor surface may restore (not read-only). Gates the per-row
   * restore affordance; HEAD (the live version) is never restorable.
   */
  canRestore?: boolean;
  /**
   * Restore the version at `versionIndex` into the editor. The parent (the edit
   * view) owns the reverse-walk + write + reflect-into-doc; this panel only fires
   * the intent. Resolves when the restore (and the editor reload) is done so the
   * panel can refresh its list to show the new "Restored an earlier version" row.
   */
  onRestore?: (versionIndex: number) => Promise<void>;
  /** Injected clock for deterministic relative labels (tests). Defaults to now. */
  now?: Date;
}

export default function SequenceHistoryPanel({
  sequenceId,
  owner,
  headCanonical,
  canRestore = false,
  onRestore,
  now,
}: SequenceHistoryPanelProps) {
  const profileMap = useLabUserProfileMap();
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [pageCount, setPageCount] = useState(1);
  const [summaries, setSummaries] = useState<Record<string, string>>({});
  /** rowId -> the version's full projection (for the per-row digest). */
  const [projections, setProjections] = useState<Record<string, SequenceProjection>>({});
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(() => new Set());
  /** versionIndex currently awaiting an inline restore confirm (null = none). */
  const [confirming, setConfirming] = useState<number | null>(null);
  const [restoring, setRestoring] = useState(false);
  /** Bumped after a successful restore so the list re-reads the new revert row
   *  in place (headCanonical alone can lag a frame behind the write). */
  const [reloadTick, setReloadTick] = useState(0);

  const nowRef = useMemo(() => now ?? new Date(), [now]);

  // ── Load history. headCanonical is in the deps so an open panel refreshes
  // after a restore writes a new row (the restore changes the live doc, which
  // changes headCanonical); reloadTick forces a re-read the instant a restore
  // resolves, since the engine write completes before headCanonical settles. ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const read = await historyEngine.readHistory(SEQUENCES_ENTITY_TYPE, owner, sequenceId);
        if (!cancelled) {
          setRows(read);
          setLoadError(false);
        }
      } catch (err) {
        console.warn(
          `[history] could not read history for ${SEQUENCES_ENTITY_TYPE}/${sequenceId}:`,
          err,
        );
        if (!cancelled) {
          setRows([]);
          setLoadError(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sequenceId, owner, headCanonical, reloadTick]);

  // ── Reconstruct every version, derive the digest + delta summary. ──────────
  useEffect(() => {
    if (!rows || rows.length === 0) {
      setSummaries({});
      setProjections({});
      return;
    }
    let cancelled = false;
    (async () => {
      const nextSummaries: Record<string, string> = {};
      const nextProjections: Record<string, SequenceProjection> = {};
      let prevProjection: SequenceProjection | null = null;
      for (let i = 0; i < rows.length; i++) {
        let canonical = "";
        try {
          canonical = await historyEngine.reconstructState(
            SEQUENCES_ENTITY_TYPE,
            owner,
            sequenceId,
            i,
            headCanonical,
          );
        } catch (err) {
          console.warn(
            `[history] reconstructState failed at version ${i} for ${SEQUENCES_ENTITY_TYPE}/${sequenceId}:`,
            err,
          );
        }
        const row = rows[i];
        if (row.kind !== "genesis" && row.kind !== "boundary_snapshot") {
          const projection = sequenceAdapter.projectBody(canonical);
          nextSummaries[row.id] = sequenceAdapter.summarize(
            prevProjection,
            projection,
            row.kind,
          );
          nextProjections[row.id] = projection;
          prevProjection = projection;
        } else if (row.kind === "boundary_snapshot") {
          prevProjection = sequenceAdapter.projectBody(canonical);
        }
      }
      if (!cancelled) {
        setSummaries(nextSummaries);
        setProjections(nextProjections);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rows, owner, sequenceId, headCanonical]);

  const model: VersionListModel | null = useMemo(() => {
    if (!rows) return null;
    return buildVersionList(rows, nowRef, summaries, pageCount);
  }, [rows, nowRef, summaries, pageCount]);

  const flatVersions: VersionEntry[] = useMemo(() => {
    if (!model) return [];
    const out: VersionEntry[] = [];
    for (const day of model.days) {
      for (const session of day.sessions) out.push(...session.versions);
    }
    return out;
  }, [model]);

  const toggleSession = useCallback((key: string) => {
    setExpandedSessions((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const handleConfirmRestore = useCallback(
    async (versionIndex: number) => {
      if (!onRestore || restoring) return;
      setRestoring(true);
      try {
        await onRestore(versionIndex);
        // The revert row is written by the time onRestore resolves; force a
        // re-read so the new "Restored an earlier version" HEAD shows in place.
        setReloadTick((t) => t + 1);
      } finally {
        setRestoring(false);
        setConfirming(null);
      }
    },
    [onRestore, restoring],
  );

  const isEmpty = rows !== null && flatVersions.length === 0;

  // ── Empty / loading states ─────────────────────────────────────────────────
  if (rows === null) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-white text-meta text-gray-400">
        Loading version history...
      </div>
    );
  }

  if (isEmpty) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center bg-white px-8 text-center">
        <IconHistory className="h-10 w-10 text-gray-300" />
        <p className="mt-3 text-body font-medium text-gray-600">No earlier versions yet</p>
        <p className="mt-1 max-w-xs text-meta text-gray-400">
          {loadError
            ? "This sequence has no readable history."
            : "Each time you Save this sequence, a version is recorded here so you can compare and restore it later."}
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col bg-white">
      <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-2.5">
        <IconHistory className="h-4 w-4 text-gray-500" />
        <h3 className="text-body font-semibold text-gray-800">Version history</h3>
        <span className="ml-auto text-meta text-gray-400">
          {model?.totalVersions} {model?.totalVersions === 1 ? "version" : "versions"}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {model?.days.map((day) => (
          <div key={day.dayKey}>
            <div className="sticky top-0 z-10 border-b border-gray-100 bg-gray-50/95 px-4 py-1.5 text-meta font-semibold uppercase tracking-wide text-gray-400 backdrop-blur">
              {day.label}
            </div>
            {day.sessions.map((session, si) => {
              const sessionKey = `${day.dayKey}:${si}`;
              const expanded = !session.collapsible || expandedSessions.has(sessionKey);
              const resolved = resolveDisplayName(session.actor, profileMap);
              if (session.collapsible && !expanded) {
                return (
                  <button
                    key={sessionKey}
                    type="button"
                    onClick={() => toggleSession(sessionKey)}
                    className="flex w-full items-center gap-2 px-4 py-2 text-left transition-colors hover:bg-gray-50"
                  >
                    <UserAvatar username={session.actor} size="xs" />
                    <span className="flex-1 truncate text-meta text-gray-600">
                      {sessionRangeLabel(session, resolved.label)}
                    </span>
                    <IconChevron className="h-3 w-3 flex-shrink-0 text-gray-400" />
                  </button>
                );
              }
              return (
                <div key={sessionKey}>
                  {session.collapsible && expanded && (
                    <button
                      type="button"
                      onClick={() => toggleSession(sessionKey)}
                      className="flex w-full items-center gap-1 px-4 pt-2 text-meta text-gray-400 hover:text-gray-600"
                    >
                      <IconChevron className="h-3 w-3 rotate-90" />
                      {resolved.label}, {session.versions.length} versions
                    </button>
                  )}
                  {session.versions.map((entry) => (
                    <SequenceVersionRow
                      key={entry.rowId}
                      entry={entry}
                      label={resolveDisplayName(entry.actor, profileMap).label}
                      digest={projections[entry.rowId]?.body ?? ""}
                      canRestore={canRestore && !!onRestore && !entry.isHead}
                      confirming={confirming === entry.versionIndex}
                      restoring={restoring}
                      onStartConfirm={() => setConfirming(entry.versionIndex)}
                      onCancelConfirm={() => setConfirming(null)}
                      onConfirmRestore={() => handleConfirmRestore(entry.versionIndex)}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        ))}

        {/* Folded-rows summary (compaction ran). */}
        {model?.summarized && (
          <div className="border-t border-gray-100 bg-amber-50/40 px-4 py-3">
            <p className="text-meta font-medium text-gray-600">Earlier versions (summarized)</p>
            <p className="mt-1 text-meta leading-snug text-gray-500">
              {model.summarized.compactedRowCount} intermediate saves before{" "}
              {model.summarized.dayLabel} were summarized to keep history fast. Row by row
              detail stops here.
            </p>
          </div>
        )}

        {/* Pagination. */}
        {model?.hasMore && (
          <div className="border-t border-gray-100 px-4 py-3">
            <button
              type="button"
              onClick={() => setPageCount((p) => p + 1)}
              className="w-full rounded-lg bg-gray-100 px-3 py-1.5 text-meta text-gray-600 transition-colors hover:bg-gray-200"
            >
              Load older versions
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** A single version row: who / when / the digest + delta summary, with restore. */
function SequenceVersionRow({
  entry,
  label,
  digest,
  canRestore,
  confirming,
  restoring,
  onStartConfirm,
  onCancelConfirm,
  onConfirmRestore,
}: {
  entry: VersionEntry;
  label: string;
  digest: string;
  canRestore: boolean;
  confirming: boolean;
  restoring: boolean;
  onStartConfirm: () => void;
  onCancelConfirm: () => void;
  onConfirmRestore: () => void;
}) {
  return (
    <div
      className={`flex items-start gap-2 px-4 py-2.5 ${
        entry.isHead ? "bg-emerald-50/40" : ""
      }`}
      data-testid="sequence-version-row"
      data-version-index={entry.versionIndex}
    >
      <span className="pt-0.5 flex-shrink-0">
        <UserAvatar username={entry.actor} size="xs" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-meta font-medium text-gray-800">{label}</span>
          {entry.isHead && (
            <span className="flex-shrink-0 text-meta font-semibold uppercase tracking-wide text-emerald-600">
              Current version
            </span>
          )}
        </span>
        {/* Delta summary (e.g. "+12 bp, +1 feature") + the absolute digest. */}
        <span className="block truncate text-meta font-medium text-gray-600">
          {entry.summary}
        </span>
        {digest && <span className="block truncate text-meta text-gray-400">{digest}</span>}
        <Tooltip label={`${formatFullDate(entry.ts)} · ${entry.ts}`} placement="bottom">
          <span className="block w-fit text-meta text-gray-400">{formatRelative(entry.ts)}</span>
        </Tooltip>

        {/* Inline restore (NON-HEAD + write access). The confirm is inline, not
            a native dialog, per the house rule. */}
        {canRestore && !confirming && (
          <button
            type="button"
            onClick={onStartConfirm}
            data-testid="sequence-restore-button"
            className="mt-1 inline-flex items-center gap-1 rounded-md border border-emerald-200 px-2 py-0.5 text-meta font-medium text-emerald-700 transition-colors hover:bg-emerald-50"
          >
            <IconRestore className="h-3 w-3" />
            Restore this version
          </button>
        )}
        {canRestore && confirming && (
          <span className="mt-1 flex items-center gap-1.5" data-testid="sequence-restore-confirm">
            <button
              type="button"
              onClick={onConfirmRestore}
              disabled={restoring}
              data-testid="sequence-restore-confirm-button"
              className="rounded-md bg-emerald-600 px-2 py-0.5 text-meta font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-60"
            >
              {restoring ? "Restoring..." : "Restore"}
            </button>
            <button
              type="button"
              onClick={onCancelConfirm}
              disabled={restoring}
              className="rounded-md bg-gray-100 px-2 py-0.5 text-meta font-medium text-gray-600 transition-colors hover:bg-gray-200 disabled:opacity-60"
            >
              Cancel
            </button>
          </span>
        )}
      </span>
    </div>
  );
}
