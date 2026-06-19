"use client";

// WelcomeMascot is the single canonical BeakerBot mascot for every welcome,
// login, and onboarding surface. It wraps the bubble-blowing IntroBubbleBot at
// the large hero size (the one on the entry front door), so the mascot is the
// SAME size, style, and animation everywhere he appears. Screens vary his
// PLACEMENT, never his size. Where a card is too dense to host him centered he
// is anchored to an edge and peeks in, rather than being shrunk down.
//
// The size and style live here once, so no surface hand-rolls its own beaker
// dimensions anymore. The wizard shell owns a separate slide layer that moves
// this same mascot between per-step anchors; this component stays placement
// simple so it drops into both the static surfaces and that slide layer.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { IntroBubbleBot } from "@/components/onboarding/oauth-first/IntroBubbleBot";
import styles from "./WelcomeMascot.module.css";

/** Where the mascot sits relative to its container. The size never changes. */
export type WelcomeMascotPlacement =
  /** Normal flow, centered hero (the default front-door look). */
  | "inline"
  /** Absolutely peeking over the top edge, centered. */
  | "peek-top"
  /** Absolutely peeking over the top-right corner. */
  | "peek-top-right"
  /** Absolutely peeking over the top-left corner. */
  | "peek-top-left";

const PLACEMENT_CLASS: Record<WelcomeMascotPlacement, string> = {
  inline: "",
  "peek-top": styles.peekTop,
  "peek-top-right": styles.peekTopRight,
  "peek-top-left": styles.peekTopLeft,
};

export interface WelcomeMascotProps {
  /** Placement relative to the container. Defaults to the centered hero. */
  placement?: WelcomeMascotPlacement;
  /** Play a one-shot settle-in on mount. Defaults to true. */
  animateIn?: boolean;
  /** Extra classes on the outer wrapper (positioning offsets, z-index, etc). */
  className?: string;
  /** Accessible label override (the mark is otherwise decorative-leaning). */
  ariaLabel?: string;
}

export function WelcomeMascot({
  placement = "inline",
  animateIn = true,
  className,
  ariaLabel = "BeakerBot",
}: WelcomeMascotProps) {
  return (
    <div
      className={[styles.mascot, PLACEMENT_CLASS[placement], className ?? ""]
        .filter(Boolean)
        .join(" ")}
      data-testid="welcome-mascot"
      data-placement={placement}
      role="img"
      aria-label={ariaLabel}
    >
      {/* Entrance lives on a dedicated inner element so its transform never
          fights IntroBubbleBot's ambient drift/tilt/breathe or an outer peek
          transform. */}
      <div className={animateIn ? styles.enter : undefined}>
        <IntroBubbleBot size="xl" />
      </div>
    </div>
  );
}

export default WelcomeMascot;
