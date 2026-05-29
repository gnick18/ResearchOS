"use client";

// frontend/src/components/showcase/SpecialCaseChrome.tsx
//
// The three Performance Hall special-case treatments (R3.8), layered as
// showcase chrome OVER the scene (not changes to the scene components):
//   - FauxCursor: MouseWave gets an in-frame arrow pointer drifting in
//     from the frame edge to a target, so the "wave near the cursor"
//     gag survives in a fixed stage.
//   - ProgressShimmer: CoffeeRefill's 13s brew gets a thin rainbow
//     progress bar so the long wait reads as intentional drama, not a
//     hang.
// No emojis (custom SVG only).

import styles from "./showcase.module.css";

/** In-frame faux cursor (R3.8). A small arrow pointer that drifts in
 *  from the frame's right edge to ~60% width / ~45% height, so MouseWave
 *  has something to wave at inside the proscenium. */
export function FauxCursor() {
  return (
    <svg
      className={styles.fauxCursor}
      viewBox="0 0 24 24"
      aria-hidden="true"
      data-testid="showcase-faux-cursor"
    >
      <path
        d="M 4 2 L 4 18 L 8.5 13.5 L 11.5 20 L 14 19 L 11 12.5 L 17 12.5 Z"
        fill="#f3f1f7"
        stroke="#0b0b12"
        strokeWidth="1"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Rainbow progress shimmer (R3.8). A thin five-stop bar along the
 *  bottom inner lip advancing left-to-right over `durationMs` (linear),
 *  paced to CoffeeRefill's verified TOTAL_DURATION_MS = 13000. */
export function ProgressShimmer({ durationMs }: { durationMs: number }) {
  return (
    <div
      className={styles.progressShimmerTrack}
      aria-hidden="true"
      data-testid="showcase-progress-shimmer"
    >
      <div
        className={styles.progressShimmerFill}
        style={{ ["--shimmer-dur" as string]: `${durationMs}ms` }}
      />
    </div>
  );
}
