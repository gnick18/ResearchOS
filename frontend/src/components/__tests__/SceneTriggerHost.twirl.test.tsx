// frontend/src/components/__tests__/SceneTriggerHost.twirl.test.tsx
//
// Host-wiring test (twirl-milestones bot): the `twirlMilestone` scene id
// maps to BeakerBotTwirlScene in SceneTriggerHost, and onComplete clears
// the active scene. The twirl scene portals to document.body and renders
// `data-testid="beakerbot-twirl-scene"`, which we assert against.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, act } from "@testing-library/react";

import SceneTriggerHost from "@/components/SceneTriggerHost";
import { useSceneTriggerStore } from "@/lib/scene-trigger-store";

describe("SceneTriggerHost: twirlMilestone wiring", () => {
  beforeEach(() => {
    useSceneTriggerStore.getState().__reset();
    vi.useFakeTimers();
    // jsdom lacks matchMedia; the twirl scene snapshots prefers-reduced-
    // motion on activation. Stub it to "no reduced motion".
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onchange: null,
    }));
  });
  afterEach(() => {
    vi.useRealTimers();
    useSceneTriggerStore.getState().__reset();
  });

  it("renders nothing when idle", () => {
    render(<SceneTriggerHost />);
    expect(
      document.querySelector('[data-testid="beakerbot-twirl-scene"]'),
    ).toBeNull();
  });

  it("renders the twirl scene when twirlMilestone fires", () => {
    render(<SceneTriggerHost />);
    act(() => {
      useSceneTriggerStore.getState().fireScene("twirlMilestone", () => {});
    });
    expect(
      document.querySelector('[data-testid="beakerbot-twirl-scene"]'),
    ).not.toBeNull();
  });

  it("invokes onComplete and clears the active scene when the twirl finishes", () => {
    const onComplete = vi.fn();
    render(<SceneTriggerHost />);
    act(() => {
      useSceneTriggerStore.getState().fireScene("twirlMilestone", onComplete);
    });
    expect(useSceneTriggerStore.getState().activeScene).toBe("twirlMilestone");

    // Advance past the twirl hold so the scene fires onComplete.
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(useSceneTriggerStore.getState().activeScene).toBeNull();
  });
});
