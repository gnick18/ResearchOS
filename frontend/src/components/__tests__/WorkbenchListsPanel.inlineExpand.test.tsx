// Workbench Lists tab — inline-expand UX pin.
//
// Pins the 2026-05-22 refactor that replaced the popup mount path with
// an inline accordion (`ExpandableListCard`). The popup component itself
// stays alive for the Gantt page (and every other surface) — only the
// Lists tab on /workbench was rerouted. The single-expanded contract
// means clicking another card collapses the previous one.
//
// Regression contract:
//   - Click a list card → inline panel mounts in the SAME DOM tree (no
//     fixed/portal popup overlay). Name input, items list, add-item
//     input, and "Mark list complete" button all surface inline.
//   - Add item from inline panel → tasksApi.update fires with the
//     extended sub_tasks array; new item appears in the panel.
//   - Toggle an item checkbox from inline panel → UI flips and
//     tasksApi.update fires with the patched is_complete.
//
// Workbench lists UX manager.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Project, Task } from "@/lib/types";
import { useAppStore } from "@/lib/store";

const mocks = vi.hoisted(() => ({
  fetchAllTasksIncludingShared: vi.fn<() => Promise<Task[]>>(),
  tasksUpdate: vi.fn(async (_id: number, _data: unknown, _owner?: string) => ({})),
}));

vi.mock("@/lib/local-api", () => ({
  fetchAllTasksIncludingShared: mocks.fetchAllTasksIncludingShared,
  tasksApi: {
    update: mocks.tasksUpdate,
  },
}));

// The completion celebration (ExpandableListCard -> DynamicAnimation) is gated by
// POPUP_ANIMATIONS_ENABLED, which ships OFF in production. The "celebration
// animation parity" tests verify the fire-on-complete behavior for when the gate
// is ON, so force it true here (DynamicAnimation itself is stubbed below).
vi.mock("@/lib/animations/popup-gate", () => ({
  POPUP_ANIMATIONS_ENABLED: true,
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ currentUser: "alex", isLoggedIn: true }),
}));

// TaskDetailPopup + TaskModal are heavy and not exercised by the inline
// flow under test. Stub to nulls so failures here can't mask the inline
// assertions.
vi.mock("@/components/TaskDetailPopup", () => ({
  default: () => null,
}));
vi.mock("@/components/TaskModal", () => ({
  default: () => null,
}));

// Stub DynamicAnimation so the inline-expand test asserts "an animation
// fired" without spinning up the real particle simulation (setInterval +
// requestAnimationFrame, plus a canvas that jsdom can't paint). The stub
// renders a marker div carrying the type + nonce-driven coordinates so
// the test can read both off the DOM.
vi.mock("@/components/DynamicAnimation", () => ({
  __esModule: true,
  default: ({
    type,
    x,
    y,
  }: {
    type: string;
    x: number;
    y: number;
    onComplete: () => void;
  }) => (
    <div
      data-testid="celebration-animation"
      data-anim-type={type}
      data-anim-x={x}
      data-anim-y={y}
    />
  ),
}));

// SharedFromPill pulls user-color hooks; not relevant for this test.
vi.mock("@/components/workbench/SharedFromPill", () => ({
  __esModule: true,
  default: () => <span data-testid="shared-from-pill" />,
}));

import WorkbenchListsPanel from "@/components/workbench/WorkbenchListsPanel";

