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
 *     While nothing is selected the grid widens to a 3-up browse layout and a
 *     slim orienting hint sits above it.
 *   - RIGHT DETAIL (~40%): collapsed entirely until a card is selected, then
 *     it opens and renders `renderDetail(selectedItem)` while the center grid
 *     drops back to a 2-up layout.
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

  /** Slim one-line orienting hint shown over the browse grid (lg) while
   *  nothing is selected. With no selection the detail pane collapses and the
   *  grid reclaims its width, so this points the user at what to do next. */
  browseHint?: string;
  /** Shown in the center column when `items` is empty. */
  emptyState?: ReactNode;

  /** The "request a new one" stub (and any caller-owned controls) the store
   *  wants pinned under the result column. */
  footerSlot?: ReactNode;

  /** Tailwind classes for the center card container when an item is selected
   *  (the detail pane is open). Defaults to a 2-up grid. */
  cardGridClassName?: string;
  /** Tailwind classes for the center card container while nothing is selected
   *  (the detail pane is collapsed, so the grid is wider). Defaults to a 3-up
   *  grid at lg. */
  browseCardGridClassName?: string;

  /** Accessible label for the close button (e.g. "Close widget store"). */
  closeAriaLabel?: string;

  onClose: () => void;
}

const DEFAULT_GRID = "grid grid-cols-1 sm:grid-cols-2 gap-3";
// Wider grid used while nothing is selected: the detail pane is collapsed, so
// the center column reclaims that ~40% width and fits a third column at lg.
const DEFAULT_BROWSE_GRID =
  "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3";

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
  browseHint = "Click any card to preview it live and see what it does.",
  emptyState,
  footerSlot,
  cardGridClassName = DEFAULT_GRID,
  browseCardGridClassName = DEFAULT_BROWSE_GRID,
  closeAriaLabel = "Close",
  onClose,
}: StoreShellProps<T>) {
  // Close on Escape, matching the project's modal convention. When a mobile
  // detail overlay is open, Escape backs out of it first so the user is not
  // yanked all the way out of the store. This is the ONE Escape binding for the
  // store shell, so callers (e.g. MethodTemplateLibraryModal) must NOT also call
  // useEscapeToClose, or one Escape would fire twice. Mirrors useEscapeToClose:
  // bail when a nested overlay already handled the event, and mark it handled
  // when we act.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (
        selectedItem !== null &&
        typeof window !== "undefined" &&
        window.innerWidth < 1024
      ) {
        e.preventDefault();
        e.stopPropagation();
        onSelectItem(null);
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onSelectItem, selectedItem]);

  const selectedKey = selectedItem !== null ? getItemKey(selectedItem) : null;
  const allCount = categories.reduce((sum, c) => sum + c.count, 0);

  // With nothing selected the detail aside collapses (below) and the center
  // grid widens to reclaim that space; selecting an item reverts to the 2-up
  // grid + the persistent detail pane.
  const noSelection = selectedItem === null;
  const gridClass = noSelection ? browseCardGridClassName : cardGridClassName;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="relative bg-surface-raised rounded-xl ros-popup-card-shadow w-[92vw] max-w-6xl h-[88vh] mx-4 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div className="min-w-0">
            <h3 className="text-title font-semibold text-foreground truncate">
              {title}
            </h3>
            {subtitle && (
              <p className="text-meta text-foreground-muted mt-0.5">{subtitle}</p>
            )}
          </div>
          <Tooltip label="Close" placement="bottom">
            <button
              onClick={onClose}
              aria-label={closeAriaLabel}
              className="shrink-0 ml-4 text-foreground-muted hover:text-foreground-muted text-lg leading-none"
            >
              &times;
            </button>
          </Tooltip>
        </div>

        {/* Body: column on mobile (chip row + results), row on lg (rail +
            results + detail). min-h-0 lets the inner columns scroll. */}
        <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
          {/* LEFT RAIL (lg and up) */}
          <aside className="hidden lg:flex lg:flex-col lg:w-[260px] lg:shrink-0 border-r border-border">
            <div className="p-4 border-b border-border flex flex-col gap-3">
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
            <div className="p-3 border-t border-border">
              <EnabledOnlyToggle
                on={enabledOnly}
                onToggle={() => onToggleEnabledOnly(!enabledOnly)}
              />
            </div>
          </aside>

          {/* MOBILE FILTER ROW (below lg) */}
          <div className="lg:hidden border-b border-border">
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
            {/* Orienting hint over the browse grid while nothing is selected.
                lg-only: that is where the collapsed detail pane frees the
                width, and the mobile browse view has no pane to reclaim. */}
            {noSelection && items.length > 0 && (
              <div className="hidden lg:flex items-center gap-2 mb-4 rounded-lg border border-border bg-surface-sunken px-3 py-2 text-meta text-foreground-muted">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  className="shrink-0 text-foreground-muted"
                >
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 16v-4M12 8h.01" />
                </svg>
                <span>{browseHint}</span>
              </div>
            )}
            {items.length === 0 ? (
              <div className="py-10 text-center text-body text-foreground-muted">
                {emptyState ?? "No results."}
              </div>
            ) : (
              <div className={gridClass}>
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
              <section className="mt-8 border-t border-border pt-6">
                {footerSlot}
              </section>
            )}
          </div>

          {/* RIGHT DETAIL PANE (lg and up). Collapsed entirely when nothing is
              selected so the center grid reclaims the width (the orienting
              hint over the grid covers the empty state instead). */}
          {selectedItem !== null && (
            <aside className="hidden lg:flex lg:flex-col lg:w-[40%] lg:shrink-0 border-l border-border overflow-auto">
              <div className="p-6">{renderDetail(selectedItem)}</div>
            </aside>
          )}
        </div>

        {/* MOBILE DETAIL OVERLAY (below lg): full-screen over the modal body
            when an item is selected. */}
        {selectedItem !== null && (
          <div className="lg:hidden absolute inset-0 z-10 bg-surface-raised flex flex-col">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
              <button
                type="button"
                onClick={() => onSelectItem(null)}
                className="inline-flex items-center gap-1 text-body text-foreground-muted hover:text-foreground"
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
      className={`w-full flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-body transition-colors ${
        active
          ? "bg-blue-50 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300 font-medium"
          : "text-foreground-muted hover:bg-surface-sunken"
      }`}
    >
      <span className="truncate">{label}</span>
      <span
        className={`shrink-0 rounded-full px-2 py-0.5 text-meta font-medium ${
          active ? "bg-blue-100 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300" : "bg-surface-sunken text-foreground-muted"
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
      className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-meta font-medium transition-colors ${
        active
          ? "bg-brand-action text-white"
          : "bg-surface-sunken text-foreground-muted hover:bg-surface-sunken"
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
        } text-body text-foreground-muted`}
      >
        <span
          className={`relative shrink-0 inline-flex h-5 w-9 items-center rounded-full transition-colors ${
            on ? "bg-brand-action" : "bg-gray-300"
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-surface-raised transition-transform ${
              on ? "translate-x-4" : "translate-x-0.5"
            }`}
          />
        </span>
        {!compact && <span>Enabled only</span>}
      </button>
    </Tooltip>
  );
}

export default StoreShell;
