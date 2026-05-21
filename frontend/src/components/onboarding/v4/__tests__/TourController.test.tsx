/**
 * Onboarding v4 P1 TourController tests — exercises the controller's
 * state transitions (start / advance / goBack / skipStep / exitTour /
 * pause / resume), feature_picks-aware gating, and the useTourController
 * hook contract (throws outside provider, optional returns null).
 *
 * The placeholder step bodies are all `completion: "manual"` so we use
 * `noteManualAdvance()` to drive the auto-advance-on-completion effect
 * the same way the real overlay's "Got it, next" button will.
 */
import { act, render, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { FeaturePicks, OnboardingSidecar } from "@/lib/onboarding/sidecar";
import {
  TourControllerProvider,
  useOptionalTourController,
  useTourController,
} from "../TourController";

function picks(over: Partial<FeaturePicks> = {}): FeaturePicks {
  return {
    account_type: "solo",
    purchases: "no",
    calendar: "no",
    goals: "no",
    telegram: "no",
    ai_helper: "no",
    ...over,
  };
}

function wrapper(initialPicks?: FeaturePicks | null) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <TourControllerProvider initialFeaturePicks={initialPicks ?? null}>
        {children}
      </TourControllerProvider>
    );
  };
}

describe("useTourController — hook contract", () => {
  it("throws outside the provider", () => {
    // Suppress React's error boundary noise — we EXPECT the throw.
    const originalError = console.error;
    console.error = () => {};
    try {
      expect(() => renderHook(() => useTourController())).toThrow(
        /TourControllerProvider/,
      );
    } finally {
      console.error = originalError;
    }
  });

  it("returns the value inside the provider", () => {
    const { result } = renderHook(() => useTourController(), {
      wrapper: wrapper(),
    });
    expect(result.current).toBeTruthy();
    expect(result.current.currentStep).toBeNull();
    expect(result.current.tourMode).toBeNull();
    expect(result.current.skippedSteps).toEqual([]);
  });
});

describe("useOptionalTourController — opt-in hook", () => {
  it("returns null outside the provider", () => {
    const { result } = renderHook(() => useOptionalTourController());
    expect(result.current).toBeNull();
  });

  it("returns the value inside the provider", () => {
    const { result } = renderHook(() => useOptionalTourController(), {
      wrapper: wrapper(),
    });
    expect(result.current).toBeTruthy();
    expect(result.current?.currentStep).toBeNull();
  });
});

describe("TourController — start() / advance() / goBack() / exitTour()", () => {
  it("start() with no arg lands on the first applicable step", () => {
    const { result } = renderHook(() => useTourController(), {
      wrapper: wrapper(picks()),
    });
    expect(result.current.currentStep).toBeNull();
    act(() => result.current.start());
    expect(result.current.currentStep).toBe("welcome");
    expect(result.current.tourMode).toBe("modal-setup");
  });

  it("start() with an explicit initialStep jumps to it", () => {
    const { result } = renderHook(() => useTourController(), {
      wrapper: wrapper(picks()),
    });
    act(() => result.current.start("home-create-project"));
    expect(result.current.currentStep).toBe("home-create-project");
    expect(result.current.tourMode).toBe("in-product-walkthrough");
  });

  it("advance() steps through the order respecting gates", () => {
    const { result } = renderHook(() => useTourController(), {
      wrapper: wrapper(picks({ account_type: "solo" })),
    });
    act(() => result.current.start());
    expect(result.current.currentStep).toBe("welcome");
    act(() => result.current.advance());
    expect(result.current.currentStep).toBe("setup-q1");
    // Solo skips q1a/q1b
    act(() => result.current.advance());
    expect(result.current.currentStep).toBe("setup-q2");
  });

  it("goBack() returns to the previous applicable step", () => {
    const { result } = renderHook(() => useTourController(), {
      wrapper: wrapper(picks({ account_type: "lab" })),
    });
    act(() => result.current.start("setup-q2"));
    act(() => result.current.goBack());
    // Lab → q1b is applicable
    expect(result.current.currentStep).toBe("setup-q1b");
  });

  it("goBack() at the head is a no-op", () => {
    const { result } = renderHook(() => useTourController(), {
      wrapper: wrapper(picks()),
    });
    act(() => result.current.start());
    expect(result.current.currentStep).toBe("welcome");
    act(() => result.current.goBack());
    expect(result.current.currentStep).toBe("welcome");
  });

  it("exitTour() jumps to phase4-cleanup", () => {
    const { result } = renderHook(() => useTourController(), {
      wrapper: wrapper(picks()),
    });
    act(() => result.current.start("home-create-project"));
    act(() => result.current.exitTour());
    expect(result.current.currentStep).toBe("phase4-cleanup");
    expect(result.current.tourMode).toBe("cleanup");
  });

  it("advance() at phase4-cleanup is a no-op", () => {
    const { result } = renderHook(() => useTourController(), {
      wrapper: wrapper(picks()),
    });
    act(() => result.current.start("phase4-cleanup"));
    act(() => result.current.advance());
    expect(result.current.currentStep).toBeNull();
  });
});

