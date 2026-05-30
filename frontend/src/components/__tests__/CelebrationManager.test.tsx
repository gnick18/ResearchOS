// Component tests for the Phase S6 CelebrationManager.
//
// Covers:
//  - Renders nothing when no celebrations are pending
//  - Renders one scene when a celebration is pending
//  - onComplete advances and persists the seen-tag
//  - One-per-session cap (queue of 3 → only scene 1 fires)
//  - Live milestone events (onStreakMilestoneCrossed) feed the queue
//  - Random scene pick covers all 6 pool entries over many iterations
//  - Tour-active deferral: when tourMode !== null, no scene fires; when
//    tourMode flips back to null, the deferred scene fires
//
// The streak-sidecar fileService is replaced with an in-memory Map.
// The tour controller is faked via a tiny test-only provider so we
// can control tourMode without spinning up the full v4 TourController
// machinery.

import {
  describe,
  expect,
  it,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import { act, render, waitFor } from "@testing-library/react";

// ---- mocks -------------------------------------------------------

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
    isConnected: vi.fn(() => true),
  },
}));

const userMetaMap = new Map<string, { created_at: string; color: string }>();
vi.mock("@/lib/file-system/user-metadata", () => ({
  getUserMetadata: vi.fn(async (username: string) => {
    return userMetaMap.get(username) ?? null;
  }),
}));

// Fake tour controller: the manager only reads `tourMode`. We expose
// a setter via a module-level ref so each test can flip tourMode at
// will, then re-render the manager.
const tourState: { mode: "in-product-walkthrough" | null } = { mode: null };
vi.mock("@/components/onboarding/v4/TourController", () => ({
  useOptionalTourController: () => {
    return tourState.mode === null
      ? null
      : ({ tourMode: tourState.mode } as { tourMode: string | null });
  },
}));

// Capture the manager's milestone listener so tests can fire events
// without standing up the full S1 tick path. The real implementation
// is also available via vi.importActual for tests that prefer it; here
// we use the captured-listener approach so the queue-from-event test
// can assert the listener wiring AND drive a synthetic event.
const capturedListeners = new Set<
  (event: { username: string; tag: string; count: number }) => void
>();
vi.mock("@/lib/streak/streak-activity-tracker", () => ({
  onStreakMilestoneCrossed: (
    cb: (event: { username: string; tag: string; count: number }) => void,
  ) => {
    capturedListeners.add(cb);
    return () => {
      capturedListeners.delete(cb);
    };
  },
  __resetStreakActivityTrackerForTests: () => {
    capturedListeners.clear();
  },
}));

// ---- module under test ------------------------------------------

import {
  __resetStreakWriteQueueForTests,
  type StreakSidecar,
} from "@/lib/streak/streak-sidecar";
import { __resetStreakActivityTrackerForTests } from "@/lib/streak/streak-activity-tracker";
import CelebrationManager, {
  CELEBRATION_POOL,
  pickRandomCelebration,
} from "@/components/onboarding/CelebrationManager";

const USER = "alex";
const PATH = `users/${USER}/_streak.json`;

/** ISO YYYY-MM-DD for today (local), mirroring the manager's helper. */
function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Mark the per-user daily-hello as already fired today so the once-per-
 *  day greeting (beakerbot-joy manager) does not fire in tests that
 *  assert on the milestone path in isolation. */
function suppressHelloToday(username: string): void {
  window.localStorage.setItem(
    `researchOS.beakerHello.${username}.lastDate`,
    todayIso(),
  );
}

/** Set the user's beakerBotAnimations setting (read by the manager via
 *  useBeakerBotAnimations → readUserSettings → fileService). Writing the
 *  settings.json into the in-memory FS is enough; the hook reads it on
 *  mount. */
function setBeakerBotAnimations(username: string, value: boolean): void {
  memFs.set(`users/${username}/settings.json`, { beakerBotAnimations: value });
}

function freshSidecar(over: Partial<StreakSidecar> = {}): StreakSidecar {
  return {
    schema_version: 1,
    enabled: true,
    current_count: 0,
    longest_count: 0,
    last_activity_date: null,
    started_on: null,
    shown_privacy_notice: false,
    pto_dates: [],
    celebrations_seen: {
      account_anniversaries: [],
      streak_milestones: [],
    },
    ...over,
  };
}

beforeEach(() => {
  memFs.clear();
  userMetaMap.clear();
  __resetStreakWriteQueueForTests();
  __resetStreakActivityTrackerForTests();
  tourState.mode = null;
  // Isolate the daily-hello localStorage dedup between tests. Each test
  // that wants the hello suppressed calls suppressHelloToday explicitly.
  if (typeof window !== "undefined") {
    try {
      window.localStorage.clear();
    } catch {
      // jsdom localStorage is always present; guard for safety.
    }
  }
  // Default matchMedia stub: not reduced-motion. Multi-stage scenes
  // (Ladder / Eureka / MouseWave) inspect this when their effects run.
  if (typeof window !== "undefined") {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }
});

