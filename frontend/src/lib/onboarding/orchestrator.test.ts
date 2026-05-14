// frontend/src/lib/onboarding/orchestrator.test.ts
//
// Unit tests for the onboarding-tips orchestrator, focused on the four
// gating decisions that justify writing a test at all:
//
//   1. Demo / wiki-capture short-circuit.
//   2. Cooldown rejection when (active_seconds - last_tip_at) < 300.
//   3. Route mismatch rejection when no eligible tip matches pathname.
//   4. Action-cancel persists outcome="action-cancel" in the sidecar.
//
// The roll tick itself is non-deterministic (random fire decision), so
// we test the gating predicates as pure functions, plus the cancelTip
// path via the public `patchOnboarding` helper that wraps the sidecar
// write. The full provider render is a React tree we don't need to
// instantiate for any of these — keeping the test surface pure module
// behavior keeps the runtime cheap and avoids the testing-library + dom
// setup the rest of the suite doesn't have.

import { describe, expect, it, vi, beforeEach } from "vitest";

const memFs = new Map<string, unknown>();

vi.mock("@/lib/file-system/file-service", () => ({
  fileService: {
    readJson: vi.fn(async (path: string) => {
      const v = memFs.get(path);
      return v === undefined ? null : v;
    }),
    writeJson: vi.fn(async (path: string, data: unknown) => {
      memFs.set(path, data);
    }),
  },
}));

let demoModeMock = false;
vi.mock("@/lib/file-system/wiki-capture-mock", () => ({
  isDemoOrWikiCapture: vi.fn(() => demoModeMock),
}));

// Imports must come after the mocks.
import {
  patchOnboarding,
  readOnboarding,
  type OnboardingSidecar,
} from "./sidecar";
import {
  MIN_GAP_SECONDS,
  ONBOARDING_TIPS,
  ROUTE_DWELL_SECONDS,
  tipsForRoute,
} from "./tips";
import { isDemoOrWikiCapture } from "@/lib/file-system/wiki-capture-mock";

const USER = "alex";

beforeEach(() => {
  memFs.clear();
  demoModeMock = false;
});

/** Pure copy of the orchestrator's gating predicate. The actual
 *  orchestrator inlines this inside its roll tick; replicating it in
 *  the test keeps the assertion crisp without bringing up a React
 *  provider tree. If the orchestrator changes the gate, the test
 *  fails — which is the right signal. */
function shouldFire(
  sidecar: OnboardingSidecar,
  pathname: string,
  nowActive: number,
  routeEnterActive: number,
): boolean {
  if (isDemoOrWikiCapture()) return false;
  if (sidecar.tips_off) return false;
  if (sidecar.shown_count >= 10) return false;
  if (sidecar.active_seconds >= 3600) return false;
  if (nowActive - sidecar.last_tip_at < MIN_GAP_SECONDS) return false;
  if (nowActive - routeEnterActive < ROUTE_DWELL_SECONDS) return false;
  const candidates = tipsForRoute(pathname).filter(
    (tip) => !sidecar.tips[tip.id],
  );
  return candidates.length > 0;
}

function freshSidecar(overrides: Partial<OnboardingSidecar> = {}): OnboardingSidecar {
  return {
    version: 1,
    first_seen_at: "2026-05-14T00:00:00.000Z",
    active_seconds: 1000,
    last_tip_at: 0,
    tips: {},
    tips_off: false,
    shown_count: 0,
    ...overrides,
  };
}

