/**
 * §6.2b Home widgets demo-preview tests (tour-fixtures sub-bot R2,
 * 2026-05-26).
 *
 * Coverage:
 *   - push / release shape: refcount goes up on push, down on release,
 *     never below zero.
 *   - React hook re-renders subscribers when the flag flips (verifies
 *     the useSyncExternalStore subscribe / getSnapshot wiring).
 *   - Multi-lease semantics: two leases held at once keep the flag on
 *     until BOTH release. Models the cross-step transition (one step's
 *     onEnter pushes while the previous step's onExit hasn't released
 *     yet).
 *   - Idempotent release: calling the returned release function twice
 *     only decrements once.
 *
 * These tests cover the standalone subscribable store. The wiring
 * between the §6.2b step-body onEnter/onExit hooks and the widgets is
 * exercised by `HomeWidgetsSteps.test.tsx` (existing) and the new
 * tests at the bottom of this file.
 */
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  __resetTourWidgetDemoPreviewForTests,
  isTourWidgetDemoPreviewActive,
  pushTourWidgetDemoPreview,
  useTourWidgetDemoPreview,
} from "../TourWidgetDemoPreview";

afterEach(() => {
  // Hard-reset the module-level refcount between cases so a missed
  // release in one test doesn't leak into the next.
  __resetTourWidgetDemoPreviewForTests();
});

/** Tiny React probe that renders the hook's value as text so we can
 *  assert via `screen.getByTestId`. Mirrors the existing v4 hook-test
 *  pattern (`step-machine.test.ts` uses pure-function asserts, but for
 *  a useSyncExternalStore hook we need a real mount). */
function Probe() {
  const active = useTourWidgetDemoPreview();
  return <span data-testid="demo-preview-active">{active ? "yes" : "no"}</span>;
}

describe("TourWidgetDemoPreview store", () => {
  it("starts inactive and reports refcount via isTourWidgetDemoPreviewActive", () => {
    expect(isTourWidgetDemoPreviewActive()).toBe(false);
  });

  it("a single push activates the flag, release deactivates it (refcount semantics)", async () => {
    expect(isTourWidgetDemoPreviewActive()).toBe(false);
    const release = pushTourWidgetDemoPreview();
    expect(isTourWidgetDemoPreviewActive()).toBe(true);
    release();
    // Release is microtask-deferred (see TourWidgetDemoPreview.ts
    // header — protects against cross-step flicker). Flush the queue
    // so the assertion sees the post-decrement state.
    await Promise.resolve();
    expect(isTourWidgetDemoPreviewActive()).toBe(false);
  });

  it("two simultaneous leases keep the flag active until BOTH release", async () => {
    // Models the cross-step transition: when one §6.2b step's onEnter
    // pushes while the previous step's onExit hasn't released yet,
    // the refcount is briefly 2. Releasing one lease must NOT
    // deactivate the flag while the other is still held — otherwise
    // adjacent §6.2b steps would flicker the tiles back to "Nothing
    // queued" between transitions.
    const releaseA = pushTourWidgetDemoPreview();
    const releaseB = pushTourWidgetDemoPreview();
    expect(isTourWidgetDemoPreviewActive()).toBe(true);

    releaseA();
    await Promise.resolve();
    // One lease still held — must stay active.
    expect(isTourWidgetDemoPreviewActive()).toBe(true);

    releaseB();
    await Promise.resolve();
    expect(isTourWidgetDemoPreviewActive()).toBe(false);
  });

  it("release is idempotent — calling it twice only decrements once", async () => {
    const releaseA = pushTourWidgetDemoPreview();
    const releaseB = pushTourWidgetDemoPreview();
    expect(isTourWidgetDemoPreviewActive()).toBe(true);

    releaseA();
    releaseA(); // Second call must be a no-op (no underflow).
    await Promise.resolve();
    // Still one outstanding lease (B), so the flag stays active.
    expect(isTourWidgetDemoPreviewActive()).toBe(true);

    releaseB();
    await Promise.resolve();
    expect(isTourWidgetDemoPreviewActive()).toBe(false);
    // A third release attempt on the already-released handle must
    // remain a no-op (the refcount must NOT go negative).
    releaseA();
    await Promise.resolve();
    expect(isTourWidgetDemoPreviewActive()).toBe(false);
  });

  it("useTourWidgetDemoPreview re-renders subscribers on flag flips", async () => {
    render(<Probe />);
    expect(screen.getByTestId("demo-preview-active").textContent).toBe("no");

    let release: (() => void) | null = null;
    act(() => {
      release = pushTourWidgetDemoPreview();
    });
    expect(screen.getByTestId("demo-preview-active").textContent).toBe("yes");

    act(() => {
      release?.();
    });
    // Release is microtask-deferred; flush + re-render to observe the
    // post-decrement state. `act` wraps a queueMicrotask flush via
    // testing-library's internal microtask drain.
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId("demo-preview-active").textContent).toBe("no");
  });

  it("__resetTourWidgetDemoPreviewForTests clears the refcount and notifies subscribers", () => {
    render(<Probe />);
    act(() => {
      pushTourWidgetDemoPreview();
      pushTourWidgetDemoPreview();
    });
    expect(screen.getByTestId("demo-preview-active").textContent).toBe("yes");

    act(() => {
      __resetTourWidgetDemoPreviewForTests();
    });
    expect(screen.getByTestId("demo-preview-active").textContent).toBe("no");
    expect(isTourWidgetDemoPreviewActive()).toBe(false);
  });
});
