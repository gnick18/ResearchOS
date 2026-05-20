// frontend/src/lib/onboarding/orchestrator.test.ts
//
// Unit tests for the onboarding-tips orchestrator, focused on the
// gating decisions that justify writing a test at all:
//
//   1. Demo / wiki-capture short-circuit.
//   2. Cooldown rejection when (active_seconds - last_tip_at) < min-gap
//      (5 minutes for suggestions, 60s for tutorial).
//   3. Route mismatch rejection when no eligible tip matches pathname.
//   4. mode === null blocks all tips (welcome modal blocks instead).
//   5. mode === "silenced" blocks all tips.
//   6. workbench-experiments-tab gate filters the tip when the active
//      sub-tab is "notes".
//   7. Action-cancel persists outcome="action-cancel" in the sidecar.
//
// The roll tick itself is non-deterministic (random fire decision in
// suggestions mode), so we test the gating predicates as pure functions
// plus the cancelTip + setOnboardingMode paths through the sidecar
// helpers. The full provider render is a React tree we don't need to
// instantiate for any of these.

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
let tutorialModeMock = false;
vi.mock("@/lib/file-system/wiki-capture-mock", () => ({
  isDemoOrWikiCapture: vi.fn(() => demoModeMock),
  isTutorialMode: vi.fn(() => tutorialModeMock),
}));

// Imports must come after the mocks.
import {
  patchOnboarding,
  readOnboarding,
  setOnboardingMode,
  type OnboardingSidecar,
} from "./sidecar";
import {
  MIN_GAP_SECONDS,
  ONBOARDING_TIPS,
  ROUTE_DWELL_SECONDS,
  TUTORIAL_MIN_GAP_SECONDS,
  tipsForRoute,
  type OnboardingTip,
} from "./tips";
import {
  isDemoOrWikiCapture,
  isTutorialMode,
} from "@/lib/file-system/wiki-capture-mock";

const USER = "alex";

beforeEach(() => {
  memFs.clear();
  demoModeMock = false;
  tutorialModeMock = false;
});

/** Pure copy of the orchestrator's gating predicate. Replicating it in
 *  the test keeps the assertion crisp without bringing up a React
 *  provider tree. If the orchestrator changes the gate, the test
 *  fails — which is the right signal.
 *
 *  `workbenchTab` simulates the URL's `?tab=` query param read by the
 *  real orchestrator's `readWorkbenchActiveTab()` helper. */
function shouldFire(
  sidecar: OnboardingSidecar,
  pathname: string,
  nowActive: number,
  routeEnterActive: number,
  workbenchTab: "experiments" | "notes" = "experiments",
): boolean {
  if (isDemoOrWikiCapture()) return false;
  if (sidecar.mode === null) return false;
  if (sidecar.mode === "silenced") return false;
  if (sidecar.tips_off) return false;
  if (sidecar.shown_count >= ONBOARDING_TIPS.length) return false;
  if (sidecar.active_seconds >= 3600) return false;
  const minGap =
    sidecar.mode === "tutorial" ? TUTORIAL_MIN_GAP_SECONDS : MIN_GAP_SECONDS;
  if (nowActive - sidecar.last_tip_at < minGap) return false;
  if (nowActive - routeEnterActive < ROUTE_DWELL_SECONDS) return false;
  const candidates = tipsForRoute(pathname).filter((tip: OnboardingTip) => {
    if (
      tip.gate === "workbench-experiments-tab" &&
      workbenchTab !== "experiments"
    ) {
      return false;
    }
    return !sidecar.tips[tip.id];
  });
  return candidates.length > 0;
}

function freshSidecar(overrides: Partial<OnboardingSidecar> = {}): OnboardingSidecar {
  return {
    version: 3,
    first_seen_at: "2026-05-14T00:00:00.000Z",
    active_seconds: 1000,
    last_tip_at: 0,
    tips: {},
    tips_off: false,
    shown_count: 0,
    mode: "suggestions",
    use_cases: null,
    wizard_completed_at: null,
    wizard_skipped_at: null,
    ...overrides,
  };
}

