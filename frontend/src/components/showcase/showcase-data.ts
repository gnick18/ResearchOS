// frontend/src/components/showcase/showcase-data.ts
//
// Source-of-truth data for the BeakerBot showcase runway (P1, redesigned).
// Maps each of the 21 poses to:
//   - a plain, understated emotion label (the ONLY copy now shown on the
//     runway: a small clean word so the viewer knows what they are
//     seeing, e.g. "Cheering", "Sleeping"),
//   - the R1/R2 collection it belongs to (still used to order the
//     auto-show in a sensible emotional arc).
//
// The old STARRED "THE CATEGORY IS..." punny category names + look names
// are kept DORMANT on each record for provenance, but they are no longer
// rendered anywhere on screen (the catchphrase copy read as try-hard).
// The runway is now a hands-free auto-playing show that cycles the poses
// on a timer; the only visible text is the small emotion label.
//
// No emojis, no em-dashes (project rules). Dormant category names are
// kept verbatim from the proposal's starred set so they can never drift.

import type { BeakerBotPose } from "../BeakerBot";

/** One runway "look": a pose served under the spotlight. `emotion` is the
 *  small plain label shown on the runway now (understated, no puns). The
 *  `category` / `lookName` fields are DORMANT (kept for provenance, never
 *  rendered) since the "THE CATEGORY IS..." copy was dropped. */
export interface RunwayLookData {
  pose: BeakerBotPose;
  /** Plain understated emotion label, the only runway copy now. */
  emotion: string;
  /** DORMANT: starred "THE CATEGORY IS..." name from R3.1. Not rendered. */
  category: string;
  /** DORMANT: friendly look name (old placard bottom line). Not rendered. */
  lookName: string;
  /** Collection id this look belongs to. */
  collection: ShowcaseCollectionId;
}

export type ShowcaseCollectionId =
  | "greetings"
  | "big-feelings"
  | "quiet-looks"
  | "lab-life"
  | "drama";

export interface ShowcaseCollection {
  id: ShowcaseCollectionId;
  /** Collection interstitial header (the R2 collection-level line). */
  title: string;
  /** Short mood blurb under the header. */
  mood: string;
}

/** The five collections, in show order. They group the poses into a
 *  sensible emotional arc for the auto-show (warm openers, then joy, then
 *  quiet, then lab life, then drama). The DORMANT title/mood fields are
 *  kept for provenance but are no longer rendered (the old interstitial
 *  "THE CATEGORY IS..." headers were dropped with the rest of the
 *  catchphrase copy). */
export const SHOWCASE_COLLECTIONS: readonly ShowcaseCollection[] = [
  {
    id: "greetings",
    title: "OPENING NUMBER REALNESS",
    mood: "Warm, welcoming openers.",
  },
  {
    id: "big-feelings",
    title: "PURE JOY, SERVED",
    mood: "High-energy joy.",
  },
  {
    id: "quiet-looks",
    title: "SOFT GLAMOUR",
    mood: "Calm, contemplative.",
  },
  {
    id: "lab-life",
    title: "EXECUTIVE LAB REALNESS",
    mood: "The working bot.",
  },
  {
    id: "drama",
    title: "HIGH DRAMA, DARLING",
    mood: "The comedic, dramatic finale.",
  },
];

/** The 21 looks, in show order, grouped by collection. `emotion` is the
 *  plain understated label shown on the runway. The `category` /
 *  `lookName` fields are DORMANT (kept verbatim for provenance, never
 *  rendered). The pointing trio shares one clustered frame (see
 *  POINTING_TRIO below) so it is NOT listed as three separate looks. */
