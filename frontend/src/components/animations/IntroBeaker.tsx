"use client";

// The exact bubbling BeakerBot from the marketing-deck title slide
// (docs/mockups/2026-06-10-entry-flow-oauth-first.html, the .introbot SVG). The
// shared <BeakerBot> component draws on a different viewBox, so the deck's bubble
// overlay (whose positions are geometry-matched to THIS drawing) only sits inside
// the glass when paired with this exact SVG. That mismatch is why the hero
// bubbles floated outside the beaker.
//
// It is the same sky-blue BeakerBot character, just the self-contained title-slide
// rendering with the pastel-rainbow liquid. Lives under components/animations/
// (icon-guard exempt) because it is a decorative animated mark, not a registry
// icon. The gradient id is a FIXED string, not useId. useId shifts its SSR vs
// client counter whenever the surrounding tree changes, which triggered a
// hydration mismatch on this gradient (the same fix BeakerBot.tsx already made,
// see its gradId note). Duplicate ids across instances are visually harmless,
// url(#intro-beaker-liquid) resolves to the identical pastel stops either way.
//
// He is alive. The eyes blink on a randomized cadence (with an occasional quick
// double blink) and the pupils track the cursor, so the same bubble BeakerBot
// watches you from every entry and loading surface. Both behaviors are gated off
// under prefers-reduced-motion and start from a neutral SSR state (no blink,
// pupils centered) so there is no hydration mismatch.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useEffect, useRef, useState } from "react";

// How far the pupils may slide from center, in viewBox user units. The eyes sit
// at x 17 and 23 inside a glass that spans x 12 to 28, so this keeps them clear
// of the rim. Vertical reach is smaller so they never dip into the liquid line.
const PUPIL_REACH_X = 1.3;
const PUPIL_REACH_Y = 0.9;
// Past this distance (px) the gaze is at full deflection; nearer the cursor the
// eyes relax toward center, so he calmly watches you from across the screen and
// does not go cross-eyed when the pointer sits right on him.
const GAZE_FULL_DISTANCE_PX = 420;

export function IntroBeaker({ className }: { className?: string }) {
  const liq = "intro-beaker-liquid";
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [blink, setBlink] = useState(false);
  const [pupil, setPupil] = useState({ x: 0, y: 0 });

  // Randomized blinking. A recursive timeout (not a fixed interval) keeps the
  // cadence irregular so it reads as alive, and roughly a quarter of the time he
  // throws a quick second blink.
  useEffect(() => {
    if (
      typeof window === "undefined" ||
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }
    let cancelled = false;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const later = (fn: () => void, ms: number) => {
      const t = setTimeout(() => {
        timers.delete(t);
        if (!cancelled) fn();
      }, ms);
      timers.add(t);
      return t;
    };
    const closeFor = (ms: number, then: () => void) => {
      setBlink(true);
      later(() => {
        setBlink(false);
        then();
      }, ms);
    };
    const scheduleNext = () => {
      // 2.6s to 6.2s between blinks.
      later(() => {
        const doubleBlink = idx % 4 === 0;
        idx += 1;
        closeFor(130, () => {
          if (doubleBlink) {
            later(() => closeFor(120, scheduleNext), 160);
          } else {
            scheduleNext();
          }
        });
      }, 2600 + (idx % 7) * 520);
    };
    let idx = 0;
    scheduleNext();
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
      timers.clear();
    };
  }, []);

  // Pupils follow the cursor, throttled to one update per animation frame.
  useEffect(() => {
    if (
      typeof window === "undefined" ||
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }
    let frame = 0;
    let mx = 0;
    let my = 0;
    const apply = () => {
      frame = 0;
      const el = svgRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      // Eyes sit in the upper third of the mark, so aim the gaze origin there.
      const cy = rect.top + rect.height * 0.42;
      const dx = mx - cx;
      const dy = my - cy;
      const dist = Math.hypot(dx, dy) || 1;
      const reach = Math.min(1, dist / GAZE_FULL_DISTANCE_PX);
      setPupil({
        x: (dx / dist) * PUPIL_REACH_X * reach,
        y: (dy / dist) * PUPIL_REACH_Y * reach,
      });
    };
    const onMove = (e: PointerEvent) => {
      mx = e.clientX;
      my = e.clientY;
      if (!frame) frame = requestAnimationFrame(apply);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <svg
      ref={svgRef}
      viewBox="8 3 24 31"
      fill="none"
      stroke="#1AA0E6"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <defs>
        <linearGradient id={liq} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFD2B0" />
          <stop offset="25%" stopColor="#FFF1A8" />
          <stop offset="50%" stopColor="#B7EBB1" />
          <stop offset="75%" stopColor="#A6D2F4" />
          <stop offset="100%" stopColor="#D6B5F0" />
        </linearGradient>
      </defs>
      {/* White glass body, then the wavy pastel liquid on top of it. */}
      <path
        d="M 12 12 L 12 24 C 12 30, 16 32, 20 32 C 24 32, 28 30, 28 24 L 28 12 Z"
        fill="white"
        stroke="none"
      />
      <path
        d="M 12 19 Q 14 17.8, 16 19 T 20 19 T 24 19 T 28 19 L 28 24 C 28 30, 24 32, 20 32 C 16 32, 12 30, 12 24 L 12 19 Z"
        fill={`url(#${liq})`}
        stroke="none"
      />
      {/* Lip curl, glass outline, rim. */}
      <path d="M22 8 C 22 6, 24 4, 26 6" />
      <path d="M12 12 L12 24 C 12 30, 16 32, 20 32 C 24 32, 28 30, 28 24 L28 12" />
      <path d="M11 12 L29 12" />
      {/* Eyes + smile. The outer group slides the pupils toward the cursor; the
          inner group squashes them flat around the eye line (y 18) for a blink. */}
      <g transform={`translate(${pupil.x} ${pupil.y})`}>
        <g transform={`translate(0 18) scale(1 ${blink ? 0.12 : 1}) translate(0 -18)`}>
          <circle cx="17" cy="18" r="1.2" fill="#1AA0E6" stroke="none" />
          <circle cx="23" cy="18" r="1.2" fill="#1AA0E6" stroke="none" />
        </g>
      </g>
      <path d="M18 22 Q 20 24, 22 22" />
      {/* Little arms. */}
      <path d="M14 26 L15.5 26" />
      <path d="M24.5 26 L26 26" />
    </svg>
  );
}

export default IntroBeaker;
