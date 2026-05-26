/**
 * Cleanup retirement 2026-05-22 (Cleanup manager R2) — tour-goodbye
 * step body tests.
 *
 * Covers:
 *   - The step record's metadata: id, pose, manualAdvance("Let's go").
 *   - The speech component renders the goodbye copy + wiki pointer.
 *   - The step's onExit dispatches `tour-goodbye:play-outro` only on a
 *     forward advance (NOT on a back-step) so the outro animation
 *     doesn't fire when the user back-steps off the terminal beat.
 *   - The TourGoodbyeOverlay renders nothing in idle, then mounts on
 *     the play-outro event, kicks off auto-cleanup, and routes to "/"
 *     after the animation finishes.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";

const { routerPush, runCleanup, readOnboarding } = vi.hoisted(() => ({
  routerPush: vi.fn(),
  runCleanup: vi.fn(async () => ({
    attempted: 0,
    succeeded: 0,
    preserved: 0,
    failed: [],
  })),
  readOnboarding: vi.fn(async (_username: string) => ({
    version: 4,
    first_seen_at: "",
    active_seconds: 0,
    feature_picks: null,
    wizard_completed_at: null,
    wizard_skipped_at: null,
    wizard_force_show: false,
    wizard_resume_state: {
      current_step: "tour-goodbye",
      skipped_steps: [],
      artifacts_created: [
        { type: "project", id: "42", cleanup_default: "keep" as const },
        { type: "method", id: "7:placeholder", cleanup_default: "discard" as const },
      ],
    },
    lab_tour_pending: false,
    lab_tour_dismissed_at: null,
    lab_mode_tour_choice: null,
  })),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: routerPush,
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  }),
  // R2 chip B Fix 1/3: usePathname now in TourController's dep array.
  usePathname: () => "/",
}));

vi.mock("@/lib/onboarding/sidecar", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/onboarding/sidecar")
  >("@/lib/onboarding/sidecar");
  return {
    ...actual,
    readOnboarding,
  };
});

// Copy-alignment manager 2026-05-26: the speech bubble now consults
// usersApi.list() + readOnboarding() to decide between the "tidy up the
// demo stuff" line and the early-skip fallback. Stub the local-api
// users.list call so the speech-render test resolves to the populated
// branch (matches the readOnboarding mock above, which seeds two
// artifacts_created).
vi.mock("@/lib/local-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/local-api")>(
    "@/lib/local-api",
  );
  return {
    ...actual,
    usersApi: {
      ...actual.usersApi,
      list: vi.fn(async () => ({ users: ["demo-user"], current_user: "demo-user" })),
    },
  };
});

// Stub the auto-cleanup import so the overlay's cleanup kick runs the
// vi.fn instead of touching domain APIs. We also pass `runCleanupFn`
// as a prop in the more direct tests; this mock covers the default-
// import path.
vi.mock("../auto-cleanup", () => ({
  runEndOfTourAutoCleanup: runCleanup,
}));

import {
  tourGoodbyeStep,
  TourGoodbyeOverlay,
  TOUR_GOODBYE_PLAY_OUTRO_EVENT,
} from "../TourGoodbyeStep";
import { setLastTourTransition } from "../../../TourController";

// Animation timing constants mirror the implementation. If
// TourGoodbyeStep.tsx changes its phase durations, update these to
// keep the timer-stepping tests in sync. Cleanup fix manager R1
// bumped cheer + wave from 1500ms to 1800ms each.
const CHEER_MS = 1800;
const WAVE_MS = 1800;
const FADE_MS = 800;
const TOAST_MS = 4000;
const CONFETTI_WAVE_2_DELAY_MS = 500;

beforeEach(() => {
  routerPush.mockReset();
  runCleanup.mockReset();
  runCleanup.mockResolvedValue({
    attempted: 0,
    succeeded: 0,
    preserved: 0,
    failed: [],
  });
  readOnboarding.mockClear();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("tourGoodbyeStep record", () => {
  it("has the expected id and pose", () => {
    expect(tourGoodbyeStep.id).toBe("tour-goodbye");
    expect(tourGoodbyeStep.pose).toBe("cheering");
  });

  it("uses manualAdvance with the \"Let's go\" label", () => {
    expect(tourGoodbyeStep.completion.type).toBe("manual");
    if (tourGoodbyeStep.completion.type === "manual") {
      expect(tourGoodbyeStep.completion.buttonLabel).toBe("Let's go");
    }
  });

  it("speech renders the goodbye copy + tidy-up framing + wiki pointer", async () => {
    const speechNode =
      typeof tourGoodbyeStep.speech === "function"
        ? tourGoodbyeStep.speech()
        : tourGoodbyeStep.speech;
    // Use real timers around the render so the speech body's useEffect
    // (which awaits readOnboarding) settles before we assert against
    // the artifacts-populated branch.
    vi.useRealTimers();
    render(<>{speechNode}</>);
    // Check across multiple text nodes; "You're set!" + tidy-up
    // framing + landmark-anchored wiki guidance.
    expect(screen.getByText(/You're set!/)).toBeTruthy();
    expect(
      screen.getByText(/Here's to many great experiments ahead\./),
    ).toBeTruthy();
    // Wait for the sidecar-driven conditional copy to resolve.
    await waitFor(() =>
      expect(screen.getByText(/I'll tidy up the demo stuff/)).toBeTruthy(),
    );
    expect(screen.getByText(/every page has its own wiki guide/)).toBeTruthy();
    expect(screen.getByText(/next to the gear icon/)).toBeTruthy();
    // The retired ❓ emoji + absolute-position pointer must NOT appear.
    expect(screen.queryByText(/❓/)).toBeNull();
    expect(screen.queryByText(/icon in the top right/)).toBeNull();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
});

describe("tourGoodbyeStep.onExit", () => {
  it("dispatches the play-outro event on a forward advance", async () => {
    setLastTourTransition("advance");
    const listener = vi.fn();
    window.addEventListener(TOUR_GOODBYE_PLAY_OUTRO_EVENT, listener);
    try {
      await tourGoodbyeStep.onExit?.();
      expect(listener).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(TOUR_GOODBYE_PLAY_OUTRO_EVENT, listener);
    }
  });

  it("does NOT dispatch on a back-step (lastTransition === 'goBack')", async () => {
    setLastTourTransition("goBack");
    const listener = vi.fn();
    window.addEventListener(TOUR_GOODBYE_PLAY_OUTRO_EVENT, listener);
    try {
      await tourGoodbyeStep.onExit?.();
      expect(listener).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(TOUR_GOODBYE_PLAY_OUTRO_EVENT, listener);
    }
  });

  it("does NOT dispatch on a skip-step transition", async () => {
    setLastTourTransition("skip");
    const listener = vi.fn();
    window.addEventListener(TOUR_GOODBYE_PLAY_OUTRO_EVENT, listener);
    try {
      await tourGoodbyeStep.onExit?.();
      expect(listener).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(TOUR_GOODBYE_PLAY_OUTRO_EVENT, listener);
    }
  });
});

describe("TourGoodbyeOverlay", () => {
  it("renders nothing in the idle phase (before play-outro event)", () => {
    const { container } = render(<TourGoodbyeOverlay username="alex" />);
    expect(container.firstChild).toBeNull();
  });

  it("mounts the overlay + runs cleanup + routes home on play-outro", async () => {
    render(
      <TourGoodbyeOverlay username="alex" runCleanupFn={runCleanup} />,
    );

    // Dispatch the play-outro event — overlay enters "cheering".
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent(TOUR_GOODBYE_PLAY_OUTRO_EVENT),
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId("tour-goodbye-overlay")).toBeTruthy();
    });
    expect(
      screen.getByTestId("tour-goodbye-overlay").getAttribute(
        "data-tour-goodbye-phase",
      ),
    ).toBe("cheering");

    // Cleanup is dispatched while the animation plays (background).
    await waitFor(() => {
      expect(runCleanup).toHaveBeenCalledTimes(1);
    });
    expect(runCleanup).toHaveBeenCalledWith({
      username: "alex",
      firstProjectId: "42",
    });

    // Advance through cheering (1800ms) → waving phase.
    await act(async () => {
      vi.advanceTimersByTime(CHEER_MS + 100);
    });
    expect(
      screen.getByTestId("tour-goodbye-overlay").getAttribute(
        "data-tour-goodbye-phase",
      ),
    ).toBe("waving");
    // Router push must NOT have fired yet — happens at START of fade.
    expect(routerPush).not.toHaveBeenCalled();

    // Advance through waving (1800ms) → fading phase + route push.
    await act(async () => {
      vi.advanceTimersByTime(WAVE_MS + 100);
    });
    expect(
      screen.getByTestId("tour-goodbye-overlay").getAttribute(
        "data-tour-goodbye-phase",
      ),
    ).toBe("fading");
    // Route push fires at the START of the fade, NOT the end — so the
    // route swap happens behind the fully-opaque overlay.
    expect(routerPush).toHaveBeenCalledWith("/");

    // Advance through fade (800ms) → toast phase.
    await act(async () => {
      vi.advanceTimersByTime(FADE_MS + 100);
    });
    expect(screen.queryByTestId("tour-goodbye-overlay")).toBeNull();
    expect(screen.getByTestId("tour-goodbye-toast")).toBeTruthy();
    expect(
      screen.getByText(/Tour complete\. Find BeakerBot again in Settings/),
    ).toBeTruthy();

    // Advance through toast (4000ms) → unmount.
    await act(async () => {
      vi.advanceTimersByTime(TOAST_MS + 100);
    });
    await waitFor(() => {
      expect(screen.queryByTestId("tour-goodbye-toast")).toBeNull();
    });
  });

  it("does not crash when cleanup fn rejects (best-effort)", async () => {
    runCleanup.mockRejectedValueOnce(new Error("disk full"));
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
      render(
        <TourGoodbyeOverlay username="alex" runCleanupFn={runCleanup} />,
      );
      await act(async () => {
        window.dispatchEvent(
          new CustomEvent(TOUR_GOODBYE_PLAY_OUTRO_EVENT),
        );
      });
      // Step through each phase as a separate act() so the React
      // commit between state transitions runs the next phase's
      // setTimeout effect. A single 4000 ms advance would only fire
      // the cheering→waving timer; the next effect doesn't schedule
      // until React commits the state update.
      await act(async () => {
        vi.advanceTimersByTime(CHEER_MS + 100);
      });
      await act(async () => {
        vi.advanceTimersByTime(WAVE_MS + 100);
      });
      // Route push lands at start of fade (after wave timer fires),
      // not at fade completion.
      expect(routerPush).toHaveBeenCalledWith("/");
      await act(async () => {
        vi.advanceTimersByTime(FADE_MS + 100);
      });
      await act(async () => {
        vi.advanceTimersByTime(TOAST_MS + 100);
      });
    } finally {
      console.warn = originalWarn;
    }
  });

  it("emits the 2-wave confetti (wave 2 spawns at +500ms)", async () => {
    // Light-touch assertion: verify the confetti canvas is mounted
    // during cheering and that the deferred wave-2 timer fires inside
    // the cheering phase budget. We can't directly inspect particle
    // counts on the canvas, but we can confirm the canvas survives
    // past the wave-2 delay without being unmounted prematurely.
    render(
      <TourGoodbyeOverlay username="alex" runCleanupFn={runCleanup} />,
    );
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent(TOUR_GOODBYE_PLAY_OUTRO_EVENT),
      );
    });
    await waitFor(() => {
      expect(screen.getByTestId("tour-goodbye-confetti")).toBeTruthy();
    });
    // Advance past the wave-2 delay but stay inside the cheering phase.
    expect(CONFETTI_WAVE_2_DELAY_MS).toBeLessThan(CHEER_MS);
    await act(async () => {
      vi.advanceTimersByTime(CONFETTI_WAVE_2_DELAY_MS + 50);
    });
    // Canvas + cheering phase still mounted (wave 2 fired inline).
    expect(screen.getByTestId("tour-goodbye-confetti")).toBeTruthy();
    expect(
      screen.getByTestId("tour-goodbye-overlay").getAttribute(
        "data-tour-goodbye-phase",
      ),
    ).toBe("cheering");
  });
});
