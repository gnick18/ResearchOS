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
import type { SelectionKind } from "@/lib/sequences/inspector-context";
import {
  buildResults,
  flattenResults,
  isCommandEnabled,
  type EditorCommand,
} from "./editor-commands";

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  commands: EditorCommand[];
  /** The live selection kind, so the empty-query Suggested group is biased. */
  selectionKind: SelectionKind;
  /** Whether the open sequence carries an organism (biases Suggested too). */
  hasOrganism: boolean;
}

/** The full-screen palette. Renders nothing when closed. */
export function CommandPalette({
  open,
  onClose,
  commands,
  selectionKind,
  hasOrganism,
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

  // Grouped + flat results for the current query and selection context.
  const groups = useMemo(
    () => buildResults(commands, query, { selectionKind, hasOrganism }),
    [commands, query, selectionKind, hasOrganism],
  );
  const flat = useMemo(() => flattenResults(groups), [groups]);

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

  const runCommand = useCallback(
    (cmd: EditorCommand | undefined) => {
      if (!cmd || !isCommandEnabled(cmd)) return;
      onClose();
      // Run AFTER closing so a command that opens its own dialog does not fight
      // the palette for focus.
      cmd.run();
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
        if (isCommandEnabled(flat[next])) {
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
        runCommand(flat[highlight]);
        return;
      }
    },
    [onClose, moveHighlight, runCommand, flat, highlight],
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
    flat[highlight] != null ? `${baseId}-opt-${flat[highlight].id}` : undefined;

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
        {/* Search row. The input is a combobox over the result listbox. */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
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
            placeholder="Search or run a tool"
            aria-label="Search or run a tool"
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

        {/* Result list. Grouped, scrollable, with a flat highlight cursor. */}
        <div
          ref={listRef}
          id={`${baseId}-listbox`}
          role="listbox"
          aria-label="Commands"
          className="max-h-[52vh] overflow-y-auto py-1"
        >
          {flat.length === 0 ? (
            <div className="px-4 py-8 text-center text-meta text-foreground-muted">
              No tools match that search.
            </div>
          ) : (
            (() => {
              // A running flat index so the highlight maps across groups.
              let flatIndex = -1;
              return groups.map((g) => (
                <div key={g.group}>
                  <div className="px-4 pb-1 pt-2 text-[10px] font-extrabold uppercase tracking-wide text-foreground-muted">
                    {g.group}
                  </div>
                  {g.commands.map((cmd) => {
                    flatIndex += 1;
                    const idx = flatIndex;
                    const isHighlighted = idx === highlight;
                    const enabled = isCommandEnabled(cmd);
                    return (
                      <div
                        key={cmd.id}
                        id={`${baseId}-opt-${cmd.id}`}
                        data-cmd-index={idx}
                        data-cmd-id={cmd.id}
                        role="option"
                        aria-selected={isHighlighted}
                        aria-disabled={!enabled}
                        onMouseMove={() => {
                          if (enabled) setHighlight(idx);
                        }}
                        onMouseDown={(e) => {
                          // Keep focus in the input; run on click.
                          e.preventDefault();
                          runCommand(cmd);
                        }}
                        className={`flex cursor-pointer items-center gap-3 px-4 py-2 ${
                          isHighlighted ? "bg-sky-50 dark:bg-sky-900/30" : ""
                        } ${enabled ? "" : "cursor-default opacity-40"}`}
                      >
                        <span className="flex h-6 w-6 flex-none items-center justify-center rounded-md bg-surface-sunken text-sky-600 dark:text-sky-300">
                          <Icon name={cmd.iconName} className="h-3.5 w-3.5" />
                        </span>
                        <span className="flex-1 truncate text-body font-medium text-foreground">
                          {cmd.label}
                        </span>
                        {cmd.shortcut ? (
                          <span className="flex-none text-[11px] text-foreground-muted">
                            {cmd.shortcut}
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
          <span>Enter to run</span>
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