afterEach(() => {
  vi.useRealTimers();
});

/** Query for any rendered celebration scene (multi-stage OR
 *  pose-only). The manager renders ONE of these at a time. */
function celebrationSceneCount(): number {
  return (
    document.querySelectorAll(
      [
        '[data-testid="beakerbot-ladder-scene"]',
        '[data-testid="beakerbot-eureka-scene"]',
        '[data-testid="beakerbot-mouse-wave-scene"]',
        '[data-testid="beakerbot-skateboard-scene"]',
        '[data-testid="beakerbot-too-many-beakers-scene"]',
        '[data-testid="beakerbot-pose-celebration-scene"]',
      ].join(","),
    ).length
  );
}

describe("CelebrationManager", () => {
  it("renders nothing when no celebrations are pending", async () => {
    // Empty sidecar + no user_metadata → no pending tags.
    // Suppress the once-per-day hello so this asserts the milestone path
    // in isolation (the hello has its own dedicated tests below).
    suppressHelloToday(USER);
    memFs.set(PATH, freshSidecar());
    render(<CelebrationManager username={USER} />);
    // Give the async evaluator a chance to settle.
    await waitFor(() => {
      // The manager has neither active state nor queued items.
      expect(celebrationSceneCount()).toBe(0);
    });
  });

  it("renders nothing when username is null", () => {
    render(<CelebrationManager username={null} />);
    expect(celebrationSceneCount()).toBe(0);
  });

  it("renders one scene when a celebration is pending on mount", async () => {
    // Seed a pending streak-milestone (3d crossing).
    memFs.set(PATH, freshSidecar({ current_count: 3 }));
    render(<CelebrationManager username={USER} />);

    await waitFor(() => {
      expect(celebrationSceneCount()).toBe(1);
    });
  });

  it("persists the seen-tag when the scene completes", async () => {
    // Force the pose-only branch by stubbing pickRandomCelebration via
    // the cheering pose (easier to drive to completion with fake timers
    // than the multi-stage scenes' 10-second timelines). We can't easily
    // override the module-level pickRandomCelebration without
    // dependency-injection plumbing, so we rely on the random pick
    // landing on the pose branch eventually, or test the persistence
    // through the scheduler API directly. Here we DO drive a render +
    // verify the seen-tag is persisted by force-completing via the
    // BeakerBotPoseCelebrationScene's hold timer when it's picked.
    //
    // Force-seed Math.random so the manager's pickRandomCelebration
    // lands on the cheering pose (index 6 in the pool after the
    // 2026-05-25 additions of skateboard + tooManyBeakers).
    const realRandom = Math.random;
    Math.random = () => 6 / CELEBRATION_POOL.length + 0.001;
    try {
      vi.useFakeTimers();
      memFs.set(PATH, freshSidecar({ current_count: 7 }));
      render(<CelebrationManager username={USER} />);

      // Flush the async evaluator + mount effect.
      await act(async () => {
        await Promise.resolve();
      });
      // Run the queue-drain effect.
      await act(async () => {
        await Promise.resolve();
      });

      // A pose-celebration scene should now be on screen.
      expect(
        document.querySelector(
          '[data-testid="beakerbot-pose-celebration-scene"]',
        ),
      ).not.toBeNull();

      // Advance past the pose-celebration's 2-second hold so it fires
      // onComplete.
      await act(async () => {
        vi.advanceTimersByTime(2100);
      });
      // Wait for the async markCelebrationSeen patch to settle.
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      // The 3d tag (the first crossed threshold for count=7) should be
      // persisted; we may get any of 3d/7d depending on pick order, so
      // assert at least one streak_milestone tag is present.
      const stored = memFs.get(PATH) as StreakSidecar;
      expect(
        stored.celebrations_seen.streak_milestones.length,
      ).toBeGreaterThan(0);
    } finally {
      Math.random = realRandom;
      vi.useRealTimers();
    }
  });

  it("one-per-session: queue with multiple items only fires one scene", async () => {
    // Seed multiple pending tags. count=14 → 3d, 7d, 14d all pending.
    memFs.set(PATH, freshSidecar({ current_count: 14 }));
    render(<CelebrationManager username={USER} />);

    await waitFor(() => {
      expect(celebrationSceneCount()).toBe(1);
    });

    // Even after waiting, only ONE scene should be on screen. We don't
    // need to complete it: the session lock is based on "did we
    // START a celebration" not "did we finish one".
    await new Promise((r) => setTimeout(r, 50));
    expect(celebrationSceneCount()).toBe(1);
  });

  // ---- 7-day-streak twirl (twirl-milestones bot) -------------------
  //
  // The first-ever 7d streak milestone renders the BeakerBot twirl
  // instead of a random pool scene, so exactly ONE celebration plays for
  // the streak (no double-fire). The standalone useMilestoneTwirlTrigger
  // hook deliberately skips the streak; this manager is its sole owner.

  it("first 7-day streak renders the twirl, not a random pool scene", async () => {
    suppressHelloToday(USER);
    // count=7 with 3d already seen → 7d is the ONLY pending milestone.
    memFs.set(
      PATH,
      freshSidecar({
        current_count: 7,
        celebrations_seen: {
          account_anniversaries: [],
          streak_milestones: ["3d"],
        },
      }),
    );
    render(<CelebrationManager username={USER} />);

    await waitFor(() => {
      expect(
        document.querySelector('[data-testid="beakerbot-twirl-scene"]'),
      ).not.toBeNull();
    });
    // And crucially NOT a separate corner pool scene on top of it.
    expect(celebrationSceneCount()).toBe(0);
  });

  it("7d twirl persists the seen-tag on complete so it never re-fires", async () => {
    vi.useFakeTimers();
    try {
      suppressHelloToday(USER);
      memFs.set(
        PATH,
        freshSidecar({
          current_count: 7,
          celebrations_seen: {
            account_anniversaries: [],
            streak_milestones: ["3d"],
          },
        }),
      );
      render(<CelebrationManager username={USER} />);

      await act(async () => {
        await Promise.resolve();
      });
      await act(async () => {
        await Promise.resolve();
      });
      expect(
        document.querySelector('[data-testid="beakerbot-twirl-scene"]'),
      ).not.toBeNull();

      // Twirl hold is ~1.9s; advance past it so onComplete fires.
      await act(async () => {
        vi.advanceTimersByTime(2200);
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      const stored = memFs.get(PATH) as StreakSidecar;
      expect(stored.celebrations_seen.streak_milestones).toContain("7d");
    } finally {
      vi.useRealTimers();
    }
  });

  it("higher streak tag (14d) with 7d already seen uses the pool, not the twirl", async () => {
    suppressHelloToday(USER);
    // count=14 with 3d + 7d seen → 14d is the only pending milestone.
    memFs.set(
      PATH,
      freshSidecar({
        current_count: 14,
        celebrations_seen: {
          account_anniversaries: [],
          streak_milestones: ["3d", "7d"],
        },
      }),
    );
    render(<CelebrationManager username={USER} />);

    await waitFor(() => {
      expect(celebrationSceneCount()).toBe(1);
    });
    // The twirl must NOT render for higher milestones.
    expect(
      document.querySelector('[data-testid="beakerbot-twirl-scene"]'),
    ).toBeNull();
  });

  it("7d twirl is suppressed when BeakerBot animations are off", async () => {
    suppressHelloToday(USER);
    setBeakerBotAnimations(USER, false);
    memFs.set(
      PATH,
      freshSidecar({
        current_count: 7,
        celebrations_seen: {
          account_anniversaries: [],
          streak_milestones: ["3d"],
        },
      }),
    );
    render(<CelebrationManager username={USER} />);

    await new Promise((r) => setTimeout(r, 50));
    expect(
      document.querySelector('[data-testid="beakerbot-twirl-scene"]'),
    ).toBeNull();
    expect(celebrationSceneCount()).toBe(0);
  });

  it("live milestone event appends to the queue and fires a scene", async () => {
    // Start with no pending celebrations. Suppress the daily hello so the
    // initial "0 scenes" assertion isolates the live-event path.
    suppressHelloToday(USER);
    memFs.set(PATH, freshSidecar());
    render(<CelebrationManager username={USER} />);

    // Wait for the on-mount evaluator to settle and the manager to
    // register its listener via the mocked onStreakMilestoneCrossed.
    await waitFor(() => {
      expect(capturedListeners.size).toBe(1);
    });
    expect(celebrationSceneCount()).toBe(0);

    // Fire a live milestone event matching the active username. The
    // listener appends to the queue, the drain effect picks it up.
    act(() => {
      for (const cb of capturedListeners) {
        cb({ username: USER, tag: "3d", count: 3 });
      }
    });

    await waitFor(() => {
      expect(celebrationSceneCount()).toBe(1);
    });
  });

  it("ignores milestone events for a different username", async () => {
    suppressHelloToday(USER);
    memFs.set(PATH, freshSidecar());
    render(<CelebrationManager username={USER} />);

    await waitFor(() => {
      expect(capturedListeners.size).toBe(1);
    });

    act(() => {
      for (const cb of capturedListeners) {
        cb({ username: "someone-else", tag: "3d", count: 3 });
      }
    });

    // Give the queue/drain a tick to verify nothing fires.
    await new Promise((r) => setTimeout(r, 30));
    expect(celebrationSceneCount()).toBe(0);
  });

  it("tour active (tourMode !== null) defers firing", async () => {
    tourState.mode = "in-product-walkthrough";
    memFs.set(PATH, freshSidecar({ current_count: 7 }));
    const { rerender } = render(<CelebrationManager username={USER} />);

    // Even with pending celebrations, no scene should fire while the
    // tour is active.
    await new Promise((r) => setTimeout(r, 50));
    expect(celebrationSceneCount()).toBe(0);

    // Flip the tour off, re-render so the manager re-reads the
    // mocked controller value, and the deferred scene should now fire.
    tourState.mode = null;
    rerender(<CelebrationManager username={USER} />);

    await waitFor(() => {
      expect(celebrationSceneCount()).toBe(1);
    });
  });
});

describe("CelebrationManager daily hello (beakerbot-joy manager)", () => {
  it("fires the once-per-day hello wave for a fresh user with no milestones", async () => {
    // No localStorage hello key set, empty sidecar, no milestones → the
    // daily hello fires the mouseWave scene.
    memFs.set(PATH, freshSidecar());
    render(<CelebrationManager username={USER} />);

    await waitFor(() => {
      expect(
        document.querySelector(
          '[data-testid="beakerbot-mouse-wave-scene"]',
        ),
      ).not.toBeNull();
    });
    // And the per-day localStorage dedup is now stamped with today.
    expect(
      window.localStorage.getItem(`researchOS.beakerHello.${USER}.lastDate`),
    ).toBe(todayIso());
  });

  it("does NOT re-fire the hello once it has already fired today", async () => {
    suppressHelloToday(USER);
    memFs.set(PATH, freshSidecar());
    render(<CelebrationManager username={USER} />);

    await new Promise((r) => setTimeout(r, 40));
    expect(celebrationSceneCount()).toBe(0);
  });

  it("suppresses BOTH hello AND streak celebrations when beakerBotAnimations is off", async () => {
    // Opt-out: a pending milestone (count=7) AND a never-fired daily hello
    // are both suppressed when the setting is false.
    setBeakerBotAnimations(USER, false);
    memFs.set(PATH, freshSidecar({ current_count: 7 }));
    render(<CelebrationManager username={USER} />);

    await new Promise((r) => setTimeout(r, 60));
    expect(celebrationSceneCount()).toBe(0);
  });

  it("still fires streak celebrations when beakerBotAnimations is on", async () => {
    setBeakerBotAnimations(USER, true);
    memFs.set(PATH, freshSidecar({ current_count: 7 }));
    render(<CelebrationManager username={USER} />);

    await waitFor(() => {
      expect(celebrationSceneCount()).toBe(1);
    });
  });
});

describe("CELEBRATION_POOL composition", () => {
  it("contains exactly eight entries", () => {
    expect(CELEBRATION_POOL).toHaveLength(8);
  });

  it("contains five multi-stage scenes and three pose entries", () => {
    const scenes = CELEBRATION_POOL.filter((c) => c.type === "scene");
    const poses = CELEBRATION_POOL.filter((c) => c.type === "pose");
    expect(scenes).toHaveLength(5);
    expect(poses).toHaveLength(3);
  });

  it("includes the resolved pool members per proposal §6.7 plus the 2026-05-25 additions", () => {
    const keys = CELEBRATION_POOL.map((c) =>
      c.type === "scene" ? `scene:${c.component}` : `pose:${c.pose}`,
    ).sort();
    expect(keys).toEqual(
      [
        "pose:bouncing",
        "pose:cheering",
        "pose:volcano-eruption",
        "scene:eureka",
        "scene:ladder",
        "scene:mouseWave",
        "scene:skateboard",
        "scene:tooManyBeakers",
      ].sort(),
    );
  });

  it("still excludes bug-stomp + centrifuge (slapstick contexts that fire elsewhere)", () => {
    const keys = CELEBRATION_POOL.map((c) =>
      c.type === "scene" ? c.component : "",
    );
    expect(keys).not.toContain("centrifuge");
    expect(keys).not.toContain("bugStomp");
    expect(keys).not.toContain("screenBump");
  });
});

describe("pickRandomCelebration distribution", () => {
  it("covers all eight pool entries within 1000 picks", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const pick = pickRandomCelebration();
      const key =
        pick.type === "scene" ? `scene:${pick.component}` : `pose:${pick.pose}`;
      seen.add(key);
    }
    // All eight pool entries should have been picked at least once over
    // 1000 draws. The chance of missing any one entry is
    // (7/8)^1000 ≈ 5e-59, effectively zero.
    expect(seen.size).toBe(8);
  });
});
