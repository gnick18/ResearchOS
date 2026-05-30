"use client";

import { useEffect, type ReactNode } from "react";
import Tooltip from "@/components/Tooltip";

/**
 * Shared master/detail "store" shell (Extension Store Phase B, store-shell
 * bot, 2026-05-29).
 *
 * Both stores (the widget store and the method library) render into this one
 * frame so they read as a single marketplace instead of two unrelated
 * dialogs. The shell is deliberately GENERIC and DUMB: it owns layout,
 * sizing, the category rail, the search slot, the detail pane, and the
 * responsive collapse, and NOTHING else. Each store supplies its own data
 * (`items`), its own card + detail renderers, its own category list, and its
 * own enable/disable behavior. The shell never touches enablement state.
 *
 * Layout (lg and up): a three-column master/detail.
 *   - LEFT RAIL (~260px): the caller's search node at top, then a category
 *     list with per-category counts, an "All" entry, and an "Enabled only"
 *     filter toggle. Selecting a category calls back; the caller decides what
 *     `items` to pass.
 *   - CENTER (flex-1, scrollable): the result list/grid via `renderCard`.
 *   - RIGHT DETAIL (~40%): an empty-state placeholder until a card is
 *     selected, then `renderDetail(selectedItem)`. The pane stays visible
 *     while browsing.
 *
 * Below lg the rail collapses to a horizontal filter-chip row above the
 * results, and the detail pane opens as a full-screen overlay on tap (a back
 * affordance returns to the list).
 *
 * Conventions kept from the existing modals: fixed inset-0 z-50 overlay,
 * bg-black/30 backdrop-blur-sm, Escape-to-close. House style: no emoji (every
 * glyph is an inline SVG), no native title= (icon-only buttons use Tooltip).
 */

export interface StoreCategory {
  id: string;
  label: string;
  count: number;
}

export interface StoreShellProps<T> {
  /** Header title (e.g. "Widget store", "Method library"). */
  title: string;
  /** Optional one-line subtitle under the title. */
  subtitle?: string;

  /** Category list for the rail. The shell adds its own "All" entry above
   *  these (selected when `selectedCategoryId` is null). */
  categories: StoreCategory[];
  /** The selected category id, or null for "All". */
  selectedCategoryId: string | null;
  /** Fires when the user picks a category (null = the "All" entry). */
  onSelectCategory: (id: string | null) => void;
  /** Label for the synthetic "All" rail entry. Defaults to "All". */
  allLabel?: string;

  /** Optional node rendered ABOVE the search slot in both the lg rail and the
   *  mobile chip row. The shell stays generic and only places it: callers use
   *  it for a segment control that switches the category set + item kind (the
   *  method library's Types | Templates segment). The widget store passes
   *  nothing (single kind, no segment). */
  railHeaderSlot?: ReactNode;

  /** The search input node. The caller owns its state; the shell only places
   *  it at the top of the rail / chip row. */
  searchSlot: ReactNode;

  /** "Enabled only" filter state. The caller owns the filtering. */
  enabledOnly: boolean;
  onToggleEnabledOnly: (next: boolean) => void;

  /** The items to render in the center column (already filtered by caller). */
  items: T[];
  /** Stable key per item, used for React keys + selection comparison. */
  getItemKey: (item: T) => string;

  /** The selected item, or null when nothing is selected. */
  selectedItem: T | null;
  /** Select an item (null clears the selection / closes the mobile overlay). */
  onSelectItem: (item: T | null) => void;

  /** Render one result card. `selected` + `onSelect` drive the detail pane. */
  renderCard: (
    item: T,
    ctx: { selected: boolean; onSelect: () => void },
  ) => ReactNode;
  /** Render the detail pane for the selected item. */
  renderDetail: (item: T) => ReactNode;

  /** Hint shown in the empty detail pane. Defaults to a generic line. */
  detailEmptyHint?: string;
  /** Shown in the center column when `items` is empty. */
  emptyState?: ReactNode;

