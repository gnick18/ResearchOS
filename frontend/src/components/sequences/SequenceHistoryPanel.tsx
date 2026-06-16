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
import { Icon } from "@/components/icons";
import type { SequenceRestoreAudit } from "@/lib/types";
import { isArtifactStale, type Artifact } from "@/lib/sequences/artifacts";

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
   * restore audit bot: the deleted/restored audit blob, present ONLY when this
   * sequence was restored from Trash. When set, the panel renders a one-line
   * provenance entry at the top of the timeline (above the version rows). Absent
   * on a never-trashed sequence (nothing renders).
   */
  restoreAudit?: SequenceRestoreAudit | null;
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
  /**
   * Phase 5 (results as artifacts). The saved RESULT artifacts for this sequence
   * (newest first), surfaced in a "Results" section above the version timeline.
   * Empty / omitted -> a calm teaching empty state.
   */
  artifacts?: Artifact[];
  /** The live sequence's content fingerprint, for flagging a result STALE when
   *  the sequence has changed since the result was computed. */
  sequenceVersion?: string;
  /** Re-open a saved result (the parent re-seeds the Compare dialog or the
   *  domains read view). */
  onOpenArtifact?: (artifact: Artifact) => void;
  /** Delete a saved result (the parent persists the removal). */
  onDeleteArtifact?: (artifactId: string) => void;
}

