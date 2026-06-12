// @vitest-environment jsdom
//
// review-mode-store unit tests (ai review-mode bot, 2026-06-12).
//
// Pins the BeakerBot review mode setting: default, get, set, toggle, coercion of
// unknown values, persistence, and the plain getReviewMode() reader the agent
// loop calls outside React. localStorage is mocked via vitest so no real browser
// storage is touched and state is reset between tests.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  DEFAULT_REVIEW_MODE,
  useBeakerBotReviewMode,
  getReviewMode,
} from "../review-mode-store";

// Minimal localStorage stub. A fresh Map per test gives isolation without
// module re-import overhead (the zustand store keeps its own state across tests
// unless we reset it directly, which we do in beforeEach).
function makeLocalStorageStub() {
  const store = new Map<string, string>();
  return {
    getItem: vi.fn((k: string) => store.get(k) ?? null),
    setItem: vi.fn((k: string, v: string) => store.set(k, v)),
    removeItem: vi.fn((k: string) => store.delete(k)),
    clear: vi.fn(() => store.clear()),
    get length() {
      return store.size;
    },
    key: vi.fn((i: number) => [...store.keys()][i] ?? null),
  };
}

let lsMock: ReturnType<typeof makeLocalStorageStub>;

beforeEach(() => {
  lsMock = makeLocalStorageStub();
  vi.stubGlobal("localStorage", lsMock);
  // Reset the zustand store to a fresh "step" state before every test, so
  // earlier tests cannot leak state into later ones.
  useBeakerBotReviewMode.setState({ mode: "step" });
});

describe("DEFAULT_REVIEW_MODE", () => {
  it("is 'step' (the most transparent default)", () => {
    expect(DEFAULT_REVIEW_MODE).toBe("step");
  });
});

describe("useBeakerBotReviewMode store", () => {
  it("starts at 'step' (the safe default)", () => {
    expect(useBeakerBotReviewMode.getState().mode).toBe("step");
  });

  it("setMode to 'plan' updates the mode and persists it", () => {
    useBeakerBotReviewMode.getState().setMode("plan");
    expect(useBeakerBotReviewMode.getState().mode).toBe("plan");
    expect(lsMock.setItem).toHaveBeenCalledWith(
      "ros.beakerbot.reviewMode",
      "plan",
    );
  });

  it("setMode back to 'step' updates the mode and persists it", () => {
    // Start from plan so the setter actually changes something observable.
    useBeakerBotReviewMode.setState({ mode: "plan" });
    useBeakerBotReviewMode.getState().setMode("step");
    expect(useBeakerBotReviewMode.getState().mode).toBe("step");
    expect(lsMock.setItem).toHaveBeenCalledWith(
      "ros.beakerbot.reviewMode",
      "step",
    );
  });

  it("setMode coerces an unknown value to 'step', the safe default", () => {
    // Cast lets us simulate a caller passing a bad string at runtime.
    useBeakerBotReviewMode.getState().setMode("banana" as never);
    expect(useBeakerBotReviewMode.getState().mode).toBe("step");
  });

  it("toggle flips step -> plan", () => {
    useBeakerBotReviewMode.setState({ mode: "step" });
    useBeakerBotReviewMode.getState().toggle();
    expect(useBeakerBotReviewMode.getState().mode).toBe("plan");
  });

  it("toggle flips plan -> step", () => {
    useBeakerBotReviewMode.setState({ mode: "plan" });
    useBeakerBotReviewMode.getState().toggle();
    expect(useBeakerBotReviewMode.getState().mode).toBe("step");
  });

  it("toggle persists the new value", () => {
    useBeakerBotReviewMode.setState({ mode: "step" });
    useBeakerBotReviewMode.getState().toggle();
    expect(lsMock.setItem).toHaveBeenCalledWith(
      "ros.beakerbot.reviewMode",
      "plan",
    );
  });
});

describe("getReviewMode (plain getter for outside-React use)", () => {
  it("returns the current store mode", () => {
    useBeakerBotReviewMode.setState({ mode: "step" });
    expect(getReviewMode()).toBe("step");

    useBeakerBotReviewMode.setState({ mode: "plan" });
    expect(getReviewMode()).toBe("plan");
  });

  it("reflects a setMode change immediately", () => {
    useBeakerBotReviewMode.getState().setMode("plan");
    expect(getReviewMode()).toBe("plan");
  });

  it("reflects a toggle change immediately", () => {
    useBeakerBotReviewMode.setState({ mode: "step" });
    useBeakerBotReviewMode.getState().toggle();
    expect(getReviewMode()).toBe("plan");
  });
});
