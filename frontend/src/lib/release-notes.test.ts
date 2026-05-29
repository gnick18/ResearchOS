// Pure version-compare + catch-up logic for the What's New popup
// (whats-new bot). No React, no I/O — just the resolver the manager keys
// off, exercised across the cases that matter:
//   - semver-ish comparison (component-wise, missing-component, junk)
//   - catch-up: which releases are "missed" relative to last-seen
//   - first-load (lastSeen == null) returns the full eligible list (the
//     manager itself does the silent-record-and-suppress)
//   - currentVersion caps releases authored ahead of the shipped build
//   - latestReleaseVersion picks the newest eligible entry

import { describe, expect, it } from "vitest";
import {
  compareVersions,
  computeAnnouncementsToShow,
  latestReleaseVersion,
  type ReleaseNote,
} from "./release-notes";

const REL = (version: string, highlights: string[] = ["x"]): ReleaseNote => ({
  version,
  date: "2026-01-01",
  highlights,
});

// A small fixed log, intentionally NOT newest-first so we also prove the
// resolver re-sorts.
const LOG: ReleaseNote[] = [
  REL("0.1.0"),
  REL("0.3.0"),
  REL("0.2.0"),
];

describe("compareVersions", () => {
  it("orders by numeric components left to right", () => {
    expect(compareVersions("0.1.0", "0.2.0")).toBeLessThan(0);
    expect(compareVersions("0.2.0", "0.1.0")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "0.9.9")).toBeGreaterThan(0);
  });

  it("treats equal versions as 0", () => {
    expect(compareVersions("0.1.0", "0.1.0")).toBe(0);
  });

  it("treats a missing component as 0 (0.1 == 0.1.0)", () => {
    expect(compareVersions("0.1", "0.1.0")).toBe(0);
    expect(compareVersions("0.1.0", "0.1")).toBe(0);
  });

  it("coerces non-numeric components to 0 instead of throwing", () => {
    expect(() => compareVersions("0.x.0", "0.0.0")).not.toThrow();
    expect(compareVersions("0.x.0", "0.0.0")).toBe(0);
  });
});

describe("computeAnnouncementsToShow", () => {
  it("returns every release strictly newer than last-seen, newest first", () => {
    const out = computeAnnouncementsToShow({
      lastSeen: "0.1.0",
      releases: LOG,
      currentVersion: "0.3.0",
    });
    expect(out.map((r) => r.version)).toEqual(["0.3.0", "0.2.0"]);
  });

  it("returns an empty array when last-seen is already the latest", () => {
    const out = computeAnnouncementsToShow({
      lastSeen: "0.3.0",
      releases: LOG,
      currentVersion: "0.3.0",
    });
    expect(out).toEqual([]);
  });

  it("returns nothing newer than last-seen even when an older one exists", () => {
    const out = computeAnnouncementsToShow({
      lastSeen: "0.2.0",
      releases: LOG,
      currentVersion: "0.3.0",
    });
    expect(out.map((r) => r.version)).toEqual(["0.3.0"]);
  });

  it("first load (lastSeen == null) returns the full eligible list, newest first", () => {
    const out = computeAnnouncementsToShow({
      lastSeen: null,
      releases: LOG,
      currentVersion: "0.3.0",
    });
    expect(out.map((r) => r.version)).toEqual(["0.3.0", "0.2.0", "0.1.0"]);
  });

  it("undefined last-seen behaves like null (full eligible list)", () => {
    const out = computeAnnouncementsToShow({
      lastSeen: undefined,
      releases: LOG,
      currentVersion: "0.3.0",
    });
    expect(out.map((r) => r.version)).toEqual(["0.3.0", "0.2.0", "0.1.0"]);
  });

  it("caps at currentVersion: a release authored ahead of the build is hidden", () => {
    const log = [...LOG, REL("0.4.0")];
    const out = computeAnnouncementsToShow({
      lastSeen: "0.1.0",
      releases: log,
      // The running build is only 0.3.0; 0.4.0 is a draft entry.
      currentVersion: "0.3.0",
    });
    expect(out.map((r) => r.version)).toEqual(["0.3.0", "0.2.0"]);
  });
});

describe("latestReleaseVersion", () => {
  it("returns the newest eligible version", () => {
    expect(latestReleaseVersion(LOG, "0.3.0")).toBe("0.3.0");
  });

  it("respects the currentVersion cap", () => {
    const log = [...LOG, REL("0.4.0")];
    expect(latestReleaseVersion(log, "0.3.0")).toBe("0.3.0");
  });

  it("returns null for an empty eligible set", () => {
    expect(latestReleaseVersion([], "0.3.0")).toBeNull();
    // Every release is ahead of the build.
    expect(latestReleaseVersion([REL("0.5.0")], "0.3.0")).toBeNull();
  });
});