  /** The "request a new one" stub (and any caller-owned controls) the store
   *  wants pinned under the result column. */
  footerSlot?: ReactNode;

  /** Tailwind classes for the center card container. Defaults to a 2-up grid. */
  cardGridClassName?: string;

  /** Accessible label for the close button (e.g. "Close widget store"). */
  closeAriaLabel?: string;

  onClose: () => void;
}

const DEFAULT_GRID = "grid grid-cols-1 sm:grid-cols-2 gap-3";

export function StoreShell<T>({
  title,
  subtitle,
  categories,
  selectedCategoryId,
  onSelectCategory,
  allLabel = "All",
  railHeaderSlot,
  searchSlot,
  enabledOnly,
  onToggleEnabledOnly,
  items,
  getItemKey,
  selectedItem,
  onSelectItem,
  renderCard,
  renderDetail,
  detailEmptyHint = "Select an item to see details",
  emptyState,
  footerSlot,
  cardGridClassName = DEFAULT_GRID,
  closeAriaLabel = "Close",
  onClose,
}: StoreShellProps<T>) {
  // Close on Escape, matching the project's modal convention. When a mobile
  // detail overlay is open, Escape backs out of it first so the user is not
  // yanked all the way out of the store.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (
        selectedItem !== null &&
        typeof window !== "undefined" &&
        window.innerWidth < 1024
      ) {
        onSelectItem(null);
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onSelectItem, selectedItem]);

  const selectedKey = selectedItem !== null ? getItemKey(selectedItem) : null;
  const allCount = categories.reduce((sum, c) => sum + c.count, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="relative bg-white rounded-xl shadow-2xl w-[92vw] max-w-6xl h-[88vh] mx-4 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-gray-900 truncate">
              {title}
            </h3>
            {subtitle && (
              <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>
            )}
          </div>
          <Tooltip label="Close" placement="bottom">
            <button
              onClick={onClose}
              aria-label={closeAriaLabel}
              className="shrink-0 ml-4 text-gray-400 hover:text-gray-600 text-lg leading-none"
            >
              &times;
            </button>
          </Tooltip>
        </div>

        {/* Body: column on mobile (chip row + results), row on lg (rail +
            results + detail). min-h-0 lets the inner columns scroll. */}
        <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
          {/* LEFT RAIL (lg and up) */}
          <aside className="hidden lg:flex lg:flex-col lg:w-[260px] lg:shrink-0 border-r border-gray-100">
            <div className="p-4 border-b border-gray-100 flex flex-col gap-3">
              {railHeaderSlot}
              {searchSlot}
            </div>
            <nav className="flex-1 overflow-auto p-2">
              <CategoryButton
                label={allLabel}
                count={allCount}
                active={selectedCategoryId === null}
                onClick={() => onSelectCategory(null)}
              />
              {categories.map((c) => (
                <CategoryButton
                  key={c.id}
                  label={c.label}
                  count={c.count}
                  active={selectedCategoryId === c.id}
                  onClick={() => onSelectCategory(c.id)}
                />
              ))}
            </nav>
            <div className="p-3 border-t border-gray-100">
              <EnabledOnlyToggle
                on={enabledOnly}
                onToggle={() => onToggleEnabledOnly(!enabledOnly)}
              />
            </div>
          </aside>

          {/* MOBILE FILTER ROW (below lg) */}
          <div className="lg:hidden border-b border-gray-100">
            {railHeaderSlot && <div className="px-4 pt-3">{railHeaderSlot}</div>}
            <div className="px-4 pt-3">{searchSlot}</div>
            <div className="flex items-center gap-2 overflow-x-auto px-4 py-3">
              <FilterChip
                label={`${allLabel} (${allCount})`}
                active={selectedCategoryId === null}
                onClick={() => onSelectCategory(null)}
              />
              {categories.map((c) => (
                <FilterChip
                  key={c.id}
                  label={`${c.label} (${c.count})`}
                  active={selectedCategoryId === c.id}
                  onClick={() => onSelectCategory(c.id)}
                />
              ))}
              <span className="ml-auto shrink-0">
                <EnabledOnlyToggle
                  on={enabledOnly}
                  onToggle={() => onToggleEnabledOnly(!enabledOnly)}
                  compact
                />
              </span>
            </div>
          </div>

          {/* CENTER: result column */}
          <div className="flex-1 min-w-0 overflow-auto p-6">
            {items.length === 0 ? (
              <div className="py-10 text-center text-sm text-gray-400">
                {emptyState ?? "No results."}
              </div>
            ) : (
              <div className={cardGridClassName}>
                {items.map((item) => {
                  const key = getItemKey(item);
                  return (
                    <div key={key}>
                      {renderCard(item, {
                        selected: key === selectedKey,
                        onSelect: () => onSelectItem(item),
                      })}
                    </div>
                  );
                })}
              </div>
            )}

            {footerSlot && (
              <section className="mt-8 border-t border-gray-100 pt-6">
                {footerSlot}
              </section>
            )}
          </div>

          {/* RIGHT DETAIL PANE (lg and up) */}
          <aside className="hidden lg:flex lg:flex-col lg:w-[40%] lg:shrink-0 border-l border-gray-100 overflow-auto">
            {selectedItem !== null ? (
              <div className="p-6">{renderDetail(selectedItem)}</div>
            ) : (
              <DetailEmptyState hint={detailEmptyHint} />
            )}
          </aside>
        </div>

        {/* MOBILE DETAIL OVERLAY (below lg): full-screen over the modal body
            when an item is selected. */}
        {selectedItem !== null && (
          <div className="lg:hidden absolute inset-0 z-10 bg-white flex flex-col">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 shrink-0">
              <button
                type="button"
                onClick={() => onSelectItem(null)}
                className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <polyline points="15 18 9 12 15 6" />
                </svg>
                Back to list
              </button>
            </div>
            <div className="flex-1 overflow-auto p-6">
              {renderDetail(selectedItem)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** A rail category row: label on the left, count badge on the right. */
function CategoryButton({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className={`w-full flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
        active
          ? "bg-blue-50 text-blue-700 font-medium"
          : "text-gray-600 hover:bg-gray-50"
      }`}
    >
      <span className="truncate">{label}</span>
      <span
        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
          active ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-500"
        }`}
      >
        {count}
      </span>
    </button>
  );
}

/** A horizontal filter chip for the mobile collapse. */
function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? "bg-blue-600 text-white"
          : "bg-gray-100 text-gray-600 hover:bg-gray-200"
      }`}
    >
      {label}
    </button>
  );
}

/** The "Enabled only" filter switch (style mirrors the method-type toggle). */
function EnabledOnlyToggle({
  on,
  onToggle,
  compact = false,
}: {
  on: boolean;
  onToggle: () => void;
  compact?: boolean;
}) {
  return (
    <Tooltip label={on ? "Showing enabled only" : "Showing all"} placement="top">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="Show enabled only"
        onClick={onToggle}
        className={`inline-flex items-center gap-2 ${
          compact ? "" : "w-full"
        } text-sm text-gray-600`}
      >
        <span
          className={`relative shrink-0 inline-flex h-5 w-9 items-center rounded-full transition-colors ${
            on ? "bg-blue-600" : "bg-gray-300"
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              on ? "translate-x-4" : "translate-x-0.5"
            }`}
          />
        </span>
        {!compact && <span>Enabled only</span>}
      </button>
    </Tooltip>
  );
}

/** Placeholder shown in the detail pane before anything is selected. */
function DetailEmptyState({ hint }: { hint: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8 text-center">
      <span aria-hidden="true" className="text-gray-300">
        <svg
          width="40"
          height="40"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
      </span>
      <p className="text-sm text-gray-400 max-w-[220px]">{hint}</p>
    </div>
  );
}

export default StoreShell;
