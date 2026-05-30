// Single-Project widget (project-widgets family, project-widgets,
// 2026-05-29).
//
// Pins the things that matter:
//   1. The tiles + ExpandedView render; empty state when unpinned.
//   2. The PRIVACY GATE on the pin PICKER: a project shared with a
//      DIFFERENT member never appears as a pick option for a viewer who is
//      not a lab_head. The SAME gate guards the pinned-status read, so a
//      stale pin at a no-longer-readable project falls back to empty.
//   3. Pin persistence: picking a project persists
//      { pinnedProject: { id, owner } } via onConfigChange.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ViewerVisibleProject } from "@/lib/local-api";

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
    taskActive: 2,
    taskOverdue: 1,
    taskUpcoming: 0,
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
    taskActive: 0,
    taskOverdue: 0,
    taskUpcoming: 0,
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
    taskActive: 3,
    taskOverdue: 2,
    taskUpcoming: 0,
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
    taskActive: 1,
    taskOverdue: 0,
    taskUpcoming: 1,
  },
];

const { getProjectsWithProgress } = vi.hoisted(() => ({
  getProjectsWithProgress: vi.fn(
    async (): Promise<ViewerVisibleProject[]> => ALL_PROJECTS,
  ),
}));

vi.mock("@/lib/local-api", () => ({
  labApi: { getProjectsWithProgress },
}));

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

import SingleProjectWidget, {
  SnapshotTile,
  SidebarTile,
} from "./SingleProjectWidget";
import type { WidgetInstanceConfig } from "@/lib/settings/user-settings";

function renderExpanded(opts?: {
  config?: WidgetInstanceConfig;
  onConfigChange?: (c: WidgetInstanceConfig | null) => void;
}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <SingleProjectWidget
        surface="canvas"
        config={opts?.config}
        onConfigChange={opts?.onConfigChange}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  getProjectsWithProgress.mockClear();
  pushMock.mockClear();
  viewerRef.username = "pat";
  accountTypeRef.value = "lab_head";
});

describe("SingleProjectWidget: render + empty state", () => {
  it("shows the empty state when unpinned", async () => {
    renderExpanded({ onConfigChange: () => {} });
    expect(
      await screen.findByTestId("single-project-empty"),
    ).toBeInTheDocument();
  });

  it("shows the pinned project's status when pinned", async () => {
    renderExpanded({ config: { pinnedProject: { id: 1, owner: "morgan" } } });
    expect(await screen.findByText("Aim 1 (whole lab)")).toBeInTheDocument();
    // 1/4 complete ⇒ 25%.
    expect(screen.getByText("25%")).toBeInTheDocument();
    // Open project link routes with the owner suffix (other member).
    fireEvent.click(screen.getByTestId("single-project-open"));
    expect(pushMock).toHaveBeenCalledWith("/workbench/projects/1?owner=morgan");
  });

  it("SnapshotTile + SidebarTile render", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <SnapshotTile
          surface="canvas"
          config={{ pinnedProject: { id: 1, owner: "morgan" } }}
        />
        <SidebarTile widgetId="single-project" onClick={() => {}} />
      </QueryClientProvider>,
    );
    expect(await screen.findByText(/complete/)).toBeInTheDocument();
  });
});

