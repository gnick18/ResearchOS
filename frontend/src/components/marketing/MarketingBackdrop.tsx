import styles from "./MarketingBackdrop.module.css";

/**
 * Shared ambient backdrop for the marketing surfaces. Soft drifting
 * pastel-rainbow auroras plus a faint masked dot grid, the same brand life the
 * login hero paints in its side space, so the welcome and pricing pages sit on
 * one continuous stage instead of three unrelated white pages. It is purely
 * decorative (aria-hidden, pointer-events none, behind the content at z-0) and
 * the drift is disabled under prefers-reduced-motion.
 *
 * Render it as the first child of a `relative` container, then put the real
 * content in a `relative z-10` sibling so it floats above the wash.
 *
 * `tone` dials the aurora opacity. "soft" is the quiet default for content
 * bands, "vivid" is for the hero where the brand should sing.
 *
 * No emojis, no em-dashes, no mid-sentence colons.
 */
export default function MarketingBackdrop({
  tone = "soft",
  dots = true,
  className = "",
}: {
  tone?: "soft" | "vivid";
  dots?: boolean;
  className?: string;
}) {
  return (
    <div
      aria-hidden
      className={`${styles.backdrop} ${tone === "vivid" ? styles.vivid : ""} ${className}`.trim()}
    >
      {dots ? <div className={styles.dotgrid} /> : null}
      <span className={`${styles.aurora} ${styles.a1}`} />
      <span className={`${styles.aurora} ${styles.a2}`} />
      <span className={`${styles.aurora} ${styles.a3}`} />
      <span className={`${styles.aurora} ${styles.a4}`} />
    </div>
  );
}
