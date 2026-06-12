// BeakerBotThinking (BeakerAI manager, 2026-06-12).
//
// The branded "BeakerBot is thinking" indicator. Replaces the old plain grey
// text line. While BeakerBot works it shows an animated beaker-blue indicator
// plus a SINGLE grey status line that updates as he works (the label prop, fed
// by statusLabel from the agent loop status), distinct from the eventual
// printed answer.
//
// Three variants are built so the user can flip between them live and pick the
// best (see the dev switcher in BeakerBotConversation and the gallery page):
//   - pulse:  a beaker-blue blob that breathes and slowly tumbles, morphing its
//             outline as it goes (the default, a Claude-style "alive" morph).
//   - beaker: the registry vial glyph in beaker-blue, gently bobbing, with CSS
//             bubble dots rising over it.
//   - blink:  three beaker-blue dots blinking in sequence (typing-indicator).
//
// Color is the brand token (text-brand-sky / bg-brand-sky), never raw hex. The
// status line uses the muted text token (text-foreground-muted). No hand-drawn
// inline icon markup anywhere, the vessel is the registry Icon (name "vial")
// and the bubbles are CSS-positioned span dots. All motion is gated behind
// prefers-reduced-motion in the CSS module.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { Icon } from "@/components/icons";
import styles from "./BeakerBotThinking.module.css";

export type ThinkingVariant = "pulse" | "beaker" | "blink";

/** The animated beaker-blue indicator, sized ~18 to 22px, swapped by variant.
 *  Decorative, the grey label carries the meaning for assistive tech. */
function ThinkingIndicator({ variant }: { variant: ThinkingVariant }) {
  if (variant === "blink") {
    return (
      <span
        data-testid="beakerbot-thinking-indicator"
        data-variant="blink"
        aria-hidden="true"
        className="inline-flex items-center gap-1"
      >
        <span
          className={`${styles.blinkDot} ${styles.blinkDelay1} inline-block h-1.5 w-1.5 rounded-full bg-brand-sky`}
        />
        <span
          className={`${styles.blinkDot} ${styles.blinkDelay2} inline-block h-1.5 w-1.5 rounded-full bg-brand-sky`}
        />
        <span
          className={`${styles.blinkDot} ${styles.blinkDelay3} inline-block h-1.5 w-1.5 rounded-full bg-brand-sky`}
        />
      </span>
    );
  }

  if (variant === "beaker") {
    return (
      <span
        data-testid="beakerbot-thinking-indicator"
        data-variant="beaker"
        aria-hidden="true"
        className="relative inline-flex h-5 w-5 items-center justify-center"
      >
        {/* CSS bubble dots rising over the vessel. Positioned over the vial
            mouth, no svg. */}
        <span
          className={`${styles.bubble} ${styles.bubbleDelay1} absolute left-[6px] top-1 h-1 w-1 rounded-full bg-brand-sky`}
        />
        <span
          className={`${styles.bubble} ${styles.bubbleDelay2} absolute left-[10px] top-0.5 h-1 w-1 rounded-full bg-brand-sky`}
        />
        <span
          className={`${styles.bubble} ${styles.bubbleDelay3} absolute left-[13px] top-1.5 h-1 w-1 rounded-full bg-brand-sky`}
        />
        <Icon
          name="vial"
          className={`${styles.beakerVessel} h-5 w-5 text-brand-sky`}
        />
      </span>
    );
  }

  // pulse (default)
  return (
    <span
      data-testid="beakerbot-thinking-indicator"
      data-variant="pulse"
      aria-hidden="true"
      className="inline-flex h-5 w-5 items-center justify-center"
    >
      <span
        className={`${styles.pulseDot} inline-block h-3.5 w-3.5 rounded-full bg-brand-sky`}
      />
    </span>
  );
}

/** The full thinking line, an animated beaker-blue indicator plus the single
 *  grey status label. */
export default function BeakerBotThinking({
  variant,
  label,
}: {
  variant: ThinkingVariant;
  label: string;
}) {
  return (
    <span
      data-testid="beakerbot-thinking"
      className="inline-flex items-center gap-2"
    >
      <ThinkingIndicator variant={variant} />
      <span className="text-foreground-muted">{label}</span>
    </span>
  );
}
