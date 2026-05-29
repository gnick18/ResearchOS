// Projects Overview widget (project-widgets family, project-widgets,
// 2026-05-29).
//
// Pins the things that matter:
//   1. Both widget tiles + the ExpandedView render.
//   2. Scope default-BY-SURFACE: unset config ⇒ "lab" on the canvas
//      surface, "my" on the home surface.
//   3. The PRIVACY GATE for lab scope + cross-member reads: a project
//      shared with a DIFFERENT user never appears for a viewer who is not
//      a lab_head; whole-lab + explicitly-shared + own projects do.
//   4. The My/Lab scope toggle persists via onConfigChange.
//
// The privacy mechanism under test is the unified `canRead(record,
// viewer)` gate applied in the widget over the raw { owner, shared_with }
// each record from `getProjectsWithProgress` carries: the SAME gate
// TraineeNotesWidget uses.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ViewerVisibleProject } from "@/lib/local-api";

// ── Project fixtures ──────────────────────────────────────────────────────
// morgan owns four projects: one shared whole-lab ("*"), one shared
// explicitly with pat (the PI), one PRIVATE, and one shared only with a
// DIFFERENT member (alex). pat owns one project of their own.
const ALL_PROJECTS: ViewerVisibleProject[] = [
  {
    id: 1,
    name: "Aim 1 (whole lab)",
    color: "#3b82f6",
    owner: "morgan",
    shared_with: [{ username: "*", level: "read" }],
    user_color: "#3b82f6",
    taskTotal: 4,
    taskCompleted: 1,
    taskIncomplete: 3,
  },
  {
    id: 2,
    name: "Aim 2 (for PI)",
    color: "#10b981",
    owner: "morgan",
    shared_with: [{ username: "pat", level: "read" }],
    user_color: "#3b82f6",
    taskTotal: 2,
    taskCompleted: 2,
    taskIncomplete: 0,
  },
  {
    id: 3,
    name: "SECRET private morgan project",
    color: "#ef4444",
    owner: "morgan",
    shared_with: [],
    user_color: "#3b82f6",
    taskTotal: 5,
    taskCompleted: 0,
    taskIncomplete: 5,
  },
  {
    id: 4,
    name: "Shared-with-alex-only project",
    color: "#f59e0b",
    owner: "morgan",
    shared_with: [{ username: "alex", level: "read" }],
    user_color: "#3b82f6",
    taskTotal: 3,
    taskCompleted: 1,
    taskIncomplete: 2,
  },
  {
    id: 9,
    name: "Pat's own project",
    color: "#8b5cf6",
    owner: "pat",
    shared_with: [],
    user_color: "#8b5cf6",
    taskTotal: 2,
    taskCompleted: 1,
    taskIncomplete: 1,
  },
];

const { getProjectsWithProgress, createProject } = vi.hoisted(() => ({
  getProjectsWithProgress: vi.fn(async (): Promise<ViewerVisibleProject[]> => {
    // The accessor returns EVERY member's records (no server-side sharing
    // filter); the widget's canRead gate is the privacy boundary, exactly
    // as in production.
    return ALL_PROJECTS;
  }),
  createProject: vi.fn(async () => ({})),
}));

vi.mock("@/lib/local-api", () => ({
  labApi: { getProjectsWithProgress },
  projectsApi: { create: createProject },
}));

// Current user + account type swapped per-test.
const viewerRef = { username: "pat" as string };
const accountTypeRef = { value: "lab_head" as "lab_head" | "member" };

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ currentUser: viewerRef.username }),
}));

vi.mock("@/hooks/useAccountType", () => ({
  useAccountType: () => accountTypeRef.value,
}));

vi.mock("@/hooks/useLabUserProfiles", () => ({
  useLabUserProfileMap: () => ({
    pat: { username: "pat", displayName: "Dr. Pat", account_type: "lab_head" },
    morgan: { username: "morgan", displayName: "Morgan", account_type: "member" },
    alex: { username: "alex", displayName: "Alex", account_type: "member" },
  }),
}));

vi.mock("@/components/UserAvatar", () => ({
  default: ({ username }: { username: string }) => (
    <span data-testid={`avatar-${username}`} />
  ),
}));

vi.mock("@/components/Tooltip", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

import ProjectsOverviewWidget, {
  SnapshotTile,
  SidebarTile,
} from "./ProjectsOverviewWidget";
import type { WidgetInstanceConfig } from "@/lib/settings/user-settings";

function renderExpanded(opts?: {
  config?: WidgetInstanceConfig;
  surface?: "canvas" | "home";
  onConfigChange?: (c: WidgetInstanceConfig | null) => void;
}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ProjectsOverviewWidget
        surface={(opts?.surface ?? "canvas") as "canvas"}
        config={opts?.config}
        onConfigChange={opts?.onConfigChange}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  getProjectsWithProgress.mockClear();
  createProject.mockClear();
  pushMock.mockClear();
  viewerRef.username = "pat";
  accountTypeRef.value = "lab_head";
});

