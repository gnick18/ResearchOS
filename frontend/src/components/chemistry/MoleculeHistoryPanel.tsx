"use client";

// chem-history bot (2026-06-11): the History tab in the molecule editor companion
// rail. Backed by the shared delta-store engine (lib/history), mirroring the
// SequenceHistoryPanel pattern.
//
// Each explicit Save records a version (recordMoleculeHistory, wired in api.ts).
// This panel reads that history and renders a newest-first version list with a
// molecule-appropriate summary per row. A selected row shows the MoleculeThumbnail
// for that version (structure thumbnail + identity is the "diff" for molecules;
// no character-level diff). One-click RESTORE (inline-confirmed, no native
// confirm()) writes the recovered Molfile back through moleculesApi.restoreVersion.
//
// Inline SVG icons only (no emoji); no em-dashes; Tooltip not title=.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import {
  historyEngine,
  moleculeAdapter,
  type HistoryRow,
  type MoleculeProjection,
} from "@/lib/history";
import { MOLECULES_ENTITY_TYPE } from "@/lib/chemistry/molecule-history";
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
import { MoleculeThumbnail } from "./MoleculeThumbnail";
import { moleculesApi } from "@/lib/chemistry/api";

// ── Local icon helpers ────────────────────────────────────────────────────────
// Routed through the shared <Icon> registry (history / undo / chevronRight) so
// the panel carries no inline SVG. Kept as thin wrappers to leave the call
// sites below unchanged.

function IconHistory({ className }: { className?: string }) {
  return <Icon name="history" className={className} />;
}

function IconRestore({ className }: { className?: string }) {
  return <Icon name="undo" className={className} />;
}

function IconChevron({ className }: { className?: string }) {
  return <Icon name="chevronRight" className={className} />;
}

// ── Panel props ───────────────────────────────────────────────────────────────

export interface MoleculeHistoryPanelProps {
  /** String molecule id (the per-user counter, e.g. "14"). */
  moleculeId: string;
  /** Owner folder the history file lives under. */
  owner: string;
  /**
   * True when the editor surface may restore (not read-only). Gates the per-row
   * restore affordance; HEAD (the live version) is never restorable.
   */
  canRestore?: boolean;
  /**
   * Called when a restore completes. The parent should reload the molecule and
   * close or refresh the editor. Resolves when the restore write is done so the
   * panel can re-read the new "Restored an earlier version" row.
   */
  onRestore?: (versionIndex: number) => Promise<void>;
  /** Injected clock for deterministic relative labels (tests). */
  now?: Date;
}

// ── The panel ─────────────────────────────────────────────────────────────────