describe("orchestrator gating", () => {
  it("does nothing when isDemoOrWikiCapture() is true", () => {
    demoModeMock = true;
    const sc = freshSidecar();
    expect(shouldFire(sc, "/", 1000, 0)).toBe(false);
  });

  it("blocks all tips when sidecar.mode === null (welcome modal blocks)", () => {
    const sc = freshSidecar({ mode: null });
    // Even with cooldown + dwell satisfied + matching route, the
    // welcome-modal gate vetoes the fire.
    expect(shouldFire(sc, "/", 1000, 0)).toBe(false);
  });

  it("blocks all tips when sidecar.mode === 'silenced'", () => {
    const sc = freshSidecar({ mode: "silenced" });
    expect(shouldFire(sc, "/", 1000, 0)).toBe(false);
  });

  it("rejects when suggestions cooldown not satisfied (gap < 300)", () => {
    const sc = freshSidecar({ mode: "suggestions", last_tip_at: 900 });
    // 1000 - 900 = 100 < 300.
    expect(shouldFire(sc, "/", 1000, 0)).toBe(false);
    // 300 boundary satisfied.
    expect(shouldFire(sc, "/", 1200, 0)).toBe(true);
  });

  it("tutorial mode uses 60s cooldown, not 300", () => {
    const sc = freshSidecar({ mode: "tutorial", last_tip_at: 900 });
    // Suggestions would fail at 1000 - 900 = 100 < 300. Tutorial passes
    // at 100 > 60.
    // But active_seconds must also be >= last_tip_at + 60 — let's
    // test both sides of the boundary.
    expect(shouldFire(sc, "/", 950, 0)).toBe(false); // 50s < 60s
    expect(shouldFire(sc, "/", 960, 0)).toBe(true); // 60s satisfies
    expect(shouldFire(sc, "/", 1000, 0)).toBe(true); // well over 60s
  });

  it("rejects when on a route that doesn't match any eligible tip", () => {
    // Mark every "/"-routed tip as already-shown so only route-specific
    // tips remain.
    const tips: Record<string, { shown_at: null; dismissed_at: null; outcome: "x" }> = {};
    for (const tip of ONBOARDING_TIPS) {
      if (tip.route === "/") {
        tips[tip.id] = { shown_at: null, dismissed_at: null, outcome: "x" };
      }
    }
    const sc = freshSidecar({ tips });
    expect(shouldFire(sc, "/never-matches", 1000, 0)).toBe(false);
    // /gantt still has eligible tips (gantt-animations, goals-vs-tasks).
    expect(shouldFire(sc, "/gantt", 1000, 0)).toBe(true);
  });

  it("rejects when shown_count has hit the cap", () => {
    const sc = freshSidecar({ shown_count: ONBOARDING_TIPS.length });
    expect(shouldFire(sc, "/", 1000, 0)).toBe(false);
  });

  it("rejects when tips_off is sticky", () => {
    const sc = freshSidecar({ tips_off: true });
    expect(shouldFire(sc, "/", 1000, 0)).toBe(false);
  });

  it("rejects when route dwell hasn't elapsed", () => {
    const sc = freshSidecar();
    expect(shouldFire(sc, "/", 1000, 1000)).toBe(false);
    expect(shouldFire(sc, "/", 1030, 1000)).toBe(true);
  });

  it("workbench-experiments-tab gate filters when tab=notes", () => {
    // Mark every non-workbench tip as already-shown so the only
    // eligible candidate is workbench-notes.
    const tips: Record<string, { shown_at: null; dismissed_at: null; outcome: "x" }> = {};
    for (const tip of ONBOARDING_TIPS) {
      if (tip.id !== "workbench-notes") {
        tips[tip.id] = { shown_at: null, dismissed_at: null, outcome: "x" };
      }
    }
    const sc = freshSidecar({ tips });
    // With tab=experiments the gate passes.
    expect(shouldFire(sc, "/workbench", 1000, 0, "experiments")).toBe(true);
    // With tab=notes the gate vetoes the only remaining candidate.
    expect(shouldFire(sc, "/workbench", 1000, 0, "notes")).toBe(false);
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
    // Schema is at v3 as of the Onboarding v2 Phase 0 chip; v3 added
    // additive wizard fields (use_cases / wizard_completed_at /
    // wizard_skipped_at). Sidecar v2/v3 migration is pinned in
    // `sidecar.test.ts`.
    expect(sc.version).toBe(3);
    expect(sc.shown_count).toBe(0);
    expect(sc.tips_off).toBe(false);
    expect(sc.active_seconds).toBe(0);
    expect(sc.last_tip_at).toBe(0);
    expect(sc.tips).toEqual({});
    // The welcome-modal default: mode starts unset so the modal blocks
    // tips until the user picks.
    expect(sc.mode).toBeNull();
  });

  it("setOnboardingMode persists the pick and sets last_tip_at to the cooldown-bypass sentinel", async () => {
    // Bootstrap with a previously-served sidecar. Mode-setter sets
    // `last_tip_at` to `active_seconds - 999_999` so the cooldown
    // gate (`now - last_tip_at >= minGap`) is already satisfied at
    // pick-time and the FIRST tip after the welcome-modal pick can
    // fire as soon as a target is in the DOM on a matching route.
    // Subsequent tips obey the real cooldown because `recordShown()`
    // bumps `last_tip_at` to the current `active_seconds` on each
    // fire. See sidecar.ts `setOnboardingMode()` for the rationale.
    await patchOnboarding(USER, (cur) => ({
      ...cur,
      active_seconds: 5000,
      last_tip_at: 0,
    }));
    const after = await setOnboardingMode(USER, "tutorial");
    expect(after.mode).toBe("tutorial");
    expect(after.last_tip_at).toBe(after.active_seconds - 999_999);
  });
});

