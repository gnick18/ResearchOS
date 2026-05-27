"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Tooltip from "@/components/Tooltip";
import { PopupActionsProvider } from "@/lib/lab-overview/popup-actions";

/**
 * Window CustomEvent names dispatched by SnapshotTilePopup when it
 * mounts / unmounts (widget tile-anatomy fix manager, 2026-05-27).
 *
 * Why: the §6.2b `home-widgets-tile-anatomy` step spotlights the tile
 * the cursor demo clicks. Once the popup overlays the tile, the
 * spotlight ring is hidden behind the popup chrome but still pulsing
 * on the tile beneath it — visually noisy and confusing because the
 * "active surface" has moved to the popup. TourSpotlight subscribes
 * to these events so it can suppress the ring while the popup is up
 * and re-show it once the popup closes (the spotlight resumes
 * pointing at the tile the user just interacted with).
 *
 * Generic across all SnapshotTilePopup consumers (canvas + sidebar +
 * tools launcher). If a future step ever WANTS the spotlight ring on
 * a tile to persist behind the popup, this attribute-driven shape
 * means the step body can opt out (e.g. by not using TourSpotlight at
 * all, or by mounting its own spotlight portal). Today's behaviour:
 * the dashboard tile popup always asks the spotlight to hide.
 */
export const SNAPSHOT_TILE_POPUP_OPENED_EVENT = "tour:snapshot-tile-popup-opened";
export const SNAPSHOT_TILE_POPUP_CLOSED_EVENT = "tour:snapshot-tile-popup-closed";

/**
 * Widget canvas Phase A (Phase A redispatch manager, 2026-05-23):
 * the popup shell that opens when the user clicks a snapshot tile on
 * either the canvas or the sidebar.
 *
 * The shell mirrors the pattern in `TaskDetailPopup` / `NoteDetailPopup`:
 *   - fixed inset overlay with backdrop blur + dim
 *   - click-outside closes (the backdrop click handler)
 *   - Escape closes (or exits fullscreen first when expanded)
 *   - title + close ("×") button + fullscreen toggle in the header
 *   - body slot for the widget's `ExpandedView`
 *
 * z-index 500: deliberately ABOVE the InputLockOverlay (z=420) so the
 * popup stays interactive when the tour-mode cursor lock is active.
 * The detail popups today sit at z=50/60, but the snapshot popup is
 * its own surface mounted from a dashboard tile rather than a row
 * click, so we keep it visually distinct and above the lock chrome.
 *
 * Phase A only renders the shell; the body is whatever
 * `ExpandedView` the caller passes. Phase B can layer per-widget
 * popup chrome (custom toolbars, filters in the header, etc.) by
 * extending the props here without changing widget bodies.
 */
export interface SnapshotTilePopupProps {
  /** Header label — the widget's title from the registry. */
  title: string;
  /** Called when the user closes the popup (Escape, backdrop click, or
   *  the close button). */
  onClose: () => void;
  /** The expanded view to render inside the popup. */
  children: ReactNode;
}

export default function SnapshotTilePopup({
  title,
  onClose,
  children,
}: SnapshotTilePopupProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  // Saves the element that opened the popup so Escape can restore
  // focus after close — same accessibility pattern the detail popups
  // use. Captured on mount; the ref keeps the closure stable.
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    restoreFocusRef.current = (document.activeElement as HTMLElement | null) ?? null;
    return () => {
      try {
        restoreFocusRef.current?.focus?.();
      } catch {
        // best-effort focus restore — never throw on unmount
      }
    };
  }, []);

  // Tour spotlight bridge (widget tile-anatomy fix manager, 2026-05-27).
  // Dispatches mount/unmount events on window so TourSpotlight can
  // suppress the spotlight ring while the popup is open and bring it
  // back when the user dismisses the popup. Outside tour mode the
  // events are inert (TourSpotlight is not mounted) so this is a free
  // no-op for the rest of the app.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.dispatchEvent(new CustomEvent(SNAPSHOT_TILE_POPUP_OPENED_EVENT));
    } catch {
      // best-effort dispatch — never throw from a mount effect
    }
    return () => {
      try {
        window.dispatchEvent(new CustomEvent(SNAPSHOT_TILE_POPUP_CLOSED_EVENT));
      } catch {
        // best-effort dispatch — never throw from an unmount cleanup
      }
    };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      // Escape exits fullscreen first (matches TaskDetailPopup) so the
      // user can collapse the chrome without losing the popup.
      if (isExpanded) {
        setIsExpanded(false);
      } else {
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isExpanded, onClose]);

  return (
    <div
      // z=440: above InputLockOverlay (420) so the popup stays interactive
      // inside the v4 tour, and above standard detail popups (50/60), but
      // BELOW the tour speech bubble (450) so tour spotlights anchored on
      // the tile do not get occluded. Outside tour mode, InputLockOverlay
      // is not mounted, so this remains the topmost surface for the
      // dashboard.
      className="fixed inset-0 z-[440] flex items-center justify-center bg-black/40 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      // Marker for TourSpotlight (widget tile-anatomy fix manager,
      // 2026-05-27). When this attribute is present anywhere in the
      // DOM, the spotlight ring suppresses itself (it would otherwise
      // pulse behind the popup chrome, visually noisy + confusing).
      // Once the popup unmounts the attribute goes with it and the
      // spotlight resumes tracking its anchor.
      data-tour-popup-occluding="snapshot-tile"
      onClick={onClose}
    >
      <div
        className={`bg-white rounded-2xl shadow-2xl w-full mx-4 flex flex-col transition-all duration-200 overflow-hidden ${
          isExpanded
            ? "inset-4 max-w-none max-h-none h-[calc(100vh-2rem)]"
            : "max-w-5xl h-[85vh] max-h-[860px]"
        }`}
        style={{
          boxShadow:
            "0 1px 3px rgba(0,0,0,0.06), 0 20px 50px -10px rgba(0,0,0,0.25)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 flex-shrink-0">
          <h2 className="flex-1 min-w-0 truncate text-base font-semibold text-gray-900">
            {title}
          </h2>
          <Tooltip
            label={isExpanded ? "Exit fullscreen" : "Fullscreen"}
            placement="bottom"
          >
            <button
              type="button"
              onClick={() => setIsExpanded((v) => !v)}
              aria-label={isExpanded ? "Exit fullscreen" : "Fullscreen"}
              className="text-gray-400 hover:text-gray-600 hover:bg-gray-100 p-1.5 rounded-lg transition-colors"
            >
              {isExpanded ? (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
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
                  <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
                </svg>
              ) : (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
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
                  <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
                </svg>
              )}
            </button>
          </Tooltip>
          <Tooltip label="Close" placement="bottom">
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="text-gray-400 hover:text-gray-600 hover:bg-gray-100 p-1.5 rounded-lg transition-colors"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
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
                <line x1="6" y1="6" x2="18" y2="18" />
                <line x1="6" y1="18" x2="18" y2="6" />
              </svg>
            </button>
          </Tooltip>
        </header>
        <div className="flex-1 min-h-0 overflow-auto p-4">
          {/* PopupActionsProvider lets the ExpandedView body call
              `closePopup()` before navigating away (see
              popup-close hook manager note in popup-actions.tsx).
              Wrapping here means every consumer surface (canvas,
              sidebar, tools launcher) gets the provider for free. */}
          <PopupActionsProvider closePopup={onClose}>
            {children}
          </PopupActionsProvider>
        </div>
      </div>
    </div>
  );
}
