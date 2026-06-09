// ProjectDetailPopup dynamic-sections test (project popup redesign, 2026-06-09).
//
// THE DYNAMIC PRINCIPLE: the popup composes itself from what EXISTS. This suite
// pins the two ends of that rule:
//
//   1. A populated project shows the funding chip, the tags row, and the recent
//      activity block.
//   2. A brand-new / empty project hides all three (and reads "just created" in
//      the status glance) instead of showing empty slots or "go link X" nags.
//
// The heavy doorway components, dialogs, history wiring, and the autosaving
// OverviewSection are mocked to inert markers so the test isolates the
// section-visibility logic from their data layers. The status glance + doorway
// presence read from the mocked local-api queries.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Project, Task } from "@/lib/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ currentUser: "alice" }),
}));
vi.mock("@/hooks/useAccountType", () => ({
  useAccountType: () => "lab",
}));

const listByProject = vi.fn<() => Promise<Task[]>>(async () => []);
const listHostedTasks = vi.fn<() => Promise<Task[]>>(async () => []);
const listFundingAccounts = vi.fn<() => Promise<unknown[]>>(async () => []);
const readProjectActivity = vi.fn<() => Promise<unknown[]>>(async () => []);
const listSequencesByProject = vi.fn<() => Promise<unknown[]>>(async () => []);

vi.mock("@/lib/local-api", () => ({
  projectsApi: {
    get: vi.fn(async () => null),
    update: vi.fn(),
    archive: vi.fn(),
    delete: vi.fn(),
    listHostedTasks: (...a: unknown[]) => listHostedTasks(...(a as [])),
  },
  purchasesApi: {
    listFundingAccounts: (...a: unknown[]) => listFundingAccounts(...(a as [])),
  },
  tasksApi: {
    listByProject: (...a: unknown[]) => listByProject(...(a as [])),
  },
  sequencesApi: {
    listByProject: (...a: unknown[]) => listSequencesByProject(...(a as [])),
  },
}));

vi.mock("@/lib/tasks/results-paths", () => ({
  taskResultsBase: () => "",
  resolveTabAttachmentBase: async () => "",
}));
vi.mock("@/lib/attachments/image-folder", () => ({
  listImagesInFolder: async () => [],
}));
vi.mock("@/lib/project-activity/event-log", () => ({
  readProjectActivity: (...a: unknown[]) => readProjectActivity(...(a as [])),
}));

// History + restore wiring mocked inert (its own suite covers it).
vi.mock("@/lib/history", () => ({
  RESTORE_ENABLED: true,
  canonicalize: () => "",
}));
vi.mock("@/lib/history/useVersionRestore", () => ({
  useVersionRestore: () => ({
    handleRestore: vi.fn(),
    handleUndoRestore: vi.fn(),
    undoConfirmPending: false,
    confirmUndoRestore: vi.fn(),
    dismissUndoConfirm: vi.fn(),
    undoWindowActive: false,
    isBusy: false,
    restoreError: null,
  }),
}));
vi.mock("@/lib/sharing/unified", () => ({
  canRead: () => true,
  canWrite: () => true,
}));
vi.mock("@/lib/history/project-viewer", () => ({ projectAdapter: {} }));
vi.mock("@/components/history/EntityVersionHistorySidebar", () => ({
  default: () => null,
}));
vi.mock("@/components/history/VersionDiffView", () => ({ default: () => null }));

// Heavy children mocked to markers.
vi.mock("@/components/project-surface/OverviewSection", () => ({
  default: () => <div data-testid="overview-section" />,
}));
vi.mock("@/components/project-surface/ResultsGallery", () => ({
  default: () => <div data-testid="results-gallery" />,
}));
vi.mock("@/components/project-surface/MethodsInventory", () => ({
  default: () => <div data-testid="methods-inventory" />,
}));
vi.mock("@/components/project-surface/SequencesInventory", () => ({
  default: () => <div data-testid="sequences-inventory" />,
}));
vi.mock("@/components/project-surface/ProjectRoute", () => ({
  EditProjectModal: () => null,
}));
vi.mock("@/components/sharing/UnifiedShareDialog", () => ({ default: () => null }));
vi.mock("@/components/ProjectDepositDialog", () => ({ default: () => null }));

