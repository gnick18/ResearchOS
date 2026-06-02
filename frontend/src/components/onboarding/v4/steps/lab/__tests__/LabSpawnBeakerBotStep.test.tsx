/**
 * Onboarding v4 P7: lab-spawn-beakerbot step body tests.
 *
 * Covers §6.16a: on entry, the spawn helper runs with the current
 * username, the speech-bubble status pill flips from "spinning up"
 * to "joined the lab" once the spawn resolves, and the speech copy
 * itself matches the brief (no em-dashes).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const { getCurrentUserCached } = vi.hoisted(() => ({
  getCurrentUserCached: vi.fn(),
}));

vi.mock("@/lib/storage/json-store", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/storage/json-store")
  >("@/lib/storage/json-store");
  return { ...actual, getCurrentUserCached };
});

// Stub next/navigation's useRouter for the TourController auto-
// navigate effect (Onboarding v4 route-nav fix). push() is a no-op.
// R2 chip B Fix 1/3: usePathname now in TourController's dep array.
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => "/",
}));

import LabSpawnInner from "../LabSpawnBeakerBotStep";
import { TourControllerProvider } from "../../../TourController";
import type { FeaturePicks } from "@/lib/onboarding/sidecar";
import type { LabFakeUserHandle } from "../lib/lab-fake-user";

function picks(over: Partial<FeaturePicks> = {}): FeaturePicks {
  return {
    account_type: "lab",
    purchases: "no",
    calendar: "no",
    goals: "no",
    telegram: "no",
    ai_helper: "no",
    ...over,
  };
}

beforeEach(() => {
  getCurrentUserCached.mockReset();
  getCurrentUserCached.mockResolvedValue("alex");
});

describe("LabSpawnBeakerBotStep (v4 P7)", () => {
  it("renders the §6.16a speech copy with no em-dashes", async () => {
    const spawnFn = vi.fn<(recipient: string) => Promise<LabFakeUserHandle>>(
      async () => ({
        recipient: "alex",
        actor: "beakerbot",
        editTaskId: 1,
        viewTaskId: 2,
        projectId: 1,
      }),
    );

    render(
      <TourControllerProvider initialFeaturePicks={picks()}>
        <LabSpawnInner spawnFn={spawnFn} />
      </TourControllerProvider>,
    );

    expect(
      screen.getByText(/Meet BeakerBot the lab member/i),
    ).toBeInTheDocument();
    // Brief copy precision: "one you can edit, one is view-only" (no em-dash).
    expect(
      screen.getByText(
        /one you can edit, one is view-only/i,
      ),
    ).toBeInTheDocument();
    // Em-dash literal (U+2014) MUST NOT appear in the speech copy.
    expect(
      screen.queryByText(/—/),
    ).toBeNull();
  });

  it("calls spawnFn with the current username + flips status to ready", async () => {
    const handle: LabFakeUserHandle = {
      recipient: "alex",
      actor: "beakerbot",
      editTaskId: 7,
      viewTaskId: 8,
      projectId: 3,
    };
    const spawnFn = vi.fn(async () => handle);

    render(
      <TourControllerProvider initialFeaturePicks={picks()}>
        <LabSpawnInner spawnFn={spawnFn} />
      </TourControllerProvider>,
    );

    await waitFor(() => {
      expect(spawnFn).toHaveBeenCalledWith("alex");
    });

    await waitFor(() => {
      expect(screen.getByTestId("lab-spawn-status").textContent).toMatch(
        /joined the lab/i,
      );
    });
  });

  it("surfaces an error pill when spawnFn rejects", async () => {
    const spawnFn = vi.fn(async () => {
      throw new Error("FS unavailable");
    });

    render(
      <TourControllerProvider initialFeaturePicks={picks()}>
        <LabSpawnInner spawnFn={spawnFn} />
      </TourControllerProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("lab-spawn-status").textContent).toMatch(
        /Couldn't spin up the fake teammate/i,
      );
    });
  });

  it("does not call spawnFn when getCurrentUserCached returns empty", async () => {
    getCurrentUserCached.mockResolvedValueOnce("");
    const spawnFn = vi.fn(async () => ({
      recipient: "",
      actor: "beakerbot",
      editTaskId: 1,
      viewTaskId: 2,
      projectId: 1,
    }));

    render(
      <TourControllerProvider initialFeaturePicks={picks()}>
        <LabSpawnInner spawnFn={spawnFn} />
      </TourControllerProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("lab-spawn-status").textContent).toMatch(
        /Couldn't read your username/i,
      );
    });
    expect(spawnFn).not.toHaveBeenCalled();
  });
});
