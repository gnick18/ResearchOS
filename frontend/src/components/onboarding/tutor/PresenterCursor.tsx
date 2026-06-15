"use client";

// Onboarding tutor — the presenter cursor.
//
// Beaker's hand. A distinct arrow (dark fill, white outline, soft shadow) the
// user reads as "Beaker is doing this, not me." It eases to a target position
// and shows a click ring when Beaker clicks. Presentational only, the parent
// passes the current x/y (in container coordinates) and whether a click is
// happening. No emojis, no em-dashes, no mid-sentence colons.

export interface PresenterCursorProps {
  /** Position in the stage's coordinate space, or null to hide. */
  x: number | null;
  y: number | null;
  clicking?: boolean;
}

// Classic mouse-pointer arrow drawn with a CSS clip-path polygon (no inline SVG,
// so the icon guard stays at zero and no new registry glyph is needed). A
// slightly larger white shape sits behind it as the outline.
const ARROW = "polygon(0 0, 0 72%, 26% 56%, 46% 100%, 60% 92%, 40% 50%, 72% 50%)";

export default function PresenterCursor({ x, y, clicking }: PresenterCursorProps) {
  if (x === null || y === null) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute z-[60] transition-all duration-700 ease-out"
      style={{ left: x, top: y, transform: "translate(-1px, -1px)" }}
    >
      {clicking ? (
        <span className="absolute -left-2.5 -top-2.5 h-6 w-6 animate-ping rounded-full border-2 border-[var(--info,#2563eb)]" />
      ) : null}
      {/* white outline */}
      <span
        className="absolute h-[22px] w-[16px]"
        style={{ background: "#fff", clipPath: ARROW, transform: "scale(1.18)", transformOrigin: "top left" }}
      />
      {/* dark fill */}
      <span
        className="absolute h-[22px] w-[16px] drop-shadow"
        style={{ background: "#2a2f2b", clipPath: ARROW }}
      />
    </div>
  );
}
