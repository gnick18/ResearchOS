"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchAllTasks,
  fetchAllMethodsIncludingShared,
  filesApi,
  usersApi,
} from "@/lib/local-api";
import type { Method, Task, TaskMethodAttachment } from "@/lib/types";
import { getMethodTypeMeta } from "@/lib/methods/method-type-registry";
import { attachmentKey, methodKey } from "@/lib/methods/lookup";
import {
  partitionMethodsByOwnership,
  groupOwnMethodsByFolder,
  groupSharedMethodsByOwner,
  matchesMethodSearch,
} from "@/lib/methods/library-sections";
import RenderedMarkdown from "@/components/RenderedMarkdown";
import MethodCard from "@/components/methods/MethodCard";
import LivingPopup from "@/components/ui/LivingPopup";

interface MethodPickerProps {
  open: boolean;
  currentMethodId: number | null;
  /** Pin "Recently used in this project" at the top when available. */
  currentProjectId?: number;
  /**
   * Hide these methods entirely — e.g. methods already attached to the task.
   * Composite `(method_id, owner)` keys so the picker can still surface a
   * public method that happens to share an id with an already-attached
   * private method (per-user id collision class). Callers must resolve
   * attachment-owner-null to the task owner before passing — the picker
   * matches strictly on the resolved namespace.
   */
  excludeMethods?: Array<{ method_id: number; owner: string }>;
  /**
   * Receives the selected method's `(id, owner)` so callers can persist the
   * attachment with the right namespace without re-resolving against a list
   * where the bare id could collide.
   */
  onSelect: (methodId: number, methodOwner: string) => void | Promise<void>;
  onClose: () => void;
  /**
   * Keep the modal mounted after an attach instead of letting the caller
   * close it. MethodTabs (multi-attach) passes `true` so the user can attach
   * several methods in a row; the just-attached card flips to "Attached" via
   * the existing `excludeMethods` machinery rather than the modal closing.
   * TaskModal (single link) omits this and closes on select exactly as
   * before — no behavior change there.
   */
  keepOpenOnSelect?: boolean;
}

type FlatRow =
  // A top-level method card. Its forks (if any) render NESTED inside the
  // card via MethodCard's recursive disclosure, so the flat-row model only
  // tracks the cards that anchor a section.
  | { kind: "header"; label: string; count: number; sectionKey: string }
  | { kind: "method"; method: Method; sectionKey: string };

const UNCATEGORIZED = "Uncategorized";
const RECENT_LIMIT = 5;

function methodIdsOf(t: Task): number[] {
  return t.method_ids ?? [];
}

/**
 * Map of composite `(owner, id)` method key -> most recent task start_date
 * that used it. Keyed on the composite so two same-id different-owner
 * methods (e.g. alex's private 5 and morgan's private 5 surfaced in the
 * same project's recency window) don't shadow each other. The owner is
 * resolved per the same rule as `resolveMethodForAttachment`: an explicit
 * `attachment.owner` wins; null falls back to the task owner.
 */
function buildRecency(tasks: Task[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const t of tasks) {
    const attachmentByMid = new Map<number, TaskMethodAttachment>();
    for (const a of t.method_attachments ?? []) {
      attachmentByMid.set(a.method_id, a);
    }
    for (const mid of methodIdsOf(t)) {
      const att = attachmentByMid.get(mid);
      const key = attachmentKey(
        { method_id: mid, owner: att?.owner ?? null },
        t.owner,
      );
      const existing = out.get(key);
      if (!existing || (t.start_date && t.start_date > existing)) {
        out.set(key, t.start_date ?? "");
      }
    }
  }
  return out;
}

function topByRecency(
  recency: Map<string, string>,
  byKey: Map<string, Method>,
  limit: number
): Method[] {
  return Array.from(recency.entries())
    .sort((a, b) => b[1].localeCompare(a[1]))
    .slice(0, limit)
    .map(([key]) => byKey.get(key))
    .filter((m): m is Method => !!m);
}

