// sequence editor master. The Cmd-K COMMAND PALETTE (sequences redesign phase
// 4). A calm, centered overlay that is the KEYBOARD route to every editor
// operation, including the ones that do not earn a permanent rail slot. It is a
// supplement to the rail and the right-click menus, never the discoverability
// fix, so it stays quiet until the informed user reaches for it.
//
// It owns nothing about WHAT an operation does. The command list is built in
// SequenceEditView from the same wired handlers the rail and menus use, and each
// command's `run` points straight at that handler. This file only renders the
// list, fuzzy-filters it, and drives the keyboard / focus / a11y.
//
// Icons render through <Icon> from the verified icon library (no inline svg, the
// icon-guard enforces it). Voice in comments and copy, no em-dashes, no
// en-dashes, no emojis, no mid-sentence colons.

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/icons";
import BeakerBot from "@/components/BeakerBot";
import type { SelectionKind } from "@/lib/sequences/inspector-context";
import {
  buildPaletteResultsForQuery,
  flattenPaletteItems,
  isPaletteItemEnabled,
  paletteItemKey,
  runPaletteItem,
  type ArtifactNavItem,
  type EditorCommand,
  type PaletteContext,
  type PaletteItem,
  type SequenceNavItem,
} from "./editor-commands";

// Stable empty defaults so an omitted prop does not churn the result memo.
const EMPTY_SEQUENCES: SequenceNavItem[] = [];
const EMPTY_ARTIFACTS: ArtifactNavItem[] = [];

/** The icon, label, optional sub, and right-side hint for ONE palette item,
 *  branched by kind. Keeps the row markup uniform across commands, sequences,
 *  and results. */
function paletteRowParts(item: PaletteItem): {
  iconName: Parameters<typeof Icon>[0]["name"];
  label: string;
  sub?: string;
  /** Right-aligned shortcut or "Open" affordance. */
  hint?: string;
} {
  if (item.kind === "command") {
    return {
      iconName: item.command.iconName,
      label: item.command.label,
      sub: item.command.detail,
      hint: item.command.shortcut,
    };
  }
  if (item.kind === "sequence") {
    return {
      iconName: item.sequence.iconName,
      label: item.sequence.label,
      sub: item.sequence.detail,
    };
  }
  return {
    iconName: item.artifact.iconName,
    label: item.artifact.label,
    sub: item.artifact.detail,
    hint: "Open",
  };
}

/** The "On this sequence" context card (empty query) or its slim one-line header
 *  (while typing). Display only, never a selectable row. Self-hides with no
 *  context. */
