// WorkbenchProjectsPanel card-click test (project popup redesign, 2026-06-09).
//
// The core routing change: clicking a project card opens the ProjectDetailPopup
// OVER the Workbench (a state-lift) instead of navigating to
// /workbench/projects/<id>. This suite pins that behavior:
//
//   1. Clicking a card mounts the popup (no router.push).
//   2. The deep-link auto-open prop opens the popup for the matching project on
//      mount (the /workbench/projects/[id] route's entry path).
//
// ProjectDetailPopup is mocked to a lightweight marker so the test isolates the
// open/route decision from the popup's heavy data layer.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Project } from "@/lib/types";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ currentUser: "alice" }),
}));

vi.mock("@/lib/local-api", () => ({
  fetchAllProjectsIncludingShared: vi.fn(),
  fetchAllTasksIncludingShared: vi.fn(async () => []),
  sequencesApi: { listByProject: vi.fn(async () => []) },
}));

vi.mock("@/components/lab-overview/NewProjectButton", () => ({
  default: () => null,
}));
vi.mock("@/components/workbench/SharedFromPill", () => ({
  default: () => null,
}));

// The popup is mocked to a marker that reports the project it was opened for.
vi.mock("@/components/project-surface/ProjectDetailPopup", () => ({
  default: ({ project, open }: { project: Project; open: boolean }) =>
    open ? <div data-testid="project-popup">popup:{project.name}</div> : null,
}));

import WorkbenchProjectsPanel from "./WorkbenchProjectsPanel";

function makeProject(over: Partial<Project>): Project {
  return {
    id: 1,
    name: "Project One",
    weekend_active: true,
    tags: null,
    color: "#3b82f6",
    created_at: new Date(0).toISOString(),
    sort_order: 0,
    is_archived: false,
    archived_at: null,
    owner: "alice",
    shared_with: [],
    ...over,
  } as Project;
}

function renderPanel(props: Parameters<typeof WorkbenchProjectsPanel>[0]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <WorkbenchProjectsPanel {...props} />
    </QueryClientProvider>,
  );
}

describe("WorkbenchProjectsPanel", () => {
  beforeEach(() => {
    push.mockReset();
  });

  it("opens the popup on card click and does NOT navigate", async () => {
    const project = makeProject({ id: 7, name: "Cloning" });
    renderPanel({ projects: [project] });

    const card = await screen.findByText("Cloning");
    fireEvent.click(card);

    await waitFor(() =>
      expect(screen.getByTestId("project-popup")).toHaveTextContent("popup:Cloning"),
    );
    // The redesign replaced router.push with a state-lift: no navigation.
    expect(push).not.toHaveBeenCalled();
  });

  it("auto-opens the popup for a deep-linked project id (+ owner)", async () => {
    const own = makeProject({ id: 3, name: "Mine", owner: "alice" });
    const shared = makeProject({
      id: 3,
      name: "Theirs",
      owner: "bob",
      is_shared_with_me: true,
    });
    const onConsumed = vi.fn();

    renderPanel({
      projects: [own, shared],
      autoOpenProjectId: 3,
      autoOpenOwner: "bob",
      onAutoOpenConsumed: onConsumed,
    });

    // The (id, owner) pair disambiguates: the shared "bob" copy opens, not the
    // own "alice" copy that shares the same id.
    await waitFor(() =>
      expect(screen.getByTestId("project-popup")).toHaveTextContent("popup:Theirs"),
    );
    expect(onConsumed).toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });
});
