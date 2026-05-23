// frontend/src/lib/scene-trigger-store.test.ts
//
// Unit tests for the global scene-trigger store wired up by the bug-
// splat manager (2026-05-23). Covers:
//
//   1. Idle default — activeScene is null on fresh boot.
//   2. fireScene accepts the first request, returns true, sets state.
//   3. Second fireScene while a scene is active is dropped (false).
//   4. clearActiveScene restores idle and the next fire is accepted.
//   5. Cooldown blocks subsequent fires inside the window.
//   6. Cooldown elapses cleanly so a later fire is accepted.

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  useSceneTriggerStore,
  type SceneTriggerId,
} from "./scene-trigger-store";

const SCENE: SceneTriggerId = "bugstomp";

describe("scene-trigger-store", () => {
  beforeEach(() => {
    useSceneTriggerStore.getState().__reset();
  });

  it("starts idle with no active scene", () => {
    const state = useSceneTriggerStore.getState();
    expect(state.activeScene).toBeNull();
    expect(state.activeOnComplete).toBeNull();
  });

  it("accepts the first fireScene and stores the scene + callback", () => {
    const cb = vi.fn();
    const accepted = useSceneTriggerStore
      .getState()
      .fireScene(SCENE, cb);

    expect(accepted).toBe(true);
    const state = useSceneTriggerStore.getState();
    expect(state.activeScene).toBe(SCENE);
    expect(state.activeOnComplete).toBe(cb);
  });

  it("drops a second fireScene while one is already active", () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    useSceneTriggerStore.getState().fireScene(SCENE, cb1);
    const accepted = useSceneTriggerStore.getState().fireScene(SCENE, cb2);

    expect(accepted).toBe(false);
    // The original callback is still the one armed.
    expect(useSceneTriggerStore.getState().activeOnComplete).toBe(cb1);
  });

  it("clearActiveScene restores idle and allows the next fire to land", () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    useSceneTriggerStore.getState().fireScene(SCENE, cb1);
    useSceneTriggerStore.getState().clearActiveScene();

    expect(useSceneTriggerStore.getState().activeScene).toBeNull();

    const accepted = useSceneTriggerStore.getState().fireScene(SCENE, cb2);
    expect(accepted).toBe(true);
    expect(useSceneTriggerStore.getState().activeOnComplete).toBe(cb2);
  });

  it("cooldown blocks fires inside the window, allows after it elapses", () => {
    const cb = vi.fn();

    // First fire — accepted, lastFireAt set.
    const accepted1 = useSceneTriggerStore
      .getState()
      .fireScene(SCENE, cb, 5000);
    expect(accepted1).toBe(true);

    // Clear (simulate scene completion) so cooldown is the only gate.
    useSceneTriggerStore.getState().clearActiveScene();

    // Immediately fire again — cooldown should block.
    const accepted2 = useSceneTriggerStore
      .getState()
      .fireScene(SCENE, cb, 5000);
    expect(accepted2).toBe(false);
    expect(useSceneTriggerStore.getState().activeScene).toBeNull();

    // Rewind the lastFireAt to simulate cooldown elapsing.
    useSceneTriggerStore.setState({ lastFireAt: Date.now() - 6000 });

    const accepted3 = useSceneTriggerStore
      .getState()
      .fireScene(SCENE, cb, 5000);
    expect(accepted3).toBe(true);
  });

  it("manual fires (no cooldown) are not blocked by a stale lastFireAt", () => {
    const cb = vi.fn();
    useSceneTriggerStore.getState().fireScene(SCENE, cb, 5000);
    useSceneTriggerStore.getState().clearActiveScene();

    // No cooldown argument — the manual click path. Should land.
    const accepted = useSceneTriggerStore.getState().fireScene(SCENE, cb);
    expect(accepted).toBe(true);
  });
});
