// Unit coverage for the org-admin track builders: step order, ids, and skip
// flags. Department has a parent-link step; institution does not.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, expect, it } from "vitest";
import { buildOrgTrack } from "./tracks-org";

function ids(track: ReturnType<typeof buildOrgTrack>) {
  return track.steps.map((s) => s.id);
}
function skips(track: ReturnType<typeof buildOrgTrack>) {
  return track.steps.map((s) => Boolean(s.skippable));
}

describe("buildOrgTrack (department)", () => {
  const track = buildOrgTrack("department");

  it("has sign-in, name, parent-link, roster, billing in order", () => {
    expect(ids(track)).toEqual([
      "sign-in",
      "org-name",
      "parent-link",
      "roster",
      "billing",
    ]);
  });

  it("makes sign-in and name required; parent-link, roster, billing skippable", () => {
    expect(skips(track)).toEqual([false, false, true, true, true]);
  });

  it("has no research-workspace steps (no handle, no folder)", () => {
    expect(ids(track)).not.toContain("handle");
    expect(ids(track)).not.toContain("folder");
  });
});

describe("buildOrgTrack (institution)", () => {
  const track = buildOrgTrack("institution");

  it("has sign-in, name, roster, billing in order (no parent-link)", () => {
    expect(ids(track)).toEqual(["sign-in", "org-name", "roster", "billing"]);
  });

  it("makes sign-in and name required; roster and billing skippable", () => {
    expect(skips(track)).toEqual([false, false, true, true]);
  });

  it("has no research-workspace steps", () => {
    expect(ids(track)).not.toContain("handle");
    expect(ids(track)).not.toContain("folder");
    expect(ids(track)).not.toContain("parent-link");
  });
});