function project(
  partial: Partial<Project> & { id: number; name: string; owner: string },
): Project {
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

function listTask(
  partial: Partial<Task> & {
    id: number;
    name: string;
    owner: string;
    project_id: number;
  },
): Task {
  return {
    start_date: "2026-05-20",
    duration_days: 1,
    end_date: "2026-05-20",
    is_high_level: false,
    is_complete: false,
    task_type: "list",
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
      <WorkbenchListsPanel projects={projects} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tasksUpdate.mockResolvedValue({});
});

afterEach(() => {
  // Reset filter state so the project pill doesn't leak across tests.
  useAppStore.setState({ selectedProjectIds: [] });
});

describe("WorkbenchListsPanel — inline-expand replaces popup on Lists tab", () => {
  const projects: Project[] = [
    project({ id: 1, name: "Alex Lab", owner: "alex" }),
  ];

  function makeList(overrides: Partial<Task> = {}): Task {
    return listTask({
      id: 42,
      name: "Buy reagents",
      owner: "alex",
      project_id: 1,
      sub_tasks: [
        { id: "st-a", text: "Order primers", is_complete: false },
        { id: "st-b", text: "Order Taq",     is_complete: false },
      ],
      ...overrides,
    });
  }

  it("clicking the list card toggles an inline accordion (no popup portal)", async () => {
    useAppStore.setState({ selectedProjectIds: ["alex:1"] });
    mocks.fetchAllTasksIncludingShared.mockResolvedValue([makeList()]);

    const { container } = renderPanel(projects);

    const cardRoot = await screen.findByTestId("expandable-list-card");
    expect(cardRoot.getAttribute("data-expanded")).toBe("false");

    // Find the role=button header within the card (the card root itself
    // is a div wrapping the clickable header).
    const header = within(cardRoot).getAllByRole("button").find((el) => {
      // The header is the clickable parent with aria-expanded set.
      return el.getAttribute("aria-expanded") !== null;
    });
    expect(header).toBeDefined();
    fireEvent.click(header!);

    await waitFor(() => {
      expect(cardRoot.getAttribute("data-expanded")).toBe("true");
    });

    // Inline panel + items live in the SAME DOM subtree (no portal).
    const panel = within(cardRoot).getByTestId(
      "expandable-list-card-panel",
    );
    expect(panel).toBeInTheDocument();
    // Items render in the inline panel.
    expect(within(panel).getByText("Order primers")).toBeInTheDocument();
    expect(within(panel).getByText("Order Taq")).toBeInTheDocument();
    // Add-item input and Mark-list-complete button live inline.
    expect(
      within(panel).getByPlaceholderText("Add item..."),
    ).toBeInTheDocument();
    expect(
      within(panel).getByRole("button", { name: /mark list complete/i }),
    ).toBeInTheDocument();

    // And — critically — the popup is NOT mounted. Our stub returns null,
    // but we also assert nothing escapes to a portal-rendered overlay
    // (no `.fixed.inset-0` overlay anywhere).
    expect(
      container.querySelector(".fixed.inset-0"),
    ).toBeNull();
  });

  it("adds an item from the inline panel and persists via tasksApi.update", async () => {
    useAppStore.setState({ selectedProjectIds: ["alex:1"] });
    mocks.fetchAllTasksIncludingShared.mockResolvedValue([makeList()]);

    renderPanel(projects);

    const cardRoot = await screen.findByTestId("expandable-list-card");
    const header = within(cardRoot)
      .getAllByRole("button")
      .find((el) => el.getAttribute("aria-expanded") !== null)!;
    fireEvent.click(header);

    const panel = within(cardRoot).getByTestId(
      "expandable-list-card-panel",
    );
    const input = within(panel).getByPlaceholderText(
      "Add item...",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Order buffer" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(mocks.tasksUpdate).toHaveBeenCalled();
    });
    const call = mocks.tasksUpdate.mock.calls.find(
      ([id, data]) =>
        id === 42 &&
        typeof data === "object" &&
        data !== null &&
        "sub_tasks" in data,
    );
    expect(call).toBeDefined();
    const updateData = call![1] as { sub_tasks: { text: string }[] };
    expect(updateData.sub_tasks.map((s) => s.text)).toEqual([
      "Order primers",
      "Order Taq",
      "Order buffer",
    ]);

    // Optimistic update: new item is visible without round-trip.
    expect(within(panel).getByText("Order buffer")).toBeInTheDocument();
  });

  it("toggling an item checkbox flips the UI and persists the new is_complete", async () => {
    useAppStore.setState({ selectedProjectIds: ["alex:1"] });
    mocks.fetchAllTasksIncludingShared.mockResolvedValue([makeList()]);

    renderPanel(projects);

    const cardRoot = await screen.findByTestId("expandable-list-card");
    const header = within(cardRoot)
      .getAllByRole("button")
      .find((el) => el.getAttribute("aria-expanded") !== null)!;
    fireEvent.click(header);

    const panel = within(cardRoot).getByTestId(
      "expandable-list-card-panel",
    );
    // Both items are incomplete — grab the first item-checkbox button.
    const toggles = within(panel).getAllByRole("button", {
      name: /mark item complete/i,
    });
    expect(toggles.length).toBe(2);
    fireEvent.click(toggles[0]!);

    await waitFor(() => {
      // Look for the tasksApi.update call that toggled a sub_task to
      // is_complete: true (skip the unrelated calls).
      const found = mocks.tasksUpdate.mock.calls.find(([id, data]) => {
        if (id !== 42) return false;
        const d = data as { sub_tasks?: { id: string; is_complete: boolean }[] };
        if (!d.sub_tasks) return false;
        const hit = d.sub_tasks.find((st) => st.id === "st-a");
        return hit?.is_complete === true;
      });
      expect(found).toBeDefined();
    });
  });
});

