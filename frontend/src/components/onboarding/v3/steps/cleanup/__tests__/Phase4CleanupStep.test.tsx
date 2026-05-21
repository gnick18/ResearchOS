import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  OnboardingSidecar,
  WizardArtifact,
} from "@/lib/onboarding/sidecar";

/**
 * P4 Phase 4 cleanup grid integration tests. Drive the cleanup step
 * through the live OnboardingWizardV3 shell so the lifted-state +
 * Finish-click + cleanupArtifacts wiring is exercised end-to-end.
 *
 * Mocks: every domain delete API the cleanup helper might hit is
 * stubbed with vi.fn() so we can assert "this artifact would have been
 * deleted" without touching the file system.
 */

const {
  projectDelete,
  methodDelete,
  taskDelete,
  goalDelete,
  userDelete,
  deleteFeed,
  clearPairing,
  deleteImageFromBase,
  patchUserSettings,
  tasksGet,
} = vi.hoisted(() => ({
  projectDelete: vi.fn(async (_id: number) => {}),
  methodDelete: vi.fn(async (_id: number) => {}),
  taskDelete: vi.fn(async (_id: number) => {}),
  goalDelete: vi.fn(async (_id: number) => {}),
  userDelete: vi.fn(async (
    _username: string,
    _step: number,
    _ack: boolean,
  ) => ({ status: "ok", deleted_username: "beakerbot", message: "" })),
  deleteFeed: vi.fn(async (_username: string, _id: number) => true),
  clearPairing: vi.fn(async (_username: string) => {}),
  deleteImageFromBase: vi.fn(
    async (_basePath: string, _filename: string) => {},
  ),
  patchUserSettings: vi.fn(async () => ({}) as never),
  tasksGet: vi.fn(async (_id: number, _owner?: string) => ({
    id: 999,
    owner: "test-user",
    name: "demo task",
  })),
}));

vi.mock("@/lib/local-api", () => ({
  projectsApi: { delete: projectDelete },
  methodsApi: { delete: methodDelete },
  tasksApi: { delete: taskDelete, get: tasksGet },
  goalsApi: { delete: goalDelete },
  usersApi: { delete: userDelete },
}));

vi.mock("@/lib/calendar/external-feeds-store", () => ({
  deleteFeed,
}));

vi.mock("@/lib/telegram/telegram-store", () => ({
  clearPairing,
}));

vi.mock("@/lib/attachments/move-image", () => ({
  deleteImageFromBase,
}));

vi.mock("@/lib/settings/user-settings", () => ({
  patchUserSettings,
}));

import OnboardingWizardV3 from "../../../OnboardingWizardV3";

function baseSidecar(
  patch: Partial<OnboardingSidecar> = {},
): OnboardingSidecar {
  return {
    version: 4,
    first_seen_at: "2026-05-20T00:00:00.000Z",
    active_seconds: 0,
    feature_picks: {
      account_type: "solo",
      purchases: "maybe",
      calendar: "maybe",
      goals: "maybe",
      telegram: "maybe",
      ai_helper: "maybe",
    },
    wizard_completed_at: null,
    wizard_skipped_at: null,
    wizard_force_show: true,
    wizard_resume_state: null,
    lab_tour_pending: false,
    lab_tour_dismissed_at: null,
    ...patch,
  };
}

function withArtifacts(
  artifacts: WizardArtifact[],
  current: string = "phase4-cleanup",
  skipped: string[] = [],
): OnboardingSidecar {
  return baseSidecar({
    wizard_resume_state: {
      current_step: current,
      skipped_steps: skipped,
      artifacts_created: artifacts,
    },
  });
}

type WizardProps = Parameters<typeof OnboardingWizardV3>[0];

interface Harness {
  onComplete: WizardProps["onComplete"];
  onSkip: WizardProps["onSkip"];
  onTransition: WizardProps["onTransition"];
  patchSidecar: WizardProps["patchSidecar"];
}

