"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const RESIZE_PERCENTAGES = [25, 50, 75, 100] as const;

interface ImageResizePopoverProps {
  /** Viewport-relative position (pixels) where the popover should initially appear. */
  x: number;
  y: number;
  /** Currently applied width percentage, or null if none. */
  currentWidth: number | null;
  onSelect: (width: number | null) => void;
  onClose: () => void;
}

export default function ImageResizePopover({
  x,
  y,
  currentWidth,
  onSelect,
  onClose,
}: ImageResizePopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x, y });

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
      className="fixed z-50 bg-white border border-gray-200 rounded-lg shadow-xl min-w-[160px] select-none"
      style={{ top: position.y, left: position.x }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Drag handle */}
      <div
        onMouseDown={handleDragStart}
        className="flex items-center justify-between px-2 py-1.5 border-b border-gray-100 cursor-move bg-gray-50 rounded-t-lg"
        title="Drag to move"
      >
        <span className="text-[11px] uppercase tracking-wide text-gray-500">
          Image size
        </span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="currentColor"
          className="text-gray-400"
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
              className={`flex items-center gap-2 px-2 py-1 rounded text-left text-xs transition-colors ${
                isCurrent
                  ? "bg-blue-50 text-blue-700 font-medium"
                  : "text-gray-700 hover:bg-blue-50"
              }`}
            >
              <span className="w-3 h-3 inline-flex items-center justify-center rounded-full border border-gray-300">
                {isCurrent && <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />}
              </span>
              <span>{pct}%</span>
            </button>
          );
        })}
        {currentWidth !== null && (
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="flex items-center gap-2 px-2 py-1 mt-1 pt-1.5 rounded text-left text-xs text-gray-700 hover:bg-blue-50 border-t border-gray-100 transition-colors"
          >
            <span className="w-3 h-3 inline-flex items-center justify-center rounded-full border border-gray-300" />
            <span>Remove width</span>
          </button>
        )}
      </div>
    </div>
  );
}
