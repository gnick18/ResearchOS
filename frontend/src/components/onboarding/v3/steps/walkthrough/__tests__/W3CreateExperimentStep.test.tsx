import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { OnboardingSidecar } from "@/lib/onboarding/sidecar";

const { createTask, createProject, writeFile, createMethod } = vi.hoisted(() => ({
  createTask: vi.fn(async (data: { name: string; project_id?: number | null }) => ({
    id: 555,
    name: data.name,
    project_id: data.project_id ?? 0,
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
    comments: [],
  })),
  createProject: vi.fn(async (data: { name: string }) => ({
    id: 999,
    name: data.name,
    weekend_active: false,
    tags: null,
    color: null,
    created_at: "2026-05-20T00:00:00.000Z",
    sort_order: 0,
    is_archived: false,
    archived_at: null,
    owner: "test-user",
    shared_with: [],
  })),
  writeFile: vi.fn(async () => ({ path: "x", sha: "y" })),
  createMethod: vi.fn(async (data: { name: string }) => ({
    id: 1,
    name: data.name,
    source_path: null,
    method_type: "markdown" as const,
    folder_path: null,
    parent_method_id: null,
    tags: null,
    is_public: false,
    created_by: null,
    owner: "test-user",
    shared_with: [],
  })),
}));

vi.mock("@/lib/local-api", () => ({
  filesApi: { writeFile },
  methodsApi: { create: createMethod },
  projectsApi: { create: createProject },
  tasksApi: { create: createTask, addMethod: vi.fn(), get: vi.fn() },
}));

import W3CreateExperimentStep from "../W3CreateExperimentStep";

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
  createProject.mockClear();
});

describe("W3CreateExperimentStep", () => {
  it("auto-creates a project when W1 was skipped, then creates the experiment in that project", async () => {
    let sidecar = baseSidecar({
      wizard_resume_state: {
        current_step: "W3",
        skipped_steps: ["W1"],
        artifacts_created: [],
      },
    });
    const patchSidecar = vi.fn(
      async (mut: (cur: OnboardingSidecar) => OnboardingSidecar) => {
        sidecar = mut(sidecar);
      },
    );

    const { rerender } = render(
      <W3CreateExperimentStep
        sidecar={sidecar}
        setNextDisabled={vi.fn()}
        patchSidecar={patchSidecar}
      />,
    );

    // First effect tick: auto-prereq runs and logs the auto project.
    await waitFor(() => {
      expect(createProject).toHaveBeenCalledTimes(1);
    });
    expect(createProject).toHaveBeenCalledWith({
      name: "[Auto] My First Project",
    });
    expect(sidecar.wizard_resume_state?.skipped_steps).toContain("auto:W1");
    expect(
      sidecar.wizard_resume_state?.artifacts_created.find(
        (a) => a.type === "project",
      )?.cleanup_default,
    ).toBe("discard");

    // Re-render with the post-auto sidecar so the click handler reads the
    // populated artifact slot.
    rerender(
      <W3CreateExperimentStep
        sidecar={sidecar}
        setNextDisabled={vi.fn()}
        patchSidecar={patchSidecar}
      />,
    );

    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: /create experiment/i }),
    );
    await waitFor(() => {
      expect(createTask).toHaveBeenCalledTimes(1);
    });
    type TaskCreatePayload = {
      project_id?: number | null;
      task_type?: "experiment" | "purchase" | "list";
    };
    const taskCall = (
      createTask.mock.calls as unknown as Array<[TaskCreatePayload]>
    )[0];
    expect(taskCall[0].project_id).toBe(999);
    expect(taskCall[0].task_type).toBe("experiment");
    expect(
      sidecar.wizard_resume_state?.artifacts_created.find(
        (a) => a.type === "experiment",
      ),
    ).toEqual({ type: "experiment", id: "555", cleanup_default: "keep" });
  });

  it("does NOT auto-create a project when W1 was not skipped (artifact present)", async () => {
    const sidecar = baseSidecar({
      wizard_resume_state: {
        current_step: "W3",
        skipped_steps: [],
        artifacts_created: [
          { type: "project", id: "42", cleanup_default: "keep" },
        ],
      },
    });
    const patchSidecar = vi.fn(
      async (mut: (cur: OnboardingSidecar) => OnboardingSidecar) =>
        void mut(sidecar),
    );

    render(
      <W3CreateExperimentStep
        sidecar={sidecar}
        setNextDisabled={vi.fn()}
        patchSidecar={patchSidecar}
      />,
    );

    // Give the effect a tick to settle — auto-prereq should be a no-op.
    await new Promise((r) => setTimeout(r, 30));
    expect(createProject).not.toHaveBeenCalled();
  });
});
