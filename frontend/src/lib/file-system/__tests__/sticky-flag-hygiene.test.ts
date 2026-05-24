// Wave 1 sticky-flag hygiene coverage for `wiki-capture-mock.ts`.
//
// Two things covered here:
//   1. `clearAllStickyDemoFlags()` removes every sessionStorage key in
//      the canonical sticky-flag list (today: just `researchos:demo-mode`).
//      This is the helper `<LeaveDemoModal>` now calls, so this is the
//      regression seam for break-bot B P1-3.
//   2. The hostname / dev-mode gates inside `getWikiCaptureVariant()`
//      stay intact: production-on-Vercel keeps blocking unless the
//      hostname is local. The full real-user shadowing guard lives in
//      `file-system-context.tsx`; this file documents the contract for
//      the helper layer.
//
// Node-env test (uses `vi.stubGlobal` to mount window / sessionStorage
// without dragging in jsdom).

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

// ── In-memory window / sessionStorage shim ────────────────────────────────
//
// wiki-capture-mock.ts is SSR-safe (every function early-returns on
// `typeof window === "undefined"`). To exercise the client paths we stub
// a minimal `window` global with sessionStorage and location.

function makeSessionStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => {
      store.clear();
    },
    get _size() {
      return store.size;
    },
  };
}

let fakeSessionStorage: ReturnType<typeof makeSessionStorage>;
let fakeLocation: { hostname: string; search: string; pathname: string };

function mountWindow(opts: {
  hostname?: string;
  search?: string;
  pathname?: string;
} = {}) {
  fakeSessionStorage = makeSessionStorage();
  fakeLocation = {
    hostname: opts.hostname ?? "localhost",
    search: opts.search ?? "",
    pathname: opts.pathname ?? "/",
  };
  vi.stubGlobal("window", {
    sessionStorage: fakeSessionStorage,
    location: fakeLocation,
  });
}

