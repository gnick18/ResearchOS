// Component tests for the Streak Phase S4 PTO surfaces on <GanttChart />.
// Pins the public contract from STREAK_AND_MILESTONES_PROPOSAL.md §6.4
// (Gantt right-click PTO) and §6.6 (project schedule extension):
//
//   - PTO day cells render the striped overlay
//   - PTO day headers carry the "PTO won't break your streak" tooltip
//   - Right-click on a non-PTO day → context menu with "Mark <date> as PTO"
//   - Right-click on a PTO day → "Unmark <date> as PTO"
//   - Confirming the menu calls patchStreak with the toggled list
//   - Empty pto_dates → no PTO overlay anywhere (regression guard for L9)
//   - Lab mode → no right-click affordance, no PTO UI (private to user)
//
// The chart depends on a tall stack — useFileSystem, useAppStore,
// tasksApi, etc — so this file mocks the surface to keep the focus on
// PTO interactions, not full chart behavior. The data-shape tests for
// the project schedule extension (helpers + shiftTask) live in
// engine/dates.test.ts which runs in node-env without these stubs.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Dependency, HighLevelGoal, Project, Task } from "@/lib/types";

// ----- mocks ---------------------------------------------------------
//
// vi.mock factories are hoisted to the top of the file, so any state they
// reference must be wrapped in vi.hoisted. The memSidecar plus the two
// mock fns live in the hoisted block; the test body accesses them via the
// `mocks` handle below.

const mocks = vi.hoisted(() => {
  const memSidecar = {
    schema_version: 1 as const,
    enabled: true,
    current_count: 0,
    longest_count: 0,
    last_activity_date: null as string | null,
    started_on: null as string | null,
    shown_privacy_notice: false,
    pto_dates: [] as string[],
    celebrations_seen: {
      account_anniversaries: [] as string[],
      streak_milestones: [] as string[],
    },
  };
  function snapshot() {
    return { ...memSidecar, pto_dates: [...memSidecar.pto_dates] };
  }
  function sortDedupe(d: string[]): string[] {
    return Array.from(new Set(d)).sort();
  }
  return { memSidecar, snapshot, sortDedupe };
});

vi.mock("@/lib/streak/streak-sidecar", () => ({
  readStreak: vi.fn(async () => mocks.snapshot()),
  patchStreak: vi.fn(
    async (
      _u: string,
      mutator: (cur: typeof mocks.memSidecar) => typeof mocks.memSidecar,
    ) => {
      const next = mutator(mocks.snapshot());
      mocks.memSidecar.pto_dates = mocks.sortDedupe(next.pto_dates);
      return mocks.snapshot();
    },
  ),
  isWeekend: (d: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
    if (!m) return false;
    const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return dt.getDay() === 0 || dt.getDay() === 6;
  },
  isPtoDay: (d: string, list: readonly string[]) => list.includes(d),
  isSkipDay: () => false,
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ currentUser: "alex", isLoggedIn: true }),
}));

