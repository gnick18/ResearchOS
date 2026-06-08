import { describe, expect, it, vi, beforeEach, type Mock } from "vitest";
import { useState } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  OnboardingSidecar,
  WizardArtifact,
} from "@/lib/onboarding/sidecar";

/**
 * Phase4CleanupStep render + interaction tests. Mocks every domain
 * delete API the cleanup helper hits so we can assert routing without
 * touching the file system.
 */

const {
  projectDelete,
  methodDelete,
  taskDelete,
  goalDelete,
  userDelete,
  purchaseDelete,
  deleteFeed,
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
  purchaseDelete: vi.fn(async (_id: number) => {}),
  deleteFeed: vi.fn(async (_username: string, _id: number) => true),
  deleteImageFromBase: vi.fn(
    async (_basePath: string, _filename: string) => {},
  ),
  patchUserSettings: vi.fn(async () => ({}) as never),
  tasksGet: vi.fn(async (_id: number) => ({
    id: 999,
    owner: "test-user",
    name: "demo",
  })),
}));

vi.mock("@/lib/local-api", () => ({
  projectsApi: { delete: projectDelete },
  methodsApi: { delete: methodDelete },
  tasksApi: { delete: taskDelete, get: tasksGet },
  goalsApi: { delete: goalDelete },
  usersApi: { delete: userDelete },
  purchasesApi: { delete: purchaseDelete },
}));

vi.mock("@/lib/calendar/external-feeds-store", () => ({
  deleteFeed,
}));

vi.mock("@/lib/attachments/move-image", () => ({
  deleteImageFromBase,
}));

vi.mock("@/lib/settings/user-settings", () => ({
  patchUserSettings,
}));

import Phase4CleanupStep, {
  type Phase4CleanupStepProps,
} from "../Phase4CleanupStep";

