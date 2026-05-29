// frontend/src/components/showcase/showcase-data.ts
//
// Source-of-truth data for the BeakerBot Drag Main Stage showcase
// (P1). Maps each of the 21 poses to:
//   - its STARRED "THE CATEGORY IS..." name (R3.1, verbatim from the
//     proposal's per-pose category menu; the starred favorite per pose),
//   - the human-friendly look name shown on the placard's bottom line,
//   - the R1/R2 collection it belongs to.
//
// The five collections (R1 section 6, reused verbatim by R2/R3) are the
// scroll's grouping scaffold; each gets a 60svh interstitial header. The
// pointing trio (pointing / pointing-up / pointing-down) stays
// de-emphasized per R1/R2/R3: it shares one clustered "the directors"
// frame rather than three full hero frames.
//
// No emojis, no em-dashes (project rules). Category names are copied
// verbatim from the proposal's starred set so they can never drift.

import type { BeakerBotPose } from "../BeakerBot";

/** One runway "look": a pose served under the spotlight with its
 *  starred category card. `lookName` is the friendly display name on
 *  the placard's bottom line (pulled from the catalog's pose label,
 *  title-cased for the stage). */
export interface RunwayLookData {
  pose: BeakerBotPose;
  /** Starred "THE CATEGORY IS..." name from R3.1, verbatim. */
  category: string;
  /** Friendly look name (placard bottom line). */
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

/** The five collections, in scroll order. Headers are the R2
 *  collection-level "THE CATEGORY IS..." lines (still available per
 *  R3.1's collection-header note), kept verbatim. */
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

/** The 21 looks, in scroll order, grouped by collection. Category names
 *  are the STARRED favorites from R3.1 (verbatim). lookName is the
 *  placard's bottom line. The pointing trio shares one clustered frame
 *  (see POINTING_TRIO below) so it is NOT listed as three separate
 *  hero looks here. */
export const SHOWCASE_LOOKS: readonly RunwayLookData[] = [
  // Collection 1: The Greetings
  {
    pose: "idle",
    category: "Resting Reaction Realness",
    lookName: "The Control Group",
    collection: "greetings",
  },
  {
    pose: "waving",
    category: "A Warm Welcome, Serotonin-Approved",
    lookName: "The Wave",
    collection: "greetings",
  },
  {
    pose: "bouncing",
    category: "Spring In Her Step (And Her Springs)",
    lookName: "The Bounce",
    collection: "greetings",
  },
  {
    pose: "bow-wink",
    category: "The Curtsy And The Wink",
    lookName: "The Charmer",
    collection: "greetings",
  },
  // Collection 2: The Big Feelings
  {
    pose: "cheering",
    category: "Eureka Eleganza",
    lookName: "The Big Win",
    collection: "big-feelings",
  },
  {
    pose: "giggle",
    category: "The Giggles, Catalyzed",
    lookName: "The Giggle",
    collection: "big-feelings",
  },
  {
    pose: "rolling-laughing",
    category: "Dying. Literally. Of Laughter.",
    lookName: "The Full ROFL",
    collection: "big-feelings",
  },
  {
    pose: "amazed",
    category: "Gagged At The Microscope",
    lookName: "The Big Idea",
    collection: "big-feelings",
  },
  // Collection 3: The Quiet Looks
  {
    pose: "thinking",
    category: "Pensive Eleganza",
    lookName: "The Hypothesis",
    collection: "quiet-looks",
  },
  {
    pose: "reading",
    category: "Literature Review Realness",
    lookName: "The Deep Read",
    collection: "quiet-looks",
  },
  {
    pose: "sleeping",
    category: "Beauty Sleep, Incubating",
    lookName: "The Overnight Culture",
    collection: "quiet-looks",
  },
  {
    pose: "yawn",
    category: "The Long Incubation",
    lookName: "The Stretch",
    collection: "quiet-looks",
  },
  // Collection 4: The Lab Life
  {
    pose: "typing",
    category: "Executive Lab Realness",
    lookName: "The Manuscript",
    collection: "lab-life",
  },
  {
    pose: "typing-on-laptop",
    category: "Working Hypothesis, Mobile Edition",
    lookName: "The Field Notes",
    collection: "lab-life",
  },
  // The pointing trio renders as one clustered frame (POINTING_TRIO),
  // inserted in the Lab Life collection in scroll order. It is not part
  // of SHOWCASE_LOOKS so it does not claim three hero frames.
  // Collection 5: The Drama
  {
    pose: "panicked",
    category: "High Drama, Darling",
    lookName: "The Five-Alarm",
    collection: "drama",
  },
  {
    pose: "embarrassed",
    category: "Contamination, But Make It Fashion",
    lookName: "The Sheepish Save",
    collection: "drama",
  },
  {
    pose: "hiccup",
    category: "Effervescent Mishap",
    lookName: "The Uninvited Bubble",
    collection: "drama",
  },
  {
    pose: "volcano-eruption",
    category: "Exothermic Eleganza",
    lookName: "Mount Eleganza",
    collection: "drama",
  },
];

/** The de-emphasized pointing trio: one clustered "the directors" frame
 *  in the Lab Life collection. Lead pose `pointing` carries the shared
 *  category card; the other two render alongside it without their own
 *  hero cards (R1/R2/R3). */
export const POINTING_TRIO = {
  collection: "lab-life" as ShowcaseCollectionId,
  category: "The Direction Is Clear",
  lookName: "The Directors",
  poses: ["pointing-up", "pointing", "pointing-down"] as readonly BeakerBotPose[],
  /** Which pose carries the shared placard (the lead). */
  leadPose: "pointing" as BeakerBotPose,
} as const;

/** Total distinct runway frames a build renders: 17 single-pose looks +
 *  1 clustered pointing-trio frame = 18 frames, covering all 21 poses
 *  (17 + the 3 pointing poses share 1 frame). Exposed so tests can
 *  assert the runway never drifts from the inventory. */
export const SHOWCASE_RUNWAY_FRAME_COUNT =
  SHOWCASE_LOOKS.length + 1; // +1 for the clustered pointing trio frame

/** All 21 poses are represented across the runway (single looks + the
 *  trio). Exposed for the coverage test. */
export const SHOWCASE_ALL_POSES: readonly BeakerBotPose[] = [
  ...SHOWCASE_LOOKS.map((l) => l.pose),
  ...POINTING_TRIO.poses,
];
