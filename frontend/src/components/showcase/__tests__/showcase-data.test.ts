// Coverage tests for the showcase runway data (the no-drift-from-
// inventory guarantee). Asserts all 21 poses are represented, the
// pointing trio is de-emphasized into a single clustered frame, every
// look carries a plain understated emotion label, and the dormant
// (no-longer-rendered) category names still match the proposal verbatim
// so the provenance never drifts.

import { describe, expect, it } from "vitest";
import type { BeakerBotPose } from "../../BeakerBot";
import {
  SHOWCASE_LOOKS,
  SHOWCASE_COLLECTIONS,
  SHOWCASE_FRAMES,
  POINTING_TRIO,
  SHOWCASE_ALL_POSES,
  SHOWCASE_RUNWAY_FRAME_COUNT,
} from "../showcase-data";

/** The full 21-pose union from BeakerBot.tsx. */
const ALL_21_POSES: BeakerBotPose[] = [
  "idle",
  "pointing",
  "pointing-up",
  "pointing-down",
  "cheering",
  "waving",
  "bouncing",
  "thinking",
  "typing",
  "typing-on-laptop",
  "bow-wink",
  "giggle",
  "rolling-laughing",
  "volcano-eruption",
  "sleeping",
  "hiccup",
  "yawn",
  "reading",
  "panicked",
  "amazed",
  "embarrassed",
];

describe("showcase runway data", () => {
  it("represents all 21 poses across the runway (single looks + the trio)", () => {
    const covered = new Set(SHOWCASE_ALL_POSES);
    expect(covered.size).toBe(21);
    for (const pose of ALL_21_POSES) {
      expect(covered.has(pose)).toBe(true);
    }
  });

  it("cycles 19 distinct runway frames (18 single looks + 1 clustered trio)", () => {
    expect(SHOWCASE_LOOKS).toHaveLength(18);
    expect(SHOWCASE_RUNWAY_FRAME_COUNT).toBe(19);
    expect(SHOWCASE_FRAMES).toHaveLength(19);
  });

  it("orders the auto-show frames by collection arc, trio woven into lab-life", () => {
    // 18 single-pose looks + 1 clustered trio, in collection arc order.
    const lookFrames = SHOWCASE_FRAMES.filter((f) => f.kind === "look");
    const trioFrames = SHOWCASE_FRAMES.filter((f) => f.kind === "trio");
    expect(lookFrames).toHaveLength(18);
    expect(trioFrames).toHaveLength(1);
    // The trio is woven into the lab-life run (after the two lab-life
    // single looks: typing, typing-on-laptop).
    const ids = SHOWCASE_FRAMES.map((f) => f.id);
    const trioIdx = ids.indexOf("look:pointing-trio");
    expect(ids[trioIdx - 1]).toBe("look:typing-on-laptop");
  });

  it("gives every look a plain understated emotion label (no puns, no category copy)", () => {
    for (const look of SHOWCASE_LOOKS) {
      expect(look.emotion).toBeTruthy();
      // The emotion label is the plain word(s), never the punny category
      // name or the dropped catchphrase.
      expect(look.emotion).not.toBe(look.category);
      expect(look.emotion.toLowerCase()).not.toContain("the category is");
      expect(look.emotion.toLowerCase()).not.toContain("realness");
      expect(look.emotion.toLowerCase()).not.toContain("eleganza");
    }
    expect(POINTING_TRIO.emotion).toBe("Pointing");
  });

  it("de-emphasizes the pointing trio into one clustered frame", () => {
    // None of the three pointing poses appear as their own hero look.
    const singleLookPoses = SHOWCASE_LOOKS.map((l) => l.pose);
    expect(singleLookPoses).not.toContain("pointing");
    expect(singleLookPoses).not.toContain("pointing-up");
    expect(singleLookPoses).not.toContain("pointing-down");
    expect(POINTING_TRIO.poses).toEqual([
      "pointing-up",
      "pointing",
      "pointing-down",
    ]);
    expect(POINTING_TRIO.leadPose).toBe("pointing");
  });

  it("uses the STARRED R3.1 category names verbatim", () => {
    const byPose = new Map(SHOWCASE_LOOKS.map((l) => [l.pose, l.category]));
    expect(byPose.get("idle")).toBe("Resting Reaction Realness");
    expect(byPose.get("waving")).toBe("A Warm Welcome, Serotonin-Approved");
    expect(byPose.get("bouncing")).toBe("Spring In Her Step (And Her Springs)");
    expect(byPose.get("bow-wink")).toBe("The Curtsy And The Wink");
    expect(byPose.get("cheering")).toBe("Eureka Eleganza");
    expect(byPose.get("giggle")).toBe("The Giggles, Catalyzed");
    expect(byPose.get("rolling-laughing")).toBe("Dying. Literally. Of Laughter.");
    expect(byPose.get("amazed")).toBe("Gagged At The Microscope");
    expect(byPose.get("thinking")).toBe("Pensive Eleganza");
    expect(byPose.get("reading")).toBe("Literature Review Realness");
    expect(byPose.get("sleeping")).toBe("Beauty Sleep, Incubating");
    expect(byPose.get("yawn")).toBe("The Long Incubation");
    expect(byPose.get("typing")).toBe("Executive Lab Realness");
    expect(byPose.get("typing-on-laptop")).toBe(
      "Working Hypothesis, Mobile Edition",
    );
    expect(POINTING_TRIO.category).toBe("The Direction Is Clear");
    expect(byPose.get("panicked")).toBe("High Drama, Darling");
    expect(byPose.get("embarrassed")).toBe("Contamination, But Make It Fashion");
    expect(byPose.get("hiccup")).toBe("Effervescent Mishap");
    expect(byPose.get("volcano-eruption")).toBe("Exothermic Eleganza");
  });

  it("has five collections in scroll order", () => {
    expect(SHOWCASE_COLLECTIONS.map((c) => c.id)).toEqual([
      "greetings",
      "big-feelings",
      "quiet-looks",
      "lab-life",
      "drama",
    ]);
  });

  it("has no em-dashes or emoji in any category name (project rules)", () => {
    const allCategories = [
      ...SHOWCASE_LOOKS.map((l) => l.category),
      POINTING_TRIO.category,
    ];
    for (const cat of allCategories) {
      expect(cat).not.toMatch(/—/); // em-dash
      // Basic emoji range check.
      expect(cat).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
    }
  });
});
