// @vitest-environment jsdom
//
// Spotlight controller test (ai perception bot, 2026-06-11).
//
// Covers the premium spotlight, mounting the scrim, ring, pointer cue, and bubble
// over a target, replacing a prior spotlight rather than stacking, dismissing via
// the bubble control, and tearing down when the target detaches from the DOM.
// jsdom has no layout or smooth scroll, so we stub scrollIntoView and assert on the
// nodes rather than pixel positions.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  showSpotlight,
  dismissSpotlight,
  isSpotlightActive,
} from "../spotlight-controller";

function makeTarget(label: string): HTMLElement {
  const el = document.createElement("button");
  el.textContent = label;
  // jsdom does not implement scrollIntoView, stub it so the controller runs.
  el.scrollIntoView = vi.fn();
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  dismissSpotlight();
  document.body.innerHTML = "";
});

describe("showSpotlight", () => {
  it("mounts the scrim, ring, cue, and bubble", () => {
    const el = makeTarget("New method");
    showSpotlight(el, "Here is the New method button.");

    expect(document.querySelector('[data-testid="beakerbot-spotlight-scrim"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="beakerbot-spotlight-ring"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="beakerbot-spotlight-cue"]')).toBeTruthy();
    const bubble = document.querySelector('[data-testid="beakerbot-spotlight-bubble"]');
    expect(bubble?.textContent).toContain("Here is the New method button.");
    expect(isSpotlightActive()).toBe(true);
  });

  it("scrolls the target into view", () => {
    const el = makeTarget("Add");
    showSpotlight(el, "note");
    expect(el.scrollIntoView).toHaveBeenCalled();
  });

  it("replaces a prior spotlight rather than stacking rings", () => {
    showSpotlight(makeTarget("First"), "a");
    showSpotlight(makeTarget("Second"), "b");
    expect(
      document.querySelectorAll('[data-testid="beakerbot-spotlight-ring"]').length,
    ).toBe(1);
  });

  it("dismisses via the bubble control", () => {
    showSpotlight(makeTarget("Edit"), "note");
    const dismiss = document.querySelector<HTMLButtonElement>(
      '[data-testid="beakerbot-spotlight-dismiss"]',
    );
    expect(dismiss).toBeTruthy();
    dismiss!.click();
    expect(isSpotlightActive()).toBe(false);
    expect(document.querySelector('[data-testid="beakerbot-spotlight-ring"]')).toBeNull();
  });
});

describe("dismissSpotlight", () => {
  it("tears down all nodes", () => {
    showSpotlight(makeTarget("X"), "note");
    dismissSpotlight();
    expect(document.querySelector('[data-testid="beakerbot-spotlight-scrim"]')).toBeNull();
    expect(document.querySelector('[data-testid="beakerbot-spotlight-bubble"]')).toBeNull();
    expect(isSpotlightActive()).toBe(false);
  });

  it("is safe to call when nothing is showing", () => {
    expect(() => dismissSpotlight()).not.toThrow();
  });
});
