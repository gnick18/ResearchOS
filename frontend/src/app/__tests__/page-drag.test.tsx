// Pins the own-only drag affordance on the home-page project grid.
//
// Background (HR sibling-sweep audit Chip 5, 2026-05-20): every project card
// — own AND shared-in — used to be `draggable` with the same bare numeric id.
// Two failure modes lived in that wiring:
//   1. Visual collision: own id N and shared-in id N rendering side-by-side
//      both lit up when one matched draggedProjectId / dragOverProjectId.
//   2. Silent mis-order: projectsApi.reorder is current-user-scoped, so
//      including a shared id in the new order quietly shuffled the receiver's
//      OWN list around a phantom slot.
//
// Smallest surface fix (per bug-fix manager dispatch): only own cards are
// draggable. Shared-in cards are static — no draggable attribute, no drag
// handlers, no drag handle SVG, no drag-state visual feedback. This file
// pins that contract: shared cards don't carry the drag affordance.

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import HomePage from "../page";
import type { Project } from "@/lib/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/file-system/file-system-context", () => ({
  useFileSystem: () => ({ currentUser: "alex", isLoading: false }),
}));

vi.mock("@/lib/store", () => ({
  useAppStore: (selector: (state: { defaultLandingTab: string }) => unknown) =>
    selector({ defaultLandingTab: "/" }),
}));

vi.mock("@/lib/local-api", () => ({
  projectsApi: { reorder: vi.fn(), create: vi.fn() },
  fetchAllTasksIncludingShared: vi.fn(async () => []),
  fetchAllProjectsIncludingShared: vi.fn(async () => []),
}));

// Heavy child surfaces are mocked as inert no-ops; this file is scoped to
// the drag affordance on the grid container, not their behavior.
vi.mock("@/components/AppShell", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/TaskDetailPopup", () => ({ default: () => null }));
vi.mock("@/components/project-surface/ProjectCardKebab", () => ({
  default: () => null,
}));
vi.mock("@/components/UserLoginScreen", () => ({ default: () => null }));
vi.mock("@/components/workbench/SubTaskProgressDots", () => ({
  default: () => null,
}));
vi.mock("@/components/Tooltip", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

function makeProject(overrides: Partial<Project>): Project {
  return {
    id: 1,
    name: "Project",
    weekend_active: false,
    tags: null,
    color: null,
    created_at: "2026-01-01",
    sort_order: 0,
    is_archived: false,
    archived_at: null,
    owner: "alex",
    shared_with: [],
    ...overrides,
  };
}

function renderHome(projects: Project[]) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: Infinity } },
  });
  qc.setQueryData(["projects", "alex"], projects);
  qc.setQueryData(["tasks", "alex"], []);
  return render(
    <QueryClientProvider client={qc}>
      <HomePage />
    </QueryClientProvider>,
  );
}

describe("home page project grid — drag affordance gating", () => {
  it("renders own active cards as draggable", () => {
    renderHome([
      makeProject({ id: 1, name: "Own Active", owner: "alex" }),
    ]);

    const card = screen.getByText("Own Active").closest("[draggable]");
    expect(card).not.toBeNull();
    expect(card?.getAttribute("draggable")).toBe("true");
  });

  it("renders shared-in cards without the draggable affordance", () => {
    renderHome([
      makeProject({
        id: 5,
        name: "Shared From Morgan",
        owner: "morgan",
        is_shared_with_me: true,
      }),
    ]);

    // The shared card's wrapper must explicitly pass draggable={false} so the
    // browser refuses to initiate a drag, and the per-card drag handle SVG
    // must NOT render (it would falsely advertise reorder capability).
    const card = screen
      .getByText("Shared From Morgan")
      .closest("div.group");
    expect(card).not.toBeNull();
    expect(card?.getAttribute("draggable")).toBe("false");

    // Drag handle SVG has aria-label "Drag to reorder" — gated on own cards
    // only, so it should not exist in a shared-only render.
    expect(screen.queryByLabelText("Drag to reorder")).toBeNull();
  });

  it("draggable gating is independent of project id (own and shared can share an id)", () => {
    // The collision the original bug exposed: own id 5 and shared id 5 lived
    // in the same render. Pin that the per-card draggable attribute depends
    // on is_shared_with_me, not on id.
    renderHome([
      makeProject({ id: 5, name: "Own Five", owner: "alex" }),
      makeProject({
        id: 5,
        name: "Shared Five",
        owner: "morgan",
        is_shared_with_me: true,
      }),
    ]);

    const ownCard = screen.getByText("Own Five").closest("[draggable]");
    const sharedCard = screen.getByText("Shared Five").closest("[draggable]");

    expect(ownCard?.getAttribute("draggable")).toBe("true");
    expect(sharedCard?.getAttribute("draggable")).toBe("false");

    // Exactly one drag handle in the rendered tree — own card only.
    expect(screen.getAllByLabelText("Drag to reorder")).toHaveLength(1);
  });
});