function renderAt(
  initialStep: Parameters<typeof OnboardingWizardV3>[0]["initialStep"],
  sidecar: OnboardingSidecar,
): Harness {
  const harness: Harness = {
    onComplete: vi.fn(async () => {}),
    onSkip: vi.fn(async () => {}),
    onTransition: vi.fn(async () => {}),
    patchSidecar: vi.fn(async () => {}),
  };
  render(
    <OnboardingWizardV3
      username="test-user"
      initialStep={initialStep}
      sidecar={sidecar}
      onTransition={harness.onTransition}
      patchSidecar={harness.patchSidecar}
      onComplete={harness.onComplete}
      onSkip={harness.onSkip}
    />,
  );
  return harness;
}

beforeEach(() => {
  projectDelete.mockClear();
  methodDelete.mockClear();
  taskDelete.mockClear();
  goalDelete.mockClear();
  userDelete.mockClear();
  deleteFeed.mockClear();
  clearPairing.mockClear();
  deleteImageFromBase.mockClear();
  patchUserSettings.mockClear();
  tasksGet.mockClear();
});

describe("Phase4CleanupStep render", () => {
  it("renders empty-state copy when no artifacts were created", async () => {
    const sidecar = baseSidecar({
      wizard_resume_state: {
        current_step: "phase4-cleanup",
        skipped_steps: [],
        artifacts_created: [],
      },
    });
    renderAt("phase4-cleanup", sidecar);

    expect(
      screen.getByText(/no artifacts were created during this run/i),
    ).toBeInTheDocument();
  });

  it("renders every artifact as a checkbox, defaulting to keep (checked)", async () => {
    const sidecar = withArtifacts([
      { type: "project", id: "42", cleanup_default: "keep" },
      { type: "method", id: "17:placeholder", cleanup_default: "keep" },
      { type: "experiment", id: "5", cleanup_default: "keep" },
    ]);
    renderAt("phase4-cleanup", sidecar);

    const projectRow = screen.getByText(/My First Project \(#42\)/);
    const methodRow = screen.getByText(/Method #17 \(placeholder body\)/);
    const expRow = screen.getByText(/Experiment #5/);
    expect(projectRow).toBeInTheDocument();
    expect(methodRow).toBeInTheDocument();
    expect(expRow).toBeInTheDocument();

    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes.length).toBe(3);
    for (const cb of checkboxes) {
      expect(cb).toBeChecked();
    }
  });

  it("tags an auto-created artifact when an `auto:` sentinel is present", async () => {
    const sidecar = withArtifacts(
      [{ type: "project", id: "42", cleanup_default: "discard" }],
      "phase4-cleanup",
      ["W1", "auto:W1"],
    );
    renderAt("phase4-cleanup", sidecar);

    const row = document.querySelector('[data-artifact-id="project:42"]');
    expect(row).toBeTruthy();
    expect(row?.getAttribute("data-cleanup-auto")).toBe("true");
    expect(row?.getAttribute("data-cleanup-state")).toBe("discard");
    const cb = within(row as HTMLElement).getByRole("checkbox");
    expect(cb).not.toBeChecked();
    expect(within(row as HTMLElement).getByText(/auto-created/i)).toBeInTheDocument();
  });
});

describe("Phase4CleanupStep Finish behavior", () => {
  it("clicking Finish with no discards calls onComplete and skips delete APIs", async () => {
    const sidecar = withArtifacts([
      { type: "project", id: "42", cleanup_default: "keep" },
    ]);
    const harness = renderAt("phase4-cleanup", sidecar);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /finish setup/i }));

    await waitFor(() => expect(harness.onComplete).toHaveBeenCalledTimes(1));
    expect(harness.onSkip).not.toHaveBeenCalled();
    expect(projectDelete).not.toHaveBeenCalled();
  });

  it("unchecks a project → Finish → cleanupArtifacts dispatches projectsApi.delete", async () => {
    const sidecar = withArtifacts([
      { type: "project", id: "42", cleanup_default: "keep" },
      { type: "experiment", id: "5", cleanup_default: "keep" },
    ]);
    const harness = renderAt("phase4-cleanup", sidecar);

    const user = userEvent.setup();
    const row = document.querySelector(
      '[data-artifact-id="project:42"]',
    ) as HTMLElement;
    const cb = within(row).getByRole("checkbox");
    await user.click(cb);
    expect(cb).not.toBeChecked();

    await user.click(screen.getByRole("button", { name: /finish setup/i }));

    await waitFor(() => expect(projectDelete).toHaveBeenCalledWith(42));
    expect(taskDelete).not.toHaveBeenCalled();
    expect(harness.onComplete).toHaveBeenCalledTimes(1);
  });

  it("master Start fresh + confirm flips every row to discard and deletes all on Finish", async () => {
    const sidecar = withArtifacts([
      { type: "project", id: "42", cleanup_default: "keep" },
      { type: "method", id: "17:placeholder", cleanup_default: "keep" },
      { type: "experiment", id: "5", cleanup_default: "keep" },
      { type: "goal", id: "9", cleanup_default: "keep" },
    ]);
    const harness = renderAt("phase4-cleanup", sidecar);

    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: /^start fresh$/i }),
    );
    await user.click(
      screen.getByRole("button", { name: /yes, wipe it all/i }),
    );

    const checkboxes = screen.getAllByRole("checkbox");
    for (const cb of checkboxes) {
      expect(cb).not.toBeChecked();
    }

    await user.click(screen.getByRole("button", { name: /finish setup/i }));

    await waitFor(() => {
      expect(projectDelete).toHaveBeenCalledWith(42);
      expect(methodDelete).toHaveBeenCalledWith(17);
      expect(taskDelete).toHaveBeenCalledWith(5);
      expect(goalDelete).toHaveBeenCalledWith(9);
    });
    expect(harness.onComplete).toHaveBeenCalledTimes(1);
  });

  it("Start fresh + Never mind keeps all checkboxes checked", async () => {
    const sidecar = withArtifacts([
      { type: "project", id: "42", cleanup_default: "keep" },
    ]);
    renderAt("phase4-cleanup", sidecar);

    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: /^start fresh$/i }),
    );
    await user.click(screen.getByRole("button", { name: /never mind/i }));

    expect(screen.getAllByRole("checkbox")[0]).toBeChecked();
  });
});

