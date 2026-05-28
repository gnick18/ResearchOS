/**
 * Tests for the detail-forwarding tour-event watchers.
 *
 * gantt-share-robust manager (BUG A): `watchExperimentPopupOpenedFor`
 * forwards the `tour:experiment-popup-opened` detail (`{ experimentId }`)
 * to its callback so the §6.8 share-back open beat can advance ONLY when
 * the user opens the right experiment (Fake A), ignoring a stale /
 * re-mounted popup that fires the same event with a different id.
 *
 * Lives in a .test.tsx file so it runs under the jsdom vitest project
 * (the watcher reads `window` / `dispatchEvent`); .test.ts files run in
 * the node project where `window` is absent.
 */
import { describe, expect, it, vi } from "vitest";
import { watchExperimentPopupOpenedFor } from "../lib/tour-events";

describe("watchExperimentPopupOpenedFor (gantt-share-robust manager, BUG A)", () => {
  it("forwards the event detail to the callback", () => {
    const onOpened = vi.fn();
    const cleanup = watchExperimentPopupOpenedFor(onOpened);

    window.dispatchEvent(
      new CustomEvent("tour:experiment-popup-opened", {
        detail: { experimentId: 7 },
      }),
    );

    expect(onOpened).toHaveBeenCalledTimes(1);
    expect(onOpened).toHaveBeenCalledWith({ experimentId: 7 });
    cleanup();
  });

  it("forwards every event (the id-filter is the caller's job)", () => {
    const seen: Array<number | undefined> = [];
    const cleanup = watchExperimentPopupOpenedFor((detail) =>
      seen.push(detail?.experimentId),
    );

    window.dispatchEvent(
      new CustomEvent("tour:experiment-popup-opened", {
        detail: { experimentId: 1 },
      }),
    );
    window.dispatchEvent(
      new CustomEvent("tour:experiment-popup-opened", {
        detail: { experimentId: 2 },
      }),
    );

    // Both events reach the callback; filtering to a specific id is left
    // to the beat that owns the completion (so a stale popup with a
    // different id does NOT advance the beat).
    expect(seen).toEqual([1, 2]);
    cleanup();
  });

  it("stops forwarding after cleanup", () => {
    const onOpened = vi.fn();
    const cleanup = watchExperimentPopupOpenedFor(onOpened);
    cleanup();

    window.dispatchEvent(
      new CustomEvent("tour:experiment-popup-opened", {
        detail: { experimentId: 7 },
      }),
    );

    expect(onOpened).not.toHaveBeenCalled();
  });
});
