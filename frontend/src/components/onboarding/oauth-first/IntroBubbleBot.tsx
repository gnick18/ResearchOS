"use client";

// The animated bubble BeakerBot used as the hero of the OAuth-first landing and
// the Welcome-back screen. Renders the shared <BeakerBot> mark (so the mascot is
// always the canonical sky-blue beaker, never a hand-rolled SVG) and overlays
// the rising bubbles from the marketing-deck title slide.
//
// No em-dashes, no emojis, no mid-sentence colons.

import BeakerBot from "@/components/BeakerBot";
import styles from "./IntroBubbleBot.module.css";

export function IntroBubbleBot({
  size = "lg",
  className,
}: {
  /** "lg" for the main landing hero, "sm" for the denser Welcome-back screen. */
  size?: "lg" | "sm";
  className?: string;
}) {
  const wrapWidth = size === "sm" ? "w-[70px]" : "w-[92px]";
  return (
    <div
      className={`${styles.introbot} ${size === "sm" ? styles.sm : ""} ${wrapWidth} ${className ?? ""}`.trim()}
    >
      {/* Rising bubbles overlay (decorative). */}
      <div className={styles.bubbles} aria-hidden>
        <i />
        <i />
        <i />
        <i />
      </div>
      <BeakerBot
        pose="idle"
        alive
        ariaLabel="ResearchOS BeakerBot"
        className="w-full text-brand-sky"
      />
    </div>
  );
}

export default IntroBubbleBot;
