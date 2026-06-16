"use client";

// BeakerBot inline record-set browser (ai record-widget bot, 2026-06-14).
//
// When a record-returning tool RESOLVES a set of matches, the chat renders this
// master-detail browser below the assistant reply. The left rail is a scrollable,
// searchable, type-filterable list of EVERY match; the right pane is a rich PREVIEW
// of the selected row. Clicking a row swaps the preview in place, no popup, so the
// user can click around fast. An "Open full" button in the preview opens the real
// object via the existing openObjectRef bridge (a popup for popup-capable types, a
// soft navigation otherwise), exactly like an embed Open button.
//
// The preview reuses the embed pipeline: it builds an EmbedDescriptor from the row
// and renders ObjectEmbed, which dispatches to the per-type rich renderer (lazy)
// with ObjectEmbedCard as the Suspense / no-renderer fallback. So a note previews
// as a note card, a sequence as its map, and so on, with zero new render code.
//
// Narrow-panel aware: under a width threshold the two columns collapse to one. The
// list shows first; selecting a row replaces it with the preview plus a Back to
// list control, so the widget stays usable inside a narrow BeakerBot panel.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { useMemo, useRef, useState, useEffect } from "react";
import { Icon } from "@/components/icons";
import type { IconName } from "@/components/icons";
import ObjectEmbed from "@/components/embeds/ObjectEmbed";
import { openObjectRef } from "@/components/ai/object-popup-bridge";
import { requestNavigation } from "@/components/ai/navigation-bridge";
import { DEFAULT_EMBED_VIEW, type EmbedDescriptor, type ObjectRefType } from "@/lib/references";
import { RECORD_SET_COMPACT_MAX, type RecordSet, type RecordSetRow, type RecordSetRowType } from "@/lib/ai/record-set";
import { WidgetIconTile, tintForObjectType } from "./widget-kit";

// Per-type glyph + label, mirroring ObjectEmbed's maps so the list and the embed
// preview read consistently. Kept local (ObjectEmbed does not export them) and
// covers every row type (every ObjectRefType plus "purchase") so a row of any type
// always has an icon and a label.
const TYPE_ICON: Record<RecordSetRowType, IconName> = {
  sequence: "sequence",
  collection: "folder",
  method: "book",
  note: "pencil",
  file: "file",
  project: "folder",
  molecule: "vial",
  datahub: "chart",
  dataset: "chart",
  phylo: "tree",
  task: "today",
  experiment: "list",
  purchase: "receipt",
  inventory: "box",
};

const TYPE_LABEL: Record<RecordSetRowType, string> = {
  sequence: "Sequence",
  collection: "Collection",
  method: "Method",
  note: "Note",
  file: "File",
  project: "Project",
  molecule: "Molecule",
  datahub: "Data Hub",
  dataset: "Dataset",
  phylo: "Phylogenetic tree",
  task: "Task",
  experiment: "Experiment",
  purchase: "Purchase",
  inventory: "Inventory item",
};

// Below this widget width the two columns collapse to a single column with a
// list / detail toggle. The BeakerBot panel can be narrow, so this matters.
const NARROW_PX = 520;

/** Build an EmbedDescriptor for a row so the preview pane can render it through the
 *  same embed pipeline notes use. The default block view per type drives which rich
 *  renderer ObjectEmbed picks. Only called for embed-capable types (purchase, which
 *  has no embed route, is handled separately in RecordPreview). */
function descriptorForRow(row: RecordSetRow & { type: ObjectRefType }): EmbedDescriptor {
  const view = DEFAULT_EMBED_VIEW[row.type] ?? "card";
  return { type: row.type, id: row.id, view, isEmbed: true, opts: {} };
}

// Row types with no embed route and no per-id deep link. They open the owning page
// as a whole (a calm fallback preview, a page-level Open full) rather than through
// the embed pipeline or openObjectRef.
const PAGELESS_ROUTE: Partial<Record<RecordSetRowType, string>> = {
  purchase: "/purchases",
  inventory: "/inventory",
};

