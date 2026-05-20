import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { OnboardingSidecar } from "@/lib/onboarding/sidecar";

const { createTask, createPurchase, taskUpdate, createGoal, createFeed } =
  vi.hoisted(() => ({
    createTask: vi.fn(async (data: { name: string; task_type?: string }) => ({
      id: 555,
      project_id: data.task_type === "purchase" ? 7 : null,
      name: data.name,
      start_date: "2026-05-20",
      duration_days: 1,
      end_date: "2026-05-20",
      is_high_level: false,
      is_complete: false,
      task_type: (data.task_type ?? "list") as "experiment" | "purchase" | "list",
      method_ids: [],
      method_attachments: [],
      owner: "test-user",
      shared_with: [],
    })),
    createPurchase: vi.fn(async () => ({
      id: 1,
      task_id: 555,
      item_name: "Sample reagent",
      quantity: 1,
      link: null,
      cas: null,
      price_per_unit: 50,
      shipping_fees: 0,
      total_price: 50,
      notes: null,
      funding_string: null,
      vendor: null,
      category: null,
    })),
    taskUpdate: vi.fn(async () => ({ id: 555, is_complete: true })),
    createGoal: vi.fn(async (data: { name: string; project_id: number | null }) => ({
      id: 777,
      project_id: data.project_id,
      name: data.name,
      start_date: "2026-05-20",
      end_date: "2026-06-19",
      color: null,
      smart_goals: [],
      is_complete: false,
      created_at: "2026-05-20T00:00:00.000Z",
    })),
    createFeed: vi.fn(async (_username: string, input: { label: string; icsUrl: string }) => ({
      id: 42,
      provider: "other" as const,
      kind: "ics" as const,
      label: input.label,
      icsUrl: input.icsUrl,
      color: "#3b82f6",
      enabled: true,
      lastSyncAt: null,
    })),
  }));

vi.mock("@/lib/local-api", () => ({
  tasksApi: { create: createTask, update: taskUpdate, get: vi.fn() },
  purchasesApi: { create: createPurchase },
  goalsApi: { create: createGoal },
}));

vi.mock("@/lib/calendar/external-feeds-store", () => ({
  createFeed,
}));

import W10PurchasesTourStep from "../W10PurchasesTourStep";
import W11GoalsTourStep from "../W11GoalsTourStep";
import W13CalendarTourStep from "../W13CalendarTourStep";

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
  createPurchase.mockClear();
  taskUpdate.mockClear();
  createGoal.mockClear();
  createFeed.mockClear();
});

describe("W10PurchasesTourStep", () => {
  it("creates a purchase task plus a line item and logs the artifact", async () => {
    let sidecar = baseSidecar({
      wizard_resume_state: {
        current_step: "W10",
        skipped_steps: [],
        artifacts_created: [
          { type: "project", id: "7", cleanup_default: "keep" },
        ],
      },
    });
    const patchSidecar = vi.fn(
      async (mut: (cur: OnboardingSidecar) => OnboardingSidecar) => {
        sidecar = mut(sidecar);
      },
    );

    const { rerender } = render(
      <W10PurchasesTourStep
        sidecar={sidecar}
        setNextDisabled={vi.fn()}
        patchSidecar={patchSidecar}
      />,
    );

    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: /create a sample purchase/i }),
    );

    await waitFor(() => {
      expect(createTask).toHaveBeenCalledTimes(1);
    });
    expect(createTask.mock.calls[0][0]).toMatchObject({
      task_type: "purchase",
      project_id: 7,
    });
    await waitFor(() => {
      expect(createPurchase).toHaveBeenCalledWith({
        task_id: 555,
        item_name: "Sample reagent",
        quantity: 1,
        price_per_unit: 50,
      });
    });

    rerender(
      <W10PurchasesTourStep
        sidecar={sidecar}
        setNextDisabled={vi.fn()}
        patchSidecar={patchSidecar}
      />,
    );

    expect(
      sidecar.wizard_resume_state?.artifacts_created.find(
        (a) => a.type === "purchase",
      ),
    ).toEqual({ type: "purchase", id: "555", cleanup_default: "keep" });
  });

  it("disables Next while no purchase exists", () => {
    const setNextDisabled = vi.fn();
    render(
      <W10PurchasesTourStep
        sidecar={baseSidecar()}
        setNextDisabled={setNextDisabled}
        patchSidecar={vi.fn()}
      />,
    );
    expect(setNextDisabled).toHaveBeenLastCalledWith(true);
  });
});

describe("W11GoalsTourStep", () => {
  it("creates a goal scoped to W1's project and logs the artifact", async () => {
    let sidecar = baseSidecar({
      wizard_resume_state: {
        current_step: "W11",
        skipped_steps: [],
        artifacts_created: [
          { type: "project", id: "9", cleanup_default: "keep" },
        ],
      },
    });
    const patchSidecar = vi.fn(
      async (mut: (cur: OnboardingSidecar) => OnboardingSidecar) => {
        sidecar = mut(sidecar);
      },
    );
    render(
      <W11GoalsTourStep
        sidecar={sidecar}
        setNextDisabled={vi.fn()}
        patchSidecar={patchSidecar}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /create the goal/i }));

    await waitFor(() => {
      expect(createGoal).toHaveBeenCalledTimes(1);
    });
    expect(createGoal.mock.calls[0][0]).toMatchObject({
      project_id: 9,
      name: "Finish first experiment",
    });
    expect(
      sidecar.wizard_resume_state?.artifacts_created.find(
        (a) => a.type === "goal",
      ),
    ).toEqual({ type: "goal", id: "777", cleanup_default: "keep" });
  });

  it("creates a personal goal (project_id null) when no project artifact exists", async () => {
    const patchSidecar = vi.fn(
      async (mut: (cur: OnboardingSidecar) => OnboardingSidecar) =>
        void mut(baseSidecar()),
    );
    render(
      <W11GoalsTourStep
        sidecar={baseSidecar()}
        setNextDisabled={vi.fn()}
        patchSidecar={patchSidecar}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /create the goal/i }));
    await waitFor(() => {
      expect(createGoal).toHaveBeenCalledTimes(1);
    });
    expect(createGoal.mock.calls[0][0]).toMatchObject({ project_id: null });
  });
});

describe("W13CalendarTourStep", () => {
  it("subscribes via createFeed with the sample URL when blank, logs encoded artifact", async () => {
    let sidecar = baseSidecar();
    const patchSidecar = vi.fn(
      async (mut: (cur: OnboardingSidecar) => OnboardingSidecar) => {
        sidecar = mut(sidecar);
      },
    );
    render(
      <W13CalendarTourStep
        username="test-user"
        sidecar={sidecar}
        setNextDisabled={vi.fn()}
        patchSidecar={patchSidecar}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^subscribe$/i }));
    await waitFor(() => {
      expect(createFeed).toHaveBeenCalledTimes(1);
    });
    expect(createFeed.mock.calls[0]).toEqual([
      "test-user",
      {
        provider: "other",
        label: "Sample lab calendar",
        icsUrl: "https://calendar.example.com/onboarding-sample.ics",
        color: "#3b82f6",
        enabled: true,
      },
    ]);
    const feedArtifact = sidecar.wizard_resume_state?.artifacts_created.find(
      (a) => a.type === "calendar_feed",
    );
    expect(feedArtifact?.id).toBe(
      "42:https://calendar.example.com/onboarding-sample.ics",
    );
    expect(feedArtifact?.cleanup_default).toBe("keep");
  });
});
