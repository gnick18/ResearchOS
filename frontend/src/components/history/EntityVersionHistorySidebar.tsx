"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { historyEngine } from "@/lib/history";
import type { HistoryRow } from "@/lib/history";

/**
 * Minimal interface that any version-history engine must implement to drive
 * EntityVersionHistorySidebar. The legacy historyEngine satisfies this as-is;
 * the Loro-backed engine (history-engine.ts) satisfies it too, so the sidebar
 * is engine-agnostic via the optional `engine` prop below.
 *
 * The optional headCanonical parameter on reconstructState mirrors the legacy
 * engine signature (it is used only by the legacy engine's bare-genesis anchor
 * resolution; the Loro engine ignores it but must accept it for type compat).
 */
export interface VersionHistorySource {
  readHistory(entityType: string, owner: string, id: number): Promise<HistoryRow[]>;
  reconstructState(
    entityType: string,
    owner: string,
    id: number,
    versionIndex: number,
    headCanonical?: string,
  ): Promise<string>;
}
import {
  buildVersionList,
  sessionRangeLabel,
  type EntityProjection,
  type EntityViewerAdapter,
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

// Version Control Phase 3 (shared-generalization): the entity-agnostic
// right-sidebar version-history viewer. Generalized FROM the Notes pilot
// sidebar (NoteVersionHistorySidebar, now a thin wrapper) by replacing the
// hardcoded ENTITY_TYPE const + noteId with {entityType, id, adapter} props.
// Behavior is byte-for-byte the Notes one: the Notes adapter (notesAdapter)
// drives it identically, and the existing Notes tests are the regression canary.
//
// Responsibilities (unchanged):
//   - read the record's history file (historyEngine.readHistory),
//   - build the day -> session grouped list (buildVersionList),
//   - reconstruct the selected version + its compare base (predecessor by
//     default, current when toggled) and hand {before, after} UP to the popup
//     via onPreviewChange so the document column renders the diff in place,
//   - keyboard nav (Up/Down select, Enter preview, Esc close), focus trap,
//   - the VC Phase 2 restore footer (gated by canRestore + onRestore).
//
// The component NEVER parses unified-diff text: it consumes reconstructed
// canonical states from the engine and the adapter's projectBody projection.

export interface VersionPreview {
  /** Diff "before" body (predecessor or current, per the compare toggle). */
  before: string;
  /** Diff "after" body (the selected version). */
  after: string;
  /** Editor credited with the selected version (tints the diff). */
  editor: string;
  /** Resolved editor label for the avatar tooltip. */
  editorLabel: string;
}

interface EntityVersionHistorySidebarProps<P extends EntityProjection> {
  /** Entity type, e.g. "notes" / "tasks" — the history-file namespace. */
  entityType: string;
  /** Numeric record id. */
  id: number;
  /** Record owner folder the history file lives under. */
  owner: string;
  /**
   * The entity adapter: projectBody(canonical) + summarize(before, after).
   * Each shareable entity ships one (~40 lines); notesAdapter is the reference.
   */
  adapter: EntityViewerAdapter<P>;
  /** Close the sidebar + return to the live editable record. */
  onClose: () => void;
  /**
   * Push the selected version's diff up to the popup's document column.
   * `null` clears the preview (back to the live record).
   */
  onPreviewChange: (preview: VersionPreview | null) => void;
  /** Injected clock for deterministic relative labels (tests). Defaults to now. */
  now?: Date;
  /**
   * Canonical tracked state of the LIVE HEAD record (canonicalize(liveRecord)),
   * threaded down from the mount point that holds it. The engine needs this to
   * resolve the anchor of a BARE-GENESIS history file: the "create a record,
   * then make a first tracked save" flow anchors genesis at a NON-EMPTY
   * pre-image, so the empty-doc hash no longer matches the genesis post_hash and
   * the engine must reverse-walk from HEAD to lazily backfill genesis_state
   * (R4-prep 2c). Without it, reconstructState throws "cannot resolve anchor"
   * for every version, the canonical stays "", and every diff renders empty.
   * Optional: a fresh-record history (genesis anchored at the empty doc)
   * resolves without it, so legacy / test call sites that omit it still work.
   */
  headCanonical?: string;
  /**
   * VC Phase 2: gates the sticky-footer "Restore this version" affordance. The
   * popup computes it (= not read-only AND owner-or-PI-unlocked) and passes it
   * down. When false the footer never renders, whatever is selected.
   */
  canRestore?: boolean;
  /**
   * VC Phase 2: invoked with the selected NON-HEAD version index when the user
   * confirms a restore. The popup owns the actual reverse-walk + write + the
   * after-restore exit, so the sidebar only surfaces the intent.
   */
  onRestore?: (versionIndex: number) => void | Promise<void>;
  /**
   * Phase 2 chunk 3: injectable version-history engine. Defaults to the legacy
   * historyEngine so every existing caller (notes, tasks, projects, sequences)
   * is byte-for-byte unchanged when this prop is absent. Pass a
   * makeLoroHistoryEngine(note) return value to drive the sidebar from Loro
   * native history instead of the delta-store (chunk 5 wiring).
   */
  engine?: VersionHistorySource;
  /**
   * Unified Popup Chrome: when hosted inside a CalmPopupShell the shell already
   * provides the title + Close + the ambient surface, so the sidebar's own card
   * chrome (raised-white background, its "Version history" header, the nested ✕)
   * would render as a second white card with a duplicate close affordance. Set
   * `embedded` to de-band it: the column becomes transparent (a quiet left
   * divider only), its header is dropped, and the restore footer loses its raised
   * band so it reads on the calm surface. Defaults false so every standalone
   * consumer (notes version history) is byte-for-byte unchanged.
   */
  embedded?: boolean;
}

export default function EntityVersionHistorySidebar<P extends EntityProjection>({
  entityType,
  id,
  owner,
  adapter,
  onClose,
  onPreviewChange,
  now,
  headCanonical,
  canRestore = false,
  onRestore,
  engine: engineProp,
  embedded = false,
}: EntityVersionHistorySidebarProps<P>) {
  // Resolve the engine: caller-supplied Loro engine OR legacy delta engine.
  // Captured in a stable ref so the effects below do not re-run purely because
  // the caller passed a new object reference on every render.
  const engineRef = useRef<VersionHistorySource>(engineProp ?? historyEngine);
  useEffect(() => {
    engineRef.current = engineProp ?? historyEngine;
  }, [engineProp]);
  const profileMap = useLabUserProfileMap();
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [pageCount, setPageCount] = useState(1);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [compareCurrent, setCompareCurrent] = useState(false);
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(
    () => new Set(),
  );
  /** rowId -> one-line change summary, filled as states reconstruct. */
  const [summaries, setSummaries] = useState<Record<string, string>>({});
  /** Bumps once reconstruction finishes so the preview effect re-runs against
   *  the now-populated projection cache (avoids a first-paint empty diff). */
  const [reconstructTick, setReconstructTick] = useState(0);
  /** VC Phase 2: inline restore-confirm state (NOT native confirm()). When
   *  true the footer swaps the "Restore this version" button for a confirm /
   *  cancel pair. Reset on selection change so it can never confirm a stale row. */
  const [confirmingRestore, setConfirmingRestore] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const listRef = useRef<HTMLDivElement>(null);
  const nowRef = useMemo(() => now ?? new Date(), [now]);

  // ── Load history ─────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const read = await engineRef.current.readHistory(entityType, owner, id);
        if (!cancelled) {
          setRows(read);
          setLoadError(false);
        }
      } catch (err) {
        // Legacy / no-history-file case is readHistory -> []; an actual read
        // failure (corrupt file) lands here and shows the empty state.
        console.warn(
          `[history] could not read history for ${entityType}/${id}:`,
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
    // headCanonical is in the deps so the OPEN sidebar live-refreshes after a
    // restore / undo writes a new history row (vc-final-polish sub-bot of HR,
    // 2026-05-31). A restore / undo updates the live note, which changes
    // headCanonical (canonicalize of the live record), so this effect re-runs,
    // re-reads history, and the new "Restored an earlier version" / "Undid a
    // restore" row appears immediately instead of only after a close + reopen.
    // While history is open the note is otherwise read-only, so headCanonical
    // does not churn during normal viewing, and the read only sets `rows` (which
    // does not feed headCanonical), so this cannot loop.
  }, [entityType, id, owner, headCanonical]);

  // ── Reconstruct every version's state once, derive summaries ─────────────
  // Reconstruction is needed both for the change summaries and for the diff
  // preview. We cache the projected body per version index.
  const projectionsRef = useRef<Map<number, string>>(new Map());
  useEffect(() => {
    if (!rows || rows.length === 0) return;
    let cancelled = false;
    (async () => {
      const cache = new Map<number, string>();
      const nextSummaries: Record<string, string> = {};
      let prevProjection = null as P | null;
      for (let i = 0; i < rows.length; i++) {
        let canonical = "";
        try {
          // Pass the live HEAD canonical so the engine can resolve a
          // bare-genesis anchor (the create-then-edit case). It is harmless for
          // a fresh-record history, which resolves its anchor from the empty-doc
          // pre-image and never consults headCanonical.
          canonical = await engineRef.current.reconstructState(
            entityType,
            owner,
            id,
            i,
            headCanonical,
          );
        } catch (err) {
          console.warn(
            `[history] reconstructState failed at version ${i} for ${entityType}/${id}:`,
            err,
          );
        }
        cache.set(i, canonical);
        const row = rows[i];
        // Only delta rows produce a list entry that needs a summary. Pass the
        // row's edit kind so the adapter can label restore / undo rows distinctly
        // (vc-persona-fixes sub-bot of HR, 2026-05-30) rather than as a plain
        // content edit indistinguishable from a real save.
        if (row.kind !== "genesis" && row.kind !== "boundary_snapshot") {
          const projection = adapter.projectBody(canonical);
          nextSummaries[row.id] = adapter.summarize(
            prevProjection,
            projection,
            row.kind,
          );
          prevProjection = projection;
        } else if (row.kind === "boundary_snapshot") {
          prevProjection = adapter.projectBody(canonical);
        }
      }
      if (!cancelled) {
        projectionsRef.current = cache;
        setSummaries(nextSummaries);
        setReconstructTick((t) => t + 1);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rows, entityType, id, owner, adapter, headCanonical]);

  const model: VersionListModel | null = useMemo(() => {
    if (!rows) return null;
    return buildVersionList(rows, nowRef, summaries, pageCount);
  }, [rows, nowRef, summaries, pageCount]);

  // Flat newest-first list of selectable versions (for keyboard nav).
  const flatVersions: VersionEntry[] = useMemo(() => {
    if (!model) return [];
    const out: VersionEntry[] = [];
    for (const day of model.days) {
      for (const session of day.sessions) {
        out.push(...session.versions);
      }
    }
    return out;
  }, [model]);

  // The currently-selected version entry (for the restore-footer gate). The
  // summarized/boundary group is NOT in flatVersions, so a selected entry is
  // always a real, restorable delta row (HEAD excepted, gated below).
  const selectedEntry = useMemo(
    () =>
      selectedIndex === null
        ? null
        : flatVersions.find((v) => v.versionIndex === selectedIndex) ?? null,
    [flatVersions, selectedIndex],
  );

  // ── Selection + diff preview ─────────────────────────────────────────────
  // Auto-select the HEAD version once the list is built.
  useEffect(() => {
    if (selectedIndex === null && flatVersions.length > 0) {
      setSelectedIndex(flatVersions[0].versionIndex);
    }
  }, [flatVersions, selectedIndex]);

  // VC Phase 2: any selection change cancels an in-flight inline confirm so the
  // footer can never confirm a restore for a row the user has navigated away
  // from. Cheap and defensive.
  useEffect(() => {
    setConfirmingRestore(false);
  }, [selectedIndex]);

  const selectVersion = useCallback((entry: VersionEntry) => {
    setSelectedIndex(entry.versionIndex);
  }, []);

  // Emit the selected version's diff into the document column. Effect-driven so
  // it re-runs whenever the selection, the compare base, OR the reconstruction
  // cache changes (reconstructTick) — the last avoids a first-paint empty diff
  // when the cache is not yet populated. The document column updates live.
  useEffect(() => {
    if (selectedIndex === null || !rows || rows.length === 0) {
      onPreviewChange(null);
      return;
    }
    const entry = flatVersions.find((v) => v.versionIndex === selectedIndex);
    if (!entry) return;

    const afterCanonical = projectionsRef.current.get(entry.versionIndex) ?? "";
    const after = adapter.projectBody(afterCanonical).body;

    // Compare base: predecessor (default) or current HEAD (toggle).
    let before = "";
    if (compareCurrent) {
      const headCanonical = projectionsRef.current.get(rows.length - 1) ?? "";
      before = adapter.projectBody(headCanonical).body;
    } else {
      const predIndex = entry.versionIndex - 1;
      const predCanonical =
        predIndex >= 0 ? projectionsRef.current.get(predIndex) ?? "" : "";
      before = adapter.projectBody(predCanonical).body;
    }

    const resolved = resolveDisplayName(entry.actor, profileMap);
    onPreviewChange({
      before,
      after,
      editor: entry.actor,
      editorLabel: resolved.label,
    });
    // profileMap + onPreviewChange are stable enough for this preview; rerun on
    // the inputs that actually change the diff.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIndex, compareCurrent, reconstructTick, flatVersions, rows]);

  // ── Focus management + keyboard nav ──────────────────────────────────────
  useEffect(() => {
    // Move focus into the list when the sidebar opens.
    listRef.current?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (flatVersions.length === 0) return;
      const currentPos = flatVersions.findIndex(
        (v) => v.versionIndex === selectedIndex,
      );
      if (e.key === "ArrowDown") {
        e.preventDefault();
        const next = Math.min(flatVersions.length - 1, currentPos + 1);
        selectVersion(flatVersions[next]);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const prev = Math.max(0, currentPos - 1);
        selectVersion(flatVersions[prev]);
      } else if (e.key === "Enter") {
        e.preventDefault();
        const entry = flatVersions[Math.max(0, currentPos)];
        if (entry) selectVersion(entry);
      }
    },
    [flatVersions, selectedIndex, selectVersion, onClose],
  );

  // VC Phase 2: confirm + fire the restore. The popup does the reverse-walk +
  // write; we keep a local `restoring` flag so the button can't double-fire.
  const handleConfirmRestore = useCallback(async () => {
    if (selectedEntry === null || selectedEntry.isHead) return;
    if (!onRestore) return;
    setRestoring(true);
    try {
      await onRestore(selectedEntry.versionIndex);
    } finally {
      setRestoring(false);
      setConfirmingRestore(false);
    }
  }, [selectedEntry, onRestore]);

  const toggleSession = useCallback((key: string) => {
    setExpandedSessions((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // ── Render ───────────────────────────────────────────────────────────────
  const isEmpty = rows !== null && flatVersions.length === 0;

  return (
    <div
      className={`w-80 flex-shrink-0 flex flex-col h-full ${
        embedded
          ? "border-l border-border/50"
          : "border-l border-border bg-surface-raised"
      }`}
      role="dialog"
      aria-label="Version history"
      data-testid="note-version-history-sidebar"
    >
      {/* Sidebar header — dropped when embedded in a CalmPopupShell, which already
          carries the title + Close (avoids the second header + nested ✕ seam). */}
      {!embedded && (
      <div className="px-4 py-3 border-b border-border flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <svg
            className="w-4 h-4 text-foreground-muted"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M3 3v5h5" />
            <path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" />
            <path d="M12 7v5l3 2" />
          </svg>
          <h3 className="text-body font-semibold text-foreground">Version history</h3>
        </div>
        <Tooltip label="Exit history" placement="left">
          <button
            type="button"
            onClick={onClose}
            data-testid="version-history-exit"
            className="p-1.5 text-foreground-muted hover:text-foreground hover:bg-surface-sunken rounded-lg transition-colors"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </Tooltip>
      </div>
      )}

      {/* Compare toggle */}
      {!isEmpty && (
        <div className="px-4 py-2 border-b border-border flex items-center gap-2 flex-shrink-0">
          <span className="text-meta text-foreground-muted">Compare against</span>
          <div className="inline-flex rounded-lg bg-surface-sunken p-0.5 text-meta">
            <button
              type="button"
              onClick={() => setCompareCurrent(false)}
              data-testid="compare-previous"
              className={`px-2 py-0.5 rounded-md transition-colors ${
                !compareCurrent
                  ? "bg-surface-raised text-foreground shadow-sm font-medium"
                  : "text-foreground-muted hover:text-foreground"
              }`}
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => setCompareCurrent(true)}
              data-testid="compare-current"
              className={`px-2 py-0.5 rounded-md transition-colors ${
                compareCurrent
                  ? "bg-surface-raised text-foreground shadow-sm font-medium"
                  : "text-foreground-muted hover:text-foreground"
              }`}
            >
              Current
            </button>
          </div>
        </div>
      )}

      {/* Version list */}
      <div
        ref={listRef}
        tabIndex={0}
        role="listbox"
        aria-label="Versions"
        onKeyDown={handleKeyDown}
        className="flex-1 overflow-y-auto focus:outline-none"
        data-testid="version-list"
      >
        {rows === null && (
          <div className="p-4 text-meta text-foreground-muted animate-pulse">
            Loading version history...
          </div>
        )}

        {isEmpty && (
          <div className="p-6 text-center text-body text-foreground-muted" data-testid="version-empty">
            <p className="font-medium text-foreground-muted">No earlier versions yet</p>
            <p className="mt-1 text-meta">
              {loadError
                ? "This note has no readable history."
                : "Saves you make from now on will appear here."}
            </p>
          </div>
        )}

        {model?.days.map((day) => (
          <div key={day.dayKey}>
            <div className="sticky top-0 bg-surface-sunken/95 backdrop-blur px-4 py-1.5 text-meta font-semibold uppercase tracking-wide text-foreground-muted border-b border-border">
              {day.label}
            </div>
            {day.sessions.map((session, si) => {
              const sessionKey = `${day.dayKey}:${si}`;
              const expanded =
                !session.collapsible || expandedSessions.has(sessionKey);
              // Resolve display names for all contributors in this session.
              const resolvedActors = session.actors.map((a) =>
                resolveDisplayName(a, profileMap),
              );
              const resolvedNames = resolvedActors.map((r) => r.label);
              if (session.collapsible && !expanded) {
                // Collapsed run: one expandable summary row.
                // Show up to 3 stacked UserAvatars for multi-author sessions.
                const avatarActors = session.actors.slice(0, 3);
                return (
                  <button
                    key={sessionKey}
                    type="button"
                    onClick={() => toggleSession(sessionKey)}
                    className="w-full flex items-center gap-2 px-4 py-2 hover:bg-surface-sunken text-left transition-colors"
                    data-testid="session-collapsed"
                  >
                    {/* Stacked avatars for multi-author; single avatar for solo */}
                    {/* size="xs" avatars are w-5 h-5 (20px). The container must
                        carry that height (the avatars are position:absolute, so
                        without it the span collapses and their bottoms get
                        clipped by the scroll container) AND a width that fits
                        20px avatars offset 8px apart (20 + (n-1)*8), or the last
                        avatar's right edge is clipped. */}
                    <span
                      className="relative flex-shrink-0 h-5"
                      style={{ width: `${20 + (avatarActors.length - 1) * 8}px` }}
                    >
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
                    <span className="flex-1 text-meta text-foreground-muted truncate">
                      {sessionRangeLabel(session, resolvedNames)}
                    </span>
                    <svg
                      className="w-3 h-3 text-foreground-muted flex-shrink-0"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M9 5l7 7-7 7"
                      />
                    </svg>
                  </button>
                );
              }
              return (
                <div key={sessionKey}>
                  {session.collapsible && expanded && (
                    <button
                      type="button"
                      onClick={() => toggleSession(sessionKey)}
                      className="w-full flex items-center gap-1 px-4 pt-2 text-meta text-foreground-muted hover:text-foreground-muted"
                      data-testid="session-expanded-header"
                    >
                      <svg
                        className="w-3 h-3"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2}
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M19 9l-7 7-7-7"
                        />
                      </svg>
                      {resolvedNames.length === 1
                        ? `${resolvedNames[0]}, ${session.versions.length} versions`
                        : resolvedNames.length === 2
                          ? `${resolvedNames[0]} & ${resolvedNames[1]}, ${session.versions.length} versions`
                          : `${resolvedNames[0]} +${resolvedNames.length - 1} others, ${session.versions.length} versions`}
                    </button>
                  )}
                  {session.versions.map((entry) => (
                    <VersionRow
                      key={entry.rowId}
                      entry={entry}
                      label={resolveDisplayName(entry.actor, profileMap).label}
                      selected={entry.versionIndex === selectedIndex}
                      onSelect={() => selectVersion(entry)}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        ))}

        {/* Folded-rows summary (compaction ran). */}
        {model?.summarized && (
          <div
            className="px-4 py-3 border-t border-border bg-amber-50/40 dark:bg-amber-500/15"
            data-testid="version-summarized"
          >
            <p className="text-meta font-medium text-foreground-muted">
              Earlier versions (summarized)
            </p>
            <p className="mt-1 text-meta text-foreground-muted leading-snug">
              {model.summarized.compactedRowCount} intermediate saves before{" "}
              {model.summarized.dayLabel} were summarized to keep history fast.
              Row by row detail stops here.
            </p>
          </div>
        )}

        {/* Pagination. */}
        {model?.hasMore && (
          <div className="px-4 py-3 border-t border-border">
            <button
              type="button"
              onClick={() => setPageCount((p) => p + 1)}
              data-testid="load-older"
              className="w-full px-3 py-1.5 text-meta text-foreground-muted bg-surface-sunken hover:bg-surface-sunken rounded-lg transition-colors"
            >
              Load older versions
            </button>
          </div>
        )}
      </div>

      {/* VC Phase 2: sticky restore footer. Renders ONLY when the popup granted
          restore rights AND a NON-HEAD version is selected. HEAD is the live
          record (nothing to restore TO), and the summarized/boundary group is
          structurally non-selectable, so it can never appear here. The confirm
          is inline (NOT native confirm()): the button swaps to a confirm/cancel
          pair so a misclick is a no-op, matching the house "no native dialogs"
          rule. */}
      {canRestore && onRestore && selectedEntry && !selectedEntry.isHead && (
        <div
          className={`border-t border-border px-4 py-3 flex-shrink-0 ${
            embedded ? "" : "bg-surface-raised"
          }`}
          data-testid="restore-footer"
        >
          {!confirmingRestore ? (
            <button
              type="button"
              onClick={() => setConfirmingRestore(true)}
              data-testid="restore-button"
              className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-body font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors"
            >
              <svg
                className="w-4 h-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M3 3v5h5" />
                <path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" />
                <path d="M12 7v5l3 2" />
              </svg>
              Restore this version
            </button>
          ) : (
            <div className="space-y-2" data-testid="restore-confirm">
              <p className="text-meta text-foreground-muted leading-snug">
                Make this version the current note? Your current version stays in
                history, and you can undo this for 24 hours.
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleConfirmRestore}
                  disabled={restoring}
                  data-testid="restore-confirm-button"
                  className="flex-1 px-3 py-2 text-body font-medium text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 rounded-lg transition-colors"
                >
                  {restoring ? "Restoring..." : "Restore"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingRestore(false)}
                  disabled={restoring}
                  data-testid="restore-cancel-button"
                  className="px-3 py-2 text-body font-medium text-foreground-muted bg-surface-sunken hover:bg-surface-sunken disabled:opacity-60 rounded-lg transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** A single selectable version row. */
function VersionRow({
  entry,
  label,
  selected,
  onSelect,
}: {
  entry: VersionEntry;
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      data-testid="version-row"
      data-version-index={entry.versionIndex}
      className={`w-full flex items-start gap-2 px-4 py-2 text-left transition-colors ${
        selected ? "bg-emerald-50 dark:bg-emerald-500/15 ring-1 ring-inset ring-emerald-200" : "hover:bg-surface-sunken"
      }`}
    >
      <span className="pt-0.5 flex-shrink-0">
        <UserAvatar username={entry.actor} size="xs" />
      </span>
      <span className="flex-1 min-w-0">
        <span className="flex items-center gap-1.5">
          <span className="text-meta font-medium text-foreground truncate">{label}</span>
          {entry.isHead && (
            <span className="text-meta font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-300 flex-shrink-0">
              Current version
            </span>
          )}
        </span>
        <span className="block text-meta text-foreground-muted truncate">
          {entry.summary}
        </span>
        <Tooltip label={`${formatFullDate(entry.ts)} · ${entry.ts}`} placement="bottom">
          <span className="block text-meta text-foreground-muted w-fit">
            {formatRelative(entry.ts)}
          </span>
        </Tooltip>
      </span>
    </button>
  );
}
