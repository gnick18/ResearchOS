"use client";

// frontend/src/components/beakerbot/BeakerSpeech.tsx
//
// Intermittent speech-bubble component for BeakerBot on entry / login screens.
// Pure presentational: the parent supplies `lines` and positions this element
// via `className`. No data fetching, no builder calls here.
//
// Rhythm: mount -> short delay -> pick a line -> TYPE it in -> HOLD -> FADE OUT
// -> SILENT GAP (7-13 s) -> repeat with the next line. Most of the time the
// bubble is fully hidden. Long silences make each message feel deliberate.
//
// Bubble width is fit-content (not w-full), capped at max-w-xs so short lines
// make a short bubble while long ones wrap cleanly.
//
// The `side` prop controls notch direction and is used by the parent to float
// the bubble to one side of the beaker with an arrow pointing at him.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { useEffect, useRef, useState } from "react";

// ─── Constants ───────────────────────────────────────────────────────────────

/** Milliseconds per character while typing in a new line. */
const CHAR_MS = 38;

/** Minimum visible hold time (ms) after typing finishes. */
const HOLD_MIN_MS = 3000;

/** Additional hold time per character (ms). Approx 55ms/char of the full line. */
const HOLD_PER_CHAR_MS = 55;

/** Fade transition duration (ms). Skipped under reduced-motion. */
const FADE_MS = 280;

/** Initial delay after mount before the first line appears (ms). */
const INITIAL_DELAY_MS = 1200;

/** Minimum silent gap between lines (ms). */
const GAP_MIN_MS = 7000;

/** Random additional silent gap on top of the minimum (ms). */
const GAP_RAND_MS = 6000;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function holdMs(line: string): number {
  return Math.max(HOLD_MIN_MS, line.length * HOLD_PER_CHAR_MS);
}

function gapMs(rand: () => number): number {
  return GAP_MIN_MS + Math.floor(rand() * GAP_RAND_MS);
}

// ─── Props ───────────────────────────────────────────────────────────────────

export interface BeakerSpeechProps {
  /** The ordered list of lines to cycle through. */
  lines: string[];
  /** Optional Tailwind / utility classes for outer positioning. */
  className?: string;
  /**
   * Ignored in the new timing model (kept for back-compat so callers do not
   * need to be updated). The rhythm is now driven by the internal constants.
   */
  rotateMs?: number;
  /**
   * When true, applies a light sky-50 tint to the bubble background instead
   * of pure white. Useful against very light page backgrounds.
   */
  tinted?: boolean;
  /**
   * Where the bubble sits relative to the beaker. Controls which edge the
   * notch appears on and how the bubble expands away from the beaker.
   *
   * "below" (default) -- notch on the TOP edge pointing up (beaker is above).
   * "right"           -- notch on the LEFT edge pointing left (beaker is left).
   * "left"            -- notch on the RIGHT edge pointing right (beaker is right).
   */
  side?: "below" | "left" | "right";
}

// ─── Types ───────────────────────────────────────────────────────────────────

type Phase = "hidden" | "typing" | "holding" | "fading";

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * Intermittent BeakerBot speech bubble for entry screens.
 *
 * Shows one line at a time with a typewriter reveal, a hold, a fade-out, and
 * then a long silent gap before the next line. Most of the time the bubble is
 * fully invisible -- each message feels deliberate and special.
 *
 * Clicking the visible bubble advances to the next line immediately.
 * Renders nothing until after mount (fully SSR-safe, no Math.random on render).
 */