describe("Celebration animation parity on inline lists", () => {
  // Pins list animation parity manager 2026-05-27: checking off a subtask,
  // checking the parent-list checkbox in the header, and clicking the
  // inline "Mark list complete" button each fire the same celebration
  // animation that experiment-complete + goal-achieve already do. Uncheck
  // never fires. Rapid double-check replaces the in-flight animation via
  // the nonce-as-key interrupt pattern (commit 0d778d95).

  const projects: Project[] = [
    project({ id: 1, name: "Alex Lab", owner: "alex" }),
  ];

  function makeList(overrides: Partial<Task> = {}): Task {
    return listTask({
      id: 42,
      name: "Buy reagents",
      owner: "alex",
      project_id: 1,
      sub_tasks: [
        { id: "st-a", text: "Order primers", is_complete: false },
        { id: "st-b", text: "Order Taq", is_complete: false },
      ],
      ...overrides,
    });
  }

  it("checking a subtask fires the celebration animation", async () => {
    useAppStore.setState({ selectedProjectIds: ["alex:1"] });
    mocks.fetchAllTasksIncludingShared.mockResolvedValue([makeList()]);

    renderPanel(projects);

    const cardRoot = await screen.findByTestId("expandable-list-card");
    const header = within(cardRoot)
      .getAllByRole("button")
      .find((el) => el.getAttribute("aria-expanded") !== null)!;
    fireEvent.click(header);

    const panel = within(cardRoot).getByTestId(
      "expandable-list-card-panel",
    );
    const toggles = within(panel).getAllByRole("button", {
      name: /mark item complete/i,
    });
    fireEvent.click(toggles[0]!);

    await waitFor(() => {
      expect(screen.getByTestId("celebration-animation")).toBeInTheDocument();
    });
  });

  it("unchecking a subtask does NOT fire the animation", async () => {
    useAppStore.setState({ selectedProjectIds: ["alex:1"] });
    mocks.fetchAllTasksIncludingShared.mockResolvedValue([
      makeList({
        sub_tasks: [
          { id: "st-a", text: "Order primers", is_complete: true },
          { id: "st-b", text: "Order Taq", is_complete: false },
        ],
      }),
    ]);

    renderPanel(projects);

    const cardRoot = await screen.findByTestId("expandable-list-card");
    const header = within(cardRoot)
      .getAllByRole("button")
      .find((el) => el.getAttribute("aria-expanded") !== null)!;
    fireEvent.click(header);

    const panel = within(cardRoot).getByTestId(
      "expandable-list-card-panel",
    );
    // The already-complete item exposes "mark item incomplete" aria label.
    const uncheck = within(panel).getByRole("button", {
      name: /mark item incomplete/i,
    });
    fireEvent.click(uncheck);

    // Persist the mutation but assert no animation appeared. Wait one
    // tick so any stray animation would have had a chance to render.
    await waitFor(() => {
      expect(mocks.tasksUpdate).toHaveBeenCalled();
    });
    expect(
      screen.queryByTestId("celebration-animation"),
    ).not.toBeInTheDocument();
  });

  it("clicking 'Mark list complete' fires exactly one animation", async () => {
    useAppStore.setState({ selectedProjectIds: ["alex:1"] });
    mocks.fetchAllTasksIncludingShared.mockResolvedValue([makeList()]);

    renderPanel(projects);

    const cardRoot = await screen.findByTestId("expandable-list-card");
    const header = within(cardRoot)
      .getAllByRole("button")
      .find((el) => el.getAttribute("aria-expanded") !== null)!;
    fireEvent.click(header);

    const panel = within(cardRoot).getByTestId(
      "expandable-list-card-panel",
    );
    const markComplete = within(panel).getByRole("button", {
      name: /mark list complete/i,
    });
    fireEvent.click(markComplete);

    await waitFor(() => {
      const all = screen.getAllByTestId("celebration-animation");
      // Even though the cascade flips two subtasks to is_complete=true in
      // the same update, the subtask handler isn't invoked — so only the
      // parent button's animation fires.
      expect(all).toHaveLength(1);
    });
  });

  it("rapid double-check on subtasks replaces the in-flight animation (nonce key)", async () => {
    useAppStore.setState({ selectedProjectIds: ["alex:1"] });
    mocks.fetchAllTasksIncludingShared.mockResolvedValue([makeList()]);

    renderPanel(projects);

    const cardRoot = await screen.findByTestId("expandable-list-card");
    const header = within(cardRoot)
      .getAllByRole("button")
      .find((el) => el.getAttribute("aria-expanded") !== null)!;
    fireEvent.click(header);

    const panel = within(cardRoot).getByTestId(
      "expandable-list-card-panel",
    );
    const toggles = within(panel).getAllByRole("button", {
      name: /mark item complete/i,
    });

    fireEvent.click(toggles[0]!);
    await waitFor(() => {
      expect(screen.getByTestId("celebration-animation")).toBeInTheDocument();
    });

    // Second check: only one DynamicAnimation is mounted at a time (the
    // overlay is rendered conditionally), and the previous instance is
    // replaced via the nonce-as-key swap. We can't observe the unmount
    // directly through the stub, but we can assert at most one node is
    // ever present in the DOM and the click doesn't double-mount.
    fireEvent.click(toggles[1]!);
    await waitFor(() => {
      expect(
        screen.getAllByTestId("celebration-animation"),
      ).toHaveLength(1);
    });
  });

  it("parent-checkbox check fires the animation", async () => {
    useAppStore.setState({ selectedProjectIds: ["alex:1"] });
    mocks.fetchAllTasksIncludingShared.mockResolvedValue([makeList()]);

    renderPanel(projects);

    const cardRoot = await screen.findByTestId("expandable-list-card");
    const parentCheckbox = within(cardRoot).getByRole("button", {
      name: /mark as complete/i,
    });
    fireEvent.click(parentCheckbox);

    await waitFor(() => {
      expect(screen.getByTestId("celebration-animation")).toBeInTheDocument();
    });
  });

  it("parent-checkbox uncheck on an already-complete list does NOT fire animation", async () => {
    // Seed with an already-complete list. Clicking the parent checkbox
    // here means uncheck, so no celebration.
    useAppStore.setState({ selectedProjectIds: ["alex:1"] });
    mocks.fetchAllTasksIncludingShared.mockResolvedValue([
      makeList({
        is_complete: true,
        sub_tasks: [
          { id: "st-a", text: "Order primers", is_complete: true },
          { id: "st-b", text: "Order Taq", is_complete: true },
        ],
      }),
    ]);

    renderPanel(projects);

    const cardRoot = await screen.findByTestId("expandable-list-card");
    const uncheckBtn = within(cardRoot).getByRole("button", {
      name: /mark as incomplete/i,
    });
    fireEvent.click(uncheckBtn);

    await waitFor(() => {
      expect(mocks.tasksUpdate).toHaveBeenCalled();
    });
    expect(
      screen.queryByTestId("celebration-animation"),
    ).not.toBeInTheDocument();
  });
});

describe("Lists popup mount path still works on the Gantt page", () => {
  // Regression-pin: importing the Gantt page must not break — its
  // TaskDetailPopup wiring is untouched by this refactor. We don't
  // boot the Gantt page (heavy), but we assert the module still
  // imports and references TaskDetailPopup, so a tree-shake or
  // export-rename can't silently kill the Gantt popup affordance.
  it("the Gantt page still imports TaskDetailPopup", async () => {
    // Read the source file directly so we don't have to construct
    // a Gantt render harness (filesystem providers, frappe-gantt CSS
    // side effects, etc).
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const ganttSrc = readFileSync(
      resolve(__dirname, "../../app/gantt/page.tsx"),
      "utf-8",
    );
    expect(ganttSrc).toMatch(/from\s+"@\/components\/TaskDetailPopup"/);
    expect(ganttSrc).toMatch(/<TaskDetailPopup/);
  });
});