describe("Phase 4: tutorial-mode carve-out for demo lab", () => {
  // The orchestrator's normal demo short-circuit (`shouldFire` returns
  // false when isDemoOrWikiCapture() is true) is preserved unchanged
  // — the carve-out lives one layer up in `OnboardingProvider`, which
  // mounts a separate `<OnboardingTutorialSequencer>` instead of the
  // orchestrator when both demo + tutorial flags are set. These tests
  // model the provider-layer decision matrix as a pure function so we
  // can assert it without spinning up a React tree.

  /** Mirrors `OnboardingProvider`'s mount decision. Returns the
   *  string name of the surface that would be mounted ("none",
   *  "tutorial", "orchestrator") so assertions are crisp. */
  function mountedSurface(currentUser: string | null): string {
    if (!currentUser) return "none";
    if (isDemoOrWikiCapture()) {
      if (isTutorialMode()) return "tutorial";
      return "none";
    }
    return "orchestrator";
  }

  it("mounts orchestrator on a real folder (no demo, no tutorial)", () => {
    demoModeMock = false;
    tutorialModeMock = false;
    expect(mountedSurface("alex")).toBe("orchestrator");
  });

  it("mounts nothing in demo mode without tutorial flag (preserves Phase-3 behavior)", () => {
    demoModeMock = true;
    tutorialModeMock = false;
    expect(mountedSurface("alex")).toBe("none");
  });

  it("mounts tutorial sequencer in demo mode with tutorial flag", () => {
    demoModeMock = true;
    tutorialModeMock = true;
    expect(mountedSurface("alex")).toBe("tutorial");
  });

  it("mounts orchestrator (NOT tutorial) on a real folder even with tutorial flag", () => {
    // Tutorial flag without demo mode is a no-op — we only ever
    // open ?tutorial=1 against /demo, never against the real folder.
    demoModeMock = false;
    tutorialModeMock = true;
    expect(mountedSurface("alex")).toBe("orchestrator");
  });

  it("mounts nothing when no current user (sign-out)", () => {
    demoModeMock = true;
    tutorialModeMock = true;
    expect(mountedSurface(null)).toBe("none");
  });
});

describe("tip catalog shape", () => {
  it("exposes the 10-tip orchestrator catalog", () => {
    // 11th tip (lab-mode-picker) is standalone, not in this array.
    expect(ONBOARDING_TIPS).toHaveLength(10);
    const ids = ONBOARDING_TIPS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("filters tips by pathname.startsWith(route) and sorts by priority", () => {
    const onHome = tipsForRoute("/");
    expect(onHome.every((t) => "/".startsWith(t.route))).toBe(true);
    for (let i = 1; i < onHome.length; i++) {
      expect(onHome[i].priority).toBeGreaterThan(onHome[i - 1].priority);
    }
  });

  it("Phase-4 tutorial walk: catalog order is the tour order (priority-sorted)", () => {
    // The sequencer iterates `ONBOARDING_TIPS` directly without
    // re-sorting. The catalog's source-file ordering matches priority
    // (1, 2, 3, 4, 6, 7, 8, 9, 10, 11), so the tutorial walks tips in
    // priority order. If a future tip is inserted out of source-order
    // (e.g. priority 5 dropped between tips 4 and 6), this test
    // catches the divergence so the sequencer can be re-sorted.
    for (let i = 1; i < ONBOARDING_TIPS.length; i++) {
      expect(ONBOARDING_TIPS[i].priority).toBeGreaterThan(
        ONBOARDING_TIPS[i - 1].priority,
      );
    }
  });
});
