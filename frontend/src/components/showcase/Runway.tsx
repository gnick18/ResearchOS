"use client";

// frontend/src/components/showcase/Runway.tsx
//
// The Runway (R3.8): all 21 poses served as snap-scroll "looks", one
// full-stage frame per look (the hard no-overlap guarantee, since looks
// are contained CSS poses that never portal). Each look renders a 128px
// <BeakerBot> on the mark under a per-look spotlight that sweeps in on
// entry, a flashbulb flurry, and a CategoryPlacard with the STARRED
// category name (R3.1).
//
// The five collections punctuate the scroll as 60svh interstitials. The
// pointing trio shares one clustered "the directors" frame (R1/R2/R3
// de-emphasis), inserted in the Lab Life collection in scroll order.
//
// Scroll order: hero is rendered by the parent; this component renders
// [interstitial, ...looks] per collection, weaving the pointing trio in.

import { useState } from "react";
import BeakerBot from "../BeakerBot";
import CategoryPlacard from "./CategoryPlacard";
import { Spotlight, Flashbulbs } from "./StageChrome";
import { useCenteredActive } from "./useCenteredActive";
import {
  SHOWCASE_COLLECTIONS,
  SHOWCASE_LOOKS,
  POINTING_TRIO,
  type RunwayLookData,
} from "./showcase-data";
import styles from "./showcase.module.css";

/** A single runway frame is either a collection interstitial, a single
 *  pose look, or the clustered pointing trio. They are flattened into
 *  one ordered list so the IntersectionObserver sequencer can index
 *  every scroll frame uniformly. */
type RunwayFrame =
  | { kind: "interstitial"; id: string; title: string; mood: string }
  | { kind: "look"; id: string; data: RunwayLookData }
  | { kind: "trio"; id: string };

/** Build the ordered scroll frames: for each collection, the
 *  interstitial header, then that collection's single-pose looks, with
 *  the pointing trio frame appended to its collection (Lab Life). */
function buildFrames(): RunwayFrame[] {
  const frames: RunwayFrame[] = [];
  for (const collection of SHOWCASE_COLLECTIONS) {
    frames.push({
      kind: "interstitial",
      id: `interstitial:${collection.id}`,
      title: collection.title,
      mood: collection.mood,
    });
    const looksHere = SHOWCASE_LOOKS.filter(
      (l) => l.collection === collection.id,
    );
    for (const look of looksHere) {
      frames.push({ kind: "look", id: `look:${look.pose}`, data: look });
    }
    if (POINTING_TRIO.collection === collection.id) {
      frames.push({ kind: "trio", id: "look:pointing-trio" });
    }
  }
  return frames;
}

export default function Runway() {
  const [frames] = useState<RunwayFrame[]>(() => buildFrames());
  const { activeIndex, registerRef } = useCenteredActive(frames.length);

  // Per-look flash flurry. The fire key is derived from the active look
  // index plus a click counter so the flashbulbs re-mount + pop on look
  // entry (new activeIndex) AND on click of the active look frame
  // (clickBump), without any setState-in-effect cascade.
  const [clickBump, setClickBump] = useState(0);
  // A monotonic-ish fire key: changing activeIndex OR clickBump yields a
  // new value, re-mounting the Flashbulbs and replaying the pop.
  const flashKey = (activeIndex + 1) * 1000 + clickBump;

  return (
    <div className={styles.runwayScroll}>
      {frames.map((frame, i) => {
        const active = i === activeIndex;
        if (frame.kind === "interstitial") {
          return (
            <section
              key={frame.id}
              ref={registerRef(i)}
              className={styles.runwayInterstitial}
              data-testid="showcase-interstitial"
            >
              <span className={styles.interstitialKicker}>
                The category is...
              </span>
              <span className={styles.interstitialTitle}>{frame.title}</span>
              <span className={styles.interstitialMood}>{frame.mood}</span>
            </section>
          );
        }
        if (frame.kind === "trio") {
          return (
            <section
              key={frame.id}
              ref={registerRef(i)}
              className={styles.runwayLook}
              data-testid="showcase-look"
              data-active={active ? "true" : "false"}
              data-look="pointing-trio"
              onClick={() => active && setClickBump((k) => k + 1)}
            >
              <Spotlight active={active} />
              {active && <Flashbulbs fireKey={flashKey} />}
              <div className={styles.botTrio}>
                {POINTING_TRIO.poses.map((pose) => (
                  <div className={styles.botTrioItem} key={pose}>
                    <BeakerBot
                      pose={pose}
                      className="w-full h-full text-sky-500"
                      ariaLabel={`BeakerBot ${pose}`}
                    />
                  </div>
                ))}
              </div>
              <CategoryPlacard
                category={POINTING_TRIO.category}
                look={POINTING_TRIO.lookName}
                active={active}
              />
            </section>
          );
        }
        // single-pose look
        const { data } = frame;
        return (
          <section
            key={frame.id}
            ref={registerRef(i)}
            className={styles.runwayLook}
            data-testid="showcase-look"
            data-active={active ? "true" : "false"}
            data-look={data.pose}
            onClick={() => active && setClickBump((k) => k + 1)}
          >
            <Spotlight active={active} />
            {active && <Flashbulbs fireKey={flashKey} />}
            <div className={styles.botMark}>
              <BeakerBot
                pose={data.pose}
                className="w-full h-full text-sky-500"
                ariaLabel={`BeakerBot ${data.pose}`}
              />
            </div>
            <CategoryPlacard
              category={data.category}
              look={data.lookName}
              active={active}
            />
          </section>
        );
      })}
    </div>
  );
}
