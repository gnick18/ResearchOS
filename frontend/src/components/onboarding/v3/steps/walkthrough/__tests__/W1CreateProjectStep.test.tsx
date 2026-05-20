import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { OnboardingSidecar } from "@/lib/onboarding/sidecar";

const { createProject } = vi.hoisted(() => ({
  createProject: vi.fn(async (data: { name: string }) => ({
    id: 101,
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
}));

vi.mock("@/lib/local-api", () => ({
  projectsApi: { create: createProject },
}));

import W1CreateProjectStep from "../W1CreateProjectStep";

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
  createProject.mockClear();
});

describe("W1CreateProjectStep", () => {
  it("creates a project with the typed name and logs the artifact as keep", async () => {
    let sidecar = baseSidecar();
    const patchSidecar = vi.fn(
      async (mut: (cur: OnboardingSidecar) => OnboardingSidecar) => {
        sidecar = mut(sidecar);
      },
    );
    const setNextDisabled = vi.fn();

    render(
      <W1CreateProjectStep
        sidecar={sidecar}
        setNextDisabled={setNextDisabled}
        patchSidecar={patchSidecar}
      />,
    );

    const user = userEvent.setup();
    const input = screen.getByPlaceholderText("My First Project");
    await user.type(input, "Antibody work");
    await user.click(screen.getByRole("button", { name: /create project/i }));

    await waitFor(() => {
      expect(createProject).toHaveBeenCalledWith({ name: "Antibody work" });
    });

    expect(patchSidecar).toHaveBeenCalledTimes(1);
    expect(sidecar.wizard_resume_state?.artifacts_created).toEqual([
      { type: "project", id: "101", cleanup_default: "keep" },
    ]);
  });

  it("falls back to the default name when the input is empty", async () => {
    const patchSidecar = vi.fn(
      async (mut: (cur: OnboardingSidecar) => OnboardingSidecar) =>
        void mut(baseSidecar()),
    );
    render(
      <W1CreateProjectStep
        sidecar={baseSidecar()}
        setNextDisabled={vi.fn()}
        patchSidecar={patchSidecar}
      />,
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /create project/i }));

    await waitFor(() => {
      expect(createProject).toHaveBeenCalledWith({ name: "My First Project" });
    });
  });

  it("renders the done state when a project artifact already exists", () => {
    const sidecar = baseSidecar({
      wizard_resume_state: {
        current_step: "W1",
        skipped_steps: [],
        artifacts_created: [
          { type: "project", id: "5", cleanup_default: "keep" },
        ],
      },
    });
    const setNextDisabled = vi.fn();
    render(
      <W1CreateProjectStep
        sidecar={sidecar}
        setNextDisabled={setNextDisabled}
        patchSidecar={vi.fn()}
      />,
    );
    expect(screen.getByText(/Project created/i)).toBeInTheDocument();
    expect(setNextDisabled).toHaveBeenLastCalledWith(false);
  });

  it("disables Next until the project is created", () => {
    const setNextDisabled = vi.fn();
    render(
      <W1CreateProjectStep
        sidecar={baseSidecar()}
        setNextDisabled={setNextDisabled}
        patchSidecar={vi.fn()}
      />,
    );
    expect(setNextDisabled).toHaveBeenLastCalledWith(true);
  });
});
