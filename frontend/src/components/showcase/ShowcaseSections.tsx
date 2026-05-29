"use client";

// frontend/src/components/showcase/ShowcaseSections.tsx
//
// Change 3 (orchestrator manager): the page is no longer a long scroll
// between a hero, the runway, the hall, and a footer. StageNav is a
// persistent marquee-style nav bar that click-switches between the Runway
// view and the Scenes view (one at a time) and offers a Leave control to
// exit the show. The old MarqueeHero + CurtainCallFooter (the scroll-era
// bookends) were retired; the BeakerBot marquee logo lives on in the
// persistent StageBackdrop, untouched.
//
// No emojis (custom inline SVG mascot only); no em-dashes.

import Tooltip from "../Tooltip";
import styles from "./showcase.module.css";

/** The two click-switched views of the showcase. */
export type ShowcaseView = "runway" | "scenes";

/** Persistent marquee-style nav: Runway / Scenes (click-switched views)
 *  plus a Leave control that exits the show. Replaces the old scroll
 *  model (Change 3). */
export function StageNav({
  view,
  onSelect,
  onLeave,
}: {
  view: ShowcaseView;
  onSelect: (view: ShowcaseView) => void;
  onLeave: () => void;
}) {
  return (
    <nav className={styles.stageNav} aria-label="Showcase navigation" data-testid="showcase-nav">
      <button
        type="button"
        className={`${styles.stageNavBtn} ${
          view === "runway" ? styles.stageNavBtnActive : ""
        }`}
        aria-pressed={view === "runway"}
        onClick={() => onSelect("runway")}
        data-testid="showcase-nav-runway"
      >
        Runway
      </button>
      <button
        type="button"
        className={`${styles.stageNavBtn} ${
          view === "scenes" ? styles.stageNavBtnActive : ""
        }`}
        aria-pressed={view === "scenes"}
        onClick={() => onSelect("scenes")}
        data-testid="showcase-nav-scenes"
      >
        Scenes
      </button>
      <span className={styles.stageNavDivider} aria-hidden="true" />
      <Tooltip label="Leave the show and head back to the lab">
        <button
          type="button"
          className={`${styles.stageNavBtn} ${styles.stageNavLeave}`}
          onClick={onLeave}
          data-testid="showcase-nav-leave"
        >
          Leave
        </button>
      </Tooltip>
    </nav>
  );
}
