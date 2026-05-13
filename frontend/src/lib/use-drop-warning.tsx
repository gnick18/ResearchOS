"use client";

import { useCallback, useState } from "react";

/**
 * Auto-dismissing toast for surfaces that intercept native OS file drops
 * (so Chrome doesn't open the file) but don't have a Files/ folder to
 * upload into — currently the MethodTabs root and its variation-notes
 * editor.
 *
 * Returns `{ show, toast }`. Call `show(x, y)` from the drop handler to
 * flash the message at the drop point (with viewport clamping). Call
 * `show()` with no args to fall back to bottom-right. Render `{toast}`
 * once anywhere in the component.
 */
export function useDropWarning(message: string) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [visible, setVisible] = useState(false);
  const show = useCallback((x?: number, y?: number) => {
    if (typeof x === "number" && typeof y === "number") {
      setPos({ x, y });
    } else {
      setPos(null);
    }
    setVisible(true);
    window.setTimeout(() => setVisible(false), 3500);
  }, []);

  const baseClasses =
    "fixed z-50 max-w-sm rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-lg pointer-events-none";

  // Viewport-clamped positioning: cap at innerWidth - 400 (max-w-sm ≈ 384px)
  // and innerHeight - 100 (typical 2-line toast height) so the toast never
  // bleeds off-screen near right/bottom edges. Falls back to bottom-right
  // when coords aren't supplied (e.g. onFileDrop wiring without an event).
  const toast = visible ? (
    pos ? (
      <div
        className={baseClasses}
        style={{
          left: Math.max(8, Math.min(pos.x + 12, (typeof window !== "undefined" ? window.innerWidth : 1024) - 400)),
          top: Math.max(8, Math.min(pos.y + 12, (typeof window !== "undefined" ? window.innerHeight : 768) - 100)),
        }}
      >
        {message}
      </div>
    ) : (
      <div className={`${baseClasses} bottom-4 right-4`}>{message}</div>
    )
  ) : null;
  return { show, toast };
}