describe("TourController — skipStep()", () => {
  it("records the skip + advances", () => {
    const { result } = renderHook(() => useTourController(), {
      wrapper: wrapper(picks()),
    });
    act(() => result.current.start("home-create-project"));
    expect(result.current.skippedSteps).toEqual([]);
    act(() => result.current.skipStep());
    expect(result.current.skippedSteps).toContain("home-create-project");
    expect(result.current.currentStep).not.toBe("home-create-project");
  });

  it("deduplicates re-skips of the same step", () => {
    const { result } = renderHook(() => useTourController(), {
      wrapper: wrapper(picks()),
    });
    act(() => result.current.start("home-create-project"));
    act(() => result.current.skipStep());
    const firstAdvanceTo = result.current.currentStep;
    act(() => result.current.goBack());
    expect(result.current.currentStep).toBe("home-create-project");
    act(() => result.current.skipStep());
    // After second skip, the skippedSteps list still contains the entry once.
    const occurrences = result.current.skippedSteps.filter(
      (id) => id === "home-create-project",
    ).length;
    expect(occurrences).toBe(1);
    expect(result.current.currentStep).toBe(firstAdvanceTo);
  });
});

describe("TourController — pause() / resume()", () => {
  it("pause sets paused=true; resume clears it", () => {
    const { result } = renderHook(() => useTourController(), {
      wrapper: wrapper(picks()),
    });
    act(() => result.current.start());
    expect(result.current.paused).toBe(false);
    act(() => result.current.pause());
    expect(result.current.paused).toBe(true);
    act(() => result.current.resume());
    expect(result.current.paused).toBe(false);
  });

  it("currentStep survives pause/resume", () => {
    const { result } = renderHook(() => useTourController(), {
      wrapper: wrapper(picks()),
    });
    act(() => result.current.start("methods-create"));
    act(() => result.current.pause());
    expect(result.current.currentStep).toBe("methods-create");
    act(() => result.current.resume());
    expect(result.current.currentStep).toBe("methods-create");
  });
});

describe("TourController — setFeaturePicks", () => {
  it("updates the active feature picks", () => {
    const { result } = renderHook(() => useTourController(), {
      wrapper: wrapper(),
    });
    expect(result.current.featurePicks).toBeNull();
    act(() =>
      result.current.setFeaturePicks(picks({ account_type: "lab" })),
    );
    expect(result.current.featurePicks?.account_type).toBe("lab");
  });

  it("changes the gating decision for subsequent advance()s", () => {
    const { result } = renderHook(() => useTourController(), {
      wrapper: wrapper(picks({ account_type: "solo" })),
    });
    act(() => result.current.start("setup-q1"));
    // First advance under solo: skips q1a + q1b → setup-q2
    act(() => result.current.advance());
    expect(result.current.currentStep).toBe("setup-q2");
    // Flip to lab + back to q1, advance: now q1a is reachable
    act(() => result.current.setFeaturePicks(picks({ account_type: "lab" })));
    act(() => result.current.start("setup-q1"));
    act(() => result.current.advance());
    expect(result.current.currentStep).toBe("setup-q1a");
  });
});

describe("TourController — noteInteraction / noteEventFired / noteManualAdvance", () => {
  it("noteInteraction flips the per-step interacted flag", () => {
    const { result } = renderHook(() => useTourController(), {
      wrapper: wrapper(),
    });
    act(() => result.current.start("home-create-project"));
    expect(result.current.interactedWithCurrentStep).toBe(false);
    act(() => result.current.noteInteraction());
    expect(result.current.interactedWithCurrentStep).toBe(true);
  });

  it("interactedWithCurrentStep resets on advance", () => {
    const { result } = renderHook(() => useTourController(), {
      wrapper: wrapper(),
    });
    act(() => result.current.start("home-create-project"));
    act(() => result.current.noteInteraction());
    expect(result.current.interactedWithCurrentStep).toBe(true);
    act(() => result.current.advance());
    expect(result.current.interactedWithCurrentStep).toBe(false);
  });

  it("noteManualAdvance on a manual-completion step advances", () => {
    const { result } = renderHook(() => useTourController(), {
      wrapper: wrapper(),
    });
    // §6.3 notifications step ships a `manual` completion ("Got it")
    // per P5; using it here keeps the test honest about which steps
    // accept manual advance. The earlier P1 version started on
    // home-create-project when every step was a manual placeholder.
    act(() => result.current.start("notifications"));
    const start = result.current.currentStep;
    act(() => result.current.noteManualAdvance());
    // Effect-driven advance fires synchronously inside the same act.
    expect(result.current.currentStep).not.toBe(start);
  });
});