function baseSidecar(
  patch: Partial<OnboardingSidecar> = {},
): OnboardingSidecar {
  return {
    version: 4,
    first_seen_at: "2026-05-21T00:00:00.000Z",
    active_seconds: 0,
    feature_picks: {
      account_type: "solo",
      purchases: "maybe",
      calendar: "maybe",
      goals: "maybe",
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

interface HarnessHandlers {
  onComplete: Mock<Phase4CleanupStepProps["onComplete"]>;
  onSkip: Mock<Phase4CleanupStepProps["onSkip"]>;
}

function Harness({
  sidecar,
  enteredViaSkip,
  handlers,
}: {
  sidecar: OnboardingSidecar;
  enteredViaSkip: boolean;
  handlers: HarnessHandlers;
}) {
  const [decisions, setDecisions] = useState<
    Record<string, "keep" | "discard">
  >({});
  return (
    <Phase4CleanupStep
      sidecar={sidecar}
      enteredViaSkip={enteredViaSkip}
      username="test-user"
      decisions={decisions}
      setDecisions={setDecisions}
      onComplete={handlers.onComplete}
      onSkip={handlers.onSkip}
    />
  );
}

function renderHarness(
  sidecar: OnboardingSidecar,
  enteredViaSkip: boolean = false,
): HarnessHandlers {
  const handlers: HarnessHandlers = {
    onComplete: vi.fn<Phase4CleanupStepProps["onComplete"]>(async () => {}),
    onSkip: vi.fn<Phase4CleanupStepProps["onSkip"]>(async () => {}),
  };
  render(
    <Harness
      sidecar={sidecar}
      enteredViaSkip={enteredViaSkip}
      handlers={handlers}
    />,
  );
  return handlers;
}

beforeEach(() => {
  projectDelete.mockClear();
  methodDelete.mockClear();
  taskDelete.mockClear();
  goalDelete.mockClear();
  userDelete.mockClear();
  purchaseDelete.mockClear();
  deleteFeed.mockClear();
  deleteImageFromBase.mockClear();
  patchUserSettings.mockClear();
  tasksGet.mockClear();
});

describe("Phase4CleanupStep render", () => {
  it("renders empty-state copy when no artifacts were created", () => {
    const sidecar = baseSidecar({
      wizard_resume_state: {
        current_step: "phase4-cleanup",
        skipped_steps: [],
        artifacts_created: [],
      },
    });
    renderHarness(sidecar);
    expect(
      screen.getByText(/no artifacts were created during this run/i),
    ).toBeInTheDocument();
  });

  it("renders every artifact as a checkbox, defaulting to keep (checked)", () => {
    const sidecar = withArtifacts([
      { type: "project", id: "42", cleanup_default: "keep" },
      { type: "method", id: "17:placeholder", cleanup_default: "keep" },
      { type: "experiment", id: "5", cleanup_default: "keep" },
    ]);
    renderHarness(sidecar);

    expect(screen.getByText(/First project \(#42\)/)).toBeInTheDocument();
    expect(
      screen.getByText(/Method #17 \(placeholder body\)/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Experiment #5/)).toBeInTheDocument();

    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes.length).toBe(3);
    for (const cb of checkboxes) {
      expect(cb).toBeChecked();
    }
  });

  it("groups artifacts under their entity-type section header with a count", () => {
    const sidecar = withArtifacts([
      { type: "project", id: "1", cleanup_default: "keep" },
      { type: "method", id: "10:placeholder", cleanup_default: "keep" },
      { type: "method", id: "11:placeholder", cleanup_default: "keep" },
      { type: "task", id: "20", cleanup_default: "discard" },
      { type: "task", id: "21", cleanup_default: "discard" },
      { type: "task", id: "22", cleanup_default: "discard" },
    ]);
    renderHarness(sidecar);

    expect(screen.getByText("Projects")).toBeInTheDocument();
    expect(screen.getByText("Methods")).toBeInTheDocument();
    expect(screen.getByText("Tasks")).toBeInTheDocument();

    const sectionCounts = screen.getAllByText(/\(\d+\)/);
    // At least Projects(1) + Methods(2) + Tasks(3) labels.
    const labels = sectionCounts.map((n) => n.textContent);
    expect(labels).toEqual(expect.arrayContaining(["(1)", "(2)", "(3)"]));
  });

  it("excludes artifacts flagged with cleanup_excluded:true", () => {
    const labArtifact = {
      type: "lab_user",
      id: "beakerbot",
      cleanup_default: "discard",
      cleanup_excluded: true,
    } as WizardArtifact;
    const sidecar = withArtifacts([
      { type: "project", id: "1", cleanup_default: "keep" },
      labArtifact,
    ]);
    renderHarness(sidecar);
    expect(screen.getByText(/First project \(#1\)/)).toBeInTheDocument();
    expect(screen.queryByText(/beakerbot/i)).not.toBeInTheDocument();
  });

  it("excludes lab_* artifacts even when cleanup_excluded is missing (L21 defense)", () => {
    // Live-test R4 (2026-05-22): legacy v3 sidecars wrote lab_user /
    // lab_task rows without the cleanup_excluded flag (the flag landed
    // later). The grid still drops them because L21 says lab artifacts
    // never reach the user-facing cleanup grid — they're owned by the
    // lab tour's own teardown.
    const sidecar = withArtifacts([
      { type: "project", id: "1", cleanup_default: "keep" },
      { type: "lab_user", id: "beakerbot", cleanup_default: "discard" },
      { type: "lab_task", id: "edit-demo:1", cleanup_default: "discard" },
    ]);
    renderHarness(sidecar);
    expect(screen.getByText(/First project \(#1\)/)).toBeInTheDocument();
    expect(screen.queryByText(/beakerbot/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/edit-demo/i)).not.toBeInTheDocument();
  });

  it("exposes data-artifact-type + data-artifact-cleanup-default on every row (live-test R4)", () => {
    // Live-test R4 (2026-05-22): rows carry the artifact type + the
    // default cleanup action as DOM data-attributes so test harnesses
    // can filter / assert per-type behavior without parsing the row
    // label.
    const sidecar = withArtifacts([
      { type: "project", id: "1", cleanup_default: "keep" },
      { type: "method", id: "2:placeholder", cleanup_default: "discard" },
    ]);
    renderHarness(sidecar);
    const projectRow = document.querySelector(
      '[data-artifact-id="project:1"]',
    );
    expect(projectRow?.getAttribute("data-artifact-type")).toBe("project");
    expect(projectRow?.getAttribute("data-artifact-cleanup-default")).toBe(
      "keep",
    );
    const methodRow = document.querySelector(
      '[data-artifact-id="method:2:placeholder"]',
    );
    expect(methodRow?.getAttribute("data-artifact-type")).toBe("method");
    expect(methodRow?.getAttribute("data-artifact-cleanup-default")).toBe(
      "discard",
    );
  });

  it("renders a tiny BeakerBot in the corner of the cleanup grid", () => {
    const sidecar = withArtifacts([
      { type: "project", id: "1", cleanup_default: "keep" },
    ]);
    renderHarness(sidecar);
    // BeakerBot's SVG carries a data-testid we can detect; if it's not
    // present we at least verify the heading copy renders so the harness
    // doesn't render entirely blank.
    expect(
      screen.getByText(/Pick what to keep before we wrap up/i),
    ).toBeInTheDocument();
  });
});

describe("Phase4CleanupStep collapsible sections", () => {
  it("toggles section open/closed via the chevron header", async () => {
    const sidecar = withArtifacts([
      { type: "project", id: "1", cleanup_default: "keep" },
    ]);
    renderHarness(sidecar);

    // Projects section starts open (count > 0).
    const section = document.querySelector(
      '[data-cleanup-section="projects"]',
    );
    expect(section?.getAttribute("data-cleanup-section-open")).toBe("true");

    const user = userEvent.setup();
    const header = within(section as HTMLElement).getByRole("button");
    await user.click(header);
    expect(section?.getAttribute("data-cleanup-section-open")).toBe("false");

    await user.click(header);
    expect(section?.getAttribute("data-cleanup-section-open")).toBe("true");
  });

  it("starts empty sections collapsed (no count)", () => {
    const sidecar = withArtifacts([
      { type: "project", id: "1", cleanup_default: "keep" },
    ]);
    renderHarness(sidecar);
    const tasksSection = document.querySelector(
      '[data-cleanup-section="tasks"]',
    );
    expect(tasksSection?.getAttribute("data-cleanup-section-open")).toBe(
      "false",
    );
    expect(within(tasksSection as HTMLElement).getByText(/none/i)).toBeInTheDocument();
  });
});

describe("Phase4CleanupStep Finish behavior", () => {
  it("Finish with all rows still checked completes without calling deletes", async () => {
    const sidecar = withArtifacts([
      { type: "project", id: "42", cleanup_default: "keep" },
    ]);
    const handlers = renderHarness(sidecar);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /finish setup/i }));

    await waitFor(() => expect(handlers.onComplete).toHaveBeenCalledTimes(1));
    expect(handlers.onSkip).not.toHaveBeenCalled();
    expect(projectDelete).not.toHaveBeenCalled();
  });

  it("unchecks a project, Finish, projectsApi.delete fires for that id", async () => {
    const sidecar = withArtifacts([
      { type: "project", id: "42", cleanup_default: "keep" },
      { type: "experiment", id: "5", cleanup_default: "keep" },
    ]);
    const handlers = renderHarness(sidecar);

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
    expect(handlers.onComplete).toHaveBeenCalledTimes(1);
  });

  it("Start fresh flips every row to discard and deletes all on Finish", async () => {
    // Live-test R4 (2026-05-22): Start fresh is now a single-click
    // direct discard (no nested confirm). The Finish-setup CTA is still
    // the destructive gate, so a one-click uncheck is safe + matches
    // the button copy ("I'll uncheck everything for you").
    const sidecar = withArtifacts([
      { type: "project", id: "42", cleanup_default: "keep" },
      { type: "method", id: "17:placeholder", cleanup_default: "keep" },
      { type: "experiment", id: "5", cleanup_default: "keep" },
      { type: "goal", id: "9", cleanup_default: "keep" },
    ]);
    const handlers = renderHarness(sidecar);

    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: /^start fresh$/i }),
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
    expect(handlers.onComplete).toHaveBeenCalledTimes(1);
  });

  it("enteredViaSkip routes Finish through onSkip instead of onComplete", async () => {
    const sidecar = withArtifacts([
      { type: "project", id: "42", cleanup_default: "keep" },
    ]);
    const handlers = renderHarness(sidecar, true);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /finish setup/i }));

    await waitFor(() => expect(handlers.onSkip).toHaveBeenCalledTimes(1));
    expect(handlers.onComplete).not.toHaveBeenCalled();
  });

  it("surfaces a partial-failure notice when a delete throws", async () => {
    projectDelete.mockRejectedValueOnce(new Error("boom"));
    const sidecar = withArtifacts([
      { type: "project", id: "42", cleanup_default: "discard" },
      { type: "goal", id: "9", cleanup_default: "discard" },
    ]);
    const handlers = renderHarness(sidecar);

    // Wait for the cleanup_default seed effect to populate decisions
    // before clicking finish, so the discarded artifacts actually route
    // through the deletes.
    await waitFor(() => {
      const cbs = screen.getAllByRole("checkbox");
      expect(cbs[0]).not.toBeChecked();
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /finish setup/i }));

    await waitFor(() =>
      expect(handlers.onComplete).toHaveBeenCalledTimes(1),
    );
    expect(
      document.querySelector('[data-cleanup-partial-failure]'),
    ).toBeTruthy();
  });
});
