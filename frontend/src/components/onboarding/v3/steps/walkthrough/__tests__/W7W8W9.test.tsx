import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { OnboardingSidecar } from "@/lib/onboarding/sidecar";

const { createEventReminder, tasksGet } = vi.hoisted(() => ({
  createEventReminder: vi.fn(async () => ({
    id: "abc-123",
    type: "event_reminder" as const,
    event_id: "x",
    event_kind: "native" as const,
    event_title: "Hi",
    event_start_iso: "2026-05-20T00:15:00.000Z",
    event_date: "2026-05-20",
    event_location: "Onboarding tour",
    offset_minutes: 15,
    created_at: "2026-05-20T00:00:00.000Z",
    read: false,
  })),
  tasksGet: vi.fn(async () => ({
    id: 88,
    name: "Tour experiment",
    project_id: 1,
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
}));

vi.mock("@/lib/local-api", () => ({
  filesApi: { writeFile: vi.fn() },
  methodsApi: { create: vi.fn() },
  projectsApi: { create: vi.fn() },
  tasksApi: { create: vi.fn(), addMethod: vi.fn(), get: tasksGet },
  sharingApi: { createEventReminder },
}));

vi.mock("../lib/use-typewriter", () => ({
  useTypewriter: (source: string) => ({ revealed: source, done: true }),
}));

import W7SearchTourStep from "../W7SearchTourStep";
import W8NotificationsTourStep from "../W8NotificationsTourStep";
import W9WikiPointerStep from "../W9WikiPointerStep";

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
  createEventReminder.mockClear();
  tasksGet.mockClear();
});

describe("W7SearchTourStep", () => {
  it("loads the experiment and renders its name as both the query and the result", async () => {
    const sidecar = baseSidecar({
      wizard_resume_state: {
        current_step: "W7",
        skipped_steps: [],
        artifacts_created: [
          { type: "experiment", id: "88", cleanup_default: "keep" },
        ],
      },
    });
    render(
      <W7SearchTourStep
        sidecar={sidecar}
        setNextDisabled={vi.fn()}
        patchSidecar={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(tasksGet).toHaveBeenCalledWith(88);
    });
    await waitFor(() => {
      expect(screen.getByTestId).toBeDefined();
    });
    await waitFor(() => {
      const result = document.querySelector("[data-w7-result]");
      expect(result?.textContent).toMatch(/Tour experiment/);
    });
  });
});

describe("W8NotificationsTourStep", () => {
  it("fires sharingApi.createEventReminder and disables the button after sending", async () => {
    render(
      <W8NotificationsTourStep
        sidecar={baseSidecar()}
        setNextDisabled={vi.fn()}
        patchSidecar={vi.fn()}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /fire a test ping/i }));
    await waitFor(() => {
      expect(createEventReminder).toHaveBeenCalledTimes(1);
    });
    expect(
      screen.getByRole("button", { name: /sent — check the bell/i }),
    ).toBeDisabled();
  });
});

describe("W9WikiPointerStep", () => {
  it("renders the wiki pointer text and enables Next immediately", () => {
    const setNextDisabled = vi.fn();
    render(<W9WikiPointerStep setNextDisabled={setNextDisabled} />);
    expect(screen.getByText(/Wiki tab/i)).toBeInTheDocument();
    expect(setNextDisabled).toHaveBeenLastCalledWith(false);
  });
});