function ContextCard({
  context,
  slim,
}: {
  context: PaletteContext | undefined;
  slim: boolean;
}) {
  if (!context) return null;

  if (slim) {
    // One quiet line so the user keeps their bearings while the list below is
    // ranked matches.
    return (
      <div className="flex items-center gap-2 border-b border-border px-4 py-2 text-meta text-foreground-muted">
        <Icon
          name={context.circular ? "moleculeCircular" : "moleculeLinear"}
          className="h-3.5 w-3.5 flex-none text-sky-600 dark:text-sky-300"
        />
        <span className="truncate font-medium text-foreground">{context.name}</span>
        <span className="truncate">{context.meta}</span>
      </div>
    );
  }

  return (
    <div className="px-3 pb-1 pt-2">
      <div className="px-1 pb-1 text-[10px] font-extrabold uppercase tracking-wide text-foreground-muted">
        On this sequence
      </div>
      <div className="rounded-xl border border-sky-100 bg-sky-50 px-3 py-2.5 dark:border-sky-900/40 dark:bg-sky-900/20">
        <div className="flex items-center gap-2">
          <Icon
            name={context.circular ? "moleculeCircular" : "moleculeLinear"}
            className="h-4 w-4 flex-none text-sky-600 dark:text-sky-300"
          />
          <span className="truncate text-body font-semibold text-foreground">
            {context.name}
          </span>
        </div>
        <div className="mt-1 pl-6 text-meta text-foreground-muted">{context.meta}</div>
        {context.organism ? (
          <div className="mt-1 flex items-center gap-1.5 pl-6 text-meta italic text-foreground-muted">
            <span
              className="h-2 w-2 flex-none rounded-sm"
              style={{ background: context.organismSwatch ?? "#0284c7" }}
            />
            {context.organism}
          </div>
        ) : null}
        {context.selection ? (
          <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-meta font-medium text-amber-700 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-300">
            <Icon name="ruler" className="h-3 w-3 flex-none" />
            <span>
              Selection {context.selection.lo}..{context.selection.hi} (
              {context.selection.len} nt)
              {context.selection.tm != null
                ? `, Tm ${context.selection.tm.toFixed(1)} C`
                : ""}
              {context.selection.gc != null
                ? `, ${context.selection.gc.toFixed(0)}% GC`
                : ""}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  commands: EditorCommand[];
  /** The live selection kind, so the empty-query Suggested group is biased. */
  selectionKind: SelectionKind;
  /** Whether the open sequence carries an organism (biases Suggested too). */
  hasOrganism: boolean;
  /** The "On this sequence" context card data (open sequence + live selection).
   *  Absent in older callers / tests; the card just self-hides then. */
  context?: PaletteContext;
  /** The OTHER sequences in the open collection, to jump to. Default empty. */
  sequences?: SequenceNavItem[];
  /** The latest saved results for the open sequence, newest first. Default empty. */
  artifacts?: ArtifactNavItem[];
  /** The collection name, for the "Jump to a sequence" group hint. */
  collectionLabel?: string;
}

/** The full-screen palette. Renders nothing when closed. */
export function CommandPalette({
  open,
  onClose,
  commands,
  selectionKind,
  hasOrganism,
  context,
  sequences = EMPTY_SEQUENCES,
  artifacts = EMPTY_ARTIFACTS,
  collectionLabel,
}: CommandPaletteProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  // The element focused before the palette opened, restored on close.
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const baseId = useId();

  const typing = query.trim() !== "";

  // Grouped + flat heterogeneous results (commands + sequences + results) for the
  // current query and selection context.
  const groups = useMemo(
    () =>
      buildPaletteResultsForQuery(
        { commands, sequences, artifacts, collectionLabel, selectionKind, hasOrganism },
        query,
      ),
    [commands, sequences, artifacts, collectionLabel, selectionKind, hasOrganism, query],
  );
  const flat = useMemo(() => flattenPaletteItems(groups), [groups]);

  // Reset the query and remember focus each time the palette opens; default the
  // highlight to the first (top-ranked) result and put the cursor in the input.
  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current =
      (document.activeElement as HTMLElement | null) ?? null;
    setQuery("");
    setHighlight(0);
    // Focus after paint so the autofocus lands on the freshly mounted input.
    const id = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(id);
  }, [open]);

  // Keep the highlight in range as the filtered list shrinks; default to the top
  // result whenever the query changes.
  useEffect(() => {
    setHighlight((h) => (h >= flat.length ? 0 : h));
  }, [flat.length]);

  // Restore focus to wherever it was when the palette closes.
  useEffect(() => {
    if (open) return;
    const el = restoreFocusRef.current;
    if (el && typeof el.focus === "function") el.focus();
  }, [open]);

  const runItem = useCallback(
    (item: PaletteItem | undefined) => {
      if (!item || !isPaletteItemEnabled(item)) return;
      onClose();
      // Run AFTER closing so an action that opens its own dialog (or switches the
      // open sequence) does not fight the palette for focus.
      runPaletteItem(item);
    },
    [onClose],
  );

  // Move the highlight to the next RUNNABLE row, wrapping, skipping disabled
  // rows. Returns the input index unchanged when nothing is runnable.
  const moveHighlight = useCallback(
    (dir: 1 | -1) => {
      if (flat.length === 0) return;
      let next = highlight;
      for (let step = 0; step < flat.length; step += 1) {
        next = (next + dir + flat.length) % flat.length;
        if (isPaletteItemEnabled(flat[next])) {
          setHighlight(next);
          return;
        }
      }
    },
    [flat, highlight],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        moveHighlight(1);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        moveHighlight(-1);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        runItem(flat[highlight]);
        return;
      }
    },
    [onClose, moveHighlight, runItem, flat, highlight],
  );

  // Keep the highlighted row scrolled into view as Up / Down walk past the fold.
  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    if (!list) return;
    const row = list.querySelector<HTMLElement>(
      `[data-cmd-index="${highlight}"]`,
    );
    // scrollIntoView is absent in some test environments (jsdom), so guard it.
    if (row && typeof row.scrollIntoView === "function") {
      row.scrollIntoView({ block: "nearest" });
    }
  }, [highlight, open]);

  if (!mounted || !open) return null;

  const activeId =
    flat[highlight] != null
      ? `${baseId}-opt-${paletteItemKey(flat[highlight])}`
      : undefined;

  return createPortal(
    <div
      // The scrim. Click outside the panel closes; clicks inside do not. A
      // blurred dark wash matches the app's other Apple-style overlays.
      className="fixed inset-0 z-[80] flex items-start justify-center bg-slate-900/35 px-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="mt-[11vh] w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-surface-raised shadow-2xl"
        onKeyDown={onKeyDown}
      >
        {/* Search row. The BeakerBot mark + BeakerSearch wordmark brand the open
            palette, then the input (a combobox over the result listbox). The
            mark is the real BeakerBot mascot rendered via the component, so no
            inline svg is added here. */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <BeakerBot
            pose="idle"
            animated={false}
            className="h-6 w-6 flex-none"
            ariaLabel="BeakerBot"
          />
          <span className="flex-none text-body font-semibold text-foreground">
            BeakerSearch
          </span>
          <Icon
            name="search"
            className="h-4 w-4 flex-none text-foreground-muted"
          />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setHighlight(0);
            }}
            placeholder="Search, jump, or run any tool"
            aria-label="BeakerSearch"
            role="combobox"
            aria-expanded="true"
            aria-controls={`${baseId}-listbox`}
            aria-activedescendant={activeId}
            autoComplete="off"
            spellCheck={false}
            className="flex-1 bg-transparent text-body text-foreground outline-none placeholder:text-foreground-muted"
          />
          <kbd className="rounded-md border border-border bg-surface px-1.5 py-0.5 text-[11px] font-semibold text-foreground-muted">
            Cmd K
          </kbd>
        </div>

        {/* The "On this sequence" context card. A full card at rest, a slim
            one-line header while typing. Display only, outside the listbox so it
            is never a selectable / highlighted row. */}
        <ContextCard context={context} slim={typing} />

        {/* Result list. Grouped, scrollable, with a flat highlight cursor across
            commands, sequences, and saved results. */}
        <div
          ref={listRef}
          id={`${baseId}-listbox`}
          role="listbox"
          aria-label="Commands, sequences, and results"
          className="max-h-[52vh] overflow-y-auto py-1"
        >
          {flat.length === 0 ? (
            <div className="px-4 py-8 text-center text-meta text-foreground-muted">
              Nothing matches that search.
            </div>
          ) : (
            (() => {
              // A running flat index so the highlight maps across groups.
              let flatIndex = -1;
              return groups.map((g) => (
                <div key={g.title}>
                  <div className="flex items-center gap-2 px-4 pb-1 pt-2 text-[10px] font-extrabold uppercase tracking-wide text-foreground-muted">
                    <span>{g.title}</span>
                    {g.hint ? (
                      <span className="font-medium normal-case tracking-normal text-foreground-muted">
                        {g.hint}
                      </span>
                    ) : null}
                  </div>
                  {g.items.map((item) => {
                    flatIndex += 1;
                    const idx = flatIndex;
                    const isHighlighted = idx === highlight;
                    const enabled = isPaletteItemEnabled(item);
                    const key = paletteItemKey(item);
                    const parts = paletteRowParts(item);
                    return (
                      <div
                        key={key}
                        id={`${baseId}-opt-${key}`}
                        data-cmd-index={idx}
                        data-cmd-id={key}
                        role="option"
                        aria-selected={isHighlighted}
                        aria-disabled={!enabled}
                        onMouseMove={() => {
                          if (enabled) setHighlight(idx);
                        }}
                        onMouseDown={(e) => {
                          // Keep focus in the input; run on click.
                          e.preventDefault();
                          runItem(item);
                        }}
                        className={`flex cursor-pointer items-center gap-3 px-4 py-2 ${
                          isHighlighted ? "bg-sky-50 dark:bg-sky-900/30" : ""
                        } ${enabled ? "" : "cursor-default opacity-40"}`}
                      >
                        <span className="flex h-6 w-6 flex-none items-center justify-center rounded-md bg-surface-sunken text-sky-600 dark:text-sky-300">
                          <Icon name={parts.iconName} className="h-3.5 w-3.5" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-body font-medium text-foreground">
                            {parts.label}
                          </span>
                          {parts.sub ? (
                            <span className="block truncate text-[11px] text-foreground-muted">
                              {parts.sub}
                            </span>
                          ) : null}
                        </span>
                        {parts.hint ? (
                          <span className="flex-none text-[11px] text-foreground-muted">
                            {parts.hint}
                          </span>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ));
            })()
          )}
        </div>

        {/* Footer hints. Calm, the standard palette legend. */}
        <div className="flex items-center gap-4 border-t border-border px-4 py-2 text-[11px] text-foreground-muted">
          <span>Up and Down to navigate</span>
          <span>Enter to run or open</span>
          <span className="ml-auto">
            Cmd K reaches everything, including tools off the rail
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default CommandPalette;
