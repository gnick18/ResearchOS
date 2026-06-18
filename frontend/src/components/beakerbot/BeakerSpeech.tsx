"use client";

// frontend/src/components/beakerbot/BeakerSpeech.tsx
//
// Rotating speech-bubble component for BeakerBot on entry / login screens.
// Pure presentational: the parent supplies `lines` and positions this
// element via `className`. No data fetching, no builder calls here.
//
// Mirrors BeakerBotGreeting's rotation mechanic (auto-cycle + click-to-
// advance + fade). Bubble look matches SpeechBubble's white card + sky-blue
// border + notch (the picker-walkthrough variant with a top notch, since
// BeakerBot sits above the bubble on entry screens).
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { useEffect, useRef, useState } from "react";

// ─── Constants ───────────────────────────────────────────────────────────────

/** Default auto-rotate interval in milliseconds. */
const DEFAULT_ROTATE_MS = 4200;

/** Fade transition duration in milliseconds. */
const FADE_MS = 300;

// ─── Props ───────────────────────────────────────────────────────────────────

export interface BeakerSpeechProps {
  /** The ordered list of lines to rotate through. */
  lines: string[];
  /** Optional Tailwind / utility classes for outer positioning. */
  className?: string;
  /** Override the auto-rotate interval (ms). Defaults to 4200. */
  rotateMs?: number;
  /**
   * When true, applies a light sky-50 tint to the bubble background
   * instead of pure white. Useful against very light page backgrounds.
   */
  tinted?: boolean;
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * Rotating BeakerBot speech bubble for entry screens.
 *
 * Shows one line at a time, auto-rotating every `rotateMs` milliseconds.
 * Clicking the bubble advances to the next line immediately.
 * Starts at index 0 on SSR and first client render to avoid hydration
 * mismatches; after mount a random start index is picked in an effect
 * for per-visit variety.
 * When `lines.length <= 1`, rotation and clicking are disabled.
 */
export default function BeakerSpeech({
  lines,
  className,
  rotateMs = DEFAULT_ROTATE_MS,
  tinted = false,
}: BeakerSpeechProps) {
  // Index is 0 during SSR and initial hydration to avoid mismatch.
  const [idx, setIdx] = useState(0);
  // Opacity state drives the fade between lines.
  const [visible, setVisible] = useState(true);
  // Tracks the fade-out timer so it can be cancelled on fast clicks.
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // After mount, pick a random start index for per-visit variety.
  // Wrapped in an effect so it never runs on the server.
  useEffect(() => {
    if (lines.length > 1) {
      setIdx(Math.floor(Math.random() * lines.length));
    }
    // Run once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-rotate interval.
  useEffect(() => {
    if (lines.length <= 1) return;
    const interval = setInterval(() => {
      advanceLine();
    }, rotateMs);
    return () => clearInterval(interval);
    // advanceLine is stable within each render cycle; eslint-disable below
    // covers the intentional omission (we want the interval to use the
    // latest `lines.length` without resetting on every render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines.length, rotateMs]);

  // Clean up any pending fade timer on unmount.
  useEffect(() => {
    return () => {
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    };
  }, []);

  /** Fade out, advance index, fade back in. */
  function advanceLine() {
    if (lines.length <= 1) return;
    setVisible(false);
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    fadeTimerRef.current = setTimeout(() => {
      setIdx((i) => (i + 1) % lines.length);
      setVisible(true);
    }, FADE_MS);
  }

  const handleClick = () => {
    advanceLine();
  };

  const currentLine = lines[idx] ?? "";

  if (lines.length === 0) return null;

  const bgColor = tinted ? "#f0f9ff" : "white"; // sky-50 or white

  return (
    <div className={className}>
      {/* Outer wrapper: white card with sky-blue border, matching
          SpeechBubble's visual language. */}
      <div
        className="relative"
        style={{
          // Check for reduced motion: keep rotating but skip the fade.
          // We read the media query once at render time; the fade CSS
          // transition handles the actual animation.
        }}
      >
        {/* Top notch (border triangle, sky-300) pointing upward toward
            BeakerBot who sits above the bubble on entry screens. */}
        <div
          aria-hidden="true"
          className="absolute -top-3 left-1/2 h-0 w-0 -translate-x-1/2"
          style={{
            borderLeft: "10px solid transparent",
            borderRight: "10px solid transparent",
            borderBottom: "12px solid #7dd3fc", // sky-300
          }}
        />
        {/* Inner notch fill (white/tinted, 1 px lower to reveal the sky
            border as the visible "border" of the notch). */}
        <div
          aria-hidden="true"
          className="absolute -top-2 left-1/2 h-0 w-0 -translate-x-1/2"
          style={{
            borderLeft: "9px solid transparent",
            borderRight: "9px solid transparent",
            borderBottom: `11px solid ${bgColor}`,
          }}
        />

        {/* Bubble card */}
        <button
          type="button"
          onClick={lines.length > 1 ? handleClick : undefined}
          aria-label={
            lines.length > 1
              ? "BeakerBot says: click for next line"
              : undefined
          }
          className={[
            "w-full rounded-2xl border border-sky-300 px-5 py-3 text-left text-slate-900 shadow-xl",
            tinted ? "bg-sky-50" : "bg-white",
            lines.length > 1 ? "cursor-pointer" : "cursor-default",
            // Fade transition (skip under reduced-motion via media query).
            "motion-safe:transition-opacity",
          ]
            .filter(Boolean)
            .join(" ")}
          style={{
            opacity: visible ? 1 : 0,
            transitionDuration: `${FADE_MS}ms`,
          }}
        >
          <p
            aria-live="polite"
            className="text-sm leading-snug"
          >
            {currentLine}
          </p>
        </button>
      </div>
    </div>
  );
}
