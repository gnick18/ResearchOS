import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { OnboardingSidecar } from "@/lib/onboarding/sidecar";

import L8LabPurchases from "../L8LabPurchases";
import L11BeakerBotCleanupOption from "../L11BeakerBotCleanupOption";

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

describe("L8LabPurchases", () => {
  it("registers a purchase-demo lab_task artifact on mount", async () => {
    let sidecar = baseSidecar({
      wizard_resume_state: {
        current_step: "L8",
        skipped_steps: [],
        artifacts_created: [
          { type: "lab_user", id: "beakerbot", cleanup_default: "discard" },
        ],
      },
    });
    const patchSidecar = vi.fn(
      async (mut: (cur: OnboardingSidecar) => OnboardingSidecar) => {
        sidecar = mut(sidecar);
      },
    );

    render(
      <L8LabPurchases
        sidecar={sidecar}
        setNextDisabled={vi.fn()}
        patchSidecar={patchSidecar}
      />,
    );

    await waitFor(() => {
      expect(patchSidecar).toHaveBeenCalled();
    });
    const purchase = sidecar.wizard_resume_state!.artifacts_created.find(
      (a) => a.type === "lab_task" && a.id.startsWith("purchase-demo:"),
    );
    expect(purchase).toMatchObject({
      type: "lab_task",
      cleanup_default: "discard",
    });
  });
});

describe("L11BeakerBotCleanupOption", () => {
  it("Yes pick flips lab_user + lab_task cleanup_default to discard", async () => {
    let sidecar = baseSidecar({
      wizard_resume_state: {
        current_step: "L11",
        skipped_steps: [],
        artifacts_created: [
          { type: "lab_user", id: "beakerbot", cleanup_default: "keep" },
          { type: "lab_task", id: "edit-demo:1", cleanup_default: "keep" },
          { type: "lab_task", id: "view-demo:1", cleanup_default: "keep" },
          {
            type: "experiment",
            id: "1234:l5-share-back",
            cleanup_default: "keep",
          },
        ],
      },
    });
    const patchSidecar = vi.fn(
      async (mut: (cur: OnboardingSidecar) => OnboardingSidecar) => {
        sidecar = mut(sidecar);
      },
    );

    render(
      <L11BeakerBotCleanupOption
        sidecar={sidecar}
        setNextDisabled={vi.fn()}
        patchSidecar={patchSidecar}
      />,
    );

    await userEvent.setup().click(
      screen.getByRole("button", { name: /Yes, clean up the demo/i }),
    );

    await waitFor(() => {
      expect(patchSidecar).toHaveBeenCalled();
    });
    const artifacts = sidecar.wizard_resume_state!.artifacts_created;
    expect(
      artifacts.find((a) => a.type === "lab_user")?.cleanup_default,
    ).toBe("discard");
    expect(
      artifacts.filter((a) => a.type === "lab_task").every((a) => a.cleanup_default === "discard"),
    ).toBe(true);
    // Non-lab artifacts (the L5 experiment) keep their cleanup_default.
    expect(
      artifacts.find((a) => a.type === "experiment")?.cleanup_default,
    ).toBe("keep");
  });

  it("No pick flips lab artifacts to keep", async () => {
    let sidecar = baseSidecar({
      wizard_resume_state: {
        current_step: "L11",
        skipped_steps: [],
        artifacts_created: [
          { type: "lab_user", id: "beakerbot", cleanup_default: "discard" },
          { type: "lab_task", id: "edit-demo:1", cleanup_default: "discard" },
        ],
      },
    });
    const patchSidecar = vi.fn(
      async (mut: (cur: OnboardingSidecar) => OnboardingSidecar) => {
        sidecar = mut(sidecar);
      },
    );

    render(
      <L11BeakerBotCleanupOption
        sidecar={sidecar}
        setNextDisabled={vi.fn()}
        patchSidecar={patchSidecar}
      />,
    );

    await userEvent.setup().click(
      screen.getByRole("button", { name: /No, keep BeakerBot around/i }),
    );

    await waitFor(() => {
      expect(patchSidecar).toHaveBeenCalled();
    });
    const artifacts = sidecar.wizard_resume_state!.artifacts_created;
    expect(
      artifacts.find((a) => a.type === "lab_user")?.cleanup_default,
    ).toBe("keep");
    expect(
      artifacts.find((a) => a.type === "lab_task")?.cleanup_default,
    ).toBe("keep");
  });
});