describe("ProjectsOverviewWidget: render + scope default by surface", () => {
  it("renders the ExpandedView (lab scope on canvas as a PI)", async () => {
    renderExpanded({ surface: "canvas" });
    // Unset config + canvas ⇒ lab scope ⇒ lab-projects label on the toggle
    // is the active one. The PI sees morgan's shared projects + their own.
    expect(await screen.findByText("Aim 1 (whole lab)")).toBeInTheDocument();
    expect(screen.getByText("Pat's own project")).toBeInTheDocument();
  });

  it("defaults to LAB scope on the canvas surface (unset config)", async () => {
    renderExpanded({ surface: "canvas" });
    const labBtn = await screen.findByTestId("projects-overview-scope-lab");
    expect(labBtn).toHaveAttribute("aria-pressed", "true");
    // No New Project button in lab scope.
    expect(screen.queryByTestId("projects-overview-new-project")).toBeNull();
  });

  it("defaults to MY scope on the home surface (unset config)", async () => {
    renderExpanded({ surface: "home" });
    const myBtn = await screen.findByTestId("projects-overview-scope-my");
    expect(myBtn).toHaveAttribute("aria-pressed", "true");
    // My scope shows the New Project affordance.
    expect(
      screen.getByTestId("projects-overview-new-project"),
    ).toBeInTheDocument();
    // As pat, my scope shows only pat's own project.
    expect(await screen.findByText("Pat's own project")).toBeInTheDocument();
    expect(screen.queryByText("Aim 1 (whole lab)")).toBeNull();
  });

  it("explicit config.projectScope overrides the surface default", async () => {
    renderExpanded({ surface: "home", config: { projectScope: "lab" } });
    const labBtn = await screen.findByTestId("projects-overview-scope-lab");
    expect(labBtn).toHaveAttribute("aria-pressed", "true");
  });

  it("SnapshotTile + SidebarTile render", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <SnapshotTile surface="canvas" />
        <SidebarTile widgetId="projects-overview" onClick={() => {}} />
      </QueryClientProvider>,
    );
    // The snapshot tile lists top projects; the sidebar shows a count.
    expect(await screen.findByText("Aim 1 (whole lab)")).toBeInTheDocument();
  });
});

describe("ProjectsOverviewWidget: PRIVACY gate (lab + cross-member)", () => {
  it("a PI (lab_head) sees every shared project via implicit view-all", async () => {
    renderExpanded({ surface: "canvas" }); // pat, lab_head, lab scope
    expect(await screen.findByText("Aim 1 (whole lab)")).toBeInTheDocument();
    expect(screen.getByText("Aim 2 (for PI)")).toBeInTheDocument();
    expect(screen.getByText("Pat's own project")).toBeInTheDocument();
    // GATE: even a lab_head only sees genuinely-shared records; a private
    // project is NOT in shared_with, but lab_head view-all reads it. The
    // CROSS-MEMBER privacy claim is proven by the member case below.
  });

  it("a regular member NEVER sees a project shared with a DIFFERENT member", async () => {
    // View as alex (regular member). canRead does the heavy lifting.
    viewerRef.username = "alex";
    accountTypeRef.value = "member";
    renderExpanded({ surface: "canvas", config: { projectScope: "lab" } });

    // alex sees the whole-lab project and the project shared with alex.
    expect(await screen.findByText("Aim 1 (whole lab)")).toBeInTheDocument();
    expect(
      screen.getByText("Shared-with-alex-only project"),
    ).toBeInTheDocument();
    // alex must NOT see the PI-only project nor morgan's private project.
    expect(screen.queryByText("Aim 2 (for PI)")).toBeNull();
    expect(screen.queryByText("SECRET private morgan project")).toBeNull();
  });

  it("MY scope shows only the viewer's OWN projects", async () => {
    viewerRef.username = "morgan";
    accountTypeRef.value = "member";
    renderExpanded({ surface: "home" }); // home ⇒ my scope

    // morgan owns 1,2,3,4, all four show in my scope (owner always reads
    // own, including the private one).
    expect(
      await screen.findByText("SECRET private morgan project"),
    ).toBeInTheDocument();
    expect(screen.getByText("Aim 1 (whole lab)")).toBeInTheDocument();
    // pat's project is not morgan's, so it is absent from my scope.
    expect(screen.queryByText("Pat's own project")).toBeNull();
  });
});

describe("ProjectsOverviewWidget: scope toggle persistence", () => {
  it("clicking Lab persists { projectScope: 'lab' } via onConfigChange", async () => {
    const onConfigChange = vi.fn();
    renderExpanded({ surface: "home", onConfigChange }); // starts my scope
    fireEvent.click(await screen.findByTestId("projects-overview-scope-lab"));
    expect(onConfigChange).toHaveBeenCalledWith(
      expect.objectContaining({ projectScope: "lab" }),
    );
  });

  it("clicking My persists { projectScope: 'my' } via onConfigChange", async () => {
    const onConfigChange = vi.fn();
    renderExpanded({ surface: "canvas", onConfigChange }); // starts lab scope
    fireEvent.click(await screen.findByTestId("projects-overview-scope-my"));
    expect(onConfigChange).toHaveBeenCalledWith(
      expect.objectContaining({ projectScope: "my" }),
    );
  });
});

describe("ProjectsOverviewWidget: New Project + navigation", () => {
  it("creates a project via projectsApi.create and closes the form", async () => {
    renderExpanded({ surface: "home" }); // my scope, has the New Project btn
    fireEvent.click(await screen.findByTestId("projects-overview-new-project"));
    const nameInput = await screen.findByTestId(
      "projects-overview-new-project-name",
    );
    fireEvent.change(nameInput, { target: { value: "Fresh project" } });
    fireEvent.click(screen.getByTestId("projects-overview-new-project-save"));
    await waitFor(() =>
      expect(createProject).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Fresh project" }),
      ),
    );
  });

  it("clicking a card routes to the project (own ⇒ bare, other ⇒ ?owner=)", async () => {
    renderExpanded({ surface: "canvas", config: { projectScope: "lab" } }); // pat PI
    fireEvent.click(
      await screen.findByTestId("projects-overview-card-morgan-1"),
    );
    expect(pushMock).toHaveBeenCalledWith(
      "/workbench/projects/1?owner=morgan",
    );
    fireEvent.click(screen.getByTestId("projects-overview-card-pat-9"));
    expect(pushMock).toHaveBeenCalledWith("/workbench/projects/9");
  });
});
