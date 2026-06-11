// @vitest-environment jsdom
//
// autonomy-store unit tests (ai click tests bot, 2026-06-11).
//
// Pins the BeakerBot autonomy setting: default, get, set, toggle, coercion of
// unknown values, and the plain getAutonomyMode() reader the agent loop calls
// outside React. localStorage is mocked via vitest so no real browser storage is
// touched and state is reset between tests.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  DEFAULT_AUTONOMY,
  useBeakerBotAutonomy,
  getAutonomyMode,
} from "../autonomy-store";

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
    // Real localStorage also exposes length + key, but the store module only
    // uses getItem/setItem, so stubs for those two are enough.
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
  // Reset the zustand store to a fresh "ask" state before every test, so
  // earlier tests cannot leak state into later ones.
  useBeakerBotAutonomy.setState({ mode: "ask" });
});

describe("DEFAULT_AUTONOMY", () => {
  it("is 'ask'", () => {
    expect(DEFAULT_AUTONOMY).toBe("ask");
  });
});

describe("useBeakerBotAutonomy store", () => {
  it("starts at 'ask' (the safe default)", () => {
    expect(useBeakerBotAutonomy.getState().mode).toBe("ask");
  });

  it("setMode to 'auto' updates the mode and persists it", () => {
    useBeakerBotAutonomy.getState().setMode("auto");
    expect(useBeakerBotAutonomy.getState().mode).toBe("auto");
    expect(lsMock.setItem).toHaveBeenCalledWith("ros.beakerbot.autonomy", "auto");
  });

  it("setMode back to 'ask' updates the mode and persists it", () => {
    // Start from auto so the setter actually changes something observable.
    useBeakerBotAutonomy.setState({ mode: "auto" });
    useBeakerBotAutonomy.getState().setMode("ask");
    expect(useBeakerBotAutonomy.getState().mode).toBe("ask");
    expect(lsMock.setItem).toHaveBeenCalledWith("ros.beakerbot.autonomy", "ask");
  });

  it("setMode coerces an unknown value to 'ask', the safe default", () => {
    // Cast lets us simulate a caller passing a bad string at runtime.
    useBeakerBotAutonomy.getState().setMode("banana" as never);
    expect(useBeakerBotAutonomy.getState().mode).toBe("ask");
  });

  it("toggle flips ask -> auto", () => {
    useBeakerBotAutonomy.setState({ mode: "ask" });
    useBeakerBotAutonomy.getState().toggle();
    expect(useBeakerBotAutonomy.getState().mode).toBe("auto");
  });

  it("toggle flips auto -> ask", () => {
    useBeakerBotAutonomy.setState({ mode: "auto" });
    useBeakerBotAutonomy.getState().toggle();
    expect(useBeakerBotAutonomy.getState().mode).toBe("ask");
  });

  it("toggle persists the new value", () => {
    useBeakerBotAutonomy.setState({ mode: "ask" });
    useBeakerBotAutonomy.getState().toggle();
    expect(lsMock.setItem).toHaveBeenCalledWith("ros.beakerbot.autonomy", "auto");
  });
});

describe("getAutonomyMode (plain getter for outside-React use)", () => {
  it("returns the current store mode", () => {
    useBeakerBotAutonomy.setState({ mode: "ask" });
    expect(getAutonomyMode()).toBe("ask");

    useBeakerBotAutonomy.setState({ mode: "auto" });
    expect(getAutonomyMode()).toBe("auto");
  });

  it("reflects a setMode change immediately", () => {
    useBeakerBotAutonomy.getState().setMode("auto");
    expect(getAutonomyMode()).toBe("auto");
  });

  it("reflects a toggle change immediately", () => {
    useBeakerBotAutonomy.setState({ mode: "ask" });
    useBeakerBotAutonomy.getState().toggle();
    expect(getAutonomyMode()).toBe("auto");
  });
});