export default function BeakerSpeech({
  lines,
  className,
  // rotateMs kept for API compat but not used in new timing model
  rotateMs: _rotateMs,
  tinted = false,
  side = "below",
}: BeakerSpeechProps) {
  // Nothing renders until after mount (SSR-safe).
  const [mounted, setMounted] = useState(false);

  // The full current line being shown (set when a new line is picked).
  const [currentLine, setCurrentLine] = useState("");

  // How many characters of currentLine are currently revealed.
  const [revealed, setRevealed] = useState(0);

  // Lifecycle phase.
  const [phase, setPhase] = useState<Phase>("hidden");

  // Whether the bubble has opacity-1 (controls CSS transition).
  const [opaque, setOpaque] = useState(false);

  // Stable ref for the current line index so effects do not need it in deps.
  const idxRef = useRef(0);

  // Whether the user prefers reduced motion. Detected once after mount.
  const reducedRef = useRef(false);

  // Master abort ref -- set to true on unmount so no timer callback fires.
  const deadRef = useRef(false);

  // Random function -- injected via ref so tests can override it.
  // Uses a module-level identity that can be replaced in tests.
  const randRef = useRef<() => number>(() => Math.random());

  // Collect all active timer handles so we can cancel them all at once.
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  function schedule(fn: () => void, ms: number): ReturnType<typeof setTimeout> {
    const id = setTimeout(() => {
      timersRef.current.delete(id);
      if (!deadRef.current) fn();
    }, ms);
    timersRef.current.add(id);
    return id;
  }

  function cancelAll() {
    timersRef.current.forEach((id) => clearTimeout(id));
    timersRef.current.clear();
  }

  // ── Mount detection ──────────────────────────────────────────────────────

  useEffect(() => {
    deadRef.current = false;
    reducedRef.current =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    setMounted(true);

    return () => {
      deadRef.current = true;
      cancelAll();
    };
    // Run once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Main loop ────────────────────────────────────────────────────────────
  //
  // Kicks off after mount. Each "cycle" is:
  //   showLine() -> type in -> hold -> fade out -> gap -> showLine() ...

  useEffect(() => {
    if (!mounted || lines.length === 0) return;

    function showLine() {
      const line = lines[idxRef.current] ?? "";
      setCurrentLine(line);
      setRevealed(0);
      setPhase("typing");
      setOpaque(true);

      if (reducedRef.current) {
        // Reduced motion: show full line immediately, skip type animation.
        setRevealed(line.length);
        schedule(beginHold, 0);
      } else {
        typeNextChar(0, line);
      }
    }

    function typeNextChar(charIdx: number, line: string) {
      if (charIdx >= line.length) {
        beginHold();
        return;
      }
      setRevealed(charIdx + 1);
      schedule(() => typeNextChar(charIdx + 1, line), CHAR_MS);
    }

    function beginHold() {
      setPhase("holding");
      schedule(beginFade, holdMs(lines[idxRef.current] ?? ""));
    }

    function beginFade() {
      setPhase("fading");

      if (reducedRef.current) {
        // Reduced motion: skip opacity fade, jump straight to hidden.
        setOpaque(false);
        schedule(beginGap, 0);
      } else {
        setOpaque(false);
        // Wait for the CSS transition to complete before hiding content.
        schedule(beginGap, FADE_MS);
      }
    }

    function beginGap() {
      setPhase("hidden");
      setCurrentLine("");
      setRevealed(0);
      // Advance to the next line, wrapping around.
      idxRef.current = (idxRef.current + 1) % lines.length;
      schedule(showLine, gapMs(randRef.current));
    }

    // Kick off after initial delay.
    schedule(showLine, INITIAL_DELAY_MS);

    return () => {
      cancelAll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, lines]);

  // ── Click handler -- advance immediately ─────────────────────────────────

  function handleClick() {
    if (phase === "hidden") return;
    cancelAll();
    // Move to the next line immediately.
    idxRef.current = (idxRef.current + 1) % lines.length;

    // Re-trigger the mount/lines effect by cycling through a fade + re-show.
    setOpaque(false);
    setPhase("fading");

    const nextLine = lines[idxRef.current] ?? "";
    const show = () => {
      if (deadRef.current) return;
      setCurrentLine(nextLine);
      setRevealed(0);
      setPhase("typing");
      setOpaque(true);

      if (reducedRef.current) {
        setRevealed(nextLine.length);
        scheduleHoldFromClick(nextLine);
      } else {
        typeNextCharClick(0, nextLine);
      }
    };

    schedule(show, reducedRef.current ? 0 : FADE_MS);
  }

  function typeNextCharClick(charIdx: number, line: string) {
    if (charIdx >= line.length) {
      scheduleHoldFromClick(line);
      return;
    }
    setRevealed(charIdx + 1);
    schedule(() => typeNextCharClick(charIdx + 1, line), CHAR_MS);
  }

  function scheduleHoldFromClick(line: string) {
    setPhase("holding");
    schedule(beginFadeFromClick, holdMs(line));
  }

  function beginFadeFromClick() {
    setPhase("fading");
    if (reducedRef.current) {
      setOpaque(false);
      schedule(beginGapFromClick, 0);
    } else {
      setOpaque(false);
      schedule(beginGapFromClick, FADE_MS);
    }
  }

  function beginGapFromClick() {
    setPhase("hidden");
    setCurrentLine("");
    setRevealed(0);
    idxRef.current = (idxRef.current + 1) % lines.length;
    // Re-enter the main loop: next line appears after the gap.
    schedule(() => {
      if (deadRef.current) return;
      const line = lines[idxRef.current] ?? "";
      setCurrentLine(line);
      setRevealed(0);
      setPhase("typing");
      setOpaque(true);
      if (reducedRef.current) {
        setRevealed(line.length);
        scheduleHoldFromClick(line);
      } else {
        typeNextCharClick(0, line);
      }
    }, gapMs(randRef.current));
  }

  // ── Early exits ──────────────────────────────────────────────────────────

  if (lines.length === 0) return null;

  // Render an invisible placeholder before mount to avoid layout shift.
  if (!mounted) {
    return <div className={className} aria-hidden />;
  }

  // ── Visual variables ─────────────────────────────────────────────────────

  const bgColor = tinted ? "#f0f9ff" : "white"; // sky-50 or white
  const displayText = currentLine.slice(0, revealed);

  // Whether to show the caret (blinking while actively typing).
  const showCaret = phase === "typing" && !reducedRef.current;

  // ── Notch triangles ──────────────────────────────────────────────────────
  //
  // Two-triangle technique: a larger sky-300 outer triangle and a smaller
  // white/tinted inner triangle 1 px inward to simulate a bordered notch.
  // No inline SVG (icon-guard).
  //
  // side="below"  -> notch on the TOP edge, pointing up toward the beaker.
  // side="right"  -> notch on the LEFT edge, pointing left toward the beaker.
  // side="left"   -> notch on the RIGHT edge, pointing right toward the beaker.

  let notchOuter: React.CSSProperties;
  let notchInner: React.CSSProperties;
  let notchOuterClass: string;
  let notchInnerClass: string;

  if (side === "right") {
    // Beaker is to the left of the bubble. Notch on the LEFT edge points left.
    notchOuterClass = "absolute top-1/2 -left-3 h-0 w-0 -translate-y-1/2";
    notchInnerClass = "absolute top-1/2 -left-[9px] h-0 w-0 -translate-y-1/2";
    notchOuter = {
      borderTop: "10px solid transparent",
      borderBottom: "10px solid transparent",
      borderRight: "12px solid #7dd3fc", // sky-300
    };
    notchInner = {
      borderTop: "9px solid transparent",
      borderBottom: "9px solid transparent",
      borderRight: `11px solid ${bgColor}`,
    };
  } else if (side === "left") {
    // Beaker is to the right of the bubble. Notch on the RIGHT edge points right.
    notchOuterClass = "absolute top-1/2 -right-3 h-0 w-0 -translate-y-1/2";
    notchInnerClass = "absolute top-1/2 -right-[9px] h-0 w-0 -translate-y-1/2";
    notchOuter = {
      borderTop: "10px solid transparent",
      borderBottom: "10px solid transparent",
      borderLeft: "12px solid #7dd3fc", // sky-300
    };
    notchInner = {
      borderTop: "9px solid transparent",
      borderBottom: "9px solid transparent",
      borderLeft: `11px solid ${bgColor}`,
    };
  } else {
    // side="below" (default) -- notch on the TOP edge pointing up.
    notchOuterClass = "absolute -top-3 left-1/2 h-0 w-0 -translate-x-1/2";
    notchInnerClass = "absolute -top-2 left-1/2 h-0 w-0 -translate-x-1/2";
    notchOuter = {
      borderLeft: "10px solid transparent",
      borderRight: "10px solid transparent",
      borderBottom: "12px solid #7dd3fc", // sky-300
    };
    notchInner = {
      borderLeft: "9px solid transparent",
      borderRight: "9px solid transparent",
      borderBottom: `11px solid ${bgColor}`,
    };
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className={className}>
      {/* The bubble is only visible while a line is in-flight (typing, holding,
          or fading). The container is always in the DOM after mount so the
          parent layout does not shift when the bubble appears. */}
      <div
        className="relative inline-block"
        style={{
          // Fades in/out via CSS opacity transition (skipped under reduced-motion
          // because we never reach opaque=true via the CSS transition then).
          opacity: opaque && phase !== "hidden" ? 1 : 0,
          pointerEvents: phase === "hidden" ? "none" : "auto",
          transition: reducedRef.current
            ? "none"
            : `opacity ${FADE_MS}ms ease`,
          // Bubble grows AWAY from the beaker: anchor it on the notch side so
          // new content pushes outward rather than inward.
          ...(side === "right"
            ? { transformOrigin: "left center" }
            : side === "left"
              ? { transformOrigin: "right center" }
              : { transformOrigin: "top center" }),
        }}
      >
        {/* Notch outer (sky-300 border color) */}
        <div
          aria-hidden="true"
          className={notchOuterClass}
          style={notchOuter}
        />
        {/* Notch inner (white/tinted fill) */}
        <div
          aria-hidden="true"
          className={notchInnerClass}
          style={notchInner}
        />

        {/* Bubble card -- fit-content width, capped at max-w-xs */}
        <button
          type="button"
          onClick={phase !== "hidden" ? handleClick : undefined}
          aria-label={
            phase !== "hidden" ? "BeakerBot says: click to skip to next" : undefined
          }
          className={[
            "rounded-2xl border border-sky-300 px-5 py-3 text-left text-slate-900 shadow-xl",
            tinted ? "bg-sky-50" : "bg-white",
            phase !== "hidden" ? "cursor-pointer" : "cursor-default",
          ]
            .filter(Boolean)
            .join(" ")}
          style={{
            // max-content (NOT fit-content) so the bubble sizes to the text
            // itself. Because the bubble is absolutely positioned at left:100%
            // of a narrow wrapper, fit-content would compute its available
            // width as nearly zero and collapse to one word per line
            // ("Hi\nthere"). max-content ignores available width, so short
            // lines stay on one line and only lines wider than the cap wrap.
            width: "max-content",
            maxWidth: "18rem", // ~max-w-xs
            minWidth: "6rem",
          }}
        >
          <p
            aria-live="polite"
            className="text-sm leading-snug whitespace-pre-wrap"
            // BeakerBot's spoken lines read in his signature voice typeface
            // (--font-ai, Hanken Grotesk -- the same face as his AI-chat replies)
            // so the bubble sounds like BeakerBot talking, not UI chrome.
            style={{ fontFamily: "var(--font-ai)" }}
          >
            {displayText}
            {showCaret && (
              <span
                aria-hidden="true"
                className="ml-0.5 inline-block w-[2px] h-[0.85em] align-middle bg-slate-400 motion-safe:animate-pulse"
              />
            )}
          </p>
        </button>
      </div>
    </div>
  );
}