export default function MethodPicker({
  open,
  currentMethodId,
  currentProjectId,
  excludeMethods,
  onSelect,
  onClose,
  keepOpenOnSelect = false,
}: MethodPickerProps) {
  const { data: allMethods = [], isLoading } = useQuery({
    queryKey: ["methods"],
    queryFn: fetchAllMethodsIncludingShared,
  });

  // Current user drives the own-vs-shared partition (same source the methods
  // page uses). Defensive against a test mock that stubs `@/lib/local-api`
  // without `usersApi` — the optional chain yields an empty username, which
  // simply routes every method into "Shared with Lab" rather than throwing.
  const { data: userData } = useQuery({
    queryKey: ["users"],
    queryFn: () =>
      usersApi?.list?.() ?? Promise.resolve({ users: [], current_user: "" }),
  });
  const currentUser = userData?.current_user || "";

  // Composite-key excludeSet: `${owner}:${id}`. Callers pre-resolve
  // attachment.owner=null to the task owner, so the picker can match
  // strictly without needing the task context.
  const excludeSet = useMemo(() => {
    const set = new Set<string>();
    for (const a of excludeMethods ?? []) {
      set.add(`${a.owner}:${a.method_id}`);
    }
    return set;
  }, [excludeMethods]);

  // In keep-open (multi-attach) mode the already-attached cards STAY visible
  // and flip to an "Attached" state; in single-link mode they are hidden, as
  // before. Either way `excludeSet` is the source of truth for "attached".
  const methods = useMemo(
    () =>
      keepOpenOnSelect || excludeSet.size === 0
        ? allMethods
        : allMethods.filter((m) => !excludeSet.has(`${m.owner}:${m.id}`)),
    [allMethods, excludeSet, keepOpenOnSelect],
  );

  // Read-time fork index: Map<parentId, fork Method[]>, built once from the
  // FULL method list (not the excluded one) so a fork of an attached parent
  // still resolves. Walked recursively in MethodCard, so a fork of a fork of
  // a fork nests fully. No persisted field — this is the cheap one-pass map
  // the design defers the denormalized `fork_count` to.
  const forkChildren = useMemo(() => {
    const map = new Map<number, Method[]>();
    for (const m of methods) {
      if (m.parent_method_id != null) {
        const bucket = map.get(m.parent_method_id);
        if (bucket) bucket.push(m);
        else map.set(m.parent_method_id, [m]);
      }
    }
    // Stable order: newest-edited first when timestamps exist, else by name.
    for (const bucket of map.values()) {
      bucket.sort((a, b) => {
        const ax = a.last_edited_at ?? "";
        const bx = b.last_edited_at ?? "";
        if (ax !== bx) return bx.localeCompare(ax);
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      });
    }
    return map;
  }, [methods]);

  // Set of ids that exist in the rendered list, so we can tell an orphan fork
  // (parent absent) apart from one whose parent is present and nests it.
  const presentIds = useMemo(() => {
    const set = new Set<number>();
    for (const m of methods) set.add(m.id);
    return set;
  }, [methods]);

  const { data: tasks = [] } = useQuery({
    queryKey: ["tasks"],
    queryFn: fetchAllTasks,
  });

  const [query, setQuery] = useState("");
  const [highlightedKey, setHighlightedKey] = useState<string | null>(null);
  const [expandedForks, setExpandedForks] = useState<Set<string>>(
    () => new Set(),
  );
  // Multi-attach (keep-open) mode: pending selections keyed by composite
  // method key. The user toggles cards into this map, then a single bottom
  // "Done" button commits them all and closes. Single-link mode never touches
  // this — it attaches immediately via the per-card Attach button as before.
  const [pending, setPending] = useState<Map<string, Method>>(() => new Map());
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  // Reset internal state when the picker is (re)opened. Uses the "compare to
  // previous prop in render" pattern documented in the React docs as the
  // preferred alternative to syncing state via useEffect.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setQuery("");
      setHighlightedKey(null);
      setExpandedForks(new Set());
      setPending(new Map());
    }
  }

  // Focus the search input on open. Side effect on the DOM, so it stays in
  // an effect — but no setState here, so the lint rule is happy.
  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  const methodByKey = useMemo(() => {
    const m = new Map<string, Method>();
    for (const x of methods) m.set(methodKey(x), x);
    return m;
  }, [methods]);

  const recentInProject = useMemo(() => {
    if (currentProjectId == null) return [] as Method[];
    const projectTasks = tasks.filter((t) => t.project_id === currentProjectId);
    return topByRecency(buildRecency(projectTasks), methodByKey, RECENT_LIMIT);
  }, [tasks, currentProjectId, methodByKey]);

  const recentAnywhere = useMemo(() => {
    return topByRecency(buildRecency(tasks), methodByKey, RECENT_LIMIT);
  }, [tasks, methodByKey]);

  const flatRows: FlatRow[] = useMemo(() => {
    const raw = query.trim();
    const searching = raw.length > 0;

    // `matchesMethodSearch` covers name + tags + source_path + folder_path,
    // matching the methods page exactly so the two surfaces never diverge.
    const filtered = searching
      ? methods.filter((m) => matchesMethodSearch(m, raw))
      : methods;

    const byName = (a: Method, b: Method) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

    // A method nests under another only when its parent is BOTH present in
    // the rendered list AND in the same section we are placing it into. To
    // keep the model simple, a fork is rendered nested whenever its parent is
    // present at all; it is then excluded from top-level placement. An orphan
    // fork (parent absent) renders top-level with a "forked from ..." caption
    // inside the card.
    const isNestedFork = (m: Method) =>
      m.parent_method_id != null && presentIds.has(m.parent_method_id);

    const rows: FlatRow[] = [];

    // Search collapses grouping into one flat list, as before. Forks render
    // flat too in search mode (a matched fork should surface even if its
    // parent did not match), so nesting is suppressed while searching.
    if (searching) {
      const items = filtered.slice().sort(byName);
      rows.push({
        kind: "header",
        label: "Results",
        count: items.length,
        sectionKey: "search-results",
      });
      for (const method of items) {
        rows.push({ kind: "method", method, sectionKey: "search-results" });
      }
      return rows;
    }

    // Pinned recents stay at the very top — high-value and already working.
    if (recentInProject.length > 0) {
      rows.push({
        kind: "header",
        label: "Recently used in this project",
        count: recentInProject.length,
        sectionKey: "pinned-project",
      });
      for (const m of recentInProject) {
        rows.push({ kind: "method", method: m, sectionKey: "pinned-project" });
      }
    }

    // Skip "Recently used" if its top entries are the same as the project
    // section above — avoid an identical pinned block. Dedup on the composite
    // `(owner, id)` key so two methods that share a numeric id but live in
    // different owner namespaces both still surface.
    const projectKeys = new Set(recentInProject.map((m) => methodKey(m)));
    const recentDeduped = recentAnywhere.filter(
      (m) => !projectKeys.has(methodKey(m)),
    );
    if (recentDeduped.length > 0) {
      rows.push({
        kind: "header",
        label: "Recently used",
        count: recentDeduped.length,
        sectionKey: "pinned-recent",
      });
      for (const m of recentDeduped) {
        rows.push({ kind: "method", method: m, sectionKey: "pinned-recent" });
      }
    }

    // Own-vs-shared split, consistent with the methods page. My Methods group
    // by folder_path; Shared with Lab group by owner (never by the owner's
    // private folder names). Forks that nest under a present parent are
    // dropped from the top-level placement here so they appear only inside
    // the disclosure.
    const { own, shared } = partitionMethodsByOwnership(filtered, currentUser);

    const ownByFolder = groupOwnMethodsByFolder(
      own.filter((m) => !isNestedFork(m)),
    );
    const ownFolders = Object.keys(ownByFolder).sort((a, b) => {
      if (a === UNCATEGORIZED) return 1;
      if (b === UNCATEGORIZED) return -1;
      return a.localeCompare(b);
    });
    if (ownFolders.some((f) => ownByFolder[f].length > 0)) {
      rows.push({
        kind: "header",
        label: "My Methods",
        count: own.filter((m) => !isNestedFork(m)).length,
        sectionKey: "own-section",
      });
      for (const folder of ownFolders) {
        const items = ownByFolder[folder].slice().sort(byName);
        if (items.length === 0) continue;
        rows.push({
          kind: "header",
          label: folder,
          count: items.length,
          sectionKey: `own-folder:${folder}`,
        });
        for (const method of items) {
          rows.push({
            kind: "method",
            method,
            sectionKey: `own-folder:${folder}`,
          });
        }
      }
    }

    const sharedByOwner = groupSharedMethodsByOwner(
      shared.filter((m) => !isNestedFork(m)),
    );
    const ownerLabels = Object.keys(sharedByOwner).sort((a, b) => {
      // "Lab" (the public namespace) sorts first; named owners follow.
      if (a === "Lab") return -1;
      if (b === "Lab") return 1;
      return a.localeCompare(b);
    });
    if (ownerLabels.some((o) => sharedByOwner[o].length > 0)) {
      rows.push({
        kind: "header",
        label: "Shared with Lab",
        count: shared.filter((m) => !isNestedFork(m)).length,
        sectionKey: "shared-section",
      });
      for (const ownerLabel of ownerLabels) {
        const items = sharedByOwner[ownerLabel].slice().sort(byName);
        if (items.length === 0) continue;
        rows.push({
          kind: "header",
          label: ownerLabel,
          count: items.length,
          sectionKey: `shared-owner:${ownerLabel}`,
        });
        for (const method of items) {
          rows.push({
            kind: "method",
            method,
            sectionKey: `shared-owner:${ownerLabel}`,
          });
        }
      }
    }

    return rows;
  }, [methods, query, currentUser, presentIds, recentInProject, recentAnywhere]);

  // Composite-key set of already-attached methods. In keep-open mode the
  // cards stay visible and flip to "Attached" from this set; in single-link
  // mode the methods are filtered out upstream so the set is moot.
  const attachedKeys = excludeSet;

  // Flat, in-DOM-order list of the method records that have a focusable card,
  // with EXPANDED forks spliced in right after their parent (the same order
  // they render). This is the 2-D grid's roving-focus track and the source of
  // the tour-anchor index. Collapsed forks are absent (not in the tab order).
  const visibleCards: Method[] = useMemo(() => {
    const out: Method[] = [];
    const pushWithForks = (m: Method) => {
      out.push(m);
      if (expandedForks.has(methodKey(m))) {
        for (const child of forkChildren.get(m.id) ?? []) {
          pushWithForks(child);
        }
      }
    };
    for (const row of flatRows) {
      if (row.kind === "method") pushWithForks(row.method);
    }
    return out;
  }, [flatRows, expandedForks, forkChildren]);

  const visibleKeys = useMemo(
    () => visibleCards.map((m) => methodKey(m)),
    [visibleCards],
  );

  const highlightedMethod: Method | null = useMemo(() => {
    if (!highlightedKey) return null;
    return visibleCards.find((m) => methodKey(m) === highlightedKey) ?? null;
  }, [visibleCards, highlightedKey]);

  // Keep the highlight on a still-present card. When the current highlight
  // falls out of the list (search, collapse), drop to the first card.
  useEffect(() => {
    if (visibleKeys.length === 0) {
      if (highlightedKey !== null) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setHighlightedKey(null);
      }
      return;
    }
    if (highlightedKey === null || !visibleKeys.includes(highlightedKey)) {
      setHighlightedKey(visibleKeys[0]);
    }
  }, [visibleKeys, highlightedKey]);

  useEffect(() => {
    if (!highlightedKey) return;
    cardRefs.current.get(highlightedKey)?.scrollIntoView({ block: "nearest" });
  }, [highlightedKey]);

  // The card grid wraps at 2 columns on md+, so Left/Right step by 1 and
  // Up/Down step by a column count. We treat the list as a 2-col grid for
  // vertical movement and a 1-D sequence for horizontal, which keeps arrow
  // reach intuitive whether the list is one or two columns wide.
  const GRID_COLS = 2;
  const moveHighlight = (delta: number) => {
    if (visibleKeys.length === 0) return;
    const cur = highlightedKey ? visibleKeys.indexOf(highlightedKey) : -1;
    const base = cur === -1 ? 0 : cur;
    const next = Math.min(visibleKeys.length - 1, Math.max(0, base + delta));
    setHighlightedKey(visibleKeys[next]);
  };

  const attachHighlighted = () => {
    if (highlightedMethod) {
      void onSelect(highlightedMethod.id, highlightedMethod.owner);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<Element>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveHighlight(GRID_COLS);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveHighlight(-GRID_COLS);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      moveHighlight(1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      moveHighlight(-1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (keepOpenOnSelect) {
        // Multi-attach mode: Enter toggles the highlighted card's pending
        // selection; Cmd/Ctrl+Enter commits all pending and closes (Done).
        if (e.metaKey || e.ctrlKey) commitPending();
        else toggleHighlighted();
      } else {
        attachHighlighted();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      // Stop the Escape from bubbling to the parent popup (TaskDetailPopup has a
      // window-level Escape listener); without this, one Escape closes both the
      // picker and the whole experiment popup.
      e.stopPropagation();
      onClose();
    }
  };

  // Attaching a method. In keep-open mode the modal stays mounted and the
  // card flips to Attached via `attachedKeys`; the caller (MethodTabs) gates
  // its own close on `keepOpenOnSelect`. In single-link mode the caller
  // closes as before.
  const handleAttach = (m: Method) => {
    void onSelect(m.id, m.owner);
  };

  // Multi-attach toggle: flip a method in/out of the pending map and move the
  // preview highlight to it so the right-hand pane still updates on click.
  // Already-attached methods are add-only and never enter the map (the card
  // itself guards this, but we double-check here too).
  const pendingKeys = useMemo(() => new Set(pending.keys()), [pending]);
  const togglePending = (m: Method) => {
    const k = methodKey(m);
    setHighlightedKey(k);
    if (attachedKeys.has(`${m.owner}:${m.id}`)) return;
    setPending((prev) => {
      const next = new Map(prev);
      if (next.has(k)) next.delete(k);
      else next.set(k, m);
      return next;
    });
  };

  // Commit every pending method via the same per-method onSelect the caller
  // already wires to handleAddMethod, then close. Used by the Done button and
  // Cmd/Ctrl+Enter.
  const commitPending = () => {
    for (const m of pending.values()) {
      void onSelect(m.id, m.owner);
    }
    onClose();
  };

  // Toggle the currently highlighted card in selectable mode (Enter key).
  const toggleHighlighted = () => {
    if (highlightedMethod) togglePending(highlightedMethod);
  };

  const toggleForks = (m: Method) => {
    const k = methodKey(m);
    setExpandedForks((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const registerCardRef = (key: string, el: HTMLButtonElement | null) => {
    if (el) cardRefs.current.set(key, el);
    else cardRefs.current.delete(key);
  };

  return (
    <LivingPopup
      open={open}
      onClose={onClose}
      label="Attach a method"
      widthClassName="max-w-5xl"
      card={false}
      fillHeight
    >
      <div
        className="w-full max-w-5xl bg-surface-raised rounded-xl ros-popup-card-shadow flex flex-col overflow-hidden"
        style={{ maxHeight: "80vh", minHeight: "min(80vh, 480px)" }}
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <svg
            className="w-4 h-4 text-foreground-muted shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z"
            />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search methods by name or #tag…"
            className="flex-1 text-body outline-none placeholder-gray-400"
          />
          <button
            onClick={onClose}
            className="text-meta text-foreground-muted hover:text-foreground bg-surface-sunken hover:bg-border px-2 py-1 border border-border rounded"
            aria-label="Close picker"
          >
            Esc
          </button>
        </div>

        <div className="flex-1 flex overflow-hidden">
        <div ref={listRef} className="w-full md:w-[560px] md:shrink-0 overflow-y-auto bg-surface-sunken/40 md:border-r md:border-border">
          {isLoading ? (
            <div className="px-4 py-8 text-center text-body text-foreground-muted">
              Loading methods…
            </div>
          ) : allMethods.length === 0 ? (
            <div className="px-4 py-8 text-center text-body text-foreground-muted">
              No methods available. Create some in the Methods section first.
            </div>
          ) : methods.length === 0 ? (
            <div className="px-4 py-8 text-center text-body text-foreground-muted">
              All methods are already attached.
            </div>
          ) : flatRows.length === 0 ? (
            <div className="px-4 py-8 text-center text-body text-foreground-muted">
              No methods match &ldquo;{query}&rdquo;. Try a different search or
              clear the input.
            </div>
          ) : (
            <div
              role="grid"
              aria-label="Method library"
              className="grid grid-cols-1 md:grid-cols-2 gap-2 p-3"
            >
              {(() => {
                // Running index of TOP-LEVEL method cards so the first card
                // gets the canonical
                // `experiment-attach-method-picker-first-method` anchor and
                // each subsequent card gets `...-method-{idx}`. The §6.6
                // attach step + spotlight positioning resolve these exact
                // attributes on the card <button>; future steps target a
                // method by index. Forks nest INSIDE their parent card and
                // are deliberately not given a top-level anchor.
                let methodIdx = -1;
                return flatRows.map((row) => {
                  if (row.kind === "header") {
                    const isPinned = row.sectionKey.startsWith("pinned-");
                    const isSection =
                      row.sectionKey === "own-section" ||
                      row.sectionKey === "shared-section";
                    const headerCls = isPinned
                      ? "col-span-full sticky top-0 z-10 bg-blue-50/95 backdrop-blur px-1 py-2 text-meta uppercase tracking-wide font-semibold text-blue-700 dark:text-blue-300 border-b border-blue-200 dark:border-blue-500/30"
                      : isSection
                        ? "col-span-full px-1 pt-2 pb-1 text-meta uppercase tracking-wide font-bold text-foreground border-b border-border"
                        : "col-span-full px-1 py-1.5 text-meta uppercase tracking-wide font-semibold text-foreground-muted";
                    return (
                      <div key={`h:${row.sectionKey}`} className={headerCls}>
                        {row.label}
                        <span
                          className={`ml-2 normal-case tracking-normal font-normal ${
                            isPinned ? "text-blue-400" : "text-foreground-muted"
                          }`}
                        >
                          {row.count}
                        </span>
                      </div>
                    );
                  }
                  const m = row.method;
                  const key = methodKey(m);
                  const isOrphanFork =
                    m.parent_method_id != null &&
                    !presentIds.has(m.parent_method_id);
                  methodIdx += 1;
                  const tourTarget =
                    methodIdx === 0
                      ? "experiment-attach-method-picker-first-method"
                      : `experiment-attach-method-picker-method-${methodIdx}`;
                  return (
                    <MethodCard
                      key={`${row.sectionKey}:${key}`}
                      method={m}
                      forkChildren={forkChildren}
                      attachedKeys={attachedKeys}
                      isActive={highlightedKey === key}
                      isHighlighted={highlightedKey === key}
                      expandedForks={expandedForks}
                      tabIndex={highlightedKey === key ? 0 : -1}
                      tourTarget={tourTarget}
                      orphanFork={isOrphanFork}
                      selectable={keepOpenOnSelect}
                      pendingKeys={pendingKeys}
                      onToggleSelect={togglePending}
                      onAttach={handleAttach}
                      onHighlight={(hm) => setHighlightedKey(methodKey(hm))}
                      onToggleForks={toggleForks}
                      onKeyDown={handleKeyDown}
                      registerRef={registerCardRef}
                    />
                  );
                });
              })()}
            </div>
          )}
        </div>
        <div className="hidden md:flex md:flex-1 flex-col bg-surface-sunken/40 overflow-hidden">
          <MethodPreview method={highlightedMethod} />
        </div>
        </div>

        {keepOpenOnSelect ? (
          // Multi-attach footer: keyboard hints on the left, a single
          // bottom-right primary commit ("Add N methods" when any are pending,
          // otherwise "Done") plus a secondary Cancel. The whole toggle-then-
          // commit flow funnels through this one button.
          <div className="flex items-center gap-4 px-4 py-2 border-t border-border text-meta text-foreground-muted bg-surface-sunken">
            <span className="hidden sm:inline">
              <kbd className="px-1 py-0.5 bg-surface-raised border border-border rounded text-foreground-muted">
                ↑
              </kbd>
              <kbd className="ml-0.5 px-1 py-0.5 bg-surface-raised border border-border rounded text-foreground-muted">
                ↓
              </kbd>{" "}
              navigate
            </span>
            <span className="hidden sm:inline">
              <kbd className="px-1 py-0.5 bg-surface-raised border border-border rounded text-foreground-muted">
                ↵
              </kbd>{" "}
              select
            </span>
            <span className="ml-auto flex items-center gap-2">
              <button
                onClick={onClose}
                className="rounded-md border border-border bg-surface-raised px-3 py-1.5 text-meta font-medium text-foreground-muted transition-colors hover:bg-border"
              >
                Cancel
              </button>
              <button
                onClick={commitPending}
                disabled={pending.size === 0}
                aria-label={
                  pending.size > 0
                    ? `Add ${pending.size} method${pending.size === 1 ? "" : "s"}`
                    : "Close picker"
                }
                className={[
                  "rounded-md px-3 py-1.5 text-meta font-semibold transition-colors",
                  pending.size > 0
                    ? "bg-brand-action text-white hover:bg-brand-action/90"
                    : "bg-surface-raised border border-border text-foreground-muted cursor-default",
                ].join(" ")}
              >
                {pending.size > 0
                  ? `Add ${pending.size} method${pending.size === 1 ? "" : "s"}`
                  : "Done"}
              </button>
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-4 px-4 py-2 border-t border-border text-meta text-foreground-muted bg-surface-sunken">
            <span>
              <kbd className="px-1 py-0.5 bg-surface-raised border border-border rounded text-foreground-muted">
                ↑
              </kbd>
              <kbd className="ml-0.5 px-1 py-0.5 bg-surface-raised border border-border rounded text-foreground-muted">
                ↓
              </kbd>{" "}
              navigate
            </span>
            <span>
              <kbd className="px-1 py-0.5 bg-surface-raised border border-border rounded text-foreground-muted">
                ↵
              </kbd>{" "}
              select
            </span>
            <span>
              <kbd className="px-1 py-0.5 bg-surface-raised border border-border rounded text-foreground-muted">
                esc
              </kbd>{" "}
              close
            </span>
          </div>
        )}
      </div>
    </LivingPopup>
  );
}

function MethodPreview({ method }: { method: Method | null }) {
  const isPcr =
    method?.method_type === "pcr" ||
    (method?.source_path?.startsWith("pcr://") ?? false);
  const isLc =
    method?.method_type === "lc_gradient" ||
    (method?.source_path?.startsWith("lc_gradient://") ?? false);
  const isPlate =
    method?.method_type === "plate" ||
    (method?.source_path?.startsWith("plate://") ?? false);
  const isCellCulture =
    method?.method_type === "cell_culture" ||
    (method?.source_path?.startsWith("cell_culture://") ?? false);
  const isMassSpec =
    method?.method_type === "mass_spec" ||
    (method?.source_path?.startsWith("mass_spec://") ?? false);
  const isPdf =
    method?.method_type === "pdf" ||
    (method?.source_path?.toLowerCase().endsWith(".pdf") ?? false);
  const canFetchFile =
    !!method?.source_path && !isPcr && !isLc && !isPlate && !isCellCulture && !isMassSpec;

  const { data, isLoading, isError } = useQuery({
    queryKey: ["method-preview", method?.id],
    queryFn: () => filesApi.readFile(method!.source_path!),
    enabled: canFetchFile,
    staleTime: 5 * 60_000,
  });

  // For PDFs, decode the base64 content into a blob URL for the <iframe>.
  // Revoke when the method changes or the component unmounts so we don't
  // leak object URLs while the user arrows through the list. The setState
  // here is a legitimate sync between an external resource (the blob URL)
  // and React state, with cleanup — exactly what useEffect is for.
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!isPdf || !data?.content) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPdfUrl(null);
      return;
    }
    let url: string | null = null;
    try {
      const binary = atob(data.content);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: "application/pdf" });
      url = URL.createObjectURL(blob);
      setPdfUrl(url);
    } catch {
      setPdfUrl(null);
    }
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [isPdf, data?.content]);

  if (!method) {
    return (
      <div className="h-full flex items-center justify-center p-8 text-center text-body text-foreground-muted">
        Hover or use ↑↓ to preview a method here.
      </div>
    );
  }

  const basePath = method.source_path?.includes("/")
    ? method.source_path.split("/").slice(0, -1).join("/")
    : undefined;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="px-5 pt-4 pb-3 border-b border-border bg-surface-raised">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-body font-semibold text-foreground truncate">
            {method.name}
          </h3>
          {isPcr && (
            <span className="text-meta px-1.5 py-0.5 bg-purple-100 dark:bg-purple-500/15 text-purple-600 dark:text-purple-300 rounded shrink-0">
              PCR
            </span>
          )}
          {isLc && (
            <span className="text-meta px-1.5 py-0.5 bg-sky-100 dark:bg-sky-500/15 text-sky-600 dark:text-sky-300 rounded shrink-0">
              LC
            </span>
          )}
          {(isPlate || isCellCulture || isPdf) && (() => {
            const typeId = isPlate
              ? "plate"
              : isCellCulture
              ? "cell_culture"
              : "pdf";
            const meta = getMethodTypeMeta(typeId);
            return (
              <span
                className={`text-meta px-1.5 py-0.5 rounded shrink-0 ${meta.color.bg} ${meta.color.text}`}
              >
                {meta.shortLabel}
              </span>
            );
          })()}
          {method.folder_path && (
            <span className="text-meta text-foreground-muted truncate">
              {method.folder_path}
            </span>
          )}
        </div>
        {method.tags && method.tags.length > 0 && (
          <div className="flex gap-1 mt-1.5 flex-wrap">
            {method.tags.map((tag) => (
              <span
                key={tag}
                className="text-meta px-1.5 py-0.5 bg-surface-sunken text-foreground-muted rounded"
              >
                #{tag}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="flex-1 flex flex-col overflow-hidden">
        {isPcr ? (
          <div className="overflow-y-auto px-5 py-4 text-body text-foreground-muted">
            PCR protocol — select the method to view and edit its gradient and
            recipe.
          </div>
        ) : isLc ? (
          <div className="overflow-y-auto px-5 py-4 text-body text-foreground-muted">
            LC gradient — select the method to view its solvent gradient, column,
            and ingredients.
          </div>
        ) : isPlate ? (
          <div className="overflow-y-auto px-5 py-4 text-body text-foreground-muted">
            Plate layout — select the method to view the plate grid and any
            pre-labeled regions.
          </div>
        ) : isCellCulture ? (
          <div className="overflow-y-auto px-5 py-4 text-body text-foreground-muted">
            Cell culture passaging — select the method to view its schedule,
            media, and planned cadence.
          </div>
        ) : !canFetchFile ? (
          <div className="overflow-y-auto px-5 py-4 text-body text-foreground-muted">
            No content available.
          </div>
        ) : isLoading ? (
          <div className="overflow-y-auto px-5 py-4 text-body text-foreground-muted animate-pulse">
            Loading preview…
          </div>
        ) : isError ? (
          <div className="overflow-y-auto px-5 py-4 text-body text-red-600 dark:text-red-300">
            Couldn&rsquo;t load preview.
          </div>
        ) : isPdf ? (
          pdfUrl ? (
            <iframe
              src={pdfUrl}
              className="flex-1 w-full bg-surface-raised border-0"
              title={method.name}
            />
          ) : (
            <div className="overflow-y-auto px-5 py-4 text-body text-foreground-muted">
              Unable to display PDF.
            </div>
          )
        ) : (
          <div className="flex-1 overflow-y-auto px-5 py-4">
            <div className="prose prose-sm prose-gray max-w-none">
              <RenderedMarkdown
                content={data?.content ?? ""}
                basePath={basePath}
                ownerUsername={method.owner}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