vi.mock("@/lib/local-api", () => ({
  tasksApi: {
    move: vi.fn(async () => ({ affected_tasks: [], warnings: [], requires_confirmation: false })),
  },
  dependenciesApi: {
    list: vi.fn(async () => []),
    create: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("@/components/LoadingOverlay", () => ({ default: () => null }));

// Pin useAppStore selector behavior so the Gantt's 2-week view renders
// against our fixed anchor date.
vi.mock("@/lib/store", () => ({
  useAppStore: (selector: (s: AppStoreShape) => unknown) =>
    selector({
      viewMode: "2week",
      ganttStartDate: "2026-05-18", // Monday of the test anchor week
      setIsCreatingTask: () => {},
      setNewTaskStartDate: () => {},
      setGanttLoading: () => {},
    } as AppStoreShape),
}));

interface AppStoreShape {
  viewMode: string;
  ganttStartDate: string | null;
  setIsCreatingTask: (b: boolean) => void;
  setNewTaskStartDate: (d: string | null) => void;
  setGanttLoading: (b: boolean, msg?: string) => void;
}

import GanttChart from "../GanttChart";
import * as streakSidecarModule from "@/lib/streak/streak-sidecar";

const patchStreakMock = vi.mocked(streakSidecarModule.patchStreak);
const readStreakMock = vi.mocked(streakSidecarModule.readStreak);

beforeEach(() => {
  mocks.memSidecar.pto_dates = [];
  patchStreakMock.mockClear();
  readStreakMock.mockClear();
});

afterEach(() => {
  // RTL cleanup is auto from test-setup.ts; nothing extra needed.
});

// ----- fixtures ------------------------------------------------------

function project(partial: Partial<Project> & { id: number; name: string; owner: string }): Project {
  return {
    weekend_active: false, // skip-weekends mode (and L9 → skip PTO)
    tags: [],
    color: "#3b82f6",
    created_at: "2026-01-01T00:00:00Z",
    sort_order: 0,
    is_archived: false,
    archived_at: null,
    shared_with: [],
    ...partial,
  };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  // Default task spans Tue-Wed within the 2026-05-18 anchor week so the
  // chart's "no tasks" early return doesn't fire and we get day cells
  // rendered for the whole 14-day window.
  return {
    id: 1,
    name: "T1",
    project_id: 1,
    owner: "alex",
    start_date: "2026-05-19",
    end_date: "2026-05-20",
    duration_days: 2,
    is_complete: false,
    description: "",
    tags: [],
    sub_tasks: [],
    task_type: "task",
    weekend_override: null,
    method_attachments: [],
    high_level_goal_id: null,
    has_purchase: false,
    has_results: false,
    has_protocol: false,
    notes_count: 0,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  } as Task;
}

function renderChart(opts: {
  ptoDates?: string[];
  isLabMode?: boolean;
  tasks?: Task[];
  projects?: Project[];
}) {
  if (opts.ptoDates) mocks.memSidecar.pto_dates = mocks.sortDedupe(opts.ptoDates);
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: Infinity },
    },
  });
  const projects = opts.projects ?? [project({ id: 1, name: "P1", owner: "alex" })];
  const tasks = opts.tasks ?? [makeTask()];
  const deps: Dependency[] = [];
  const goals: HighLevelGoal[] = [];
  return render(
    <QueryClientProvider client={qc}>
      <GanttChart
        tasks={tasks}
        dependencies={deps}
        projectColors={{ "alex:1": "#3b82f6" }}
        projects={projects}
        goals={goals}
        onTaskClick={() => {}}
        onGoalClick={() => {}}
        isLabMode={opts.isLabMode}
      />
    </QueryClientProvider>,
  );
}

