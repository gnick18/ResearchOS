"use client";

// frontend/src/components/beakerbot/SpeechBubble.tsx
//
// Shared speech-bubble primitive for the BeakerBot easter-egg scenes.
//
// Before Scene polish B each scene rolled its own bubble:
//   - Eureka  "Eureka!"  (sky-blue border, sky-700 text, downward triangle tail)
//   - TooManyBeakers "phew!" (sky-blue border, sky-700 text, rotated-square tail + sweat bead)
//   - MouseWave "Hi!" (cyan pill, NO tail — the auditor's note)
//   - Centrifuge "!" alarm (red border, red text, rotated-square tail)
//   - Centrifuge "..." shrug (sky border, sky text, rotated-square tail + sweat bead)
//
// This primitive consolidates the look-and-feel into three "tones"
// (default, alarm, sweat) + an explicit tail-direction + an optional
// `withSweatBead` flag for the sheepish bubbles. The wrapper itself
// is positioned by the caller via the `position` prop so each scene
// keeps full control of its own coordinate space (some live in the
// portal's viewport coordinates, others in a centered body-anchor
// frame). All bubbles get a real SVG triangle tail (the MouseWave
// auditor catch: its bubble had no tail).
//
// API kept intentionally narrow — animation/fade is the caller's job
// (most scenes drive the bubble via their own keyframes that animate
// opacity + a small translateY/scale pop). The primitive renders a
// pure visual; it does not own its own enter/exit transitions.

import type { CSSProperties, FC, ReactNode } from "react";

export type SpeechBubbleTone = "default" | "alarm" | "sweat";

export interface SpeechBubbleProps {
  /** Bubble content. Usually a short string ("Eureka!", "phew!",
   *  "Hi!"); any inline React tree works (e.g. an emoji + text). */
  children: ReactNode;
  /** Color palette. Maps to the per-tone hex/Tailwind values defined
   *  in TONE_PALETTE below. Default `"default"` (sky-blue). */
  tone?: SpeechBubbleTone;
  /** Which side the bubble's pointer triangle hangs off. `"down"`
   *  points the tail toward whatever is BELOW the bubble (the typical
   *  "BeakerBot looking up while bubble sits over his head" case);
   *  `"up"` points the tail toward whatever is ABOVE (used by anchor
   *  positions where BeakerBot sits above the bubble). Default
   *  `"down"`. */
  direction?: "up" | "down";
  /** Absolute-positioning offsets handed straight onto the wrapper's
   *  `style`. Either-or with the `style` escape hatch below — usually
   *  this is all you need. Strings (`"50%"`) pass through unchanged;
   *  numbers are treated as `px`. */
  position?: {
    top?: number | string;
    left?: number | string;
    right?: number | string;
    bottom?: number | string;
  };
  /** Render a small sweat-bead droplet beside the bubble — matches the
   *  "phew!" + "..." beats in TooManyBeakers / Centrifuge. The droplet
   *  is positioned to the right of the bubble (or to the left when the
   *  caller mirrors via CSS transforms). Default false. */
  withSweatBead?: boolean;
  /** Tailwind / utility class names appended to the bubble wrapper.
   *  The component already supplies its own positioning + base styles
   *  so this is for caller-specific overrides (e.g. an explicit `text-`
   *  class when a tone needs a non-default text color). */
  className?: string;
  /** Additional inline styles merged onto the wrapper. Used for caller-
   *  driven keyframe animation (`animation: '... 600ms ...'`) without
   *  forcing the primitive to bake in transition logic. */
  style?: CSSProperties;
  /** Test id forwarded to the wrapper. Optional so most call sites can
   *  skip it and inherit their own outer test id. */
  "data-testid"?: string;
}

interface TonePalette {
  /** Background — almost always white so the bubble pops against the
   *  page background, but kept explicit per tone in case a future tone
   *  needs a tinted fill. */
  background: string;
  /** Border color (also drives the tail outline). */
  borderColor: string;
  /** Text color inside the bubble. */
  textColor: string;
}

/** Per-tone color values. Match the inline styles each scene used
 *  before Scene polish B so the visual identity stays identical. */
const TONE_PALETTE: Record<SpeechBubbleTone, TonePalette> = {
  default: {
    background: "white",
    borderColor: "#38bdf8", // sky-400 — Eureka, MouseWave
    textColor: "#0369a1", // sky-700
  },
  alarm: {
    background: "white",
    borderColor: "#f87171", // red-400 — Centrifuge "!" beat
    textColor: "#b91c1c", // red-700
  },
  sweat: {
    background: "white",
    borderColor: "#7dd3fc", // blue-300 — TooManyBeakers "phew!", Centrifuge "..."
    textColor: "#0284c7", // sky-600
  },
};

/** Resolve a CSS length-ish input (`number | string | undefined`)
 *  into a value `style` can accept (`number` becomes a `px` literal). */
function toCssLength(v: number | string | undefined): string | number | undefined {
  if (v === undefined) return undefined;
  return typeof v === "number" ? v : v;
}

