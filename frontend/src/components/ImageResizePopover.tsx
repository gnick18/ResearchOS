"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const RESIZE_PERCENTAGES = [25, 50, 75, 100] as const;

/** Bounds for the custom-percentage input (Grant 2026-05-27). Min 1 so
 *  the image never collapses to nothing; max 100 because width is a
 *  percentage of the editor's content column and >100 would overflow
 *  the page. The preset buttons (25/50/75/100) stay as quick picks; the
 *  custom field covers every value in between (e.g. 33, 60, 90). */
const CUSTOM_MIN = 1;
const CUSTOM_MAX = 100;

function clampCustom(n: number): number {
  if (Number.isNaN(n)) return CUSTOM_MIN;
  return Math.max(CUSTOM_MIN, Math.min(CUSTOM_MAX, Math.round(n)));
}

interface ImageResizePopoverProps {
  /** Viewport-relative position (pixels) where the popover should initially appear. */
  x: number;
  y: number;
  /** Currently applied width percentage, or null if none. */
  currentWidth: number | null;
  onSelect: (width: number | null) => void;
  onClose: () => void;
  /**
   * When provided, the popover shows an "Annotate" action that opens the photo
   * annotation editor for the clicked image. The caller (an editor surface
   * that knows the basePath + filename) owns mounting the modal. Omitted when
   * the surface cannot address the image on disk.
   */
  onAnnotate?: () => void;
}

export default function ImageResizePopover({
  x,
  y,
  currentWidth,
  onSelect,
  onClose,
  onAnnotate,
}: ImageResizePopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x, y });
  // Custom-percentage input (Grant 2026-05-27). Seeded from the current
  // width so re-opening the popover on a custom-sized image shows the
  // active value. Empty string when there's no width set yet.
  const [customInput, setCustomInput] = useState<string>(
    currentWidth !== null ? String(currentWidth) : "",
  );

  const applyCustom = useCallback(() => {
    const trimmed = customInput.trim();
    if (trimmed === "") return;
    const parsed = clampCustom(Number(trimmed));
    setCustomInput(String(parsed));
    onSelect(parsed);
  }, [customInput, onSelect]);

  // Outside click + Escape close
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onClose();
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  // After mount and whenever position changes, clamp to the viewport so the
  // popover can never get cut off at the edges.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pad = 8;
    const maxX = window.innerWidth - rect.width - pad;
    const maxY = window.innerHeight - rect.height - pad;
    const clampedX = Math.max(pad, Math.min(position.x, maxX));
    const clampedY = Math.max(pad, Math.min(position.y, maxY));
    if (clampedX !== position.x || clampedY !== position.y) {
      setPosition({ x: clampedX, y: clampedY });
    }
  }, [position.x, position.y]);

  // Drag handle behavior — attach document-level listeners on mousedown so the
  // drag continues even if the cursor leaves the popover.
  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startMouseX = e.clientX;
      const startMouseY = e.clientY;
      const startPosX = position.x;
      const startPosY = position.y;

      const onMove = (ev: MouseEvent) => {
        setPosition({
          x: startPosX + (ev.clientX - startMouseX),
          y: startPosY + (ev.clientY - startMouseY),
        });
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [position.x, position.y],
  );

  return (
    <div
      ref={ref}
      data-tour-target="hybrid-editor-resize-handle"
      className="fixed z-50 bg-surface-raised border border-border rounded-lg shadow-xl min-w-[160px] select-none"
      style={{ top: position.y, left: position.x }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Drag handle */}
      <div
        onMouseDown={handleDragStart}
        className="flex items-center justify-between px-2 py-1.5 border-b border-border cursor-move bg-surface-sunken rounded-t-lg"
        title="Drag to move"
      >
        <span className="text-meta uppercase tracking-wide text-foreground-muted">
          Image size
        </span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="currentColor"
          className="text-foreground-muted"
          aria-hidden
        >
          <circle cx="9" cy="6" r="1.4" />
          <circle cx="9" cy="12" r="1.4" />
          <circle cx="9" cy="18" r="1.4" />
          <circle cx="15" cy="6" r="1.4" />
          <circle cx="15" cy="12" r="1.4" />
          <circle cx="15" cy="18" r="1.4" />
        </svg>
      </div>
      <div className="flex flex-col p-2">
        {RESIZE_PERCENTAGES.map((pct) => {
          const isCurrent = currentWidth === pct;
          return (
            <button
              key={pct}
              type="button"
              onClick={() => onSelect(pct)}
              data-tour-target={`hybrid-editor-resize-percent-${pct}`}
              className={`flex items-center gap-2 px-2 py-1 rounded text-left text-meta transition-colors ${
                isCurrent
                  ? "bg-blue-50 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300 font-medium"
                  : "text-foreground hover:bg-blue-50 dark:hover:bg-brand-action/20"
              }`}
            >
              <span className="w-3 h-3 inline-flex items-center justify-center rounded-full border border-border">
                {isCurrent && <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />}
              </span>
              <span>{pct}%</span>
            </button>
          );
        })}
        {/* Custom percentage (Grant 2026-05-27): type any value 1-100
            for finer control than the preset quick-picks. Applies on
            Enter or the Set button. The radio dot lights when the
            current width is a non-preset value. */}
        <div className="mt-1 pt-1.5 border-t border-border">
          <div className="flex items-center gap-2 px-2 py-1">
            <span
              className="w-3 h-3 inline-flex items-center justify-center rounded-full border border-border shrink-0"
              aria-hidden
            >
              {currentWidth !== null &&
                !RESIZE_PERCENTAGES.includes(
                  currentWidth as (typeof RESIZE_PERCENTAGES)[number],
                ) && (
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                )}
            </span>
            <label className="text-meta text-foreground shrink-0">Custom</label>
            <input
              type="number"
              min={CUSTOM_MIN}
              max={CUSTOM_MAX}
              inputMode="numeric"
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  applyCustom();
                }
              }}
              placeholder="%"
              aria-label="Custom width percentage"
              className="w-12 px-1.5 py-0.5 text-meta border border-border rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
            <span className="text-meta text-foreground-muted">%</span>
            <button
              type="button"
              onClick={applyCustom}
              className="ml-auto px-2 py-0.5 text-meta rounded bg-blue-50 dark:bg-brand-action/15 text-blue-700 dark:text-blue-300 font-medium hover:bg-blue-100 dark:hover:bg-brand-action/20 transition-colors"
            >
              Set
            </button>
          </div>
        </div>
        {currentWidth !== null && (
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="flex items-center gap-2 px-2 py-1 mt-1 pt-1.5 rounded text-left text-meta text-foreground hover:bg-blue-50 dark:hover:bg-brand-action/20 border-t border-border transition-colors"
          >
            <span className="w-3 h-3 inline-flex items-center justify-center rounded-full border border-border" />
            <span>Remove width</span>
          </button>
        )}
        {onAnnotate && (
          <button
            type="button"
            onClick={onAnnotate}
            className="flex items-center gap-2 px-2 py-1.5 mt-1 pt-1.5 rounded text-left text-meta font-medium text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-brand-action/20 border-t border-border transition-colors"
          >
            {/* Pencil icon (custom inline SVG, no icon library). */}
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z" />
            </svg>
            <span>Annotate</span>
          </button>
        )}
      </div>
    </div>
  );
}