async function flushAsync() {
  // The streak useQuery has its own async lifecycle (suspense-like) — react
  // -query schedules a microtask round-trip before notifying subscribers,
  // so a single Promise.resolve isn't enough. Five flushes is a comfortable
  // safety margin under jsdom.
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function waitForPtoCell(date: string) {
  await waitFor(() => {
    expect(screen.getAllByTestId(`pto-day-cell-${date}`).length).toBeGreaterThan(0);
  });
}

// PTO target date sits inside the 2-week visible range starting 2026-05-18
// (Mon). 2026-05-21 is the Thursday of that week.
const PTO_DATE = "2026-05-21";
const NON_PTO_DATE = "2026-05-20"; // Wednesday in range

describe("GanttChart — PTO right-click + striped overlay (Phase S4)", () => {
  it("renders the striped overlay on cells for PTO dates", async () => {
    renderChart({ ptoDates: [PTO_DATE] });
    await waitForPtoCell(PTO_DATE);

    const cells = screen.getAllByTestId(`pto-day-cell-${PTO_DATE}`);
    expect(cells.length).toBeGreaterThan(0);
    for (const c of cells) {
      expect(c.className).toContain("pto-day-cell");
    }
  });

  it("renders the PTO tooltip target on the day header", async () => {
    renderChart({ ptoDates: [PTO_DATE] });
    await waitForPtoCell(PTO_DATE);
    const header = screen.getAllByTestId(`day-header-${PTO_DATE}`)[0];
    expect(header.getAttribute("data-pto-header")).toBe("true");
  });

  it("empty pto_dates → no PTO overlay anywhere (L9 regression guard)", async () => {
    renderChart({ ptoDates: [] });
    await flushAsync();
    expect(screen.queryByTestId(`pto-day-cell-${PTO_DATE}`)).toBeNull();
    const header = screen.queryByTestId(`day-header-${PTO_DATE}`);
    // Header still renders for every day, but without the PTO marker.
    expect(header?.getAttribute("data-pto-header")).toBeNull();
  });

  it("right-click on a non-PTO day opens 'Mark as PTO' menu", async () => {
    renderChart({ ptoDates: [] });
    await flushAsync();

    const header = screen.getAllByTestId(`day-header-${NON_PTO_DATE}`)[0];
    await act(async () => {
      fireEvent.contextMenu(header, { clientX: 100, clientY: 100 });
    });

    const menu = screen.getByTestId("pto-context-menu");
    expect(menu).toBeInTheDocument();
    expect(within(menu).getByTestId("pto-context-menu-toggle")).toHaveTextContent(
      `Mark ${NON_PTO_DATE} as PTO`,
    );
  });

  it("right-click on a PTO day opens 'Unmark as PTO' menu", async () => {
    renderChart({ ptoDates: [PTO_DATE] });
    await waitForPtoCell(PTO_DATE);

    const cell = screen.getAllByTestId(`pto-day-cell-${PTO_DATE}`)[0];
    await act(async () => {
      fireEvent.contextMenu(cell, { clientX: 50, clientY: 50 });
    });

    const menu = screen.getByTestId("pto-context-menu");
    expect(within(menu).getByTestId("pto-context-menu-toggle")).toHaveTextContent(
      `Unmark ${PTO_DATE} as PTO`,
    );
  });

  it("clicking the menu toggle persists via patchStreak", async () => {
    renderChart({ ptoDates: [] });
    await flushAsync();

    const header = screen.getAllByTestId(`day-header-${PTO_DATE}`)[0];
    await act(async () => {
      fireEvent.contextMenu(header, { clientX: 100, clientY: 100 });
    });

    const toggle = screen.getByTestId("pto-context-menu-toggle");
    await act(async () => {
      fireEvent.click(toggle);
      await Promise.resolve();
    });
    await flushAsync();

    expect(patchStreakMock).toHaveBeenCalledTimes(1);
    expect(mocks.memSidecar.pto_dates).toEqual([PTO_DATE]);
  });

  it("toggling an already-PTO date removes it", async () => {
    renderChart({ ptoDates: [PTO_DATE] });
    await waitForPtoCell(PTO_DATE);

    const cell = screen.getAllByTestId(`pto-day-cell-${PTO_DATE}`)[0];
    await act(async () => {
      fireEvent.contextMenu(cell, { clientX: 50, clientY: 50 });
    });

    const toggle = screen.getByTestId("pto-context-menu-toggle");
    await act(async () => {
      fireEvent.click(toggle);
      await Promise.resolve();
    });
    await flushAsync();

    expect(mocks.memSidecar.pto_dates).toEqual([]);
  });

  it("lab mode hides the PTO surface entirely", async () => {
    renderChart({ ptoDates: [PTO_DATE], isLabMode: true });
    await flushAsync();
    // No PTO overlay in lab mode — the streak query is gated off so
    // ptoSet stays empty regardless of the seeded sidecar.
    expect(screen.queryByTestId(`pto-day-cell-${PTO_DATE}`)).toBeNull();
    expect(screen.queryByTestId(`pto-day-header-${PTO_DATE}`)).toBeNull();
  });
});
