"use client";

// frontend/src/components/showcase/CategoryPlacard.tsx
//
// The "THE CATEGORY IS..." title card (R2.5 + R3.8). Two-tier card:
// kicker "THE CATEGORY IS...", the starred category name big, then the
// look name. Flips up into the clear zone (62svh) between the bot and
// the pit so it never overlaps BeakerBot. No emojis.

import styles from "./showcase.module.css";

export default function CategoryPlacard({
  category,
  look,
  active,
}: {
  category: string;
  look: string;
  /** When true (the centered look), play the flip-up entry. */
  active: boolean;
}) {
  return (
    <div
      className={`${styles.placard} ${active ? styles.placardActive : ""}`}
      role="status"
      aria-live="polite"
      data-testid="showcase-placard"
    >
      <span className={styles.placardKicker}>The category is...</span>
      <span className={styles.placardCategory}>{category}</span>
      <span className={styles.placardLook}>{look}</span>
    </div>
  );
}