beforeEach(() => {
  mountWindow();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// Imports AFTER stubbing so the module's first reference to `window`
// (none at module-eval time, every read is lazy inside a function) is
// safe either way.
import {
  clearAllStickyDemoFlags,
  clearDemoMode,
  getDemoMode,
  getWikiCaptureVariant,
  isForceControlsMode,
  isUnlockSessionMode,
  isWikiCaptureMode,
  markDemoMode,
} from "../wiki-capture-mock";

const DEMO_MODE_KEY = "researchos:demo-mode";
const FORCE_CONTROLS_STICKY_KEY = "researchos:wiki-capture-force-controls";
const UNLOCK_SESSION_STICKY_KEY = "researchos:wiki-capture-unlock-session";

describe("clearAllStickyDemoFlags", () => {
  it("removes the demo-mode sticky key when it was set", () => {
    markDemoMode();
    expect(fakeSessionStorage.getItem(DEMO_MODE_KEY)).toBe("1");

    clearAllStickyDemoFlags();

    expect(fakeSessionStorage.getItem(DEMO_MODE_KEY)).toBeNull();
  });

  it("is idempotent / no-throw when no sticky keys are set", () => {
    expect(fakeSessionStorage._size).toBe(0);

    // Should not throw even with nothing to clear.
    clearAllStickyDemoFlags();

    expect(fakeSessionStorage._size).toBe(0);
  });

  it("leaves unrelated sessionStorage keys alone", () => {
    fakeSessionStorage.setItem("unrelated-key", "keepme");
    markDemoMode();

    clearAllStickyDemoFlags();

    // Demo-mode is gone, unrelated key untouched.
    expect(fakeSessionStorage.getItem(DEMO_MODE_KEY)).toBeNull();
    expect(fakeSessionStorage.getItem("unrelated-key")).toBe("keepme");
  });

  it("clears the demo-mode flag, so getDemoMode() returns false on the next path-less read", () => {
    markDemoMode();
    expect(getDemoMode()).toBe(true);

    clearAllStickyDemoFlags();

    // Pathname-based reads can still flip getDemoMode() back to true
    // (the URL-derived path /demo always counts as demo mode), so we
    // assert against a non-demo pathname.
    expect(fakeLocation.pathname).toBe("/");
    expect(getDemoMode()).toBe(false);
  });

  it("matches clearDemoMode() for the single-key case (back-compat)", () => {
    markDemoMode();
    expect(fakeSessionStorage.getItem(DEMO_MODE_KEY)).toBe("1");

    // Existing single-key clearer.
    clearDemoMode();
    expect(fakeSessionStorage.getItem(DEMO_MODE_KEY)).toBeNull();

    // Re-mark + clear-all should land in the same state.
    markDemoMode();
    clearAllStickyDemoFlags();
    expect(fakeSessionStorage.getItem(DEMO_MODE_KEY)).toBeNull();
  });
});

describe("getWikiCaptureVariant hostname gate (existing contract)", () => {
  it("returns null when wikiCapture is absent from URL", () => {
    mountWindow({ search: "" });
    expect(getWikiCaptureVariant()).toBeNull();
    expect(isWikiCaptureMode()).toBe(false);
  });

  it("returns 'signed-in' for ?wikiCapture=1 in non-production env", () => {
    // NODE_ENV defaults to "test" under vitest. The hostname gate only
    // runs when NODE_ENV === "production", so test env always passes.
    mountWindow({ search: "?wikiCapture=1", hostname: "localhost" });
    expect(getWikiCaptureVariant()).toBe("signed-in");
    expect(isWikiCaptureMode()).toBe(true);
  });

  it("returns 'picker' for ?wikiCapture=picker in non-production env", () => {
    mountWindow({ search: "?wikiCapture=picker", hostname: "localhost" });
    expect(getWikiCaptureVariant()).toBe("picker");
  });
});

// ── Wiki-screenshot fixture flag gates ───────────────────────────────────
//
// Both flags below are strictly gated to `isWikiCaptureMode()`: they are
// no-ops outside the fixture so real users can never hit the code paths
// they unlock. Stickiness mirrors the wiki-capture sticky pattern so
// in-tab nav that strips the query string keeps the flag alive.

describe("isForceControlsMode", () => {
  it("returns false outside wikiCapture mode", () => {
    mountWindow({ search: "?forceControls=1", hostname: "localhost" });
    expect(isForceControlsMode()).toBe(false);
  });

  it("returns true when both wikiCapture and forceControls are set", () => {
    mountWindow({
      search: "?wikiCapture=1&forceControls=1",
      hostname: "localhost",
    });
    expect(isForceControlsMode()).toBe(true);
  });

  it("returns false when wikiCapture is set but forceControls is not", () => {
    mountWindow({ search: "?wikiCapture=1", hostname: "localhost" });
    expect(isForceControlsMode()).toBe(false);
  });

  it("sticks via sessionStorage after first observation", () => {
    mountWindow({
      search: "?wikiCapture=1&forceControls=1",
      hostname: "localhost",
    });
    expect(isForceControlsMode()).toBe(true);
    expect(fakeSessionStorage.getItem(FORCE_CONTROLS_STICKY_KEY)).toBe("1");

    // Subsequent reads with `forceControls` stripped from the URL still
    // see the sticky flag: wikiCapture stays alive via the URL so the
    // gate inside `isForceControlsMode` still passes. The forceControls
    // sticky alone carries the flag forward.
    fakeLocation.search = "?wikiCapture=1";
    expect(isForceControlsMode()).toBe(true);
  });

  it("clearAllStickyDemoFlags wipes the forceControls sticky", () => {
    mountWindow({
      search: "?wikiCapture=1&forceControls=1",
      hostname: "localhost",
    });
    expect(isForceControlsMode()).toBe(true);
    expect(fakeSessionStorage.getItem(FORCE_CONTROLS_STICKY_KEY)).toBe("1");

    clearAllStickyDemoFlags();
    expect(fakeSessionStorage.getItem(FORCE_CONTROLS_STICKY_KEY)).toBeNull();
  });
});

describe("isUnlockSessionMode", () => {
  it("returns false outside wikiCapture mode", () => {
    mountWindow({ search: "?unlockSession=1", hostname: "localhost" });
    expect(isUnlockSessionMode()).toBe(false);
  });

  it("returns true when both wikiCapture and unlockSession are set", () => {
    mountWindow({
      search: "?wikiCapture=1&unlockSession=1",
      hostname: "localhost",
    });
    expect(isUnlockSessionMode()).toBe(true);
  });

  it("returns false when wikiCapture is set but unlockSession is not", () => {
    mountWindow({ search: "?wikiCapture=1", hostname: "localhost" });
    expect(isUnlockSessionMode()).toBe(false);
  });

  it("sticks via sessionStorage after first observation", () => {
    mountWindow({
      search: "?wikiCapture=1&unlockSession=1",
      hostname: "localhost",
    });
    expect(isUnlockSessionMode()).toBe(true);
    expect(fakeSessionStorage.getItem(UNLOCK_SESSION_STICKY_KEY)).toBe("1");

    // wikiCapture stays on the URL so the gate inside
    // `isUnlockSessionMode` still passes; the unlockSession sticky
    // carries the flag forward without needing the URL param.
    fakeLocation.search = "?wikiCapture=1";
    expect(isUnlockSessionMode()).toBe(true);
  });

  it("clearAllStickyDemoFlags wipes the unlockSession sticky", () => {
    mountWindow({
      search: "?wikiCapture=1&unlockSession=1",
      hostname: "localhost",
    });
    expect(isUnlockSessionMode()).toBe(true);
    expect(fakeSessionStorage.getItem(UNLOCK_SESSION_STICKY_KEY)).toBe("1");

    clearAllStickyDemoFlags();
    expect(fakeSessionStorage.getItem(UNLOCK_SESSION_STICKY_KEY)).toBeNull();
  });
});
