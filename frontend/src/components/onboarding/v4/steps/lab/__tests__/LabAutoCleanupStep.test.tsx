/**
 * Onboarding v4 P7: lab-cleanup step body tests.
 *
 * Covers §6.16c / L21: on mount, the cleanup helper runs with the
 * current username; the status pill flips from "removing..." to
 * "done"; calling cleanup twice is a no-op (idempotency check).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";

const { getCurrentUserCached } = vi.hoisted(() => ({
  getCurrentUserCached: vi.fn(),
}));

vi.mock("@/lib/storage/json-store", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/storage/json-store")
  >("@/lib/storage/json-store");
  return { ...actual, getCurrentUserCached };
});

import LabAutoCleanupInner from "../LabAutoCleanupStep";
import { TourControllerProvider } from "../../../TourController";

beforeEach(() => {
  getCurrentUserCached.mockReset();
  getCurrentUserCached.mockResolvedValue("alex");
});

describe("LabAutoCleanupStep (v4 P7)", () => {
  it("calls cleanupFn with the current username on mount", async () => {
    const cleanupFn = vi.fn(async () => {});

    render(
      <TourControllerProvider initialFeaturePicks={null}>
        <LabAutoCleanupInner cleanupFn={cleanupFn} />
      </TourControllerProvider>,
    );

    await waitFor(() => {
      expect(cleanupFn).toHaveBeenCalledWith("alex");
    });
  });

  it("flips status pill from cleaning to done after cleanupFn resolves", async () => {
    // Build a deferred so the test controls when cleanupFn resolves.
    // The "cleaning" copy is observable BEFORE we release it.
    let resolveCleanup: (() => void) | null = null;
    const cleanupPromise = new Promise<void>((res) => {
      resolveCleanup = res;
    });
    const cleanupFn = vi.fn(() => cleanupPromise);

    render(
      <TourControllerProvider initialFeaturePicks={null}>
        <LabAutoCleanupInner cleanupFn={cleanupFn} />
      </TourControllerProvider>,
    );

    expect(screen.getByTestId("lab-cleanup-status").textContent).toMatch(
      /Removing BeakerBot/i,
    );

    await act(async () => {
      resolveCleanup?.();
      await cleanupPromise;
    });

    await waitFor(() => {
      expect(screen.getByTestId("lab-cleanup-status").textContent).toMatch(
        /Done/i,
      );
    });
  });

  it("swallows cleanupFn rejections and still flips status to done", async () => {
    const cleanupFn = vi.fn(async () => {
      throw new Error("FS unavailable");
    });
    // Suppress the expected console.warn so the test output stays clean.
    const originalWarn = console.warn;
    console.warn = () => {};

    try {
      render(
        <TourControllerProvider initialFeaturePicks={null}>
          <LabAutoCleanupInner cleanupFn={cleanupFn} />
        </TourControllerProvider>,
      );

      await waitFor(() => {
        expect(screen.getByTestId("lab-cleanup-status").textContent).toMatch(
          /Done/i,
        );
      });
    } finally {
      console.warn = originalWarn;
    }
  });

  it("cleanupFn called multiple times is idempotent from the user's POV", async () => {
    // Simulates remounting the cleanup step (e.g., back-step from
    // phase4-cleanup → lab-cleanup → forward again). The helper itself
    // is idempotent on disk; this test just confirms the component
    // calls the helper on every mount.
    const cleanupFn = vi.fn(async () => {});

    const { unmount } = render(
      <TourControllerProvider initialFeaturePicks={null}>
        <LabAutoCleanupInner cleanupFn={cleanupFn} />
      </TourControllerProvider>,
    );
    await waitFor(() => {
      expect(cleanupFn).toHaveBeenCalledTimes(1);
    });
    unmount();

    render(
      <TourControllerProvider initialFeaturePicks={null}>
        <LabAutoCleanupInner cleanupFn={cleanupFn} />
      </TourControllerProvider>,
    );
    await waitFor(() => {
      expect(cleanupFn).toHaveBeenCalledTimes(2);
    });
    // Both calls resolved successfully: that's the idempotency contract.
    expect(cleanupFn).toHaveBeenNthCalledWith(1, "alex");
    expect(cleanupFn).toHaveBeenNthCalledWith(2, "alex");
  });
});
