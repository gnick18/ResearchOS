// Pins the Onboarding v4 §6.16 lab-permission-practice cursor-demo fix:
// experiment tasks shared INTO the current user must render on
// /workbench regardless of the recipient's project-pill selection. They
// belong to the sharer's project (e.g. BeakerBot's lab notebook), which
// the recipient's `selectedProjectIds` set never contains — applying the
// recipient's project filter to shared tasks hid both cards and the
// `data-tour-target` anchors the cursor demo clicks. The fix lets
// `is_shared_with_me` tasks bypass the project pill filter while keeping
// the recipient's OWN tasks subject to it.
//
// Regression contract:
//   - User's owned task in a selected project → renders
//   - User's owned task NOT in any selected project → filtered out
//   - Shared-into-me task in NONE of the user's projects → renders
//
// HR 2026-05-22.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Project, Task } from "@/lib/types";
import { useAppStore } from "@/lib/store";

const mocks = vi.hoisted(() => ({
  fetchAllTasksIncludingShared: vi.fn<() => Promise<Task[]>>(),
  fetchAllMethodsIncludingShared: vi.fn(async () => []),
  dependenciesApi: {
    list: vi.fn(async () => []),
  },
}));

vi.mock("@/lib/local-api", () => ({
  fetchAllTasksIncludingShared: mocks.fetchAllTasksIncludingShared,
  fetchAllMethodsIncludingShared: mocks.fetchAllMethodsIncludingShared,
  dependenciesApi: mocks.dependenciesApi,
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ currentUser: "alex", isLoggedIn: true }),
}));

// Probe is async-IO heavy and unrelated to the filter contract under
// test — stub to a no-result probe so cards still render with the
// placeholder hero.
vi.mock("@/lib/experiments/findTaskResultsBase", () => ({
  probeTaskResults: vi.fn(async () => ({
    hasResult: false,
    heroImagePath: null,
    resultsPreview: null,
  })),
}));

// TaskDetailPopup + TaskModal are heavy and irrelevant here; only the
// panel's own DOM matters for the filter assertion.
vi.mock("@/components/TaskDetailPopup", () => ({
  default: () => null,
}));
vi.mock("@/components/TaskModal", () => ({
  default: () => null,
}));

// ExperimentResultCard pulls in UserAvatar -> useUserColor ->
// useFileSystem, which throws outside a FileSystemProvider. Stub to a
// minimal renderer that surfaces the task name so the filter assertions
// can query by text. The card's own behavior has its own test surface.
vi.mock("@/components/experiments/ExperimentResultCard", () => ({
  __esModule: true,
  default: ({ task }: { task: { name: string } }) => (
    <div data-testid="experiment-card-stub">{task.name}</div>
  ),
}));

// SharedFromPill also touches user-color hooks. Stub to a no-op pill.
vi.mock("@/components/workbench/SharedFromPill", () => ({
  __esModule: true,
  default: () => <span data-testid="shared-from-pill" />,
}));

import WorkbenchExperimentsPanel from "@/components/workbench/WorkbenchExperimentsPanel";

function project(partial: Partial<Project> & { id: number; name: string; owner: string }): Project {
  return {
    weekend_active: false,
    tags: [],
    color: null,
    created_at: "2026-05-01T00:00:00Z",
    sort_order: 0,
    is_archived: false,
    archived_at: null,
    shared_with: [],
    ...partial,
  };
}

function experiment(partial: Partial<Task> & { id: number; name: string; owner: string; project_id: number }): Task {
  return {
    start_date: "2026-05-10",
    duration_days: 1,
    end_date: "2026-05-10",
    is_high_level: false,
    is_complete: false,
    task_type: "experiment",
    weekend_override: null,
    method_ids: [],
    deviation_log: null,
    tags: null,
    sort_order: 0,
    experiment_color: null,
    sub_tasks: null,
    method_attachments: [],
    shared_with: [],
    ...partial,
  };
}

