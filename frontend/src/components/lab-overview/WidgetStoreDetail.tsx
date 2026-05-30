"use client";

import { useRef } from "react";
import Tooltip from "@/components/Tooltip";
import {
  PreviewSkeleton,
  StaticHero,
  WidgetPreviewBoundary,
  useInViewport,
} from "./WidgetCard";
import { resolveToolTitle } from "@/lib/lab-overview/tool-registry";
import { widgetHasSurface, type WidgetDefinition } from "./widgets/types";

/**
 * Widget store DETAIL pane (Extension Store Phase D, store-detail bot,
 * 2026-05-30). Replaces the Phase B/C placeholder in the StoreShell's right
 * column. The payoff of the redesign: clicking a widget card fills this pane
 * with a LARGE live preview, a "what it does / when to use it" blurb, the
 * concrete metadata (the Tool it opens, the surfaces it can mount on, who can
 * see it), and the On/Off enable toggle.
 *
 * The live preview reuses the EXACT primitives the card uses (the
 * `WidgetPreviewBoundary` error boundary + the `useInViewport` lazy-mount, both
 * exported from WidgetCard), rendered at a larger scale than the card's 0.62x
 * thumbnail so the widget reads as a real tile here. The preview never fires
 * its data queries until the pane scrolls into view, and a throwing tile falls
 * back to the static glyph + description instead of tearing down the store.
 *
 * Curation lives elsewhere (the `enabledWidgets` layer + `useEnabledWidgets`
 * setter): this pane only RENDERS and TRIGGERS. `onToggle` is the same setter
 * the card uses, threaded down from the modal.
 */

export function WidgetStoreDetail({
  widget,
  on,
  curating,
  onToggle,
}: {
  widget: WidgetDefinition;
  /** Is the widget currently enabled in the user's palette? */
  on: boolean;
  /** False when signed out / pre-data-setup: the toggle can't persist. */
  curating: boolean;
  /** Flip the widget's enabled state. Same setter the card's badge uses. */
  onToggle: (next: boolean) => void;
}) {
  const toolTitle = resolveToolTitle(widget);
  const surfaces = SURFACE_ROWS.filter((s) => widgetHasSurface(widget, s.key));

  const enableToggle = (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={`${on ? "Disable" : "Enable"} ${widget.title}`}
      disabled={!curating}
      onClick={() => {
        if (!curating) return;
        onToggle(!on);
      }}
      className="inline-flex w-full items-center justify-between gap-3 rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span>
        {on ? "In your Add widget palette" : "Hidden from your palette"}
      </span>
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
    </button>
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Title + On/Off status pill */}
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

      {/* LARGE live preview. Bigger than the card's 0.62x thumbnail, inside the
          shared error boundary + lazy-mount. */}
      <WidgetLivePreview widget={widget} />

      {/* What it does / when to use it. description = the one-liner; helpText =
          the fuller "what is this / who sees it / main action" copy. */}
      <section className="flex flex-col gap-2">
        <h5 className="text-xs font-semibold uppercase tracking-wide text-gray-400">
          What it does
        </h5>
        {widget.description && (
          <p className="text-sm text-gray-700 leading-snug">
            {widget.description}
          </p>
        )}
        {widget.helpText && (
          <p className="text-sm text-gray-500 leading-snug">{widget.helpText}</p>
        )}
        {!widget.description && !widget.helpText && (
          <p className="text-sm text-gray-400">
            No description provided for this widget yet.
          </p>
        )}
      </section>

      {/* Metadata rows. */}
      <section className="border-t border-gray-100 pt-3">
        <dl className="flex flex-col gap-2 text-sm">
          <MetaRow label="Opens">{toolTitle}</MetaRow>
          <MetaRow label="Surfaces">
            {surfaces.length > 0 ? (
              <span className="flex flex-wrap gap-1">
                {surfaces.map((s) => (
                  <span
                    key={s.key}
                    className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600"
                  >
                    {s.label}
                  </span>
                ))}
              </span>
            ) : (
              <span className="text-gray-400">None</span>
            )}
          </MetaRow>
          <MetaRow label="Visible to">{visibilityLabel(widget)}</MetaRow>
        </dl>
      </section>

      {/* Footer action: the On/Off enable toggle (same setter as the card).
          Signed-out / pre-data-setup, the toggle can't persist, so it disables
          and explains why via a Tooltip; while curating it stands alone. */}
      <section className="border-t border-gray-100 pt-4">
        {curating ? (
          enableToggle
        ) : (
          <Tooltip label="Sign in to change this" placement="top">
            {enableToggle}
          </Tooltip>
        )}
      </section>
    </div>
  );
}

/** The supported-surface map, rendered as small pills. */
const SURFACE_ROWS: { key: "canvas" | "sidebar" | "home"; label: string }[] = [
  { key: "canvas", label: "Lab overview canvas" },
  { key: "home", label: "Home" },
  { key: "sidebar", label: "Sidebar rail" },
];

/** Plain-language member/PI visibility. `memberVisible` gates the member
 *  catalog; `labHeadVisible` (default true) gates the PI catalog. */
function visibilityLabel(widget: WidgetDefinition): string {
  const piVisible = widget.labHeadVisible !== false;
  if (widget.memberVisible && piVisible) return "PI and lab members";
  if (widget.memberVisible) return "Lab members only";
  if (piVisible) return "PI only";
  return "Hidden";
}

/** A definition-list row: a fixed-width label and free-form value. */
function MetaRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <dt className="w-24 shrink-0 text-xs font-medium uppercase tracking-wide text-gray-400 pt-0.5">
        {label}
      </dt>
      <dd className="flex-1 min-w-0 text-gray-700">{children}</dd>
    </div>
  );
}

/**
 * Large live `SnapshotTile`, lazily mounted + error-boundaried with the SAME
 * primitives the card uses. Rendered at full tile scale inside a taller box so
 * it reads as a real widget, not a thumbnail. Non-interactive (pointer-events
 * off + aria-hidden) so the tile's own click-to-open can't fire from here.
 */
function WidgetLivePreview({ widget }: { widget: WidgetDefinition }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const inView = useInViewport(ref);
  const Tile = widget.SnapshotTile;
  const staticHero = <StaticHero widget={widget} />;
  return (
    <div
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none relative h-56 overflow-hidden rounded-xl border border-gray-100 bg-gray-50/60 select-none"
    >
      {inView ? (
        <WidgetPreviewBoundary fallback={staticHero}>
          <div className="absolute inset-0 p-4">
            <Tile surface="canvas" />
          </div>
        </WidgetPreviewBoundary>
      ) : (
        <PreviewSkeleton />
      )}
    </div>
  );
}

export default WidgetStoreDetail;
