"use client";

// sequence editor master. The RIGHT-CLICK SIGNIFIER (sequences redesign phase
// 3). A small calm footer on the feature / primer hover cards that teaches the
// object accelerator we already built (the smart right-click menu). Light by
// design, one subtle line, never a redesign of the cards. A tiny inline-SVG
// pointer glyph (no emoji) sits before the hint text.
//
// Voice, no em-dashes, no en-dashes, no emojis, no mid-sentence colons.

/** The hover-card footer hint. Shared by the linear and circular maps so the
 *  affordance reads identically on both. */
export default function HoverCardActionHint() {
  return (
    <div className="mt-1.5 flex items-center gap-1 border-t border-slate-100 pt-1.5 text-[10px] text-slate-400">
      <svg viewBox="0 0 24 24" className="h-3 w-3 flex-none" aria-hidden="true">
        <path
          d="M6 3l12 7-5 1.5L16 18l-2 1-3-5.5L7 17z"
          fill="currentColor"
        />
      </svg>
      <span>Right-click for actions</span>
    </div>
  );
}