export const SHOWCASE_LOOKS: readonly RunwayLookData[] = [
  // Collection 1: The Greetings
  {
    pose: "idle",
    emotion: "Idle",
    category: "Resting Reaction Realness",
    lookName: "The Control Group",
    collection: "greetings",
  },
  {
    pose: "waving",
    emotion: "Waving",
    category: "A Warm Welcome, Serotonin-Approved",
    lookName: "The Wave",
    collection: "greetings",
  },
  {
    pose: "bouncing",
    emotion: "Bouncing",
    category: "Spring In Her Step (And Her Springs)",
    lookName: "The Bounce",
    collection: "greetings",
  },
  {
    pose: "bow-wink",
    emotion: "Taking a Bow",
    category: "The Curtsy And The Wink",
    lookName: "The Charmer",
    collection: "greetings",
  },
  // Collection 2: The Big Feelings
  {
    pose: "cheering",
    emotion: "Cheering",
    category: "Eureka Eleganza",
    lookName: "The Big Win",
    collection: "big-feelings",
  },
  {
    pose: "giggle",
    emotion: "Giggling",
    category: "The Giggles, Catalyzed",
    lookName: "The Giggle",
    collection: "big-feelings",
  },
  {
    pose: "rolling-laughing",
    emotion: "Laughing",
    category: "Dying. Literally. Of Laughter.",
    lookName: "The Full ROFL",
    collection: "big-feelings",
  },
  {
    pose: "amazed",
    emotion: "Amazed",
    category: "Gagged At The Microscope",
    lookName: "The Big Idea",
    collection: "big-feelings",
  },
  // Collection 3: The Quiet Looks
  {
    pose: "thinking",
    emotion: "Thinking",
    category: "Pensive Eleganza",
    lookName: "The Hypothesis",
    collection: "quiet-looks",
  },
  {
    pose: "reading",
    emotion: "Reading",
    category: "Literature Review Realness",
    lookName: "The Deep Read",
    collection: "quiet-looks",
  },
  {
    pose: "sleeping",
    emotion: "Sleeping",
    category: "Beauty Sleep, Incubating",
    lookName: "The Overnight Culture",
    collection: "quiet-looks",
  },
  {
    pose: "yawn",
    emotion: "Yawning",
    category: "The Long Incubation",
    lookName: "The Stretch",
    collection: "quiet-looks",
  },
  // Collection 4: The Lab Life
  {
    pose: "typing",
    emotion: "Typing",
    category: "Executive Lab Realness",
    lookName: "The Manuscript",
    collection: "lab-life",
  },
  {
    pose: "typing-on-laptop",
    emotion: "On the Laptop",
    category: "Working Hypothesis, Mobile Edition",
    lookName: "The Field Notes",
    collection: "lab-life",
  },
  // The pointing trio renders as one clustered frame (POINTING_TRIO),
  // inserted in the Lab Life collection in show order. It is not part
  // of SHOWCASE_LOOKS so it does not claim three frames.
  // Collection 5: The Drama
  {
    pose: "panicked",
    emotion: "Panicking",
    category: "High Drama, Darling",
    lookName: "The Five-Alarm",
    collection: "drama",
  },
  {
    pose: "embarrassed",
    emotion: "Embarrassed",
    category: "Contamination, But Make It Fashion",
    lookName: "The Sheepish Save",
    collection: "drama",
  },
  {
    pose: "hiccup",
    emotion: "Hiccuping",
    category: "Effervescent Mishap",
    lookName: "The Uninvited Bubble",
    collection: "drama",
  },
  {
    pose: "volcano-eruption",
    emotion: "Erupting",
    category: "Exothermic Eleganza",
    lookName: "Mount Eleganza",
    collection: "drama",
  },
];

/** The de-emphasized pointing trio: one clustered frame in the Lab Life
 *  collection. The three pointing poses cluster as one look in the
 *  auto-show. `category` / `lookName` are DORMANT (not rendered);
 *  `emotion` is the plain label shown for the cluster. */
export const POINTING_TRIO = {
  collection: "lab-life" as ShowcaseCollectionId,
  emotion: "Pointing",
  category: "The Direction Is Clear",
  lookName: "The Directors",
  poses: ["pointing-up", "pointing", "pointing-down"] as readonly BeakerBotPose[],
  /** Which pose carries the shared label (the lead). */
  leadPose: "pointing" as BeakerBotPose,
} as const;

/** A single frame the auto-show cycles through: either one pose or the
 *  clustered pointing trio. The runway holds one of these on stage at a
 *  time, then advances to the next on a timer (looping). */
export type ShowcaseFrame =
  | {
      kind: "look";
      id: string;
      emotion: string;
      pose: BeakerBotPose;
    }
  | {
      kind: "trio";
      id: string;
      emotion: string;
      poses: readonly BeakerBotPose[];
    };

/** The ordered auto-show: every collection's single-pose looks in arc
 *  order, with the clustered pointing trio woven into its collection
 *  (Lab Life). This flat list is what the runway cycles through on a
 *  timer. 18 single-pose looks + 1 clustered trio = 19 frames. */
export const SHOWCASE_FRAMES: readonly ShowcaseFrame[] = (() => {
  const frames: ShowcaseFrame[] = [];
  for (const collection of SHOWCASE_COLLECTIONS) {
    for (const look of SHOWCASE_LOOKS) {
      if (look.collection !== collection.id) continue;
      frames.push({
        kind: "look",
        id: `look:${look.pose}`,
        emotion: look.emotion,
        pose: look.pose,
      });
    }
    if (POINTING_TRIO.collection === collection.id) {
      frames.push({
        kind: "trio",
        id: "look:pointing-trio",
        emotion: POINTING_TRIO.emotion,
        poses: POINTING_TRIO.poses,
      });
    }
  }
  return frames;
})();

/** Total distinct show frames the runway cycles: 18 single-pose looks +
 *  1 clustered pointing-trio frame = 19, covering all 21 poses (18
 *  single + the 3 pointing poses share 1 frame). Exposed so tests can
 *  assert the runway never drifts from the inventory. */
export const SHOWCASE_RUNWAY_FRAME_COUNT = SHOWCASE_FRAMES.length;

/** All 21 poses are represented across the runway (single looks + the
 *  trio). Exposed for the coverage test. */
export const SHOWCASE_ALL_POSES: readonly BeakerBotPose[] = [
  ...SHOWCASE_LOOKS.map((l) => l.pose),
  ...POINTING_TRIO.poses,
];
