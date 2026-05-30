"use client";

import { useMemo, useState } from "react";
import Tooltip from "@/components/Tooltip";
import { StoreShell } from "@/components/store/StoreShell";
import WidgetCard from "./WidgetCard";
import { WIDGET_CATALOG } from "./widgets/registry";
import {
  visibleCatalog,
  widgetHasSurface,
  type WidgetDefinition,
} from "./widgets/types";
import {
  filterWidgetStore,
  groupWidgetsByTool,
} from "./widget-store-filter";
import { useEnabledWidgets } from "@/hooks/useEnabledWidgets";
import { resolveEnabledWidgets } from "@/lib/lab-overview/widget-enablement";
import { buildRequestWidgetUrl } from "@/lib/lab-overview/request-widget";
import type { AccountType } from "@/lib/settings/user-settings";

/**
 * Widget store (Extension Store Phase B, store-shell bot, 2026-05-29).
 *
 * Adopts the shared master/detail `StoreShell` so the widget store and the
 * method library read as ONE marketplace. The widget-specific pieces stay
 * here: the rich `WidgetCard` (live `SnapshotTile` preview), the Tool-family
 * categories, and the enable/disable curation (unchanged from before, driven
 * by `useEnabledWidgets`). The shell owns the wide three-column frame, the
 * category rail, the detail pane, and the responsive collapse.
 *
 * Phase C makes the navigation real: the search box filters the center list
 * live (title / description / toolId), the Tool-family categories narrow it
 * with live per-category counts, and "Enabled only" shows just the enabled
 * widgets. The detail pane stays the Phase B placeholder (Phase D fills it).
 * The widget store has a single kind, so it passes NO rail-header segment.
 *
 * Two curation axes, kept distinct (EXTENSION doc): ENABLE / DISABLE (this
 * store's switch, the `enabledWidgets` layer) vs PIN / PLACE (the canvas
 * palette + drag, NOT this store's concern). A disabled widget greys out here
 * with an "Off" badge and is hidden from the palette entirely.
 *
 * ACCOUNT-AWARE: the store lists exactly the widgets the viewer's account type
 * + surface gating already allow; it never widens visibility.
 */

export function WidgetStoreModal({
  username,
  accountType,
  surfaceKey,
  onClose,
}: {
  username: string | null;
  accountType: AccountType;
  /** Which surface's eligibility to browse (the canvas adapter's resolved
   *  key). The store shows only widgets eligible on this surface so it stays
   *  consistent with the palette it launches alongside. */
  surfaceKey: "canvas" | "home";
  onClose: () => void;
}) {
  const { raw: enabledRaw, setEnabled } = useEnabledWidgets(username);
  const enabledSet = useMemo(
    () => resolveEnabledWidgets(enabledRaw),
    [enabledRaw],
  );

  const [requestText, setRequestText] = useState("");
  const [search, setSearch] = useState("");
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(
    null,
  );
  const [enabledOnly, setEnabledOnly] = useState(false);
  const [selected, setSelected] = useState<WidgetDefinition | null>(null);

  const curating = username !== null;

  // Account + surface gating, identical to the palette in SnapshotCanvas, so
  // the store never offers a widget the canvas would not.
  const eligible = useMemo(() => {
    const byAccount = visibleCatalog(WIDGET_CATALOG, accountType, surfaceKey);
    return byAccount.filter((w) => widgetHasSurface(w, surfaceKey));
  }, [accountType, surfaceKey]);

  // Group by Tool family once, from the full eligible catalog, so the category
  // SET stays stable while the user types. Single-variant families fall into
  // an "Other widgets" catch-all.
  const groups = useMemo(() => groupWidgetsByTool(eligible), [eligible]);

  // One pure pass computes the rail categories (with live counts reflecting
  // search + enabled-only) and the center-column items (search + enabled-only
  // + selected category). See widget-store-filter.ts.
  const { categories, items } = useMemo(
    () =>
      filterWidgetStore({
        eligible,
        groups,
        query: search,
        enabledOnly,
        enabledIds: enabledSet,
        selectedCategoryId,
      }),
    [eligible, groups, search, enabledOnly, enabledSet, selectedCategoryId],
  );

  return (
    <StoreShell<WidgetDefinition>
      title="Widget store"
      subtitle="Browse every widget for your dashboard and choose which ones to keep in your Add widget palette."
      closeAriaLabel="Close widget store"
      categories={categories}
      allLabel="All widgets"
      selectedCategoryId={selectedCategoryId}
      onSelectCategory={setSelectedCategoryId}
      searchSlot={<WidgetSearchInput value={search} onChange={setSearch} />}
      enabledOnly={enabledOnly}
      onToggleEnabledOnly={setEnabledOnly}
      items={items}
      getItemKey={(w) => w.id}
      selectedItem={selected}
      onSelectItem={setSelected}
      detailEmptyHint="Select a widget to see details."
      emptyState={
        eligible.length === 0
          ? "No widgets are available for your account on this surface."
          : "No widgets match this filter."
      }
      renderCard={(widget, { selected: isSelected, onSelect }) => {
        const on = enabledSet.has(widget.id);
        return (
          <div
            role="button"
            tabIndex={0}
            onClick={onSelect}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect();
              }
            }}
            className={`cursor-pointer rounded-xl transition-shadow ${
              isSelected ? "ring-2 ring-blue-500 ring-offset-2" : ""
            }`}
          >
            <WidgetCard
              widget={widget}
              // The store is a CURATION surface, not a placement one:
              // "Add to canvas" is the palette's job. We repurpose the card's
              // single affordance as the enable/disable toggle by driving
              // `isMounted` from the enabled state and `onToggle` from the
              // enablement setter. `disabled` greys a turned-off widget's
              // preview footer; `badgeSlot` shows the On/Off pill.
              isMounted={on}
              disabled={!curating}
              onToggle={() => {
                if (!curating) return;
                void setEnabled(widget.id, !on);
              }}
              badgeSlot={<EnablementBadge on={on} curating={curating} />}
            />
          </div>
        );
      }}
      renderDetail={(widget) => (
        <WidgetDetailPlaceholder
          widget={widget}
          on={enabledSet.has(widget.id)}
        />
      )}
      footerSlot={
        <RequestWidgetStub value={requestText} onChange={setRequestText} />
      }
      onClose={onClose}
    />
  );
}

