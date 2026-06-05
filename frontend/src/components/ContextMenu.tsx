"use client";

import { useEffect, useRef, type ReactNode } from "react";

export interface ContextMenuItem {
  label: string;
  onClick: () => void;
  icon?: ReactNode;
}

/**
 * Small right-click context menu positioned at the cursor. Closes on outside
 * click or Escape. Used to offer per-tile actions (e.g. "Add a comment") without
 * opening the full detail popup first.
 *
 * Voice / style: inline SVG icons only, no emojis.
 */
export default function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [onClose]);

  const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
  const vh = typeof window !== "undefined" ? window.innerHeight : 768;
  const left = Math.min(x, vw - 200);
  const top = Math.min(y, vh - 16 - items.length * 40);

  return (
    <div
      ref={ref}
      role="menu"
      className="fixed z-[60] min-w-[180px] rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
      style={{ left, top }}
    >
      {items.map((it, i) => (
        <button
          key={i}
          type="button"
          role="menuitem"
          onClick={() => {
            it.onClick();
            onClose();
          }}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-body text-gray-700 hover:bg-gray-50"
        >
          {it.icon}
          {it.label}
        </button>
      ))}
    </div>
  );
}