/** Sweat-bead SVG — small teardrop tinted to the same sky palette as
 *  the sweat-tone bubble. Used by the "phew!" + "..." beats. */
function SweatBead() {
  return (
    <svg
      data-testid="speech-bubble-sweat-bead"
      aria-hidden="true"
      style={{
        position: "absolute",
        // Pinned to the upper-right corner of the bubble — the same
        // place each previous scene parked it. Slightly negative so
        // the drop visibly hangs OFF the bubble rather than overlapping
        // the border.
        top: -2,
        right: -10,
      }}
      width="10"
      height="14"
      viewBox="0 0 10 14"
      fill="none"
    >
      <path
        d="M5 1 C 5 1, 1 7, 1 10 A 4 4 0 0 0 9 10 C 9 7, 5 1, 5 1 Z"
        fill="#A6D2F4"
        stroke="#6FB5E8"
        strokeWidth="0.8"
      />
    </svg>
  );
}

const BeakerBotSpeechBubble: FC<SpeechBubbleProps> = ({
  children,
  tone = "default",
  direction = "down",
  position,
  withSweatBead = false,
  className,
  style,
  "data-testid": testId,
}) => {
  const palette = TONE_PALETTE[tone];

  // Tail size — 10px half-width is the same as Eureka's pre-refactor
  // triangle. Sized in CSS pixels so it reads at the same scale at
  // both 1x and 2x DPR; SVG units would compete with the parent's CSS
  // sizing.
  const TAIL_HALF_W = 8;
  const TAIL_H = 10;

  const wrapperStyle: CSSProperties = {
    position: "absolute",
    background: palette.background,
    border: `2px solid ${palette.borderColor}`,
    borderRadius: 14,
    padding: "5px 12px",
    color: palette.textColor,
    fontFamily: "system-ui, -apple-system, sans-serif",
    fontWeight: 700,
    fontSize: 14,
    lineHeight: 1.2,
    whiteSpace: "nowrap",
    boxShadow: "0 2px 6px rgba(0, 0, 0, 0.08)",
    top: toCssLength(position?.top),
    left: toCssLength(position?.left),
    right: toCssLength(position?.right),
    bottom: toCssLength(position?.bottom),
    ...style,
  };

  // Tail triangle. We draw two stacked SVG triangles (border + fill)
  // so the tail visually inherits the bubble's outline + background.
  // The tail hangs DOWN (direction === "down") or UP (direction ===
  // "up"); horizontal placement defaults to the center of the bubble.
  const tailOuter: CSSProperties =
    direction === "down"
      ? {
          position: "absolute",
          left: "50%",
          bottom: -TAIL_H - 1,
          width: 0,
          height: 0,
          borderLeft: `${TAIL_HALF_W}px solid transparent`,
          borderRight: `${TAIL_HALF_W}px solid transparent`,
          borderTop: `${TAIL_H}px solid ${palette.borderColor}`,
          transform: "translateX(-50%)",
          pointerEvents: "none",
        }
      : {
          position: "absolute",
          left: "50%",
          top: -TAIL_H - 1,
          width: 0,
          height: 0,
          borderLeft: `${TAIL_HALF_W}px solid transparent`,
          borderRight: `${TAIL_HALF_W}px solid transparent`,
          borderBottom: `${TAIL_H}px solid ${palette.borderColor}`,
          transform: "translateX(-50%)",
          pointerEvents: "none",
        };

  // Inner fill triangle sits a hair INSIDE the outer triangle so the
  // border-colored tail reads as an outline. Offset is one pixel
  // smaller than the outer + nudged one pixel toward the bubble body.
  const tailInner: CSSProperties =
    direction === "down"
      ? {
          position: "absolute",
          left: "50%",
          bottom: -TAIL_H + 2,
          width: 0,
          height: 0,
          borderLeft: `${TAIL_HALF_W - 2}px solid transparent`,
          borderRight: `${TAIL_HALF_W - 2}px solid transparent`,
          borderTop: `${TAIL_H - 2}px solid ${palette.background}`,
          transform: "translateX(-50%)",
          pointerEvents: "none",
        }
      : {
          position: "absolute",
          left: "50%",
          top: -TAIL_H + 2,
          width: 0,
          height: 0,
          borderLeft: `${TAIL_HALF_W - 2}px solid transparent`,
          borderRight: `${TAIL_HALF_W - 2}px solid transparent`,
          borderBottom: `${TAIL_H - 2}px solid ${palette.background}`,
          transform: "translateX(-50%)",
          pointerEvents: "none",
        };

  return (
    <div
      data-testid={testId ?? "beakerbot-speech-bubble"}
      data-tone={tone}
      data-direction={direction}
      className={className}
      style={wrapperStyle}
    >
      {children}
      <span aria-hidden="true" style={tailOuter} />
      <span aria-hidden="true" style={tailInner} />
      {withSweatBead && <SweatBead />}
    </div>
  );
};

export default BeakerBotSpeechBubble;