/** Search box for the rail. State is owned by the caller; the filtering runs
 *  in filterWidgetStore over title / description / toolId. */
function WidgetSearchInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">
        Search widgets
      </label>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search by name or tool..."
        aria-label="Search widgets"
        className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30"
      />
    </div>
  );
}

/** Minimal Phase B detail placeholder. Phase D replaces this with a large
 *  live preview, a "what it does" blurb, metadata, and the enable toggle. */
function WidgetDetailPlaceholder({
  widget,
  on,
}: {
  widget: WidgetDefinition;
  on: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <h4 className="text-base font-semibold text-gray-900">
          {widget.title}
        </h4>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
            on ? "bg-blue-600 text-white" : "bg-gray-200 text-gray-600"
          }`}
        >
          {on ? "On" : "Off"}
        </span>
      </div>
      {widget.description && (
        <p className="text-sm text-gray-600 leading-snug">
          {widget.description}
        </p>
      )}
      {widget.helpText && (
        <p className="text-xs text-gray-500 leading-snug">{widget.helpText}</p>
      )}
      <p className="text-xs text-gray-400 border-t border-gray-100 pt-3">
        A large live preview and full details arrive in the next update.
      </p>
    </div>
  );
}

/** Request-a-new-widget stub (opens a prefilled GitHub issue). Lives in the
 *  shell's footer slot. */
function RequestWidgetStub({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <h4 className="text-sm font-semibold text-gray-700 mb-1">
        Need a widget that isn&apos;t here?
      </h4>
      <p className="text-xs text-gray-400 mb-3">
        Widgets are built and reviewed on GitHub, then ship in an update.
        Describe what you need and we&apos;ll open an issue for you.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[220px]">
          <label className="block text-xs font-medium text-gray-500 mb-1">
            What widget do you want?
          </label>
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="e.g. Freezer inventory low-stock alert"
            aria-label="Describe the widget you want"
            className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30"
          />
        </div>
        <a
          href={buildRequestWidgetUrl({ description: value })}
          target="_blank"
          rel="noopener noreferrer"
          className="px-3 py-1.5 text-sm bg-gray-900 text-white rounded-lg hover:bg-gray-800"
        >
          Request a widget
        </a>
      </div>
    </div>
  );
}

/** The On / Off curation pill rendered in the card's `badgeSlot`. Custom
 *  inline SVG dot, no emoji. */
function EnablementBadge({ on, curating }: { on: boolean; curating: boolean }) {
  return (
    <Tooltip
      label={
        curating
          ? on
            ? "In your Add widget palette. Click the card action to turn off."
            : "Hidden from your Add widget palette. Click the card action to turn on."
          : "Sign in to change this"
      }
      placement="left"
    >
      <span
        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium shadow-sm ${
          on ? "bg-blue-600 text-white" : "bg-gray-200 text-gray-600"
        }`}
      >
        <svg
          width="8"
          height="8"
          viewBox="0 0 8 8"
          aria-hidden="true"
          className={on ? "text-white" : "text-gray-500"}
        >
          <circle cx="4" cy="4" r="4" fill="currentColor" />
        </svg>
        {on ? "On" : "Off"}
      </span>
    </Tooltip>
  );
}
