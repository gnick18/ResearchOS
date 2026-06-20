// Validated core for the badge snapshot contract (badges phase 2). Node project.
//
// House style: no em-dashes, no emojis, no mid-sentence colons, sentence case.

import { describe, expect, it } from "vitest";

import type { BadgeMetrics } from "../earn";
import {
  MAX_PINNED_BADGES,
  buildBadgeSnapshot,
  emptyBadgeSnapshot,
  isBadgeSnapshotEmpty,
  normalizePins,
  parseBadgeSnapshot,
  parseBadgeSnapshotJson,
  serializeBadgeSnapshot,
} from "../snapshot";

const FOUNDING: BadgeMetrics = {
  experiments: 0,
  isFounding: true,
  tenureDays: 0,
  hasExternalShare: false,
  hasCompanionSite: false,
};

describe("normalizePins", () => {
  it("keeps only earned ids, de-duped, in order, capped", () => {
    const earned = ["a", "b", "c", "d", "e"];
    expect(normalizePins(["b", "b", "x", "a", "c", "d", "e"], earned)).toEqual([
      "b",
      "a",
      "c",
      "d",
    ]);
  });

  it("drops pins that are not earned", () => {
    expect(normalizePins(["x", "y"], ["a"])).toEqual([]);
  });

  it("never exceeds the cap", () => {
    const earned = ["a", "b", "c", "d", "e", "f"];
    expect(normalizePins(earned, earned).length).toBe(MAX_PINNED_BADGES);
  });
});

describe("buildBadgeSnapshot", () => {
  it("earns from metrics and only pins earned ids", () => {
    const snap = buildBadgeSnapshot(FOUNDING, ["founding-lab", "experiments-1000"]);
    expect(snap.earnedBadgeIds).toContain("founding-lab");
    expect(snap.earnedBadgeIds).not.toContain("experiments-1000");
    expect(snap.pinnedBadgeIds).toEqual(["founding-lab"]);
  });

  it("threads awarded grants into the earned set", () => {
    const snap = buildBadgeSnapshot(FOUNDING, ["course-complete"], ["course-complete"]);
    expect(snap.earnedBadgeIds).toContain("course-complete");
    expect(snap.pinnedBadgeIds).toEqual(["course-complete"]);
  });
});

describe("parse + serialize round trip", () => {
  it("parses a well-formed object and re-normalizes pins", () => {
    const parsed = parseBadgeSnapshot({
      earnedBadgeIds: ["a", "b"],
      pinnedBadgeIds: ["b", "z"],
    });
    expect(parsed).toEqual({ earnedBadgeIds: ["a", "b"], pinnedBadgeIds: ["b"] });
  });

  it("degrades a malformed value to empty rather than throwing", () => {
    expect(parseBadgeSnapshot(null)).toEqual(emptyBadgeSnapshot());
    expect(parseBadgeSnapshot("nope")).toEqual(emptyBadgeSnapshot());
    expect(parseBadgeSnapshot({ earnedBadgeIds: 5 })).toEqual(emptyBadgeSnapshot());
  });

  it("round-trips through JSON", () => {
    const snap = buildBadgeSnapshot(FOUNDING, ["founding-lab"]);
    expect(parseBadgeSnapshotJson(serializeBadgeSnapshot(snap))).toEqual(snap);
  });

  it("parses a null/garbage json column to empty", () => {
    expect(parseBadgeSnapshotJson(null)).toEqual(emptyBadgeSnapshot());
    expect(parseBadgeSnapshotJson("{not json")).toEqual(emptyBadgeSnapshot());
  });
});

describe("isBadgeSnapshotEmpty", () => {
  it("is empty only when nothing is earned", () => {
    expect(isBadgeSnapshotEmpty(emptyBadgeSnapshot())).toBe(true);
    expect(isBadgeSnapshotEmpty(buildBadgeSnapshot(FOUNDING, []))).toBe(false);
  });
});
