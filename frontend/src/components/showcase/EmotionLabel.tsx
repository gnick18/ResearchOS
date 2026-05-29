"use client";

// frontend/src/components/showcase/EmotionLabel.tsx
//
// The minimal runway label (redesigned). The old "THE CATEGORY IS..."
// placard with its punny per-pose category name was dropped: the
// catchphrase copy read as try-hard. The drag-stage homage now lives
// entirely in the VISUALS (the runway, the spotlight, BeakerBot serving
// looks, the camera flashes, the rainbow). All that remains in text is a
// small, plain, understated emotion label so the viewer knows what they
// are seeing (e.g. "Cheering", "Sleeping").
//
// Legibility: light small-caps over a subtle dark scrim + text-shadow
// halo so it never washes out against the bright spotlight on the light
// catwalk. No emojis, no em-dashes.

import styles from "./showcase.module.css";

export default function EmotionLabel({ emotion }: { emotion: string }) {
  return (
    <div
      className={styles.emotionLabel}
      role="status"
      aria-live="polite"
      data-testid="showcase-emotion-label"
    >
      <span className={styles.emotionLabelText}>{emotion}</span>
    </div>
  );
}
