// @vitest-environment jsdom
// sequence editor master (step 4). Unit tests for the pure mouse-awareness
// helpers (beaker-hover.ts), no provider mounted.
//
// Voice in comments, no em-dashes, no en-dashes, no emojis, no mid-sentence
// colons.

import { describe, it, expect, afterEach } from "vitest";
import { beakerTargetKeyOf, parseBeakerTargetKey } from "./beaker-hover";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("parseBeakerTargetKey", () => {
  it("splits on the FIRST colon, keeping composite owner:id keys intact", () => {
    expect(parseBeakerTargetKey("task:self:5")).toEqual({ kind: "task", key: "self:5" });
    expect(parseBeakerTargetKey("lab-member:alex")).toEqual({ kind: "lab-member", key: "alex" });
    expect(parseBeakerTargetKey("link:morgan:12")).toEqual({ kind: "link", key: "morgan:12" });
  });

  it("returns null without a usable kind separator", () => {
    expect(parseBeakerTargetKey("nocolon")).toBeNull();
    expect(parseBeakerTargetKey(":leading")).toBeNull();
    expect(parseBeakerTargetKey("trailing:")).toBeNull();
    expect(parseBeakerTargetKey("")).toBeNull();
    expect(parseBeakerTargetKey(null)).toBeNull();
    expect(parseBeakerTargetKey(undefined)).toBeNull();
  });
});

describe("beakerTargetKeyOf", () => {
  it("reads the key from the nearest tagged ancestor of the event target", () => {
    const card = document.createElement("div");
    card.setAttribute("data-beaker-target", "task:self:5");
    const inner = document.createElement("span");
    card.appendChild(inner);
    document.body.appendChild(card);
    // Pointer over a child still resolves the card's key (closest walks up).
    expect(beakerTargetKeyOf(inner)).toBe("task:self:5");
    expect(beakerTargetKeyOf(card)).toBe("task:self:5");
  });

  it("returns null over an untagged element (the palette, scrim, page chrome)", () => {
    const plain = document.createElement("div");
    document.body.appendChild(plain);
    expect(beakerTargetKeyOf(plain)).toBeNull();
  });

  it("returns null for a non-element target or an empty key", () => {
    expect(beakerTargetKeyOf(null)).toBeNull();
    expect(beakerTargetKeyOf(window as unknown as EventTarget)).toBeNull();
    const empty = document.createElement("div");
    empty.setAttribute("data-beaker-target", "");
    document.body.appendChild(empty);
    expect(beakerTargetKeyOf(empty)).toBeNull();
  });
});