describe("TourController — mode transitions", () => {
  it("setup steps produce tourMode=modal-setup", () => {
    const { result } = renderHook(() => useTourController(), {
      wrapper: wrapper(),
    });
    act(() => result.current.start("setup-q1"));
    expect(result.current.tourMode).toBe("modal-setup");
  });

  it("universal walkthrough steps produce in-product-walkthrough", () => {
    const { result } = renderHook(() => useTourController(), {
      wrapper: wrapper(),
    });
    act(() => result.current.start("methods-create"));
    expect(result.current.tourMode).toBe("in-product-walkthrough");
  });

  it("lab steps produce tourMode=lab", () => {
    const { result } = renderHook(() => useTourController(), {
      wrapper: wrapper(picks({ account_type: "lab" })),
    });
    act(() => result.current.start("lab-prompt"));
    expect(result.current.tourMode).toBe("lab");
  });

  it("cleanup step produces tourMode=cleanup", () => {
    const { result } = renderHook(() => useTourController(), {
      wrapper: wrapper(),
    });
    act(() => result.current.start("phase4-cleanup"));
    expect(result.current.tourMode).toBe("cleanup");
  });
});

describe("TourController — P12 wizard_resume_state persistence", () => {
  // The controller persists `current_step` + `skipped_steps` on every
  // step transition. Grant's blocker: refresh wiped his Q1-Q6 answers
  // because the controller never patched the sidecar's resume state
  // until P12. We assert the patch fires on advance / goBack / skipStep
  // / exitTour and stays silent when currentStep is null.
  function recordingPatchSidecar() {
    const calls: Array<{ current_step: string; skipped_steps: string[] }> = [];
    const cur: OnboardingSidecar = {
      version: 4,
      first_seen_at: "2026-05-20T00:00:00.000Z",
      active_seconds: 0,
      feature_picks: null,
      wizard_completed_at: null,
      wizard_skipped_at: null,
      wizard_force_show: false,
      wizard_resume_state: null,
      lab_tour_pending: false,
      lab_tour_dismissed_at: null,
    };
    const patch = async (mut: (s: OnboardingSidecar) => OnboardingSidecar) => {
      const next = mut(cur);
      if (next.wizard_resume_state) {
        calls.push({
          current_step: next.wizard_resume_state.current_step,
          skipped_steps: [...next.wizard_resume_state.skipped_steps],
        });
      }
      // Mutate `cur` in place so back-to-back patches see prior writes
      // (mirrors how V4MountForUser.patchOnboarding behaves on disk).
      Object.assign(cur, next);
    };
    return { calls, patch };
  }

  function withPatch(
    patch: (mut: (s: OnboardingSidecar) => OnboardingSidecar) => Promise<void>,
    initialPicks?: FeaturePicks | null,
  ) {
    return function Wrapper({ children }: { children: React.ReactNode }) {
      return (
        <TourControllerProvider
          patchSidecar={patch}
          initialFeaturePicks={initialPicks ?? null}
        >
          {children}
        </TourControllerProvider>
      );
    };
  }

  it("persists current_step on start()", async () => {
    const { calls, patch } = recordingPatchSidecar();
    const { result } = renderHook(() => useTourController(), {
      wrapper: withPatch(patch, picks()),
    });
    act(() => result.current.start());
    // Wait for the effect to flush.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(calls.some((c) => c.current_step === "welcome")).toBe(true);
  });

  it("persists current_step on advance()", async () => {
    const { calls, patch } = recordingPatchSidecar();
    const { result } = renderHook(() => useTourController(), {
      wrapper: withPatch(patch, picks({ account_type: "solo" })),
    });
    act(() => result.current.start());
    act(() => result.current.advance());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(calls.some((c) => c.current_step === "setup-q1")).toBe(true);
  });

  it("persists current_step on goBack()", async () => {
    const { calls, patch } = recordingPatchSidecar();
    const { result } = renderHook(() => useTourController(), {
      wrapper: withPatch(patch, picks()),
    });
    act(() => result.current.start("setup-q2"));
    act(() => result.current.goBack());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    // Solo: goBack from setup-q2 lands on setup-q1 (q1a/q1b gated).
    expect(calls.some((c) => c.current_step === "setup-q1")).toBe(true);
  });

  it("persists skipped_steps on skipStep()", async () => {
    const { calls, patch } = recordingPatchSidecar();
    const { result } = renderHook(() => useTourController(), {
      wrapper: withPatch(patch, picks()),
    });
    act(() => result.current.start("home-create-project"));
    act(() => result.current.skipStep());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    // The post-skip patch should include home-create-project in the
    // skipped_steps list.
    const lastWithSkip = [...calls]
      .reverse()
      .find((c) => c.skipped_steps.length > 0);
    expect(lastWithSkip?.skipped_steps).toContain("home-create-project");
  });

  it("persists current_step on exitTour() (advances to phase4-cleanup)", async () => {
    const { calls, patch } = recordingPatchSidecar();
    const { result } = renderHook(() => useTourController(), {
      wrapper: withPatch(patch, picks()),
    });
    act(() => result.current.start("home-create-project"));
    act(() => result.current.exitTour());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(calls.some((c) => c.current_step === "phase4-cleanup")).toBe(true);
  });

  it("does NOT persist when currentStep transitions to null (tour ended)", async () => {
    const { calls, patch } = recordingPatchSidecar();
    const { result } = renderHook(() => useTourController(), {
      wrapper: withPatch(patch, picks()),
    });
    act(() => result.current.start("phase4-cleanup"));
    // advance() from phase4-cleanup transitions currentStep to null.
    await act(async () => {
      await Promise.resolve();
    });
    const callsBefore = calls.length;
    act(() => result.current.advance());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    // No new persistence call should have fired for the null transition.
    // (Any earlier null-state patches would have a current_step set;
    // we assert that the per-transition watch is silent here.)
    const nullCalls = calls
      .slice(callsBefore)
      .filter((c) => !c.current_step);
    expect(nullCalls.length).toBe(0);
  });

  it("is a no-op when patchSidecar prop is not wired", () => {
    // No patchSidecar prop -> no crash, no calls (covers the test +
    // dev-sandbox case where the controller mounts without a host).
    const { result } = renderHook(() => useTourController(), {
      wrapper: wrapper(picks()),
    });
    act(() => result.current.start());
    // Just asserting we did not throw / crash.
    expect(result.current.currentStep).toBe("welcome");
  });
});