import ProjectDetailPopup from "./ProjectDetailPopup";

function makeProject(over: Partial<Project>): Project {
  return {
    id: 1,
    name: "Project One",
    weekend_active: true,
    tags: null,
    color: "#3b82f6",
    created_at: new Date("2026-06-01T00:00:00Z").toISOString(),
    sort_order: 0,
    is_archived: false,
    archived_at: null,
    owner: "alice",
    shared_with: [],
    ...over,
  } as Project;
}

function makeTask(over: Partial<Task>): Task {
  return {
    id: 1,
    project_id: 1,
    owner: "alice",
    name: "Exp",
    task_type: "experiment",
    is_complete: false,
    start_date: "2026-06-01",
    ...over,
  } as Task;
}

function renderPopup(project: Project) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ProjectDetailPopup project={project} open onClose={vi.fn()} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  listByProject.mockReset().mockResolvedValue([]);
  listHostedTasks.mockReset().mockResolvedValue([]);
  listFundingAccounts.mockReset().mockResolvedValue([]);
  readProjectActivity.mockReset().mockResolvedValue([]);
  listSequencesByProject.mockReset().mockResolvedValue([]);
});

describe("ProjectDetailPopup dynamic sections", () => {
  it("shows funding, tags, and recent activity when the project is populated", async () => {
    listByProject.mockResolvedValue([
      makeTask({ id: 1, is_complete: true }),
      makeTask({ id: 2, is_complete: false }),
    ]);
    listFundingAccounts.mockResolvedValue([
      { id: 5, name: "R01-GM-1234", award_number: "GM1234" },
    ]);
    readProjectActivity.mockResolvedValue([
      {
        id: "e1",
        type: "task_completed",
        task_name: "PCR",
        actor: "alice",
        ts: "2026-06-08T10:00:00Z",
      },
    ]);

    renderPopup(makeProject({ tags: ["crispr", "qc"], funding_account_id: 5 }));

    // Funding chip resolves the linked grant name.
    await waitFor(() =>
      expect(screen.getByTestId("project-funding-chip")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("project-funding-chip")).toHaveTextContent("R01-GM-1234");

    // Tags row.
    expect(screen.getByText("#crispr")).toBeInTheDocument();
    expect(screen.getByText("#qc")).toBeInTheDocument();

    // Recent activity block.
    await waitFor(() =>
      expect(screen.getByTestId("project-recent-activity")).toBeInTheDocument(),
    );
    expect(screen.getByText(/Completed PCR/)).toBeInTheDocument();

    // The status glance is NOT the brand-new message.
    expect(
      screen.queryByText(/just created, no experiments yet/i),
    ).not.toBeInTheDocument();
  });

  it("hides funding, tags, and activity on a brand-new empty project", async () => {
    renderPopup(makeProject({ tags: null, funding_account_id: null }));

    // The status glance adapts to the empty state.
    await waitFor(() =>
      expect(
        screen.getByText(/just created, no experiments yet/i),
      ).toBeInTheDocument(),
    );

    // No funding chip, no tags, no recent-activity block, no "link X" nags.
    expect(screen.queryByTestId("project-funding-chip")).not.toBeInTheDocument();
    expect(screen.queryByText(/^#/)).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("project-recent-activity"),
    ).not.toBeInTheDocument();

    // Doorways: Timeline always shows; the content-gated ones do not.
    expect(screen.getByText("Timeline")).toBeInTheDocument();
    expect(screen.queryByText("Results")).not.toBeInTheDocument();
    expect(screen.queryByText("Methods")).not.toBeInTheDocument();
    expect(screen.queryByText("Sequences")).not.toBeInTheDocument();
  });
});