describe("I've-got-it-from-here routing", () => {
  it("confirming I've-got-it transitions to phase4-cleanup and routes Finish through onSkip", async () => {
    const sidecar = withArtifacts(
      [{ type: "project", id: "42", cleanup_default: "keep" }],
      "W3",
    );
    const harness = renderAt("W3", sidecar);

    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: /i.+ve got it from here/i }),
    );
    await user.click(
      screen.getByRole("button", { name: /yes, skip ahead/i }),
    );

    // The shell should now be at phase4-cleanup. Wait for the
    // step-id data attribute on the modal to flip.
    await waitFor(() => {
      const root = document.querySelector('[data-wizard-step="phase4-cleanup"]');
      expect(root).toBeTruthy();
    });

    await user.click(screen.getByRole("button", { name: /finish setup/i }));

    await waitFor(() => expect(harness.onSkip).toHaveBeenCalledTimes(1));
    expect(harness.onComplete).not.toHaveBeenCalled();
  });

  it("normal cleanup path (no I've-got-it click) routes Finish through onComplete", async () => {
    const sidecar = withArtifacts([
      { type: "project", id: "42", cleanup_default: "keep" },
    ]);
    const harness = renderAt("phase4-cleanup", sidecar);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /finish setup/i }));

    await waitFor(() => expect(harness.onComplete).toHaveBeenCalledTimes(1));
    expect(harness.onSkip).not.toHaveBeenCalled();
  });
});