describe("TourController — provider mount", () => {
  it("renders children without crashing when no tour is active", () => {
    const { container } = render(
      <TourControllerProvider>
        <div data-testid="child">hello</div>
      </TourControllerProvider>,
    );
    expect(container.querySelector("[data-testid='child']")).toBeTruthy();
    // Overlay is not rendered when no tour is active.
    expect(container.querySelector("[data-testid='tour-beakerbot-overlay']")).toBeNull();
  });

  it("renders the overlay when a tour is active", () => {
    // Use renderHook to capture the controller value via the hook,
    // matching the rest of this file (avoids a write-during-render
    // capture pattern that rules-of-hooks flags). We assert overlay
    // presence on the same document jsdom maintains across both
    // render() calls inside the spec.
    const { result } = renderHook(() => useTourController(), {
      wrapper: wrapper(),
    });
    act(() => result.current.start("home-create-project"));
    expect(result.current.currentStep).toBe("home-create-project");
    // The overlay portals to document.body, so query the document
    // directly rather than the harness container.
    expect(
      document.body.querySelector("[data-testid='tour-beakerbot-overlay']"),
    ).toBeTruthy();
  });

  it("places Skip-walkthrough next to Skip-this-step (post-polish layout)", () => {
    // Polish pass: both skip affordances live in the same right-edge
    // action container at the bottom of the bubble, not split between
    // the top-corner and the bottom-row. Asserting via the shared
    // parent guards against a regression where the exit link drifts
    // back to the top of the bubble.
    const { result } = renderHook(() => useTourController(), {
      wrapper: wrapper(),
    });
    act(() => result.current.start("home-create-project"));
    const skipStepBtn = document.body.querySelector(
      "[aria-label='Skip this step']",
    );
    const skipWalkthroughBtn = document.body.querySelector(
      "[aria-label='Skip walkthrough']",
    );
    expect(skipStepBtn).toBeTruthy();
    expect(skipWalkthroughBtn).toBeTruthy();
    expect(skipStepBtn?.parentElement).toBe(
      skipWalkthroughBtn?.parentElement,
    );
  });
});