describe("SingleProjectWidget: SnapshotTile rich card", () => {
  function renderTile(
    config: WidgetInstanceConfig = { pinnedProject: { id: 1, owner: "morgan" } },
    wrapperOnClick?: () => void,
  ) {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return render(
      <QueryClientProvider client={client}>
        {/* Stand-in for the canvas wrapper: it opens the pin-picker popup on
            a bubbled click, and is `draggable` only in edit mode (off here). */}
        <div
          data-testid="canvas-wrapper"
          role="button"
          draggable={false}
          onClick={wrapperOnClick}
        >
          <SnapshotTile surface="canvas" config={config} />
        </div>
      </QueryClientProvider>,
    );
  }

  it("renders the project name + percent + Active/Overdue/Upcoming counts", async () => {
    renderTile();
    expect(await screen.findByText("Aim 1 (whole lab)")).toBeInTheDocument();
    // 1/4 complete ⇒ 25%.
    expect(screen.getByText("25%")).toBeInTheDocument();
    // The labelled counts row mirrors the old project cards.
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Overdue")).toBeInTheDocument();
    expect(screen.getByText("Upcoming")).toBeInTheDocument();
    // The open-task count is surfaced too (3 incomplete tasks).
    expect(screen.getByText(/3 tasks open/)).toBeInTheDocument();
  });

  it("a pinned-tile body click navigates to the project page and does NOT open the popup", async () => {
    const wrapperOnClick = vi.fn();
    renderTile({ pinnedProject: { id: 1, owner: "morgan" } }, wrapperOnClick);
    const name = await screen.findByText("Aim 1 (whole lab)");
    fireEvent.click(name);
    // Routes with the owner suffix (project owned by a different member).
    expect(pushMock).toHaveBeenCalledWith("/workbench/projects/1?owner=morgan");
    // The popup (canvas wrapper onClick) must NOT also fire.
    expect(wrapperOnClick).not.toHaveBeenCalled();
  });

  it("a SYNTHETIC tour click (native el.click, no pointerdown) navigates and does NOT open the popup", async () => {
    // §6.1 `project-overview-nav` regression (newproject-modal-tour-fix bot,
    // 2026-05-29): the tour's cursor re-resolves
    // [data-tour-target^='home-single-project-open-'] and calls a NATIVE
    // `el.click()` with no preceding pointerdown. Before the fix, a stale
    // `downAt` from a prior real pointerdown made the drag-guard read this as
    // a drag and bail before stopPropagation + navigate, so the click bubbled
    // to the wrapper and flashed the pin-picker popup ("closed right away").
    const wrapperOnClick = vi.fn();
    renderTile({ pinnedProject: { id: 1, owner: "morgan" } }, wrapperOnClick);
    await screen.findByText("Aim 1 (whole lab)");
    const el = document.querySelector(
      "[data-tour-target^='home-single-project-open-']",
    ) as HTMLElement;
    expect(el).toBeTruthy();
    // Reproduce the real-browser preconditions: an EARLIER real click on the
    // tile (pointerdown + click both at 200,200) navigates AND leaves a STALE
    // `downAt` of (200,200) in the ref. `pressed` is consumed (back to false)
    // by that click. THEN the tour's lone synthetic `el.click()` fires with a
    // native MouseEvent whose clientX/Y = 0 — a 200px delta from the stale
    // `downAt`, past the 6px slop. Pre-fix, the drag-guard read that stale
    // delta as a drag and bailed BEFORE stopPropagation + navigate, so the
    // click bubbled to the wrapper and flashed the pin-picker popup. The fix
    // gates the guard on `pressed`, which is false for the lone synthetic
    // click, so it always navigates.
    fireEvent.pointerDown(el, { clientX: 200, clientY: 200 });
    fireEvent.click(el, { clientX: 200, clientY: 200 }); // earlier real click
    pushMock.mockClear();
    wrapperOnClick.mockClear();
    // SYNTHETIC tour click: native .click() (clientX/Y = 0), no fresh
    // pointerdown — pressed.current is already false, downAt is stale.
    el.click();
    expect(pushMock).toHaveBeenCalledWith("/workbench/projects/1?owner=morgan");
    expect(wrapperOnClick).not.toHaveBeenCalled();
  });

  it("a real drag gesture (pointerdown far from click) does NOT navigate", async () => {
    // The drag-guard still suppresses navigation for a genuine reorder drag:
    // a real pointerdown followed by a click that lands far away.
    const wrapperOnClick = vi.fn();
    renderTile({ pinnedProject: { id: 1, owner: "morgan" } }, wrapperOnClick);
    const root = (await screen.findByText("Aim 1 (whole lab)")).closest(
      "[data-tour-target^='home-single-project-open-']",
    ) as HTMLElement;
    fireEvent.pointerDown(root, { clientX: 0, clientY: 0 });
    // Click lands 50px away → past the slop threshold → treated as a drag.
    fireEvent.click(root, { clientX: 50, clientY: 50 });
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("the Change project affordance opens the picker (popup) and does NOT navigate", async () => {
    const wrapperOnClick = vi.fn();
    renderTile({ pinnedProject: { id: 1, owner: "morgan" } }, wrapperOnClick);
    const change = await screen.findByTestId("single-project-change");
    fireEvent.click(change);
    // The click bubbles to the wrapper (opens the pin-picker popup)…
    expect(wrapperOnClick).toHaveBeenCalledTimes(1);
    // …but the tile does NOT navigate away.
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("an UNPINNED tile click bubbles to the wrapper (opens the picker) and does NOT navigate", async () => {
    const wrapperOnClick = vi.fn();
    renderTile({}, wrapperOnClick);
    const empty = await screen.findByText("No project pinned");
    fireEvent.click(empty);
    expect(wrapperOnClick).toHaveBeenCalledTimes(1);
    expect(pushMock).not.toHaveBeenCalled();
    // No Change-project affordance when there is nothing pinned.
    expect(screen.queryByTestId("single-project-change")).toBeNull();
  });

  it("a PINNED tile carries the §6.1 home-single-project-open- tour target", async () => {
    // The §6.1 `project-overview-nav` beat re-resolves
    // [data-tour-target^='home-single-project-open-'] and clicks it. A pinned
    // tile must carry the per-project target so the beat lands on a tile whose
    // onClick navigates straight to the project page.
    renderTile({ pinnedProject: { id: 1, owner: "morgan" } });
    await screen.findByText("Aim 1 (whole lab)");
    const el = document.querySelector(
      "[data-tour-target^='home-single-project-open-']",
    );
    expect(el).toBeTruthy();
    expect(el?.getAttribute("data-tour-target")).toBe(
      "home-single-project-open-morgan-1",
    );
  });

  it("an UNPINNED tile carries NO home-single-project-open- tour target (avoids the §6.1 picker collision)", async () => {
    // Root cause of "closes right away": if an empty/unpinned single-project
    // tile ALSO matched the prefix selector, the §6.1 beat could resolve to it
    // (first in DOM) and click it, opening the pick-a-project PICKER (which
    // flashes shut) instead of navigating. The target is stamped ONLY when
    // pinned, so the empty tile never matches the nav selector.
    renderTile({});
    await screen.findByText("No project pinned");
    expect(
      document.querySelector("[data-tour-target^='home-single-project-open-']"),
    ).toBeNull();
  });
});

describe("SingleProjectWidget: PRIVACY gate (picker + stale pin)", () => {
  it("the picker only lists projects the viewer can read (member)", async () => {
    // alex (regular member): canRead allows whole-lab + shared-with-alex,
    // blocks PI-only + private + cross-member.
    viewerRef.username = "alex";
    accountTypeRef.value = "member";
    renderExpanded({ onConfigChange: () => {} });

    const select = (await screen.findByTestId(
      "single-project-pin-select",
    )) as HTMLSelectElement;
    const optionText = Array.from(select.options).map((o) => o.textContent);

    expect(optionText).toContain("Aim 1 (whole lab)");
    expect(optionText).toContain("Shared-with-alex-only project");
    // NEVER expose a project shared with someone else / private to alex.
    expect(optionText).not.toContain("Aim 2 (for PI)");
    expect(optionText).not.toContain("SECRET private morgan project");
  });

  it("a stale pin at a no-longer-readable project falls back to empty", async () => {
    // alex pins project 2 (PI-only); alex cannot read it, so the widget
    // refuses to surface it and shows the empty/picker state instead.
    viewerRef.username = "alex";
    accountTypeRef.value = "member";
    renderExpanded({
      config: { pinnedProject: { id: 2, owner: "morgan" } },
      onConfigChange: () => {},
    });

    expect(
      await screen.findByTestId("single-project-empty"),
    ).toBeInTheDocument();
    // The forbidden project's name must NOT render anywhere.
    expect(screen.queryByText("Aim 2 (for PI)")).toBeNull();
  });

  it("a PI (lab_head) can pick any project via implicit view-all", async () => {
    renderExpanded({ onConfigChange: () => {} }); // pat, lab_head
    const select = (await screen.findByTestId(
      "single-project-pin-select",
    )) as HTMLSelectElement;
    const optionText = Array.from(select.options).map((o) => o.textContent);
    // View-all: every project (including the private one) is pickable.
    expect(optionText).toContain("SECRET private morgan project");
    expect(optionText).toContain("Aim 2 (for PI)");
  });
});

describe("SingleProjectWidget: pin persistence", () => {
  it("picking a project persists { pinnedProject: { id, owner } }", async () => {
    const onConfigChange = vi.fn();
    renderExpanded({ onConfigChange });
    const select = await screen.findByTestId("single-project-pin-select");
    // The option value encodes "owner::id".
    fireEvent.change(select, { target: { value: "morgan::1" } });
    expect(onConfigChange).toHaveBeenCalledWith(
      expect.objectContaining({
        pinnedProject: { owner: "morgan", id: 1 },
      }),
    );
  });

  it("clearing the pick persists pinnedProject: undefined", async () => {
    const onConfigChange = vi.fn();
    renderExpanded({
      config: { pinnedProject: { id: 1, owner: "morgan" } },
      onConfigChange,
    });
    const select = await screen.findByTestId("single-project-pin-select");
    fireEvent.change(select, { target: { value: "" } });
    expect(onConfigChange).toHaveBeenCalledWith(
      expect.objectContaining({ pinnedProject: undefined }),
    );
  });
});
