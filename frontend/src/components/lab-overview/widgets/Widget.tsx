"use client";

import type { ReactNode } from "react";
import Tooltip from "@/components/Tooltip";

/**
 * Lab Mode retirement R2 (R2 widget framework manager, 2026-05-23) +
 * Widget canvas Phase A (Phase A redispatch manager, 2026-05-23):
 * the canonical widget frame. Every Lab Overview widget — canvas
 * snapshot tile or sidebar tile — renders inside this wrapper. The
 * popup chrome (`SnapshotTilePopup`) supplies its own header; this
 * frame is only used at the snapshot layer.
 *
 * The frame owns:
 *   - the card chrome (rounded white surface, soft shadow, border)
 *   - the header bar (title + drag affordance in edit mode)
 *   - the remove ("×") button (visible only in edit mode)
 *
 * Phase A: react-grid-layout is gone — the canvas is a CSS-grid of
 * tiles with native HTML5 drag-and-drop wired by the parent. The
 * frame's header still shows a drag-handle glyph in edit mode for
 * visual affordance, but the actual draggable attribute is on the
 * parent tile wrapper, not on the header.
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
  children,
}: WidgetFrameProps) {
  return (
    <div
      data-widget-id={id}
      className="h-full w-full flex flex-col bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden"
    >
      <header
        className={`flex items-center gap-2 border-b border-gray-100 ${
          surface === "sidebar" ? "px-2.5 py-1.5" : "px-3 py-2"
        } ${
          isEditing
            ? "cursor-grab active:cursor-grabbing select-none bg-gray-50"
            : "bg-white"
        }`}
      >
        {isEditing && (
          <span
            aria-hidden="true"
            className="text-gray-400 text-base leading-none"
            title="Drag to move"
          >
            {/* Six-dot grip glyph — universally legible as "drag handle". */}
            ⋮⋮
          </span>
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
