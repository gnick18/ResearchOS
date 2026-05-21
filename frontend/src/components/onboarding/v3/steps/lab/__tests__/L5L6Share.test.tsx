import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { OnboardingSidecar } from "@/lib/onboarding/sidecar";

const { createTask, shareTask, unshareTask } = vi.hoisted(() => ({
  createTask: vi.fn(async (data: { name: string }) => ({
    id: 1234,
    project_id: null,
    name: data.name,
    start_date: "2026-05-20",
    duration_days: 1,
    end_date: "2026-05-20",
    is_high_level: false,
    is_complete: false,
    task_type: "experiment" as const,
    method_ids: [],
    method_attachments: [],
    owner: "test-user",
    shared_with: [],
  })),
  shareTask: vi.fn(async () => ({
    status: "ok",
    item_id: 1234,
    shared_with: "beakerbot",
    permission: "edit",
  })),
  unshareTask: vi.fn(async () => ({
    status: "ok",
    item_id: 1234,
    shared_with: "beakerbot",
  })),
}));

vi.mock("@/lib/local-api", () => ({
  tasksApi: { create: createTask },
  sharingApi: { shareTask, unshareTask },
}));

import L5UserSharesBack from "../L5UserSharesBack";
import L6RevokeShare from "../L6RevokeShare";

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

beforeEach(() => {
  createTask.mockClear();
  shareTask.mockClear();
  unshareTask.mockClear();
});

describe("L5UserSharesBack", () => {
  it("creates a new experiment, shares it with beakerbot edit, and logs the artifact", async () => {
    let sidecar = baseSidecar();
    const patchSidecar = vi.fn(
      async (mut: (cur: OnboardingSidecar) => OnboardingSidecar) => {
        sidecar = mut(sidecar);
      },
    );

    render(
      <L5UserSharesBack
        sidecar={sidecar}
        setNextDisabled={vi.fn()}
        patchSidecar={patchSidecar}
      />,
    );

    await userEvent.setup().click(
      screen.getByRole("button", { name: /Create and share with BeakerBot/i }),
    );

    await waitFor(() => {
      expect(createTask).toHaveBeenCalledTimes(1);
    });
    expect(createTask.mock.calls[0][0]).toMatchObject({
      task_type: "experiment",
    });
    expect(shareTask).toHaveBeenCalledWith(1234, {
      username: "beakerbot",
      permission: "edit",
    });
    const experiment = sidecar.wizard_resume_state!.artifacts_created.find(
      (a) => a.type === "experiment" && a.id.endsWith(":l5-share-back"),
    );
    expect(experiment).toMatchObject({
      type: "experiment",
      id: "1234:l5-share-back",
      cleanup_default: "keep",
    });
  });
});

describe("L6RevokeShare", () => {
  it("calls sharingApi.unshareTask for the L5 task id when the user clicks Revoke", async () => {
    const sidecar = baseSidecar({
      wizard_resume_state: {
        current_step: "L6",
        skipped_steps: [],
        artifacts_created: [
          { type: "lab_user", id: "beakerbot", cleanup_default: "discard" },
          {
            type: "experiment",
            id: "1234:l5-share-back",
            cleanup_default: "keep",
          },
        ],
      },
    });

    render(
      <L6RevokeShare
        sidecar={sidecar}
        setNextDisabled={vi.fn()}
      />,
    );

    await userEvent.setup().click(
      screen.getByRole("button", { name: /Revoke access/i }),
    );

    await waitFor(() => {
      expect(unshareTask).toHaveBeenCalledWith(1234, "beakerbot");
    });
    expect(screen.getByText(/can no longer see/i)).toBeTruthy();
  });

  it("renders a pointer-back hint when the L5 artifact is missing", () => {
    const sidecar = baseSidecar();
    render(
      <L6RevokeShare
        sidecar={sidecar}
        setNextDisabled={vi.fn()}
      />,
    );
    expect(screen.getByText(/Skipped the share-back step/i)).toBeTruthy();
    expect(unshareTask).not.toHaveBeenCalled();
  });
});
