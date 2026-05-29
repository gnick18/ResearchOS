// Coverage tests for the showcase runway data (R3.1 category menu +
// the no-drift-from-inventory guarantee). Asserts all 21 poses are
// represented, each starred category name matches the proposal verbatim,
// and the pointing trio is de-emphasized into a single clustered frame.

import { describe, expect, it } from "vitest";
import type { BeakerBotPose } from "../../BeakerBot";
import {
  SHOWCASE_LOOKS,
  SHOWCASE_COLLECTIONS,
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

  it("renders 19 distinct runway frames (18 single looks + 1 clustered trio)", () => {
    expect(SHOWCASE_LOOKS).toHaveLength(18);
    expect(SHOWCASE_RUNWAY_FRAME_COUNT).toBe(19);
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