/** Open the row's full object the way an embed Open button does. Purchases and
 *  inventory items have no per-id route, so they navigate to their page as a whole;
 *  every other type goes through openObjectRef (popup for popup-capable types, soft
 *  navigation otherwise). */
function openRowFull(row: RecordSetRow): void {
  const route = PAGELESS_ROUTE[row.type];
  if (route) {
    requestNavigation(route);
    return;
  }
  openObjectRef({ type: row.type as ObjectRefType, id: row.id });
}

/** A single left-rail row button. Icon + title (truncated) + a small second line
 *  (subtitle / meta / date). Highlighted when selected. */
function RowButton({
  row,
  selected,
  onSelect,
}: {
  row: RecordSetRow;
  selected: boolean;
  onSelect: () => void;
}) {
  const secondLine = row.subtitle || row.meta || row.date || TYPE_LABEL[row.type];
  return (
    <button
      type="button"
      onClick={onSelect}
      data-selected={selected ? "true" : undefined}
      className={`flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
        selected
          ? "bg-surface-sunken text-foreground"
          : "text-foreground-muted hover:bg-surface-sunken/60 hover:text-foreground"
      }`}
    >
      <WidgetIconTile
        icon={TYPE_ICON[row.type]}
        tint={tintForObjectType(row.type)}
        size="sm"
        className="mt-0.5"
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-meta font-semibold text-foreground">
          {row.title || row.id}
        </span>
        <span className="block truncate text-[11px] text-foreground-muted">{secondLine}</span>
      </span>
    </button>
  );
}

/** The right-pane preview of the selected row. Reuses ObjectEmbed for the rich body
 *  (or its calm fallback card), with the row's snippet shown above when present and
 *  an Open full button below. */
