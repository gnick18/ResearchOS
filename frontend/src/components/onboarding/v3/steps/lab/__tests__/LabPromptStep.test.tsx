import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { OnboardingSidecar } from "@/lib/onboarding/sidecar";

import LabPromptStep from "../LabPromptStep";

function baseSidecar(
  patch: Partial<OnboardingSidecar> = {},
): OnboardingSidecar {
  return {
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
    ...patch,
  };
}

describe("LabPromptStep", () => {
  it("Now button clears both opt-out fields", async () => {
    let sidecar = baseSidecar({
      lab_tour_pending: true,
      lab_tour_dismissed_at: "2026-01-01T00:00:00.000Z",
    });
    const patchSidecar = vi.fn(
      async (mut: (cur: OnboardingSidecar) => OnboardingSidecar) => {
        sidecar = mut(sidecar);
      },
    );

    render(
      <LabPromptStep
        sidecar={sidecar}
        setNextDisabled={vi.fn()}
        patchSidecar={patchSidecar}
      />,
    );

    await userEvent.setup().click(
      screen.getByRole("button", { name: /Take the Lab tour now/i }),
    );

    await waitFor(() => {
      expect(patchSidecar).toHaveBeenCalled();
    });
    expect(sidecar.lab_tour_pending).toBe(false);
    expect(sidecar.lab_tour_dismissed_at).toBeNull();
  });

  it("Later button writes lab_tour_pending=true and leaves dismissed_at null", async () => {
    let sidecar = baseSidecar();
    const patchSidecar = vi.fn(
      async (mut: (cur: OnboardingSidecar) => OnboardingSidecar) => {
        sidecar = mut(sidecar);
      },
    );

    render(
      <LabPromptStep
        sidecar={sidecar}
        setNextDisabled={vi.fn()}
        patchSidecar={patchSidecar}
      />,
    );

    await userEvent.setup().click(
      screen.getByRole("button", { name: /^Later/i }),
    );

    await waitFor(() => {
      expect(patchSidecar).toHaveBeenCalled();
    });
    expect(sidecar.lab_tour_pending).toBe(true);
    expect(sidecar.lab_tour_dismissed_at).toBeNull();
  });

  it("Dismiss button writes lab_tour_dismissed_at and clears pending", async () => {
    let sidecar = baseSidecar({ lab_tour_pending: true });
    const patchSidecar = vi.fn(
      async (mut: (cur: OnboardingSidecar) => OnboardingSidecar) => {
        sidecar = mut(sidecar);
      },
    );

    render(
      <LabPromptStep
        sidecar={sidecar}
        setNextDisabled={vi.fn()}
        patchSidecar={patchSidecar}
      />,
    );

    await userEvent.setup().click(
      screen.getByRole("button", { name: /^Dismiss/i }),
    );

    await waitFor(() => {
      expect(patchSidecar).toHaveBeenCalled();
    });
    expect(sidecar.lab_tour_pending).toBe(false);
    expect(sidecar.lab_tour_dismissed_at).toBeTruthy();
    // ISO-8601 shape: 4-digit year, dash, dash, T...
    expect(sidecar.lab_tour_dismissed_at).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
    );
  });

  it("Next stays disabled until the user picks a button", async () => {
    const setNextDisabled = vi.fn();
    const sidecar = baseSidecar();
    const patchSidecar = vi.fn(async () => {});

    render(
      <LabPromptStep
        sidecar={sidecar}
        setNextDisabled={setNextDisabled}
        patchSidecar={patchSidecar}
      />,
    );

    // Initial render: persistedPick is null → Next disabled.
    expect(setNextDisabled).toHaveBeenLastCalledWith(true);

    await userEvent.setup().click(
      screen.getByRole("button", { name: /Take the Lab tour now/i }),
    );

    await waitFor(() => {
      expect(setNextDisabled).toHaveBeenLastCalledWith(false);
    });
  });
});
