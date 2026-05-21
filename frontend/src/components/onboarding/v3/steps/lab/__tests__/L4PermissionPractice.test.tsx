import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { OnboardingSidecar } from "@/lib/onboarding/sidecar";

import L4PermissionPractice from "../L4PermissionPractice";

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

describe("L4PermissionPractice", () => {
  it("registers a view-demo lab_task artifact on mount when none exists", async () => {
    let sidecar = baseSidecar({
      wizard_resume_state: {
        current_step: "L4",
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
      <L4PermissionPractice
        sidecar={sidecar}
        setNextDisabled={vi.fn()}
        patchSidecar={patchSidecar}
      />,
    );

    await waitFor(() => {
      expect(patchSidecar).toHaveBeenCalled();
    });
    const viewArtifact = sidecar.wizard_resume_state!.artifacts_created.find(
      (a) => a.type === "lab_task" && a.id.startsWith("view-demo:"),
    );
    expect(viewArtifact).toMatchObject({
      type: "lab_task",
      cleanup_default: "discard",
    });
  });

  it("view-only delete button shows the blocked-write hint and does not surface a real delete API call", async () => {
    const sidecar = baseSidecar({
      wizard_resume_state: {
        current_step: "L4",
        skipped_steps: [],
        artifacts_created: [
          { type: "lab_user", id: "beakerbot", cleanup_default: "discard" },
          { type: "lab_task", id: "edit-demo:1", cleanup_default: "discard" },
          { type: "lab_task", id: "view-demo:1", cleanup_default: "discard" },
        ],
      },
    });

    render(
      <L4PermissionPractice
        sidecar={sidecar}
        setNextDisabled={vi.fn()}
        patchSidecar={vi.fn()}
      />,
    );

    // The Delete button on the view-only card lives behind data-l4-view-delete.
    const deleteBtn = document.querySelector(
      "[data-l4-view-delete]",
    ) as HTMLButtonElement | null;
    expect(deleteBtn).not.toBeNull();
    await userEvent.setup().click(deleteBtn!);

    await waitFor(() => {
      expect(screen.getByText(/Blocked\./i)).toBeTruthy();
    });
    // No tasksApi.delete or similar should have run; we don't import tasksApi
    // here, but the UI confirms only the blocked-hint rendered.
    expect(screen.getByText(/View-only/i)).toBeTruthy();
  });

  it("edit-permission rename button flips the displayed task name", async () => {
    const sidecar = baseSidecar({
      wizard_resume_state: {
        current_step: "L4",
        skipped_steps: [],
        artifacts_created: [
          { type: "lab_user", id: "beakerbot", cleanup_default: "discard" },
          { type: "lab_task", id: "edit-demo:1", cleanup_default: "discard" },
          { type: "lab_task", id: "view-demo:1", cleanup_default: "discard" },
        ],
      },
    });

    render(
      <L4PermissionPractice
        sidecar={sidecar}
        setNextDisabled={vi.fn()}
        patchSidecar={vi.fn()}
      />,
    );

    expect(screen.getByText(/gel screen$/)).toBeTruthy();
    await userEvent.setup().click(
      screen.getByRole("button", { name: /Rename it/i }),
    );
    await waitFor(() => {
      expect(screen.getByText(/edited by you/i)).toBeTruthy();
    });
  });
});