function RecordPreview({ row }: { row: RecordSetRow }) {
  // Purchases and inventory items have no embed route, so they show a calm summary
  // card built from the row fields rather than an ObjectEmbed. Every other type
  // renders through the embed pipeline (rich renderer or its fallback card).
  const isPageless = row.type in PAGELESS_ROUTE;
  const descriptor = useMemo(
    () => (isPageless ? null : descriptorForRow(row as RecordSetRow & { type: ObjectRefType })),
    [row, isPageless],
  );
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-auto">
        {row.snippet ? (
          <p className="mb-2 rounded-md bg-surface-sunken px-3 py-2 text-[11px] leading-relaxed text-foreground-muted">
            {row.snippet}
          </p>
        ) : null}
        {descriptor ? (
          // ObjectEmbed brings its own figure frame, so it nests cleanly here.
          <ObjectEmbed descriptor={descriptor} caption={row.title || row.id} />
        ) : (
          <div className="rounded-xl border border-border bg-surface-raised px-4 py-3">
            <p className="truncate text-body font-semibold text-foreground">
              {row.title || row.id}
            </p>
            <p className="mt-0.5 text-meta text-foreground-muted">
              {[TYPE_LABEL[row.type], row.subtitle, row.meta].filter(Boolean).join(" · ")}
            </p>
          </div>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 border-t border-border pt-2">
        <span className="truncate text-[11px] text-foreground-muted">
          {TYPE_LABEL[row.type]}
          {row.meta ? ` · ${row.meta}` : ""}
        </span>
        <button
          type="button"
          onClick={() => openRowFull(row)}
          className="shrink-0 rounded-md border border-border px-2.5 py-1 text-meta font-semibold text-foreground-muted transition-colors hover:border-brand-action hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-action"
        >
          Open full
        </button>
      </div>
    </div>
  );
}

function FullRecordSet({ set }: { set: RecordSet }) {
  const [query, setQuery] = useState("");
  // Active type-filter chips. Empty set means "all types".
  const [activeTypes, setActiveTypes] = useState<Set<RecordSetRowType>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(set.items[0]?.id ?? null);
  // Narrow-panel single-column mode: which pane is showing.
  const [mobileView, setMobileView] = useState<"list" | "detail">("list");

  // Measure the widget width to decide single vs two column.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setNarrow(w > 0 && w < NARROW_PX);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Distinct types present, with counts, in first-seen order, for the filter chips.
  const typeChips = useMemo(() => {
    const counts = new Map<RecordSetRowType, number>();
    for (const row of set.items) counts.set(row.type, (counts.get(row.type) ?? 0) + 1);
    return Array.from(counts.entries()).map(([type, count]) => ({ type, count }));
  }, [set.items]);

  // The filtered + searched row list. Search matches title + snippet + subtitle,
  // case-insensitive. Type chips AND with the search.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return set.items.filter((row) => {
      if (activeTypes.size > 0 && !activeTypes.has(row.type)) return false;
      if (!q) return true;
      const hay = `${row.title} ${row.snippet ?? ""} ${row.subtitle ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [set.items, query, activeTypes]);

  // Keep a valid selection: if the current one filtered out, fall to the first
  // visible row (or null when the filter is empty).
  const selectedRow = useMemo(
    () => filtered.find((r) => r.id === selectedId) ?? null,
    [filtered, selectedId],
  );
  useEffect(() => {
    if (!selectedRow && filtered.length > 0) setSelectedId(filtered[0].id);
  }, [selectedRow, filtered]);
  const effectiveRow = selectedRow ?? filtered[0] ?? null;

  const toggleType = (type: RecordSetRowType) => {
    setActiveTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const selectRow = (id: string) => {
    setSelectedId(id);
    if (narrow) setMobileView("detail");
  };

  // Keyboard up/down moves the selection within the filtered list (nice-to-have).
  const onListKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    if (filtered.length === 0) return;
    e.preventDefault();
    const idx = filtered.findIndex((r) => r.id === effectiveRow?.id);
    const nextIdx =
      e.key === "ArrowDown"
        ? Math.min(filtered.length - 1, idx + 1)
        : Math.max(0, idx - 1);
    setSelectedId(filtered[nextIdx].id);
  };

  const showingNote =
    set.items.length < set.total ? `showing ${set.items.length} of ${set.total}` : null;

  // The left rail (list + search + chips). Shared by both layouts.
  const listColumn = (
    <div className="flex min-h-0 flex-col" onKeyDown={onListKeyDown}>
      <div className="relative mb-2">
        <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-foreground-muted">
          <Icon name="search" className="h-3.5 w-3.5" />
        </span>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search matches"
          aria-label="Search matches"
          className="w-full rounded-md border border-border bg-surface-raised py-1.5 pl-7 pr-2 text-meta text-foreground placeholder:text-foreground-muted focus:border-brand-action focus:outline-none"
        />
      </div>
      {typeChips.length > 1 ? (
        <div className="mb-2 flex flex-wrap gap-1">
          {typeChips.map(({ type, count }) => {
            const on = activeTypes.has(type);
            return (
              <button
                key={type}
                type="button"
                onClick={() => toggleType(type)}
                aria-pressed={on}
                className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold transition-colors ${
                  on
                    ? "border-brand-action bg-brand-action/10 text-foreground"
                    : "border-border text-foreground-muted hover:border-brand-action hover:text-foreground"
                }`}
              >
                {TYPE_LABEL[type]} {count}
              </button>
            );
          })}
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto pr-0.5">
        {filtered.length === 0 ? (
          <p className="px-2 py-6 text-center text-meta text-foreground-muted">
            No matches for this search
          </p>
        ) : (
          <div className="flex flex-col gap-0.5">
            {filtered.map((row, idx) => (
              <RowButton
                key={`${row.type}:${row.id}:${idx}`}
                row={row}
                selected={row.id === effectiveRow?.id}
                onSelect={() => selectRow(row.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div
      ref={containerRef}
      data-testid="record-set-widget"
      className="mt-2 overflow-hidden rounded-xl border border-border bg-surface-raised"
    >
      {/* Header: title + count note. */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center text-foreground-muted">
          <Icon name="filter" className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1 truncate text-meta font-semibold text-foreground">
          {set.title}
        </span>
        <span className="shrink-0 text-[11px] text-foreground-muted">
          {showingNote ?? `${set.total} ${set.total === 1 ? "match" : "matches"}`}
        </span>
      </div>

      {narrow ? (
        // Single column: list, or detail with a Back control.
        <div className="p-2" style={{ height: 340 }}>
          {mobileView === "detail" && effectiveRow ? (
            <div className="flex h-full flex-col">
              <button
                type="button"
                onClick={() => setMobileView("list")}
                className="mb-2 flex items-center gap-1 self-start rounded-md px-1.5 py-1 text-meta font-semibold text-foreground-muted transition-colors hover:text-foreground"
              >
                <Icon name="chevronLeft" className="h-3.5 w-3.5" />
                Back to list
              </button>
              <div className="min-h-0 flex-1">
                <RecordPreview row={effectiveRow} />
              </div>
            </div>
          ) : (
            <div className="h-full">{listColumn}</div>
          )}
        </div>
      ) : (
        // Two column: list rail + preview pane.
        <div className="flex" style={{ height: 340 }}>
          <div className="w-[220px] shrink-0 border-r border-border p-2">{listColumn}</div>
          <div className="min-w-0 flex-1 p-3">
            {effectiveRow ? (
              <RecordPreview row={effectiveRow} />
            ) : (
              <p className="flex h-full items-center justify-center text-meta text-foreground-muted">
                Select a row to preview it
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Compact layout (Grant's "Option D", 2026-06-14) for a small set (2 to
// RECORD_SET_COMPACT_MAX rows). The full widget in miniature: a row of selectable
// chip tabs across the top, one shared preview pane below, no search box or rail
// (overkill for a handful). Same preview + Open-full as the full layout, so the
// two sizes are one mental model. Used instead of scattered inline chips so a few
// results can be previewed in place without committing to the full popup.
function CompactRecordSet({ set }: { set: RecordSet }) {
  const [selectedId, setSelectedId] = useState<string | null>(set.items[0]?.id ?? null);
  const selected = set.items.find((r) => r.id === selectedId) ?? set.items[0] ?? null;
  return (
    <div
      data-testid="record-set-widget"
      data-layout="compact"
      className="mt-2 overflow-hidden rounded-xl border border-border bg-surface-raised"
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center text-foreground-muted">
          <Icon name="filter" className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1 truncate text-meta font-semibold text-foreground">
          {set.title}
        </span>
        <span className="shrink-0 text-[11px] text-foreground-muted">
          {set.total} {set.total === 1 ? "match" : "matches"}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
        {set.items.map((row, idx) => {
          const on = row.id === selected?.id;
          return (
            <button
              key={`${row.type}:${row.id}:${idx}`}
              type="button"
              onClick={() => setSelectedId(row.id)}
              aria-selected={on}
              className={`inline-flex max-w-full items-center gap-1.5 rounded-md border py-1 pl-1 pr-2.5 text-meta transition-colors ${
                on
                  ? "border-brand-action bg-brand-action/10 text-foreground"
                  : "border-border text-foreground-muted hover:border-brand-action hover:text-foreground"
              }`}
            >
              <WidgetIconTile
                icon={TYPE_ICON[row.type]}
                tint={tintForObjectType(row.type)}
                size="sm"
              />
              <span className="truncate">{row.title || row.id}</span>
            </button>
          );
        })}
      </div>
      <div className="px-3 pb-3 pt-2.5">
        {/* Fixed height so RecordPreview's h-full preview body and Open-full row
            lay out the same way they do in the full layout. */}
        <div style={{ height: 300 }}>
          {selected ? <RecordPreview row={selected} /> : null}
        </div>
      </div>
    </div>
  );
}

// The single entry point. A SET of 2 to RECORD_SET_COMPACT_MAX renders the compact
// Option-D layout; a larger set renders the full search + rail layout. (Sets of 0
// or 1 never reach here, the tools do not attach a _ui below RECORD_SET_MIN_ITEMS.)
export default function RecordSetWidget({ set }: { set: RecordSet }) {
  if (!set.items.length) return null;
  return set.items.length <= RECORD_SET_COMPACT_MAX ? (
    <CompactRecordSet set={set} />
  ) : (
    <FullRecordSet set={set} />
  );
}
