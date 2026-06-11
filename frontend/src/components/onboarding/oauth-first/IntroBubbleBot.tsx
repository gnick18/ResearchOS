"use client";

// The animated bubble BeakerBot used as the hero of the OAuth-first landing and
// the Welcome-back screen. Renders the shared <BeakerBot> mark (so the mascot is
// always the canonical sky-blue beaker, never a hand-rolled SVG) and overlays
// the rising bubbles from the marketing-deck title slide.
//
// No em-dashes, no emojis, no mid-sentence colons.

import IntroBeaker from "@/components/animations/IntroBeaker";
import styles from "./IntroBubbleBot.module.css";

export function IntroBubbleBot({
  size = "lg",
  className,
}: {
  /** "xl" for the full-screen landing hero, "lg" mid, "sm" for the denser
   *  Welcome-back screen. */
  size?: "xl" | "lg" | "sm";
  className?: string;
}) {
  const wrapWidth =
    size === "sm" ? "w-[70px]" : size === "xl" ? "w-[190px]" : "w-[92px]";
  const sizeClass =
    size === "sm" ? styles.sm : size === "xl" ? styles.xl : "";
  return (
    <div
      className={`${styles.introbot} ${sizeClass} ${wrapWidth} ${className ?? ""}`.trim()}
    >
      {/* Rising bubbles overlay (decorative). */}
      <div className={styles.bubbles} aria-hidden>
        <i />
        <i />
        <i />
        <i />
      </div>
      <IntroBeaker className="w-full" />
    </div>
  );
}

export default IntroBubbleBot;
