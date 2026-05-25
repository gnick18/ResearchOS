"use client";

import type { ReactNode } from "react";
import Tooltip from "@/components/Tooltip";

/**
 * Lab Mode retirement R2 (R2 widget framework manager, 2026-05-23):
 * the canonical widget frame. Every Lab Overview widget — canvas or
 * sidebar — renders inside this wrapper.
 *
 * The frame owns:
 *   - the card chrome (rounded white surface, soft shadow, border)
 *   - the header bar (title + drag handle in edit mode)
 *   - the remove ("×") button (visible only in edit mode)
 *   - the resize visual hint (a tiny corner glyph; the actual resize
 *     handle is added by react-grid-layout when `isEditing` is true)
 *
 * Widget bodies render in the content slot and are completely free of
 * drag / resize concerns: react-grid-layout sees the parent `<div>` we
 * mount via WidgetCanvas and attaches handles automatically. The drag
 * handle inside this frame is wired via the `.lab-widget-drag-handle`
 * class so react-grid-layout's `draggableHandle` prop picks it up,
 * which is what keeps clicks inside the widget body (comment rows,
 * link cards, etc.) from accidentally starting a drag.
 */
export interface WidgetFrameProps {
  /** Stable widget id — used by the canvas to wire grid positioning. */
  id: string;
  /** Header label. */
  title: string;
  /** Optional one-line subtitle in the header (e.g. an unread count). */
  subtitle?: string;
  /** True when the surface is in edit mode. Drag handle + remove
   *  button only render when this is on. */
  isEditing: boolean;
  /** Called when the user clicks the "×" button (edit mode only). */
  onRemove?: () => void;
  /** When mounted inside a sidebar rail, the body padding shrinks to
   *  fit the narrower column. */
  surface: "canvas" | "sidebar";
  /**
   * Optional tour-surface tag (home widgets surface-prep manager,
   * 2026-05-25). When mounted inside the /home page's widget canvas
   * (where `surface` is still `"canvas"` for layout-shape parity), the
   * caller passes `tourSurface="home"` so the drag-handle header
   * stamps the §6.2b walkthrough's `home-widget-drag-handle` anchor.
   * Defaults to undefined, in which case no tour anchor is stamped.
   */
  tourSurface?: "home";
  /** The widget body. */
  children: ReactNode;
}

export default function Widget({
  id,
  title,
  subtitle,
  isEditing,
  onRemove,
  surface,
  tourSurface,
  children,
}: WidgetFrameProps) {
  // §6.2b Home widgets walkthrough anchor (home widgets surface-prep
  // manager, 2026-05-25). The drag handle is the entire header bar
  // (the `.lab-widget-drag-handle` class react-grid-layout watches).
  // When mounted on /home in edit mode the header stamps
  // `home-widget-drag-handle` so the §6.2b reorder demo can find and
  // grab it. Off-home (or out of edit mode) no tour anchor is stamped.
  const tourDragHandle =
    tourSurface === "home" && isEditing ? "home-widget-drag-handle" : undefined;
  return (
    <div
      data-widget-id={id}
      className="h-full w-full flex flex-col bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden"
    >
      <header
        data-tour-target={tourDragHandle}
        className={`flex items-center gap-2 border-b border-gray-100 ${
          surface === "sidebar" ? "px-2.5 py-1.5" : "px-3 py-2"
        } ${
          isEditing
            ? "lab-widget-drag-handle cursor-grab active:cursor-grabbing select-none bg-blue-50/40 hover:bg-blue-50 ring-1 ring-blue-200 transition-colors"
            : "bg-white"
        }`}
      >
        {isEditing && (
          // UI affordance fix (break-bot Bug 5, 2026-05-24): the drag
          // handle was a tiny `⋮⋮` text glyph that's easy to miss. The
          // six-dot grip SVG below matches the standard "drag handle"
          // affordance used across Notion / Linear / GitHub. The whole
          // header bar is the drag surface (via the .lab-widget-drag-handle
          // class react-grid-layout watches), and now also wears a soft
          // blue tint + ring in edit mode so the surface itself signals
          // "draggable" alongside the explicit grip glyph + grab cursor.
          <Tooltip label="Drag to move" placement="top">
            <span
              aria-hidden="true"
              className="text-blue-500 flex items-center justify-center"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <circle cx="9" cy="5" r="1.7" />
                <circle cx="9" cy="12" r="1.7" />
                <circle cx="9" cy="19" r="1.7" />
                <circle cx="15" cy="5" r="1.7" />
                <circle cx="15" cy="12" r="1.7" />
                <circle cx="15" cy="19" r="1.7" />
              </svg>
            </span>
          </Tooltip>
        )}
        <h2
          className={`flex-1 min-w-0 truncate font-semibold text-gray-900 ${
            surface === "sidebar" ? "text-xs" : "text-sm"
          }`}
        >
          {title}
        </h2>
        {subtitle && (
          <span className="text-xs text-gray-500 truncate">{subtitle}</span>
        )}
        {isEditing && onRemove && (
          <Tooltip label="Remove widget" placement="left">
            <button
              type="button"
              aria-label={`Remove ${title} widget`}
              className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors"
              onClick={(e) => {
                // Drag-handle parent has onMouseDown handling from
                // react-grid-layout. stopPropagation keeps the remove
                // click from starting a phantom drag.
                e.stopPropagation();
                onRemove();
              }}
              // onMouseDown also stops propagation: react-grid-layout
              // initiates drag on mousedown, not click.
              onMouseDown={(e) => e.stopPropagation()}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="6" y1="6" x2="18" y2="18" />
                <line x1="6" y1="18" x2="18" y2="6" />
              </svg>
            </button>
          </Tooltip>
        )}
      </header>
      <div
        className={`flex-1 min-h-0 overflow-auto ${
          surface === "sidebar" ? "p-2" : "p-3"
        }`}
      >
        {children}
      </div>
    </div>
  );
}
