"use client";

// sequence editor master. The NO-MENU GLYPH for the website-wide right-click
// framework. A small circle with a diagonal bar (the universal "no" mark) that
// appears at the pointer when a bare right-click had no registered menu. It fades
// in, pulses slightly, then shrinks and fades out over ~350ms, then unmounts.
//
// Calm by convention. Low-contrast gray, inline SVG only (no emojis), and
// pointer-events none so it can NEVER intercept a click. The provider bumps a
// `key` per trigger so rapid repeats restart the animation cleanly.

import { useEffect, useState } from "react";

/** How long the whole appear -> pulse -> vanish sequence runs, in ms. The
 *  provider unmounts the glyph after this. Keep in sync with the keyframes. */
export const NO_MENU_GLYPH_MS = 350;

export function NoMenuGlyph({
  x,
  y,
  onDone,
}: {
  x: number;
  y: number;
  onDone: () => void;
}) {
  // Self-unmount after the animation so the provider's glyph state can clear
  // even if no other trigger arrives. The provider also clears its own state,
  // so this is belt-and-suspenders for a lone trigger.
  const [gone, setGone] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => {
      setGone(true);
      onDone();
    }, NO_MENU_GLYPH_MS);
    return () => clearTimeout(t);
  }, [onDone]);

  if (gone) return null;

  return (
    <span
      aria-hidden="true"
      className="no-menu-glyph pointer-events-none fixed z-[200]"
      style={{ left: x, top: y }}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        className="h-6 w-6 text-gray-400/80"
      >
        <circle cx="12" cy="12" r="9" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </span>
  );
}
