"use client";

import { useEffect, useMemo, useState } from "react";
import Tooltip from "@/components/Tooltip";
import WidgetCard from "./WidgetCard";
import { WIDGET_CATALOG } from "./widgets/registry";
import {
  visibleCatalog,
  widgetHasSurface,
  type WidgetDefinition,
} from "./widgets/types";
import { useEnabledWidgets } from "@/hooks/useEnabledWidgets";
import {
  resolveEnabledWidgets,
} from "@/lib/lab-overview/widget-enablement";
import { buildRequestWidgetUrl } from "@/lib/lab-overview/request-widget";
import type { AccountType } from "@/lib/settings/user-settings";

/**
 * Widget store / library SHELL (Extension Store Phase U3, extension-store U3
 * bot, 2026-05-29).
 *
 * The widget companion to the U2 method library store
 * (`MethodTemplateLibraryModal`): mirror its modal shape (centered dialog,
 * intro copy, grouped grid, a request-a-new-one stub) so methods + widgets
 * feel like ONE store. The difference is the tile: this store renders the
 * rich `WidgetCard` (live `SnapshotTile` preview) so a PI browses widgets the
 * way they appear on the canvas, not as a flat checkbox list.
 *
 * Two curation axes, kept distinct (EXTENSION doc §3.5):
 *   - ENABLE / DISABLE (this store's switch): whether a widget is even OFFERED
 *     in this account's "+ Add widget" palette + store-default view. The new
 *     `enabledWidgets` curation layer. A DISABLED widget greys out here (the
 *     `WidgetCard` `disabled` prop) with an "Off" badge (`badgeSlot`) and its
 *     enable toggle; it is hidden from the palette entirely.
 *   - PIN / PLACE (the inline palette + drag): which enabled widgets are on
 *     the canvas, in what order. NOT this store's concern, the canvas owns it.
 *
 * ACCOUNT-AWARE: the store lists exactly the widgets the viewer's account type
 * + surface gating already allow (`visibleCatalog` + `widgetHasSurface` on the
 * supplied `surfaceKey`). It NEVER widens visibility, a member never sees a
 * PI-only widget in the store, enabled or not.
 *
 * Extensions remain code shipped in the reviewed build; this shell is curation
 * + a request stub, never a code loader (EXTENSION doc §1.5).
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

  // Account + surface gating, identical to the palette in SnapshotCanvas, so
  // the store never offers a widget the canvas would not.
  const eligible = useMemo(() => {
    const byAccount = visibleCatalog(WIDGET_CATALOG, accountType, surfaceKey);
    return byAccount.filter((w) => widgetHasSurface(w, surfaceKey));
  }, [accountType, surfaceKey]);

  // Group by Tool family, mirroring the palette's grouping so the two surfaces
  // read the same. Single-variant families fall into an "Other widgets"
  // catch-all.
  const groups = useMemo(() => groupByTool(eligible), [eligible]);

  // Close on Escape, matching the project's modal convention.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const curating = username !== null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full mx-4 max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h3 className="text-base font-semibold text-gray-900">
              Widget store
            </h3>
            <p className="text-xs text-gray-400 mt-0.5">
              Browse every widget for your dashboard and choose which ones to
              keep in your Add widget palette.
            </p>
          </div>
          <Tooltip label="Close" placement="bottom">
            <button
              onClick={onClose}
              aria-label="Close widget store"
              className="text-gray-400 hover:text-gray-600 text-lg"
            >
              &times;
            </button>
          </Tooltip>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-6">
          <p className="text-sm text-gray-500 mb-4">
            Turn off the widgets you never use to keep the Add widget palette
            short. Turning a widget off only stops it being offered here and in
            the palette; a widget already on your canvas keeps working until you
            remove it.
          </p>

          {eligible.length === 0 ? (
            <p className="text-sm text-gray-400 py-10 text-center">
              No widgets are available for your account on this surface.
            </p>
          ) : (
            groups.map((group) => (
              <section key={group.toolId} className="mb-8 last:mb-0">
                {groups.length > 1 && (
                  <h4 className="text-sm font-semibold text-gray-700 mb-3">
                    {group.label}
                  </h4>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {group.widgets.map((widget) => {
                    const on = enabledSet.has(widget.id);
                    return (
                      <WidgetCard
                        key={widget.id}
                        widget={widget}
                        // The store is a CURATION surface, not a placement
                        // one: "Add to canvas" is the palette's job. We
                        // repurpose the card's single affordance as the
                        // enable/disable toggle by driving `isMounted` from
                        // the enabled state and `onToggle` from the enablement
                        // setter. `disabled` greys a turned-off widget's
                        // preview footer; `badgeSlot` shows the On/Off pill.
                        isMounted={on}
                        disabled={!curating}
                        onToggle={() => {
                          if (!curating) return;
                          void setEnabled(widget.id, !on);
                        }}
                        badgeSlot={
                          <EnablementBadge on={on} curating={curating} />
                        }
                      />
                    );
                  })}
                </div>
              </section>
            ))
          )}

          {/* Request a new widget (STUB: opens a prefilled GitHub issue) */}
          <section className="mt-8 border-t border-gray-100 pt-6">
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
                  value={requestText}
                  onChange={(e) => setRequestText(e.target.value)}
                  placeholder="e.g. Freezer inventory low-stock alert"
                  aria-label="Describe the widget you want"
                  className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                />
              </div>
              <a
                href={buildRequestWidgetUrl({ description: requestText })}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1.5 text-sm bg-gray-900 text-white rounded-lg hover:bg-gray-800"
              >
                Request a widget
              </a>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

/** The On / Off curation pill rendered in the card's `badgeSlot`. Custom
 *  inline SVG dot, no emoji. */
function EnablementBadge({
  on,
  curating,
}: {
  on: boolean;
  curating: boolean;
}) {
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
          on
            ? "bg-blue-600 text-white"
            : "bg-gray-200 text-gray-600"
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

// ── Tool-family grouping (mirrors SnapshotCanvas.groupCatalogByTool) ─────────

interface WidgetGroup {
  toolId: string;
  label: string;
  widgets: WidgetDefinition[];
}

function groupByTool(catalog: WidgetDefinition[]): WidgetGroup[] {
  const byTool = new Map<string, WidgetDefinition[]>();
  for (const w of catalog) {
    const list = byTool.get(w.toolId);
    if (list) list.push(w);
    else byTool.set(w.toolId, [w]);
  }
  const multi: WidgetGroup[] = [];
  const singletons: WidgetDefinition[] = [];
  for (const [toolId, widgets] of byTool) {
    if (widgets.length > 1) {
      const label = widgets
        .map((w) => w.title)
        .reduce((a, b) => (b.length < a.length ? b : a));
      multi.push({ toolId, label, widgets });
    } else {
      singletons.push(widgets[0]);
    }
  }
  if (singletons.length > 0) {
    multi.push({
      toolId: "__other__",
      label: "Other widgets",
      widgets: singletons,
    });
  }
  return multi;
}
