"use client";

// frontend/src/components/showcase/Runway.tsx
//
// The Runway, redesigned (R3.8 successor). The runway is now a
// self-contained, hands-free AUTO-PLAYING show that occupies the first
// viewport. BeakerBot stands center stage on the catwalk under the
// spotlight and automatically cycles through all 21 emotions/poses on a
// timer (~2.4s per look), looping forever. The user does NOT scroll to
// change poses: scrolling moves on to the Performance Hall below.
//
// What stayed: the genuine drag-stage VISUALS (the spotlight sweep, the
// camera-flash flurry, BeakerBot serving looks on the catwalk). Camera
// flashes still fire on CLICK. The pointing trio still clusters as one
// "directors" frame so it does not claim three looks.
//
// What was dropped: the "THE CATEGORY IS..." copy and the punny per-pose
// category names (read as try-hard). All that remains in text is a small,
// plain emotion label (EmotionLabel) so the viewer knows what they are
// seeing. The category-name data is dormant in showcase-data.ts.
//
// Reduced motion: the auto-advance is off; the show holds a static pose
// and surfaces a manual "next look" control so the viewer can walk the
// looks at their own pace.

import { useState } from "react";
import BeakerBot from "../BeakerBot";
import EmotionLabel from "./EmotionLabel";
import { Spotlight, StageBacklightRig, Flashbulbs } from "./StageChrome";
import { useRunwayAutoplay } from "./useRunwayAutoplay";
import { SHOWCASE_FRAMES } from "./showcase-data";
import styles from "./showcase.module.css";

export default function Runway() {
  const { activeIndex, bumpKey, autoplaying, advance } = useRunwayAutoplay(
    SHOWCASE_FRAMES.length,
  );

  // Camera-flash flurry. The fire key combines the auto-advance bump (so
  // a fresh flurry pops as each new look arrives) with a click counter
  // (so clicking the stage re-fires the flashes on demand), with no
  // setState-in-effect cascade.
  const [clickBump, setClickBump] = useState(0);
  const flashKey = (bumpKey + 1) * 1000 + clickBump;

  const frame = SHOWCASE_FRAMES[activeIndex];
  if (!frame) return null;

  return (
    <section
      className={styles.runwayShow}
      data-testid="showcase-runway"
      data-look={frame.kind === "trio" ? "pointing-trio" : frame.pose}
      aria-label="BeakerBot runway show"
      onClick={() => setClickBump((k) => k + 1)}
    >
      {/* Overhead beam ambiance (hot white up high, not over the bot). */}
      <Spotlight active />
      {/* The anti-wash backlight rig: the brightest glow sits BEHIND the
          bot (halo) with a dark contrast pocket on his silhouette, so he is
          lit + rimmed but never washed (Change 1). Rendered before the
          stage so it stacks below the bot (z4/z5 < the bot's z6). */}
      <StageBacklightRig active />
      {/* The flash flurry re-mounts (new key) on every look change and on
          click, replaying the pop. */}
      <Flashbulbs fireKey={flashKey} />

      {/* The look on stage. We render exactly one frame at a time (the
          contained-pose, no-overlap guarantee), keyed so each look's
          entry animation replays as the show advances. */}
      <div className={styles.runwayStage} key={frame.id}>
        {frame.kind === "trio" ? (
          <div className={styles.botTrio} data-testid="showcase-look">
            {frame.poses.map((pose) => (
              <div className={styles.botTrioItem} key={pose}>
                <BeakerBot
                  pose={pose}
                  className="w-full h-full text-sky-500"
                  ariaLabel={`BeakerBot ${pose}`}
                />
              </div>
            ))}
          </div>
        ) : (
          <div className={styles.botMark} data-testid="showcase-look">
            <BeakerBot
              pose={frame.pose}
              className="w-full h-full text-sky-500"
              ariaLabel={`BeakerBot ${frame.pose}`}
            />
          </div>
        )}
      </div>

      <EmotionLabel emotion={frame.emotion} />

      {/* Reduced motion: no auto-advance, so offer a manual step. Hidden
          while autoplaying (the timer is in charge). */}
      {!autoplaying && (
        <button
          type="button"
          className={styles.runwayManualNext}
          data-testid="showcase-runway-next"
          onClick={(e) => {
            e.stopPropagation();
            advance();
          }}
        >
          Next look
        </button>
      )}
    </section>
  );
}
