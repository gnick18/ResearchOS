// Unit coverage for the research-track builders: step order, ids, and the
// per-step skip flags from the spec's skip table.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, expect, it } from "vitest";
import {
  buildSoloFreeTrack,
  buildSoloLocalTrack,
  buildPiCreateTrack,
} from "./tracks";

function ids(track: ReturnType<typeof buildSoloFreeTrack>) {
  return track.steps.map((s) => s.id);
}
function skips(track: ReturnType<typeof buildSoloFreeTrack>) {
  return track.steps.map((s) => Boolean(s.skippable));
}

describe("buildSoloFreeTrack", () => {
  it("has sign-in, handle, profile, folder in order", () => {
    expect(ids(buildSoloFreeTrack())).toEqual([
      "sign-in",
      "handle",
      "profile",
      "folder",
    ]);
  });

  it("makes sign-in, handle, and folder required; only profile skippable", () => {
    // Go-live: the folder step is unskippable (no folder = no app). The demo
    // escape FolderStep renders is the only way past it without connecting.
    expect(skips(buildSoloFreeTrack())).toEqual([false, false, true, false]);
  });
});

describe("buildSoloLocalTrack", () => {
  it("is a single folder-only step (no sign in / handle / profile)", () => {
    const track = buildSoloLocalTrack();
    expect(ids(track)).toEqual(["folder"]);
  });

  it("the lone folder step is required (go-live: no folder = no app)", () => {
    expect(skips(buildSoloLocalTrack())).toEqual([false]);
  });
});

describe("buildPiCreateTrack", () => {
  it("appends a non-skippable lab-setup step before the folder", () => {
    expect(ids(buildPiCreateTrack())).toEqual([
      "sign-in",
      "handle",
      "profile",
      "lab-setup",
      "folder",
    ]);
  });

  it("makes lab-setup and folder required (name to create, folder to work)", () => {
    expect(skips(buildPiCreateTrack())).toEqual([
      false,
      false,
      true,
      false,
      false,
    ]);
  });
});