function renderPanel(projects: Project[]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <WorkbenchExperimentsPanel projects={projects} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  // Reset filter state so cross-test leakage can't mask a regression.
  useAppStore.setState({ selectedProjectIds: [] });
});

describe("WorkbenchExperimentsPanel — shared experiments bypass the project-pill filter", () => {
  it("renders shared-with-me tasks regardless of the recipient's selectedProjectIds, while still filtering the recipient's own tasks by the pill selection", async () => {
    // Recipient (alex) has selected only their own project id=1. Their
    // own id=2 task should be filtered out, but the two BeakerBot-shared
    // tasks (in beakerbot's own project namespace) must still render.
    useAppStore.setState({ selectedProjectIds: ["alex:1"] });

    const projects: Project[] = [
      project({ id: 1, name: "Alex Lab", owner: "alex" }),
      project({ id: 2, name: "Side Quest", owner: "alex" }),
    ];

    const tasks: Task[] = [
      // OWN: in selected project → should render
      experiment({
        id: 10,
        name: "OWN-IN-FILTER",
        owner: "alex",
        project_id: 1,
      }),
      // OWN: NOT in selected project → should be hidden
      experiment({
        id: 11,
        name: "OWN-OUT-OF-FILTER",
        owner: "alex",
        project_id: 2,
      }),
      // SHARED FROM beakerbot (edit) → should always render
      experiment({
        id: 100,
        name: "SHARED-EDIT",
        owner: "beakerbot",
        project_id: 42,
        is_shared_with_me: true,
        shared_permission: "edit",
      }),
      // SHARED FROM beakerbot (view) → should always render
      experiment({
        id: 101,
        name: "SHARED-VIEW",
        owner: "beakerbot",
        project_id: 42,
        is_shared_with_me: true,
        shared_permission: "view",
      }),
    ];

    mocks.fetchAllTasksIncludingShared.mockResolvedValue(tasks);

    renderPanel(projects);

    // Wait for the query to resolve and the panel to populate.
    await screen.findByText("OWN-IN-FILTER");

    // Recipient's own task in their selected project: visible.
    expect(screen.getByText("OWN-IN-FILTER")).toBeInTheDocument();

    // Recipient's own task outside their selected project: hidden.
    expect(screen.queryByText("OWN-OUT-OF-FILTER")).not.toBeInTheDocument();

    // Both shared tasks render despite their project (beakerbot:42)
    // not being in the recipient's selectedProjectIds.
    expect(screen.getByText("SHARED-EDIT")).toBeInTheDocument();
    expect(screen.getByText("SHARED-VIEW")).toBeInTheDocument();
  });

  it("stamps data-tour-target anchors on the BeakerBot-shared cards so the §6.16 cursor demo can click them", async () => {
    useAppStore.setState({ selectedProjectIds: ["alex:1"] });

    const projects: Project[] = [
      project({ id: 1, name: "Alex Lab", owner: "alex" }),
    ];

    const tasks: Task[] = [
      experiment({
        id: 100,
        name: "SHARED-EDIT",
        owner: "beakerbot",
        project_id: 42,
        is_shared_with_me: true,
        shared_permission: "edit",
      }),
      experiment({
        id: 101,
        name: "SHARED-VIEW",
        owner: "beakerbot",
        project_id: 42,
        is_shared_with_me: true,
        shared_permission: "view",
      }),
    ];

    mocks.fetchAllTasksIncludingShared.mockResolvedValue(tasks);

    const { container } = renderPanel(projects);

    await screen.findByText("SHARED-EDIT");

    // The wrapper div around each shared card carries the lab-tour
    // anchor for the cursor demo.
    await waitFor(() => {
      expect(
        container.querySelector('[data-tour-target="workbench-shared-edit-experiment"]'),
      ).not.toBeNull();
      expect(
        container.querySelector('[data-tour-target="workbench-shared-view-experiment"]'),
      ).not.toBeNull();
    });
  });
});
