// frontend/src/hooks/__tests__/useMilestoneTwirlTrigger.test.tsx
//
// Unit tests for the milestone twirl BeakerBot trigger
// (twirl-milestones bot).
//
// Covers:
//   - fireTwirlMilestone fires the twirl exactly once per milestone and
//     persists a per-user dedup flag so it never re-fires.
//   - Each of the three milestones (tourComplete, firstExperiment,
//     firstProject) dedups independently.
//   - The animations opt-out (settings.beakerBotAnimations === false)
//     suppresses the twirl AND leaves the dedup flag unburned.
//   - The hook integration: a tour-goodbye outro event + a task-
//     completion event each fire the twirl through the global store.
//   - First-experiment fires only for task_type "experiment"; a purchase
//     completion does not.
//   - A project-fully-complete event fires the firstProject twirl.

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { renderHook, act } from "@testing-library/react";

import {
  fireTwirlMilestone,
  milestoneFlagKey,
  milestonePending,
  useMilestoneTwirlTrigger,
  __resetMilestoneTwirlTriggerForTests,
} from "../useMilestoneTwirlTrigger";
import { useSceneTriggerStore } from "@/lib/scene-trigger-store";
import { taskCompletionEvents } from "@/lib/tasks/task-completion-events";
import { TOUR_GOODBYE_PLAY_OUTRO_EVENT } from "@/components/onboarding/v4/steps/cleanup/TourGoodbyeStep";

// The opt-out read goes through readUserSettings. Mock it so we can flip
// beakerBotAnimations per test without a file system.
const settingsState = { beakerBotAnimations: true };
vi.mock("@/lib/settings/user-settings", () => ({
  readUserSettings: vi.fn(async () => ({ ...settingsState })),
}));

const USER = "ada";

describe("fireTwirlMilestone (dedup + opt-out)", () => {
  beforeEach(() => {
    localStorage.clear();
    useSceneTriggerStore.getState().__reset();
    settingsState.beakerBotAnimations = true;
  });
  afterEach(() => {
    localStorage.clear();
    useSceneTriggerStore.getState().__reset();
  });

  it("fires the twirl once and burns the per-user dedup flag", async () => {
    const accepted = await fireTwirlMilestone(USER, "firstExperiment");
    expect(accepted).toBe(true);
    expect(useSceneTriggerStore.getState().activeScene).toBe("twirlMilestone");
    expect(localStorage.getItem(milestoneFlagKey(USER, "firstExperiment"))).toBe(
      "1",
    );
    expect(milestonePending(USER, "firstExperiment")).toBe(false);
  });

  it("does NOT fire a second time for the same milestone (dedup)", async () => {
    await fireTwirlMilestone(USER, "firstExperiment");
    useSceneTriggerStore.getState().clearActiveScene();

    const second = await fireTwirlMilestone(USER, "firstExperiment");
    expect(second).toBe(false);
    expect(useSceneTriggerStore.getState().activeScene).toBeNull();
  });

  it("dedups each milestone independently", async () => {
    await fireTwirlMilestone(USER, "tourComplete");
    useSceneTriggerStore.getState().clearActiveScene();
    // tourComplete is now burned, but firstProject is still pending.
    const project = await fireTwirlMilestone(USER, "firstProject");
    expect(project).toBe(true);
    expect(milestonePending(USER, "tourComplete")).toBe(false);
    expect(milestonePending(USER, "firstProject")).toBe(false);
  });

  it("dedups per-user (a different user still fires)", async () => {
    await fireTwirlMilestone(USER, "firstExperiment");
    useSceneTriggerStore.getState().clearActiveScene();
    const other = await fireTwirlMilestone("grace", "firstExperiment");
    expect(other).toBe(true);
  });

  it("is suppressed by the animations opt-out and leaves the flag unburned", async () => {
    settingsState.beakerBotAnimations = false;
    const accepted = await fireTwirlMilestone(USER, "firstProject");
    expect(accepted).toBe(false);
    expect(useSceneTriggerStore.getState().activeScene).toBeNull();
    // Flag NOT burned, so re-enabling lets a future event still fire.
    expect(milestonePending(USER, "firstProject")).toBe(true);

    settingsState.beakerBotAnimations = true;
    const retry = await fireTwirlMilestone(USER, "firstProject");
    expect(retry).toBe(true);
  });

  it("drops when another scene is already playing", async () => {
    useSceneTriggerStore.getState().fireScene("bugstomp", () => {});
    const accepted = await fireTwirlMilestone(USER, "tourComplete");
    expect(accepted).toBe(false);
    // Dedup flag must NOT be burned when we never even attempted a fire.
    expect(milestonePending(USER, "tourComplete")).toBe(true);
  });
});

