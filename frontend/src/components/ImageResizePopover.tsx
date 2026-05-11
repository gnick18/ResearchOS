"use client";

import { useEffect, useRef } from "react";

const RESIZE_PERCENTAGES = [25, 50, 75, 100] as const;

interface ImageResizePopoverProps {
  /** Viewport-relative position (pixels) of the popover's top-left corner. */
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

  return (
    <div
      ref={ref}
      className="fixed z-50 bg-white border border-gray-200 rounded-lg shadow-xl p-2 min-w-[150px]"
      style={{ top: y, left: x }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="text-[11px] uppercase tracking-wide text-gray-500 px-1 pb-1.5 border-b border-gray-100">
        Image size
      </div>
      <div className="flex flex-col mt-1">
        {RESIZE_PERCENTAGES.map((pct) => (
          <label
            key={pct}
            className="flex items-center gap-2 px-2 py-1 rounded hover:bg-blue-50 cursor-pointer text-xs text-gray-700"
          >
            <input
              type="radio"
              name="image-resize-width"
              checked={currentWidth === pct}
              onChange={() => onSelect(pct)}
              className="w-3 h-3 accent-blue-500"
            />
            <span>{pct}%</span>
          </label>
        ))}
        <label className="flex items-center gap-2 px-2 py-1 mt-1 pt-1.5 rounded hover:bg-blue-50 cursor-pointer text-xs text-gray-700 border-t border-gray-100">
          <input
            type="radio"
            name="image-resize-width"
            checked={currentWidth === null}
            onChange={() => onSelect(null)}
            className="w-3 h-3 accent-blue-500"
          />
          <span>Remove width</span>
        </label>
      </div>
    </div>
  );
}