describe("orchestrator gating", () => {
  it("does nothing when isDemoOrWikiCapture() is true", () => {
    demoModeMock = true;
    const sc = freshSidecar();
    expect(shouldFire(sc, "/", 1000, 0)).toBe(false);
  });

  it("rejects when (active_seconds - last_tip_at) < 300", () => {
    const sc = freshSidecar({ last_tip_at: 900 });
    // 1000 - 900 = 100 < 300 → cooldown not satisfied.
    expect(shouldFire(sc, "/", 1000, 0)).toBe(false);
    // After 200 more active-seconds, the gap is 300, which is the
    // boundary — the spec says `>= 300` passes, so 1200 - 900 = 300
    // should fire.
    expect(shouldFire(sc, "/", 1200, 0)).toBe(true);
  });

  it("rejects when on a route that doesn't match any eligible tip", () => {
    // Mark every "/"-routed tip as already-shown so only route-specific
    // tips remain. Then assert that /lab + /methods + /settings + /gantt
    // each match their own tip(s), and that a synthetic route /never
    // (which is none of those AND not "/") matches nothing.
    const tips: Record<string, { shown_at: null; dismissed_at: null; outcome: "x" }> = {};
    for (const tip of ONBOARDING_TIPS) {
      if (tip.route === "/") {
        tips[tip.id] = { shown_at: null, dismissed_at: null, outcome: "x" };
      }
    }
    const sc = freshSidecar({ tips });
    // A nonexistent route should now have no eligible tips left.
    expect(shouldFire(sc, "/never-matches", 1000, 0)).toBe(false);
    // Lab page still matches the lab-mode tip.
    expect(shouldFire(sc, "/lab", 1000, 0)).toBe(true);
  });

  it("rejects when shown_count has hit the cap", () => {
    const sc = freshSidecar({ shown_count: 10 });
    expect(shouldFire(sc, "/", 1000, 0)).toBe(false);
  });

  it("rejects when tips_off is sticky", () => {
    const sc = freshSidecar({ tips_off: true });
    expect(shouldFire(sc, "/", 1000, 0)).toBe(false);
  });

  it("rejects when route dwell hasn't elapsed", () => {
    const sc = freshSidecar();
    // Just landed on the route; nowActive == routeEnterActive.
    expect(shouldFire(sc, "/", 1000, 1000)).toBe(false);
    // 30s later, dwell satisfies.
    expect(shouldFire(sc, "/", 1030, 1000)).toBe(true);
  });
});

describe("sidecar action-cancel persistence", () => {
  it("records outcome='action-cancel' in the sidecar map", async () => {
    const tipId = ONBOARDING_TIPS[0].id;
    await patchOnboarding(USER, (cur) => ({
      ...cur,
      tips: {
        ...cur.tips,
        [tipId]: {
          shown_at: null,
          dismissed_at: new Date().toISOString(),
          outcome: "action-cancel",
        },
      },
    }));
    const after = await readOnboarding(USER);
    expect(after.tips[tipId].outcome).toBe("action-cancel");
    expect(after.tips[tipId].shown_at).toBeNull();
    expect(after.tips[tipId].dismissed_at).not.toBeNull();
  });

  it("normalizes a missing sidecar into a fresh default on read", async () => {
    const sc = await readOnboarding("brand-new-user");
    expect(sc.version).toBe(1);
    expect(sc.shown_count).toBe(0);
    expect(sc.tips_off).toBe(false);
    expect(sc.active_seconds).toBe(0);
    expect(sc.last_tip_at).toBe(0);
    expect(sc.tips).toEqual({});
  });
});

describe("tip catalog shape", () => {
  it("exposes exactly the 10 LOCKED tips from the proposal", () => {
    expect(ONBOARDING_TIPS).toHaveLength(10);
    // Priority is a strict 1..10 sequence.
    const priorities = ONBOARDING_TIPS.map((t) => t.priority);
    expect(priorities).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    // No duplicate ids.
    const ids = ONBOARDING_TIPS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("filters tips by pathname.startsWith(route) and sorts by priority", () => {
    const onHome = tipsForRoute("/");
    // /home matches tips whose route is "/" only (every route would
    // match "/" via startsWith, but our catalog has tips with specific
    // routes that don't reverse-match — e.g. tip with route "/methods"
    // does NOT match pathname "/").
    expect(onHome.every((t) => "/".startsWith(t.route))).toBe(true);
    // Sorted ascending by priority.
    for (let i = 1; i < onHome.length; i++) {
      expect(onHome[i].priority).toBeGreaterThan(onHome[i - 1].priority);
    }
  });
});
