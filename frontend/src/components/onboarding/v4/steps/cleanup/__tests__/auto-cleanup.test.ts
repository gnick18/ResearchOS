/**
 * Cleanup retirement 2026-05-22 (Cleanup manager R2) — auto-cleanup
 * unit tests.
 *
 * Mocks every domain delete API plus the lab teammate teardown helper +
 * the sidecar I/O. Asserts:
 *   - First project is preserved (delete NOT called for matching id).
 *   - settings_change is preserved (no delete dispatched).
 *   - ai_helper_prompt_copied is preserved (no delete dispatched).
 *   - Every other tracked artifact type routes through its matching
 *     domain delete API.
 *   - The lab teammate teardown is invoked.
 *   - `wizard_completed_at` is set on the sidecar.
 *   - `wizard_resume_state` is cleared to null.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import type {
  OnboardingSidecar,
  WizardArtifact,
} from "@/lib/onboarding/sidecar";

const {
  projectDelete,
  methodDelete,
  taskDelete,
  goalDelete,
  purchaseDelete,
  dependencyDelete,
  deleteFeed,
  deleteImageFromBase,
  tasksGet,
  getNotifications,
  dismissNotification,
  cleanupBeakerBotLabUser,
  readOnboarding,
  patchOnboarding,
} = vi.hoisted(() => ({
  projectDelete: vi.fn(async (_id: number) => {}),
  methodDelete: vi.fn(async (_id: number) => {}),
  taskDelete: vi.fn(async (_id: number) => {}),
  goalDelete: vi.fn(async (_id: number) => {}),
  purchaseDelete: vi.fn(async (_id: number) => {}),
  dependencyDelete: vi.fn(async (_id: number) => {}),
  deleteFeed: vi.fn(async (_username: string, _id: number) => true),
  deleteImageFromBase: vi.fn(
    async (_basePath: string, _filename: string) => {},
  ),
  tasksGet: vi.fn(async (_id: number) => ({
    id: 999,
    owner: "test-user",
    name: "demo",
  })),
  getNotifications: vi.fn(async () => ({ notifications: [] as unknown[] })),
  dismissNotification: vi.fn(async (_id: string) => ({
    status: "ok",
    notification_id: _id,
  })),
  cleanupBeakerBotLabUser: vi.fn(async (_username: string) => {}),
  readOnboarding: vi.fn(
    async (_username: string): Promise<OnboardingSidecar> => ({
      version: 4,
      first_seen_at: "",
      active_seconds: 0,
      feature_picks: null,
      wizard_completed_at: null,
      wizard_skipped_at: null,
      wizard_force_show: false,
      wizard_resume_state: null,
      lab_tour_pending: false,
      lab_tour_dismissed_at: null,
      lab_mode_tour_choice: null,
    }),
  ),
  patchOnboarding: vi.fn(async (_username: string, patch: any) =>
    patch({
      version: 4,
      first_seen_at: "",
      active_seconds: 0,
      feature_picks: null,
      wizard_completed_at: null,
      wizard_skipped_at: null,
      wizard_force_show: false,
      wizard_resume_state: null,
      lab_tour_pending: false,
      lab_tour_dismissed_at: null,
      lab_mode_tour_choice: null,
    }),
  ),
}));

vi.mock("@/lib/local-api", () => ({
  projectsApi: { delete: projectDelete },
  methodsApi: { delete: methodDelete },
  tasksApi: { delete: taskDelete, get: tasksGet },
  goalsApi: { delete: goalDelete },
  purchasesApi: { delete: purchaseDelete },
  dependenciesApi: { delete: dependencyDelete },
  sharingApi: {
    getNotifications,
    dismissNotification,
  },
}));

vi.mock("@/lib/calendar/external-feeds-store", () => ({
  deleteFeed,
}));

vi.mock("@/lib/attachments/move-image", () => ({
  deleteImageFromBase,
}));

vi.mock("@/lib/onboarding/sidecar", async () => {
  // Pull through the real type exports so callers that import
  // `WizardArtifact` keep working without an extra mock layer.
  const actual = await vi.importActual<
    typeof import("@/lib/onboarding/sidecar")
  >("@/lib/onboarding/sidecar");
  return {
    ...actual,
    readOnboarding,
    patchOnboarding,
  };
});

vi.mock(
  "@/components/onboarding/v4/steps/lab/lib/lab-fake-user",
  () => ({
    cleanupBeakerBotLabUser,
    BEAKERBOT_LAB_USERNAME: "beakerbot",
  }),
);

import { runEndOfTourAutoCleanup } from "../auto-cleanup";

function art(
  type: WizardArtifact["type"],
  id: string,
  def: "keep" | "discard" = "discard",
): WizardArtifact {
  return { type, id, cleanup_default: def };
}

function seedArtifacts(artifacts: WizardArtifact[]): void {
  readOnboarding.mockImplementation(async () => ({
    version: 4,
    first_seen_at: "2026-05-22T00:00:00.000Z",
    active_seconds: 0,
    feature_picks: null,
    wizard_completed_at: null,
    wizard_skipped_at: null,
    wizard_force_show: false,
    wizard_resume_state: {
      current_step: "tour-goodbye",
      skipped_steps: [],
      artifacts_created: artifacts,
    },
    lab_tour_pending: false,
    lab_tour_dismissed_at: null,
    lab_mode_tour_choice: null,
  }));
}

beforeEach(() => {
  projectDelete.mockClear();
  methodDelete.mockClear();
  taskDelete.mockClear();
  goalDelete.mockClear();
  purchaseDelete.mockClear();
  dependencyDelete.mockClear();
  deleteFeed.mockClear();
  deleteImageFromBase.mockClear();
  tasksGet.mockClear();
  getNotifications.mockReset();
  dismissNotification.mockReset();
  cleanupBeakerBotLabUser.mockClear();
  readOnboarding.mockReset();
  patchOnboarding.mockReset();
  getNotifications.mockResolvedValue({ notifications: [] });
  dismissNotification.mockResolvedValue({
    status: "ok",
    notification_id: "x",
  });
  patchOnboarding.mockImplementation(async (_u: string, patch: any) =>
    patch({
      version: 4,
      first_seen_at: "",
      active_seconds: 0,
      feature_picks: null,
      wizard_completed_at: null,
      wizard_skipped_at: null,
      wizard_force_show: false,
      wizard_resume_state: null,
      lab_tour_pending: false,
      lab_tour_dismissed_at: null,
      lab_mode_tour_choice: null,
    }),
  );
});

describe("runEndOfTourAutoCleanup — preservation rules", () => {
  it("preserves the first project (does NOT delete by id)", async () => {
    seedArtifacts([
      art("project", "42", "keep"),
      art("project", "43"), // second project, should be deleted
    ]);
    const summary = await runEndOfTourAutoCleanup({
      username: "alex",
      firstProjectId: "42",
    });
    expect(projectDelete).toHaveBeenCalledTimes(1);
    expect(projectDelete).toHaveBeenCalledWith(43);
    expect(projectDelete).not.toHaveBeenCalledWith(42);
    expect(summary.preserved).toBe(1);
  });

  it("preserves settings_change rows (no delete dispatched)", async () => {
    seedArtifacts([
      art("settings_change", "color:#abc→#def", "keep"),
      art("settings_change", "animationType:none→fade", "keep"),
    ]);
    const summary = await runEndOfTourAutoCleanup({
      username: "alex",
      firstProjectId: null,
    });
    expect(summary.preserved).toBe(2);
    expect(summary.attempted).toBe(0);
  });

  it("preserves ai_helper_prompt_copied rows (no delete dispatched)", async () => {
    seedArtifacts([
      art("ai_helper_prompt_copied", "full", "keep"),
    ]);
    const summary = await runEndOfTourAutoCleanup({
      username: "alex",
      firstProjectId: null,
    });
    expect(summary.preserved).toBe(1);
    expect(summary.attempted).toBe(0);
  });
});

describe("runEndOfTourAutoCleanup — per-type delete routing", () => {
  it("routes a non-first project to projectsApi.delete", async () => {
    seedArtifacts([art("project", "100")]);
    await runEndOfTourAutoCleanup({
      username: "alex",
      firstProjectId: "42",
    });
    expect(projectDelete).toHaveBeenCalledWith(100);
  });

  it("routes method to methodsApi.delete via decoded id", async () => {
    seedArtifacts([art("method", "17:placeholder")]);
    await runEndOfTourAutoCleanup({
      username: "alex",
      firstProjectId: null,
    });
    expect(methodDelete).toHaveBeenCalledWith(17);
  });

  it("routes experiment/task/demo_dep_task to tasksApi.delete", async () => {
    seedArtifacts([
      art("experiment", "5"),
      art("task", "11"),
      art("demo_dep_task", "12"),
    ]);
    await runEndOfTourAutoCleanup({
      username: "alex",
      firstProjectId: null,
    });
    expect(taskDelete).toHaveBeenCalledWith(5);
    expect(taskDelete).toHaveBeenCalledWith(11);
    expect(taskDelete).toHaveBeenCalledWith(12);
  });

  it("routes purchase artifact to tasksApi.delete (cascades items)", async () => {
    seedArtifacts([art("purchase", "9")]);
    await runEndOfTourAutoCleanup({
      username: "alex",
      firstProjectId: null,
    });
    expect(taskDelete).toHaveBeenCalledWith(9);
  });

  it("routes purchase_item to purchasesApi.delete", async () => {
    seedArtifacts([art("purchase_item", "7")]);
    await runEndOfTourAutoCleanup({
      username: "alex",
      firstProjectId: null,
    });
    expect(purchaseDelete).toHaveBeenCalledWith(7);
  });

  it("routes dep_edge to dependenciesApi.delete", async () => {
    seedArtifacts([art("dep_edge", "33")]);
    await runEndOfTourAutoCleanup({
      username: "alex",
      firstProjectId: null,
    });
    expect(dependencyDelete).toHaveBeenCalledWith(33);
  });

  it("routes goal to goalsApi.delete", async () => {
    seedArtifacts([art("goal", "8")]);
    await runEndOfTourAutoCleanup({
      username: "alex",
      firstProjectId: null,
    });
    expect(goalDelete).toHaveBeenCalledWith(8);
  });

  it("treats funding_string and category as no-ops", async () => {
    seedArtifacts([
      art("funding_string", "NSF-1234"),
      art("category", "PCR Methods"),
      art("method_category", "Bench Methods"),
    ]);
    const summary = await runEndOfTourAutoCleanup({
      username: "alex",
      firstProjectId: null,
    });
    // All three attempted but produce no domain calls.
    expect(summary.attempted).toBe(3);
    expect(summary.succeeded).toBe(3);
    expect(summary.failed).toEqual([]);
    expect(projectDelete).not.toHaveBeenCalled();
    expect(methodDelete).not.toHaveBeenCalled();
  });
});

describe("runEndOfTourAutoCleanup — finalize behavior", () => {
  it("calls cleanupBeakerBotLabUser with the username", async () => {
    seedArtifacts([]);
    await runEndOfTourAutoCleanup({
      username: "alex",
      firstProjectId: null,
    });
    expect(cleanupBeakerBotLabUser).toHaveBeenCalledWith("alex");
  });

  it("patches sidecar with wizard_completed_at + clears resume state", async () => {
    seedArtifacts([art("project", "99")]);
    await runEndOfTourAutoCleanup({
      username: "alex",
      firstProjectId: null,
    });
    expect(patchOnboarding).toHaveBeenCalled();
    // Apply the patch fn to a known input and inspect the output.
    const patchFn = patchOnboarding.mock.calls[0][1] as (cur: any) => any;
    const before = {
      version: 4,
      first_seen_at: "",
      active_seconds: 0,
      feature_picks: null,
      wizard_completed_at: null,
      wizard_skipped_at: "2026-05-21T00:00:00.000Z",
      wizard_force_show: true,
      wizard_resume_state: {
        current_step: "tour-goodbye",
        skipped_steps: [],
        artifacts_created: [],
      },
      lab_tour_pending: false,
      lab_tour_dismissed_at: null,
      lab_mode_tour_choice: null,
    };
    const after = patchFn(before);
    expect(after.wizard_completed_at).toBeTruthy();
    expect(after.wizard_skipped_at).toBeNull();
    expect(after.wizard_force_show).toBe(false);
    expect(after.wizard_resume_state).toBeNull();
  });

  it("swallows per-artifact delete failures (best-effort)", async () => {
    seedArtifacts([
      art("project", "1"),
      art("project", "2"),
    ]);
    // First delete throws; the loop must still attempt the second.
    projectDelete.mockImplementationOnce(async () => {
      throw new Error("disk full");
    });
    const originalWarn = console.warn;
    console.warn = () => {};
    let summary;
    try {
      summary = await runEndOfTourAutoCleanup({
        username: "alex",
        firstProjectId: null,
      });
    } finally {
      console.warn = originalWarn;
    }
    expect(projectDelete).toHaveBeenCalledTimes(2);
    expect(summary.attempted).toBe(2);
    expect(summary.succeeded).toBe(1);
    expect(summary.failed).toHaveLength(1);
    expect(summary.failed[0]?.type).toBe("project");
  });

  it("swallows cleanupBeakerBotLabUser failures (best-effort)", async () => {
    seedArtifacts([]);
    cleanupBeakerBotLabUser.mockImplementationOnce(async () => {
      throw new Error("lab teardown failure");
    });
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
      // Should not throw.
      await runEndOfTourAutoCleanup({
        username: "alex",
        firstProjectId: null,
      });
    } finally {
      console.warn = originalWarn;
    }
    // patchOnboarding still ran (finalize is best-effort but unblocked
    // by the lab teardown failure).
    expect(patchOnboarding).toHaveBeenCalled();
  });
});

// cleanup scope fix manager 2026-05-23: pre-existing fixture data must
// survive cleanup. The artifacts_created list should only contain
// tour-created entities; this suite asserts that cleanup is strictly
// list-driven and never touches ids that were NOT recorded during the
// tour walkthrough.
describe("runEndOfTourAutoCleanup — pre-existing fixture data is unaffected", () => {
  it("does not delete tasks absent from artifacts_created (demo fixture task ids)", async () => {
    // Simulate the scenario: the tour recorded two tour-created tasks
    // (ids 31, 32) but the user's pre-existing demo fixture has tasks
    // with overlapping id numbers in a DIFFERENT namespace. Cleanup
    // must only delete what is explicitly listed in artifacts_created.
    seedArtifacts([
      art("task", "31", "discard"),
      art("task", "32", "discard"),
    ]);
    await runEndOfTourAutoCleanup({
      username: "alex",
      firstProjectId: null,
    });
    // Only the two tour-created task ids were attempted.
    expect(taskDelete).toHaveBeenCalledTimes(2);
    expect(taskDelete).toHaveBeenCalledWith(31);
    expect(taskDelete).toHaveBeenCalledWith(32);
    // Crucially: pre-existing demo task ids (morgan's project 1 tasks:
    // 1, 2, 3, 6, 7, 9, 10, 12) were NOT passed to tasksApi.delete.
    for (const prExistingId of [1, 2, 3, 6, 7, 9, 10, 12]) {
      expect(taskDelete).not.toHaveBeenCalledWith(prExistingId);
    }
  });

  it("does not delete projects absent from artifacts_created (demo fixture project ids)", async () => {
    // Tour created one project (id 5, preserved as firstProjectId)
    // and one method (id 13). Pre-existing demo fixture projects 1-4
    // must not be touched by cleanup.
    seedArtifacts([
      art("project", "5", "keep"),
      art("method", "13:placeholder", "discard"),
    ]);
    await runEndOfTourAutoCleanup({
      username: "alex",
      firstProjectId: "5",
    });
    // Project 5 preserved (firstProjectId), method 13 deleted.
    expect(projectDelete).not.toHaveBeenCalled();
    expect(methodDelete).toHaveBeenCalledWith(13);
    // Pre-existing demo project ids must not be touched.
    for (const preExistingProjectId of [1, 2, 3, 4]) {
      expect(projectDelete).not.toHaveBeenCalledWith(preExistingProjectId);
    }
  });

  it("no-ops when artifacts_created is empty (skip-ahead before any step)", async () => {
    // User clicked Skip ahead before doing anything. No artifacts
    // recorded. Cleanup must make zero domain delete calls.
    seedArtifacts([]);
    const summary = await runEndOfTourAutoCleanup({
      username: "alex",
      firstProjectId: null,
    });
    expect(summary.attempted).toBe(0);
    expect(summary.preserved).toBe(0);
    expect(taskDelete).not.toHaveBeenCalled();
    expect(projectDelete).not.toHaveBeenCalled();
    expect(goalDelete).not.toHaveBeenCalled();
    expect(methodDelete).not.toHaveBeenCalled();
  });
});