describe("useMilestoneTwirlTrigger (hook integration)", () => {
  beforeEach(() => {
    localStorage.clear();
    useSceneTriggerStore.getState().__reset();
    settingsState.beakerBotAnimations = true;
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
    useSceneTriggerStore.getState().__reset();
    __resetMilestoneTwirlTriggerForTests(USER);
  });

  /** Flush the async fireTwirlMilestone chain (settings read + store). */
  async function flushAsync() {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("fires the twirl on a first-experiment completion event", async () => {
    renderHook(() => useMilestoneTwirlTrigger(USER));
    act(() => {
      taskCompletionEvents.emitCompleted({
        username: USER,
        projectOwner: USER,
        projectId: 1,
        taskType: "experiment",
        projectFullyComplete: false,
      });
    });
    await flushAsync();
    expect(useSceneTriggerStore.getState().activeScene).toBe("twirlMilestone");
  });

  it("does NOT fire first-experiment for a purchase completion", async () => {
    renderHook(() => useMilestoneTwirlTrigger(USER));
    act(() => {
      taskCompletionEvents.emitCompleted({
        username: USER,
        projectOwner: USER,
        projectId: 1,
        taskType: "purchase",
        projectFullyComplete: false,
      });
    });
    await flushAsync();
    expect(useSceneTriggerStore.getState().activeScene).toBeNull();
  });

  it("fires the twirl when a project becomes fully complete", async () => {
    renderHook(() => useMilestoneTwirlTrigger(USER));
    act(() => {
      taskCompletionEvents.emitCompleted({
        username: USER,
        projectOwner: USER,
        projectId: 2,
        // The last task closing a project is itself a "list" task here, so
        // the experiment milestone must NOT fire; only firstProject does.
        taskType: "list",
        projectFullyComplete: true,
      });
    });
    await flushAsync();
    expect(useSceneTriggerStore.getState().activeScene).toBe("twirlMilestone");
    expect(milestonePending(USER, "firstProject")).toBe(false);
    expect(milestonePending(USER, "firstExperiment")).toBe(true);
  });

  it("ignores completion events for a different user", async () => {
    renderHook(() => useMilestoneTwirlTrigger(USER));
    act(() => {
      taskCompletionEvents.emitCompleted({
        username: "grace",
        projectOwner: "grace",
        projectId: 1,
        taskType: "experiment",
        projectFullyComplete: true,
      });
    });
    await flushAsync();
    expect(useSceneTriggerStore.getState().activeScene).toBeNull();
  });

  it("fires the twirl after the tour-goodbye outro budget elapses", async () => {
    renderHook(() => useMilestoneTwirlTrigger(USER));
    act(() => {
      window.dispatchEvent(new CustomEvent(TOUR_GOODBYE_PLAY_OUTRO_EVENT));
    });
    // Twirl must NOT fire immediately (it waits out the goodbye outro).
    await flushAsync();
    expect(useSceneTriggerStore.getState().activeScene).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(5000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(useSceneTriggerStore.getState().activeScene).toBe("twirlMilestone");
  });

  it("does nothing when username is null", async () => {
    renderHook(() => useMilestoneTwirlTrigger(null));
    act(() => {
      taskCompletionEvents.emitCompleted({
        username: USER,
        projectOwner: USER,
        projectId: 1,
        taskType: "experiment",
        projectFullyComplete: true,
      });
    });
    await flushAsync();
    expect(useSceneTriggerStore.getState().activeScene).toBeNull();
  });
});
