"use client";

// ComposerMentionPicker (ai at-mentions bot, 2026-06-13).
//
// The "@" object picker that opens inline above the BeakerBot composer. It reads
// the SAME cross-type global object index that powers BeakerSearch
// (useGlobalObjectIndex), filters it by the text the user typed after "@", and
// renders a grouped, keyboard-navigable list. Selecting a row calls onSelect with
// an AttachedRef the composer stages via the store's addAttachedRef.
//
// Deliberately presentational over the index hook, no new store, no new fetch.
// The parent owns the open/close lifecycle and the query string (parsed from the
// textarea). Keyboard handling (up/down/enter/escape) is driven by the parent via
// the imperative-ish props (activeIndex + the filtered list) so the textarea keeps
// focus while the user arrows through results.
//
// House style, Icon only (every glyph is a registry IconName carried on the index
// entry), no emojis / em-dashes / mid-sentence colons.

import { useEffect, useMemo } from "react";
import { type IconName } from "@/components/icons";
import { WidgetIconTile, tintDotClass, tintForObjectType } from "./widget-kit";
import { useGlobalObjectIndex } from "@/components/beaker-search/useGlobalObjectIndex";
import type { GlobalIndexEntry } from "@/components/beaker-search/global-index";
import type { AttachedRef } from "@/lib/ai/conversation-store";

/** Human label shown on the type pill at the end of each row. */
const TYPE_LABEL: Record<GlobalIndexEntry["type"], string> = {
  task: "experiment",
  project: "project",
  method: "method",
  sequence: "sequence",
  inventory: "inventory",
  note: "note",
  datahub: "table",
  molecule: "molecule",
  purchase: "purchase",
  phylo: "tree",
};

/** Group title shown above a run of same-type rows. */
const GROUP_LABEL: Record<GlobalIndexEntry["type"], string> = {
  task: "Experiments and tasks",
  project: "Projects",
  method: "Methods",
  sequence: "Sequences",
  inventory: "Inventory",
  note: "Notes",
  datahub: "Tables",
  molecule: "Molecules",
  purchase: "Purchases",
  phylo: "Trees",
};

// Cap the visible result count so the dropdown never grows unbounded. The user
// keeps typing to narrow when their object is past the cap.
const MAX_RESULTS = 12;

/** Map a global index entry to the AttachedRef the store stages. */
export function entryToRef(entry: GlobalIndexEntry): AttachedRef {
  return {
    type: entry.type,
    id: entry.key,
    name: entry.label,
    deepLink: entry.href,
  };
}

/** Rank entries against a lowercased query, prefix-and-substring over the
 *  precomputed haystack, then by recency. Empty query returns recency order. */
export function rankEntries(
  entries: GlobalIndexEntry[],
  query: string,
): GlobalIndexEntry[] {
  const q = query.trim().toLowerCase();
  const byRecency = (a: GlobalIndexEntry, b: GlobalIndexEntry) =>
    b.recencyAt - a.recencyAt;
  if (!q) {
    return [...entries].filter((e) => e.enabled).sort(byRecency).slice(0, MAX_RESULTS);
  }
  const scored = entries
    .filter((e) => e.enabled && e.haystack.includes(q))
    .sort((a, b) => {
      // Label prefix matches rank above mid-string matches.
      const ap = a.label.toLowerCase().startsWith(q) ? 0 : 1;
      const bp = b.label.toLowerCase().startsWith(q) ? 0 : 1;
      if (ap !== bp) return ap - bp;
      return byRecency(a, b);
    });
  return scored.slice(0, MAX_RESULTS);
}

/**
 * The @ picker container. It OWNS the global-index hook, so the hook (and its
 * FileSystem provider dependency) only runs while the picker is actually open.
 * The parent mounts this component conditionally (atQuery !== null), which keeps
 * the heavier index subscription off the render path for every closed-composer
 * render and for tests that never open the picker.
 *
 * The ranked results are reported back up via onResultsChange so the parent can
 * drive Enter/Arrow keyboard navigation against the same list the user sees.
 */
export default function ComposerMentionPicker({
  query,
  activeIndex,
  onSelect,
  onResultsChange,
}: {
  /** The text typed after "@" (may be empty). */
  query: string;
  /** The currently highlighted row index (driven by keyboard in the parent). */
  activeIndex: number;
  /** Called when a row is chosen (click or Enter). */
  onSelect: (ref: AttachedRef) => void;
  /** Reports the live ranked results up so the parent can keyboard-navigate them. */
  onResultsChange: (results: GlobalIndexEntry[]) => void;
}) {
  const index = useGlobalObjectIndex();
  const results = useMemo(() => rankEntries(index, query), [index, query]);

  // Push the latest results up whenever they change identity.
  useEffect(() => {
    onResultsChange(results);
  }, [results, onResultsChange]);

  if (results.length === 0) return null;

  return (
    <div
      data-testid="beakerbot-mention-picker"
      role="listbox"
      aria-label="Attach an object"
      className="absolute bottom-[calc(100%+4px)] left-0 right-0 z-30 overflow-hidden rounded-md border border-border bg-surface-raised shadow-lg"
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className="text-sm font-semibold text-brand">@</span>
        <span className="text-meta text-foreground-muted">
          Pick an object to attach
        </span>
      </div>

      {results.length > 0 ? (
        <div className="max-h-64 overflow-y-auto py-1">
          {results.map((entry, i) => {
            const prevType = i > 0 ? results[i - 1].type : null;
            const showGroup = entry.type !== prevType;
            const isActive = i === activeIndex;
            return (
              <div key={entry.key}>
                {showGroup ? (
                  <div className="flex items-center gap-1.5 px-3 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wide text-foreground-muted">
                    <span
                      className={`h-[7px] w-[7px] shrink-0 rounded-full ${tintDotClass(
                        tintForObjectType(entry.type),
                      )}`}
                    />
                    {GROUP_LABEL[entry.type]}
                  </div>
                ) : null}
                <button
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  data-testid="beakerbot-mention-row"
                  // onMouseDown (not onClick) so selecting a row does not blur the
                  // textarea before the parent's handler runs.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onSelect(entryToRef(entry));
                  }}
                  className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left ${
                    isActive ? "bg-brand/10" : "hover:bg-surface-sunken"
                  }`}
                >
                  <WidgetIconTile
                    icon={entry.iconName as IconName}
                    tint={tintForObjectType(entry.type)}
                    size="sm"
                  />
                  <span className="min-w-0 flex-1 truncate text-body text-foreground">
                    {entry.label}
                  </span>
                  <span className="flex-none rounded bg-surface-sunken px-1.5 py-0.5 text-[10px] text-foreground-muted">
                    {TYPE_LABEL[entry.type]}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="flex gap-3 border-t border-border px-3 py-1.5 text-[10px] text-foreground-muted">
        <span>Up and down to navigate</span>
        <span>Enter to attach</span>
        <span>Esc to close</span>
      </div>
    </div>
  );
}