export default function MoleculeHistoryPanel({
  moleculeId,
  owner,
  canRestore = false,
  onRestore,
  now,
}: MoleculeHistoryPanelProps) {
  const profileMap = useLabUserProfileMap();
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [pageCount, setPageCount] = useState(1);
  const [summaries, setSummaries] = useState<Record<string, string>>({});
  /** rowId -> projection (for the per-row digest + selected-version thumbnail). */
  const [projections, setProjections] = useState<Record<string, MoleculeProjection>>({});
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(() => new Set());
  /** versionIndex currently selected for preview (null = HEAD). */
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  /** versionIndex awaiting inline restore confirm (null = none). */
  const [confirming, setConfirming] = useState<number | null>(null);
  const [restoring, setRestoring] = useState(false);
  /** Bumped after a restore so the list re-reads the new revert row. */
  const [reloadTick, setReloadTick] = useState(0);

  const nowRef = useMemo(() => now ?? new Date(), [now]);

  // ── Load history rows. Refreshes when moleculeId / owner / reloadTick change. ─
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const read = await historyEngine.readHistory(MOLECULES_ENTITY_TYPE, owner, moleculeId);
        if (!cancelled) {
          setRows(read);
          setLoadError(false);
        }
      } catch (err) {
        console.warn(
          `[history] could not read history for ${MOLECULES_ENTITY_TYPE}/${moleculeId}:`,
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
  }, [moleculeId, owner, reloadTick]);

  // ── Reconstruct every version to derive the digest + delta summary. ──────────
  useEffect(() => {
    if (!rows || rows.length === 0) {
      setSummaries({});
      setProjections({});
      return;
    }
    let cancelled = false;
    (async () => {
      const nextSummaries: Record<string, string> = {};
      const nextProjections: Record<string, MoleculeProjection> = {};
      let prevProjection: MoleculeProjection | null = null;
      for (let i = 0; i < rows.length; i++) {
        let canonical = "";
        try {
          canonical = await historyEngine.reconstructState(
            MOLECULES_ENTITY_TYPE,
            owner,
            moleculeId,
            i,
          );
        } catch (err) {
          console.warn(
            `[history] reconstructState failed at version ${i} for ${MOLECULES_ENTITY_TYPE}/${moleculeId}:`,
            err,
          );
        }
        const row = rows[i];
        if (row.kind !== "genesis" && row.kind !== "boundary_snapshot") {
          const projection = moleculeAdapter.projectBody(canonical);
          nextSummaries[row.id] = moleculeAdapter.summarize(
            prevProjection,
            projection,
            row.kind,
          );
          nextProjections[row.id] = projection;
          prevProjection = projection;
        } else if (row.kind === "boundary_snapshot") {
          prevProjection = moleculeAdapter.projectBody(canonical);
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
  }, [rows, owner, moleculeId]);

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
      if (restoring) return;
      setRestoring(true);
      try {
        if (onRestore) {
          await onRestore(versionIndex);
        } else {
          // Default: call moleculesApi.restoreVersion directly.
          await moleculesApi.restoreVersion(moleculeId, versionIndex, owner);
        }
        setReloadTick((t) => t + 1);
      } finally {
        setRestoring(false);
        setConfirming(null);
      }
    },
    [onRestore, restoring, moleculeId, owner],
  );

  const isEmpty = rows !== null && flatVersions.length === 0;

  // ── The version currently selected for preview (or null = no selection). ─────
  const selectedProjection: MoleculeProjection | null = useMemo(() => {
    if (selectedIndex === null || !rows) return null;
    const row = rows[selectedIndex];
    if (!row || row.kind === "genesis") return null;
    return projections[row.id] ?? null;
  }, [selectedIndex, rows, projections]);

  // ── Empty / loading states ────────────────────────────────────────────────────
  if (rows === null) {
    return (
      <div className="flex h-full w-full items-center justify-center text-meta text-foreground-muted">
        Loading version history...
      </div>
    );
  }

  if (isEmpty) {
    return (
      <div className="flex h-full w-full flex-col overflow-y-auto">
        <div className="flex flex-1 flex-col items-center justify-center px-4 py-8 text-center">
          <IconHistory className="h-8 w-8 text-foreground-muted" />
          <p className="mt-2 text-body font-medium text-foreground-muted">No earlier versions yet</p>
          <p className="mt-1 max-w-xs text-meta text-foreground-muted">
            {loadError
              ? "This molecule has no readable history."
              : "Each time you save this molecule, a version is recorded here so you can compare and restore it later."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <IconHistory className="h-4 w-4 text-foreground-muted" />
        <h3 className="text-meta font-semibold text-foreground">Version history</h3>
        <span className="ml-auto text-meta text-foreground-muted">
          {model?.totalVersions} {model?.totalVersions === 1 ? "version" : "versions"}
        </span>
      </div>

      {/* Version preview: thumbnail + identity for the selected version. */}
      {selectedProjection && (
        <VersionPreview projection={selectedProjection} />
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {model?.days.map((day) => (
          <div key={day.dayKey}>
            <div className="sticky top-0 z-10 border-b border-border bg-surface-sunken/95 px-3 py-1 text-meta font-semibold uppercase tracking-wide text-foreground-muted backdrop-blur">
              {day.label}
            </div>
            {day.sessions.map((session, si) => {
              const sessionKey = `${day.dayKey}:${si}`;
              const expanded = !session.collapsible || expandedSessions.has(sessionKey);
              const resolvedActors = session.actors.map((a) =>
                resolveDisplayName(a, profileMap),
              );
              const resolvedNames = resolvedActors.map((r) => r.label);
              if (session.collapsible && !expanded) {
                return (
                  <button
                    key={sessionKey}
                    type="button"
                    onClick={() => toggleSession(sessionKey)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-surface-sunken"
                  >
                    <span className="relative flex-shrink-0" style={{ width: session.actors.length > 1 ? `${16 + (session.actors.length - 1) * 8}px` : undefined }}>
                      {session.actors.slice(0, 3).map((actor, idx) => (
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
                      className="flex w-full items-center gap-1 px-3 pt-2 text-meta text-foreground-muted hover:text-foreground"
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
                    <MoleculeVersionRow
                      key={entry.rowId}
                      entry={entry}
                      label={resolveDisplayName(entry.actor, profileMap).label}
                      digest={projections[entry.rowId]?.body ?? ""}
                      selected={selectedIndex === entry.versionIndex}
                      canRestore={canRestore && !!onRestore && !entry.isHead}
                      confirming={confirming === entry.versionIndex}
                      restoring={restoring}
                      onSelect={() =>
                        setSelectedIndex((prev) =>
                          prev === entry.versionIndex ? null : entry.versionIndex,
                        )
                      }
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

        {/* Compacted rows summary. */}
        {model?.summarized && (
          <div className="border-t border-border bg-amber-50/40 dark:bg-amber-500/15 px-3 py-2">
            <p className="text-meta font-medium text-foreground-muted">Earlier versions (summarized)</p>
            <p className="mt-0.5 text-meta leading-snug text-foreground-muted">
              {model.summarized.compactedRowCount} intermediate saves before{" "}
              {model.summarized.dayLabel} were summarized to keep history fast.
            </p>
          </div>
        )}

        {/* Pagination. */}
        {model?.hasMore && (
          <div className="border-t border-border px-3 py-2">
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

// ── Version preview (thumbnail + identity for a selected prior version) ───────

function VersionPreview({ projection }: { projection: MoleculeProjection }) {
  return (
    <div className="border-b border-border bg-surface-sunken px-3 py-2">
      <p className="mb-1 text-meta font-semibold uppercase tracking-wide text-foreground-muted">
        Preview
      </p>
      <div className="flex items-start gap-3">
        {projection.molfile || projection.smiles ? (
          <MoleculeThumbnail
            structure={projection.molfile || projection.smiles}
            width={100}
            height={72}
            className="flex-shrink-0 rounded border border-border bg-white"
          />
        ) : (
          <div className="flex h-[72px] w-[100px] flex-shrink-0 items-center justify-center rounded border border-border bg-surface-raised text-meta text-foreground-muted">
            No structure
          </div>
        )}
        <div className="min-w-0 flex-1 space-y-0.5">
          {projection.name && (
            <p className="truncate text-body font-semibold text-foreground">{projection.name}</p>
          )}
          {projection.formula && (
            <p className="font-mono text-meta text-foreground-muted">{projection.formula}</p>
          )}
          {projection.mol_weight != null && (
            <p className="text-meta text-foreground-muted">{projection.mol_weight.toFixed(2)} g/mol</p>
          )}
          {projection.inchikey && (
            <p className="truncate font-mono text-meta text-foreground-muted">{projection.inchikey}</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── A single version row ───────────────────────────────────────────────────────

function MoleculeVersionRow({
  entry,
  label,
  digest,
  selected,
  canRestore,
  confirming,
  restoring,
  onSelect,
  onStartConfirm,
  onCancelConfirm,
  onConfirmRestore,
}: {
  entry: VersionEntry;
  label: string;
  digest: string;
  selected: boolean;
  canRestore: boolean;
  confirming: boolean;
  restoring: boolean;
  onSelect: () => void;
  onStartConfirm: () => void;
  onCancelConfirm: () => void;
  onConfirmRestore: () => void;
}) {
  return (
    <div
      className={`flex items-start gap-2 px-3 py-2 transition-colors hover:bg-surface-sunken ${
        entry.isHead
          ? "bg-emerald-50/40 dark:bg-emerald-500/15"
          : selected
            ? "bg-surface-sunken"
            : ""
      }`}
      data-testid="molecule-version-row"
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
        <span className="block truncate text-meta font-medium text-foreground-muted">
          {entry.summary}
        </span>
        {digest && (
          <span className="block truncate text-meta text-foreground-muted">{digest}</span>
        )}
        <Tooltip label={`${formatFullDate(entry.ts)} · ${entry.ts}`} placement="bottom">
          <span className="block w-fit text-meta text-foreground-muted">
            {formatRelative(entry.ts)}
          </span>
        </Tooltip>

        {/* Preview toggle (non-head only; click to select / deselect). */}
        {!entry.isHead && (
          <button
            type="button"
            onClick={onSelect}
            data-testid="molecule-preview-button"
            className="ros-btn-neutral mt-1 inline-flex items-center gap-1 px-2 py-0.5 text-meta font-medium text-foreground-muted"
          >
            {selected ? "Hide preview" : "Preview"}
          </button>
        )}

        {/* Inline restore (non-head + write access). No native confirm(). */}
        {canRestore && !confirming && (
          <button
            type="button"
            onClick={onStartConfirm}
            data-testid="molecule-restore-button"
            className="ml-1 mt-1 inline-flex items-center gap-1 rounded-md border border-emerald-200 dark:border-emerald-500/30 px-2 py-0.5 text-meta font-medium text-emerald-700 dark:text-emerald-300 transition-colors hover:bg-emerald-50 dark:hover:bg-emerald-500/20"
          >
            <IconRestore className="h-3 w-3" />
            Restore this version
          </button>
        )}
        {canRestore && confirming && (
          <span className="mt-1 flex items-center gap-1.5" data-testid="molecule-restore-confirm">
            <button
              type="button"
              onClick={onConfirmRestore}
              disabled={restoring}
              data-testid="molecule-restore-confirm-button"
              className="ros-btn-raise rounded-md bg-emerald-600 px-2 py-0.5 text-meta font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-60"
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