export default function SequenceHistoryPanel({
  sequenceId,
  owner,
  headCanonical,
  canRestore = false,
  onRestore,
  now,
  restoreAudit,
  artifacts = [],
  sequenceVersion = "",
  onOpenArtifact,
  onDeleteArtifact,
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

  // restore audit bot: the one-line deleted/restored provenance, surfaced at the
  // top of the timeline when this sequence came back from Trash. `·` separated,
  // names resolved through the lab profile map. Absent on a never-trashed seq.
  const restoreProvenanceLine = useMemo(() => {
    if (!restoreAudit) return null;
    const deletedBy = resolveDisplayName(restoreAudit.deleted_by, profileMap).label;
    const restoredBy = resolveDisplayName(restoreAudit.restored_by, profileMap).label;
    return `Deleted ${formatFullDate(restoreAudit.deleted_at)} by ${deletedBy} · Restored ${formatFullDate(restoreAudit.restored_at)} by ${restoredBy}`;
  }, [restoreAudit, profileMap]);

  const isEmpty = rows !== null && flatVersions.length === 0;

  // ── Empty / loading states ─────────────────────────────────────────────────
  if (rows === null) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-surface-raised text-meta text-foreground-muted">
        Loading version history...
      </div>
    );
  }

  if (isEmpty) {
    return (
      <div className="flex h-full w-full flex-col overflow-y-auto bg-surface-raised">
        {restoreProvenanceLine && <RestoreProvenanceRow line={restoreProvenanceLine} />}
        <ResultsSection
          artifacts={artifacts}
          sequenceVersion={sequenceVersion}
          onOpenArtifact={onOpenArtifact}
          onDeleteArtifact={onDeleteArtifact}
        />
        <div className="flex flex-1 flex-col items-center justify-center px-8 py-10 text-center">
          <IconHistory className="h-10 w-10 text-foreground-muted" />
          <p className="mt-3 text-body font-medium text-foreground-muted">No earlier versions yet</p>
          <p className="mt-1 max-w-xs text-meta text-foreground-muted">
            {loadError
              ? "This sequence has no readable history."
              : "Each time you Save this sequence, a version is recorded here so you can compare and restore it later."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col bg-surface-raised">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <IconHistory className="h-4 w-4 text-foreground-muted" />
        <h3 className="text-body font-semibold text-foreground">Version history</h3>
        <span className="ml-auto text-meta text-foreground-muted">
          {model?.totalVersions} {model?.totalVersions === 1 ? "version" : "versions"}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {restoreProvenanceLine && <RestoreProvenanceRow line={restoreProvenanceLine} />}
        <ResultsSection
          artifacts={artifacts}
          sequenceVersion={sequenceVersion}
          onOpenArtifact={onOpenArtifact}
          onDeleteArtifact={onDeleteArtifact}
        />
        {model?.days.map((day) => (
          <div key={day.dayKey}>
            <div className="sticky top-0 z-10 border-b border-border bg-surface-sunken/95 px-4 py-1.5 text-meta font-semibold uppercase tracking-wide text-foreground-muted backdrop-blur">
              {day.label}
            </div>
            {day.sessions.map((session, si) => {
              const sessionKey = `${day.dayKey}:${si}`;
              const expanded = !session.collapsible || expandedSessions.has(sessionKey);
              // Resolve display names for all contributors in this session.
              const resolvedActors = session.actors.map((a) =>
                resolveDisplayName(a, profileMap),
              );
              const resolvedNames = resolvedActors.map((r) => r.label);
              if (session.collapsible && !expanded) {
                // Show up to 3 stacked UserAvatars for multi-author sessions.
                const avatarActors = session.actors.slice(0, 3);
                return (
                  <button
                    key={sessionKey}
                    type="button"
                    onClick={() => toggleSession(sessionKey)}
                    className="flex w-full items-center gap-2 px-4 py-2 text-left transition-colors hover:bg-surface-sunken"
                  >
                    {/* Stacked avatars for multi-author; single avatar for solo */}
                    <span className="relative flex-shrink-0" style={{ width: avatarActors.length > 1 ? `${16 + (avatarActors.length - 1) * 8}px` : undefined }}>
                      {avatarActors.map((actor, idx) => (
                        <span
                          key={actor}
                          className="absolute top-0"
                          style={idx === 0 ? undefined : { left: `${idx * 8}px` }}
                        >
                          <UserAvatar username={actor} size="xs" />
                        </span>
                      ))}
                    </span>
                    <span className="flex-1 truncate text-meta text-foreground-muted">
                      {sessionRangeLabel(session, resolvedNames)}
                    </span>
                    <IconChevron className="h-3 w-3 flex-shrink-0 text-foreground-muted" />
                  </button>
                );
              }
              return (
                <div key={sessionKey}>
                  {session.collapsible && expanded && (
                    <button
                      type="button"
                      onClick={() => toggleSession(sessionKey)}
                      className="flex w-full items-center gap-1 px-4 pt-2 text-meta text-foreground-muted hover:text-foreground-muted"
                    >
                      <IconChevron className="h-3 w-3 rotate-90" />
                      {resolvedNames.length === 1
                        ? `${resolvedNames[0]}, ${session.versions.length} versions`
                        : resolvedNames.length === 2
                          ? `${resolvedNames[0]} & ${resolvedNames[1]}, ${session.versions.length} versions`
                          : `${resolvedNames[0]} +${resolvedNames.length - 1} others, ${session.versions.length} versions`}
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
          <div className="border-t border-border bg-amber-50/40 dark:bg-amber-500/15 px-4 py-3">
            <p className="text-meta font-medium text-foreground-muted">Earlier versions (summarized)</p>
            <p className="mt-1 text-meta leading-snug text-foreground-muted">
              {model.summarized.compactedRowCount} intermediate saves before{" "}
              {model.summarized.dayLabel} were summarized to keep history fast. Row by row
              detail stops here.
            </p>
          </div>
        )}

        {/* Pagination. */}
        {model?.hasMore && (
          <div className="border-t border-border px-4 py-3">
            <button
              type="button"
              onClick={() => setPageCount((p) => p + 1)}
              className="w-full rounded-lg bg-surface-sunken px-3 py-1.5 text-meta text-foreground-muted transition-colors hover:bg-surface-sunken"
            >
              Load older versions
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** restore audit bot: the deleted/restored provenance entry. Pinned at the top
 *  of the timeline so the recovery shows alongside the version history. One
 *  line, `·` separated; amber to match the library RestoredBadge. */
function RestoreProvenanceRow({ line }: { line: string }) {
  return (
    <div
      className="flex items-start gap-2 border-b border-amber-100 bg-amber-50/50 dark:bg-amber-500/15 px-4 py-2.5"
      data-testid="sequence-restore-provenance"
    >
      <IconRestore className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600 dark:text-amber-300" />
      <span className="min-w-0">
        <span className="block text-meta font-semibold text-amber-800 dark:text-amber-300">
          Restored from Trash
        </span>
        <span className="block text-meta text-amber-700 dark:text-amber-300">{line}</span>
      </span>
    </div>
  );
}

/**
 * Phase 5 (results as artifacts). The "Results" section pinned above the
 * version timeline. Lists the saved Align / Find-domains results newest first,
 * each row with a type icon, the title + summary, a relative time, a STALE chip
 * when the sequence has changed since, and Open / Delete actions. A calm empty
 * state teaches the section when there are no results yet.
 */
function ResultsSection({
  artifacts,
  sequenceVersion,
  onOpenArtifact,
  onDeleteArtifact,
}: {
  artifacts: Artifact[];
  sequenceVersion: string;
  onOpenArtifact?: (artifact: Artifact) => void;
  onDeleteArtifact?: (artifactId: string) => void;
}) {
  return (
    <div className="border-b border-border" data-testid="sequence-results-section">
      <div className="flex items-center gap-2 bg-surface-sunken/60 px-4 py-1.5">
        <Icon name="results" className="h-3.5 w-3.5 text-foreground-muted" />
        <span className="text-meta font-semibold uppercase tracking-wide text-foreground-muted">
          Results
        </span>
        {artifacts.length > 0 ? (
          <span className="ml-auto text-meta text-foreground-muted">
            {artifacts.length} saved
          </span>
        ) : null}
      </div>
      {artifacts.length === 0 ? (
        <p
          className="px-4 py-3 text-meta text-foreground-muted"
          data-testid="sequence-results-empty"
        >
          Run an analysis and its result is saved here.
        </p>
      ) : (
        artifacts.map((artifact) => (
          <ResultRow
            key={artifact.id}
            artifact={artifact}
            stale={isArtifactStale(artifact, sequenceVersion)}
            onOpen={onOpenArtifact ? () => onOpenArtifact(artifact) : undefined}
            onDelete={onDeleteArtifact ? () => onDeleteArtifact(artifact.id) : undefined}
          />
        ))
      )}
    </div>
  );
}

/** One saved-result row. The delete is inline-confirmed (no native confirm()),
 *  matching the version-row house rule. */
function ResultRow({
  artifact,
  stale,
  onOpen,
  onDelete,
}: {
  artifact: Artifact;
  stale: boolean;
  onOpen?: () => void;
  onDelete?: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div
      className="flex items-start gap-2 px-4 py-2.5"
      data-testid="sequence-result-row"
      data-result-type={artifact.type}
    >
      <span className="pt-0.5 flex-shrink-0 text-foreground-muted">
        <Icon
          name={artifact.type === "alignment" ? "align" : "protein"}
          className="h-4 w-4"
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-meta font-medium text-foreground">
            {artifact.title}
          </span>
          {stale ? (
            <span
              className="flex-shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-meta font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-500/20 dark:text-amber-300"
              data-testid="sequence-result-stale"
            >
              Stale
            </span>
          ) : null}
        </span>
        <span className="block truncate text-meta text-foreground-muted">
          {artifact.summary}
        </span>
        <Tooltip
          label={`${formatFullDate(artifact.createdAt)} · ${artifact.createdAt}`}
          placement="bottom"
        >
          <span className="block w-fit text-meta text-foreground-muted">
            {formatRelative(artifact.createdAt)}
          </span>
        </Tooltip>

        <span className="mt-1 flex items-center gap-1.5">
          {onOpen ? (
            <button
              type="button"
              onClick={onOpen}
              data-testid="sequence-result-open"
              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-meta font-medium text-foreground-muted transition-colors hover:bg-surface-sunken hover:text-foreground"
            >
              <Icon name="eye" className="h-3 w-3" />
              Open
            </button>
          ) : null}
          {onDelete && !confirming ? (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              data-testid="sequence-result-delete"
              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-meta font-medium text-foreground-muted transition-colors hover:bg-surface-sunken hover:text-foreground"
            >
              <Icon name="trash" className="h-3 w-3" />
              Delete
            </button>
          ) : null}
          {onDelete && confirming ? (
            <span className="flex items-center gap-1.5" data-testid="sequence-result-delete-confirm">
              <button
                type="button"
                onClick={() => {
                  onDelete();
                  setConfirming(false);
                }}
                className="rounded-md bg-rose-600 px-2 py-0.5 text-meta font-medium text-white transition-colors hover:bg-rose-700"
              >
                Delete
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="ros-btn-neutral px-2 py-0.5 text-meta font-medium text-foreground-muted"
              >
                Cancel
              </button>
            </span>
          ) : null}
        </span>
      </span>
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
        entry.isHead ? "bg-emerald-50/40 dark:bg-emerald-500/15" : ""
      }`}
      data-testid="sequence-version-row"
      data-version-index={entry.versionIndex}
    >
      <span className="pt-0.5 flex-shrink-0">
        <UserAvatar username={entry.actor} size="xs" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-meta font-medium text-foreground">{label}</span>
          {entry.isHead && (
            <span className="flex-shrink-0 text-meta font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-300">
              Current version
            </span>
          )}
        </span>
        {/* Delta summary (e.g. "+12 bp, +1 feature") + the absolute digest. */}
        <span className="block truncate text-meta font-medium text-foreground-muted">
          {entry.summary}
        </span>
        {digest && <span className="block truncate text-meta text-foreground-muted">{digest}</span>}
        <Tooltip label={`${formatFullDate(entry.ts)} · ${entry.ts}`} placement="bottom">
          <span className="block w-fit text-meta text-foreground-muted">{formatRelative(entry.ts)}</span>
        </Tooltip>

        {/* Inline restore (NON-HEAD + write access). The confirm is inline, not
            a native dialog, per the house rule. */}
        {canRestore && !confirming && (
          <button
            type="button"
            onClick={onStartConfirm}
            data-testid="sequence-restore-button"
            className="mt-1 inline-flex items-center gap-1 rounded-md border border-emerald-200 dark:border-emerald-500/30 px-2 py-0.5 text-meta font-medium text-emerald-700 dark:text-emerald-300 transition-colors hover:bg-emerald-50 dark:hover:bg-emerald-500/20"
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
              className="ros-btn-neutral px-2 py-0.5 text-meta font-medium text-foreground-muted disabled:opacity-60"
            >
              Cancel
            </button>
          </span>
        )}
      </span>
    </div>
  );
}
