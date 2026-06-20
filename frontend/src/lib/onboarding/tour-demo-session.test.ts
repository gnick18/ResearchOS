import { describe, expect, it } from "vitest";
import {
  TOUR_RESUME_KEY,
  saveTourResume,
  readTourResume,
  hasTourResume,
  clearTourResume,
  endTourDemoSession,
  type StorageLike,
  type TourResumeState,
} from "./tour-demo-session";

// An in-memory StorageLike stub, so the resume marker round-trips with no real
// sessionStorage. A `throwing` flavor proves the module degrades (never throws)
// when storage is unavailable / full / privacy-mode.
function memStorage(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
}

function throwingStorage(): StorageLike {
  return {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
    removeItem: () => {
      throw new Error("blocked");
    },
  };
}

const STATE: TourResumeState = {
  role: "pi",
  goals: ["microbio", "phylo"],
  beatIndex: 2,
  fixtureFlavor: "resistance",
};

describe("tour-demo-session resume marker", () => {
  it("round-trips a saved state", () => {
    const s = memStorage();
    saveTourResume(STATE, s);
    expect(s.map.get(TOUR_RESUME_KEY)).toBeTruthy();
    expect(readTourResume(s)).toEqual(STATE);
    expect(hasTourResume(s)).toBe(true);
  });

  it("reads null when nothing is stored", () => {
    const s = memStorage();
    expect(readTourResume(s)).toBeNull();
    expect(hasTourResume(s)).toBe(false);
  });

  it("clears the marker", () => {
    const s = memStorage();
    saveTourResume(STATE, s);
    clearTourResume(s);
    expect(readTourResume(s)).toBeNull();
    expect(hasTourResume(s)).toBe(false);
  });

  it("rejects a malformed marker rather than resuming a broken tour", () => {
    const s = memStorage();
    s.map.set(TOUR_RESUME_KEY, "{not json");
    expect(readTourResume(s)).toBeNull();
  });

  it("rejects a marker missing required fields", () => {
    const s = memStorage();
    // goals is not a string array.
    s.map.set(
      TOUR_RESUME_KEY,
      JSON.stringify({ role: "pi", goals: [1, 2], beatIndex: 1, fixtureFlavor: "x" }),
    );
    expect(readTourResume(s)).toBeNull();
    // negative beatIndex is invalid.
    s.map.set(
      TOUR_RESUME_KEY,
      JSON.stringify({ role: "pi", goals: [], beatIndex: -1, fixtureFlavor: "x" }),
    );
    expect(readTourResume(s)).toBeNull();
    // empty role is invalid (cannot rebuild the role-gated reel).
    s.map.set(
      TOUR_RESUME_KEY,
      JSON.stringify({ role: "", goals: [], beatIndex: 0, fixtureFlavor: "x" }),
    );
    expect(readTourResume(s)).toBeNull();
  });

  it("accepts an empty goals list (role-default reel) with a flavor", () => {
    const s = memStorage();
    const state: TourResumeState = {
      role: "bench",
      goals: [],
      beatIndex: 0,
      fixtureFlavor: "generic",
    };
    saveTourResume(state, s);
    expect(readTourResume(s)).toEqual(state);
  });

  it("degrades silently when storage throws (never crashes the tour)", () => {
    const s = throwingStorage();
    expect(() => saveTourResume(STATE, s)).not.toThrow();
    expect(readTourResume(s)).toBeNull();
    expect(hasTourResume(s)).toBe(false);
    expect(() => clearTourResume(s)).not.toThrow();
  });

  it("treats a null storage (SSR) as no resume", () => {
    expect(readTourResume(null)).toBeNull();
    expect(hasTourResume(null)).toBe(false);
    expect(() => saveTourResume(STATE, null)).not.toThrow();
    expect(() => clearTourResume(null)).not.toThrow();
  });
});

describe("endTourDemoSession", () => {
  it("restores the real folder BEFORE clearing demo, then returns to the stashed route", async () => {
    const order: string[] = [];
    let replaced: string | null = null;
    await endTourDemoSession({
      restore: async () => {
        order.push("restore");
        return true;
      },
      clearDemoMode: () => order.push("clearDemo"),
      clearMarker: () => order.push("clearMarker"),
      consumeRoute: () => {
        order.push("consume");
        return "/datahub?doc=1";
      },
      replace: (u) => {
        order.push("replace");
        replaced = u;
      },
    });
    expect(order).toEqual([
      "restore",
      "clearDemo",
      "clearMarker",
      "consume",
      "replace",
    ]);
    expect(replaced).toBe("/datahub?doc=1");
  });

  it("falls back to / when no route was stashed (or restore failed)", async () => {
    let replaced: string | null = null;
    await endTourDemoSession({
      restore: async () => false,
      clearDemoMode: () => {},
      clearMarker: () => {},
      consumeRoute: () => null,
      replace: (u) => {
        replaced = u;
      },
    });
    expect(replaced).toBe("/");
  });

  it("still exits cleanly when restore throws (never strands the user in demo)", async () => {
    let replaced: string | null = null;
    let demoCleared = false;
    await expect(
      endTourDemoSession({
        restore: async () => {
          throw new Error("idb fail");
        },
        clearDemoMode: () => {
          demoCleared = true;
        },
        clearMarker: () => {},
        consumeRoute: () => null,
        replace: (u) => {
          replaced = u;
        },
      }),
    ).resolves.toBeUndefined();
    expect(demoCleared).toBe(true);
    expect(replaced).toBe("/");
  });
});
