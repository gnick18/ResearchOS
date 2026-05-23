/**
 * DemoLabModeViewer demo-data wiring tests (Lab Mode demo-data manager,
 * 2026-05-22).
 *
 * Separate from `DemoLabModeViewer.test.tsx` (which stubs every panel
 * and `useLabData`). This file deliberately does NOT stub the panels,
 * letting them render with the demo bundle that the viewer fetches at
 * mount time. We stub `fetch` globally so the demo aggregator returns
 * deterministic fixture data (no actual `/demo-data/` HTTP).
 *
 * What we assert:
 *   - The viewer renders chrome (DEMO pill + Exit button) immediately.
 *   - Once the demo bundle resolves, the Activity panel surfaces
 *     demo tasks (proving the cache pre-seed reaches the panel).
 *   - The Roadmaps tab surfaces demo SMART goals.
 *   - The aggregator returns a non-empty bundle when both demo users
 *     contribute data.
 *
 * We intentionally do NOT mock `@/hooks/useLabData` here — the real
 * hook reads from the scoped React Query cache that the viewer seeds.
 * That's the whole point of the fix: panels read demo data without any
 * per-panel changes.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

// UserAvatar reaches into FileSystemProvider via useUserColor; in
// jsdom we have no provider, so stub it. The viewer test is about
// data wiring, not avatar rendering — the stub keeps the panel
// rendering machinery alive.
vi.mock("@/components/UserAvatar", () => ({
  default: ({ username }: { username: string }) => (
    <div data-testid={`stub-avatar-${username}`}>{username}</div>
  ),
}));

// TaskDetailPopup is huge and not relevant to this test — stub it so
// it doesn't drag in editor / file-system dependencies.
vi.mock("@/components/TaskDetailPopup", () => ({
  default: () => <div data-testid="stub-task-detail-popup" />,
}));
vi.mock("@/components/LabUserDetailPanel", () => ({
  default: () => <div data-testid="stub-lab-user-detail-panel" />,
}));
vi.mock("@/components/LabUserFilterButton", () => ({
  default: () => <div data-testid="stub-lab-user-filter-button" />,
}));
// LabGanttChart imports frappe-gantt (CSS side-effects, DOM measurements)
// that don't load cleanly in jsdom. Stub it since this test exercises
// the Activity + Roadmaps panels.
vi.mock("@/components/LabGanttChart", () => ({
  default: () => <div data-testid="stub-lab-gantt-chart" />,
}));

import DemoLabModeViewer from "../DemoLabModeViewer";
import { aggregateDemoLabData } from "@/lib/demo/lab-demo-data";

// Fixture counters — each user gets a small but non-zero set so the
// aggregator's fetch loops run end-to-end.
const ALEX_COUNTERS = {
  projects: 1,
  tasks: 2,
  methods: 1,
  goals: 1,
  notes: 1,
  purchase_items: 1,
};
const MORGAN_COUNTERS = {
  projects: 1,
  tasks: 1,
  methods: 1,
  goals: 1,
  notes: 1,
};
const LAB_COUNTERS = { funding_accounts: 1 };

const USER_METADATA = {
  alex: { color: "#abc", created_at: "2026-01-15T00:00:00Z" },
  morgan: { color: "#def", created_at: "2026-01-20T00:00:00Z" },
  // Demo PI archetype (Dr. Mira Castellanos). Zero counters in the real
  // fixture; her presence is the LabComment thread layer across alex +
  // morgan's shared content. She contributes no rows here.
  mira: { color: "#fff", created_at: "2026-01-05T00:00:00Z" },
};

// One project per user.
const ALEX_PROJECT = {
  id: 1,
  name: "Alex demo project",
  color: "#3b82f6",
  weekend_active: false,
  tags: null,
  created_at: "2026-02-01T00:00:00Z",
  sort_order: 0,
  is_archived: false,
  archived_at: null,
  owner: "alex",
  shared_with: [],
};
const MORGAN_PROJECT = {
  id: 1,
  name: "Morgan demo project",
  color: "#10b981",
  weekend_active: false,
  tags: null,
  created_at: "2026-02-15T00:00:00Z",
  sort_order: 0,
  is_archived: false,
  archived_at: null,
  owner: "morgan",
  shared_with: [],
};

// Tasks: pick today/yesterday so the Activity panel's "Running now"
// section qualifies (start_date <= today <= end_date && !is_complete).
function todayIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}
function dayShift(daysFromToday: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + daysFromToday);
  return d.toISOString().slice(0, 10);
}

const ALEX_TASK_1 = {
  id: 1,
  project_id: 1,
  name: "Alex active experiment",
  start_date: dayShift(-1),
  duration_days: 5,
  end_date: dayShift(3),
  is_high_level: false,
  is_complete: false,
  task_type: "experiment",
  weekend_override: null,
  method_ids: [1],
  deviation_log: null,
  tags: null,
  sort_order: 0,
  experiment_color: null,
  sub_tasks: null,
  method_attachments: [],
  owner: "alex",
  shared_with: [],
};
const ALEX_TASK_2 = {
  id: 2,
  project_id: 1,
  name: "Alex demo purchase order",
  start_date: dayShift(-2),
  duration_days: 7,
  end_date: dayShift(4),
  is_high_level: false,
  is_complete: false,
  task_type: "purchase",
  weekend_override: null,
  method_ids: [],
  deviation_log: null,
  tags: null,
  sort_order: 0,
  experiment_color: null,
  sub_tasks: null,
  method_attachments: [],
  owner: "alex",
  shared_with: [],
};
const MORGAN_TASK_1 = {
  id: 1,
  project_id: 1,
  name: "Morgan active screening",
  start_date: dayShift(0),
  duration_days: 3,
  end_date: dayShift(2),
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
  owner: "morgan",
  shared_with: [],
};

const ALEX_METHOD = {
  id: 1,
  name: "Alex demo method",
  owner: "alex",
  is_public: false,
};
const MORGAN_METHOD = {
  id: 1,
  name: "Morgan demo method",
  owner: "morgan",
  is_public: false,
};

const ALEX_GOAL = {
  id: 1,
  project_id: 1,
  name: "Alex demo SMART goal",
  start_date: dayShift(-30),
  end_date: dayShift(60),
  color: "#3b82f6",
  smart_goals: [
    { id: "sg1", text: "Demo smart goal one", is_complete: true },
    { id: "sg2", text: "Demo smart goal two", is_complete: false },
  ],
  is_complete: false,
  created_at: "2026-04-01T00:00:00Z",
};
const MORGAN_GOAL = {
  id: 1,
  project_id: 1,
  name: "Morgan demo SMART goal",
  start_date: dayShift(-20),
  end_date: dayShift(40),
  color: "#10b981",
  smart_goals: [
    { id: "sg1", text: "Morgan smart goal", is_complete: false },
  ],
  is_complete: false,
  created_at: "2026-04-15T00:00:00Z",
};

const ALEX_NOTE = {
  id: 1,
  title: "Alex shared demo note",
  description: "Hello from the demo bundle.",
  is_running_log: false,
  is_shared: true,
  entries: [],
  comments: [],
  created_at: "2026-05-10T00:00:00Z",
  updated_at: todayIso() + "T00:00:00Z",
  username: "alex",
};
const MORGAN_NOTE = {
  id: 1,
  title: "Morgan shared demo note",
  description: "Hello from morgan.",
  is_running_log: false,
  is_shared: true,
  entries: [],
  comments: [],
  created_at: "2026-05-12T00:00:00Z",
  updated_at: todayIso() + "T00:00:00Z",
  username: "morgan",
};

const ALEX_PURCHASE_ITEM = {
  id: 1,
  task_id: 2,
  item_name: "Demo reagent",
  quantity: 1,
  link: null,
  cas: null,
  price_per_unit: 50,
  shipping_fees: 5,
  total_price: 55,
  notes: null,
  funding_string: "Demo funding",
  vendor: "Demo vendor",
  category: "Reagents",
};

const FUNDING_ACCOUNT = {
  id: 1,
  name: "Demo funding",
  description: null,
  total_budget: 5000,
  spent: 55,
  remaining: 4945,
};

/**
 * Route a fetch URL to a JSON fixture. Returns 404 for anything we
 * don't recognize — the aggregator tolerates per-file 404s and just
 * skips them.
 */
function routeFetch(url: string): Response {
  const path = url.toString();
  const json = (data: unknown) =>
    new Response(JSON.stringify(data), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  const notFound = () => new Response("Not Found", { status: 404 });

  if (path.endsWith("/users/_user_metadata.json")) return json(USER_METADATA);
  if (path.endsWith("/users/alex/_counters.json")) return json(ALEX_COUNTERS);
  if (path.endsWith("/users/morgan/_counters.json")) return json(MORGAN_COUNTERS);
  if (path.endsWith("/users/lab/_counters.json")) return json(LAB_COUNTERS);

  if (path.endsWith("/users/alex/projects/1.json")) return json(ALEX_PROJECT);
  if (path.endsWith("/users/morgan/projects/1.json")) return json(MORGAN_PROJECT);

  if (path.endsWith("/users/alex/tasks/1.json")) return json(ALEX_TASK_1);
  if (path.endsWith("/users/alex/tasks/2.json")) return json(ALEX_TASK_2);
  if (path.endsWith("/users/morgan/tasks/1.json")) return json(MORGAN_TASK_1);

  if (path.endsWith("/users/alex/methods/1.json")) return json(ALEX_METHOD);
  if (path.endsWith("/users/morgan/methods/1.json")) return json(MORGAN_METHOD);

  if (path.endsWith("/users/alex/goals/1.json")) return json(ALEX_GOAL);
  if (path.endsWith("/users/morgan/goals/1.json")) return json(MORGAN_GOAL);

  if (path.endsWith("/users/alex/notes/1.json")) return json(ALEX_NOTE);
  if (path.endsWith("/users/morgan/notes/1.json")) return json(MORGAN_NOTE);

  if (path.endsWith("/users/alex/purchase_items/1.json"))
    return json(ALEX_PURCHASE_ITEM);

  if (path.endsWith("/users/lab/funding_accounts/1.json"))
    return json(FUNDING_ACCOUNT);

  return notFound();
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => routeFetch(url)),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("aggregateDemoLabData", () => {
  it("merges mira + alex + morgan slices into a single bundle", async () => {
    const bundle = await aggregateDemoLabData("/demo-data");

    // mira (demo PI) is included but contributes zero rows — her presence
    // is the LabComment thread layer across alex + morgan's content.
    expect(bundle.users.map((u) => u.username).sort()).toEqual([
      "alex",
      "mira",
      "morgan",
    ]);
    expect(bundle.tasks).toHaveLength(3); // 2 alex + 1 morgan + 0 mira
    expect(bundle.projects).toHaveLength(2); // 1 alex + 1 morgan + 0 mira
    expect(bundle.methods).toHaveLength(2);
    expect(bundle.goals).toHaveLength(2);
    expect(bundle.notesShared).toHaveLength(2);
    expect(bundle.purchaseItems).toHaveLength(1);
    expect(bundle.fundingAccounts).toHaveLength(1);
  });

  it("decorates tasks with the user's color so the Gantt can color-code", async () => {
    const bundle = await aggregateDemoLabData("/demo-data");
    const alexTask = bundle.tasks.find((t) => t.username === "alex");
    const morganTask = bundle.tasks.find((t) => t.username === "morgan");
    expect(alexTask?.user_color).toBe("#abc");
    expect(morganTask?.user_color).toBe("#def");
  });

  it("filters out personal goals (project_id === null) like labApi.getGoals", async () => {
    // We don't seed a personal goal in this test, but the filter is in
    // the aggregator. Sanity-check the existing demo goals all have a
    // project_id set.
    const bundle = await aggregateDemoLabData("/demo-data");
    for (const goal of bundle.goals) {
      expect(goal.project_id).not.toBeNull();
    }
  });

  it("decorates purchase items with the username field", async () => {
    const bundle = await aggregateDemoLabData("/demo-data");
    expect(bundle.purchaseItems[0]?.username).toBe("alex");
  });

  it("keeps only shared notes (is_shared = true)", async () => {
    // Both seeded notes are shared, so the count matches the fixture
    // counters exactly.
    const bundle = await aggregateDemoLabData("/demo-data");
    expect(bundle.notesShared.every((n) => n.is_shared)).toBe(true);
    expect(bundle.notesShared.length).toBe(2);
  });
});

describe("DemoLabModeViewer demo data wiring", () => {
  it("renders the DEMO pill + Exit button immediately (before fetch resolves)", () => {
    const { getByTestId } = render(
      <DemoLabModeViewer onExit={() => {}} />,
    );
    expect(getByTestId("demo-lab-mode-pill").textContent).toMatch(/Demo/i);
    expect(getByTestId("demo-lab-mode-exit")).toBeTruthy();
  });

  it("Activity panel surfaces demo tasks after the bundle resolves", async () => {
    render(<DemoLabModeViewer onExit={() => {}} />);

    // The Activity panel's "Running now" section renders tasks where
    // today is between start_date and end_date — the fixture above
    // sets both alex + morgan experiments to satisfy that.
    await waitFor(
      () => {
        expect(screen.getByText(/Alex active experiment/i)).toBeInTheDocument();
      },
      { timeout: 5000 },
    );

    expect(screen.getByText(/Morgan active screening/i)).toBeInTheDocument();
  });

  it("Roadmaps tab surfaces demo SMART goals after switch", async () => {
    render(<DemoLabModeViewer onExit={() => {}} />);

    // Wait for first paint with data (Activity panel populated).
    await waitFor(
      () => {
        expect(screen.getByText(/Alex active experiment/i)).toBeInTheDocument();
      },
      { timeout: 5000 },
    );

    // Click the Roadmaps tab.
    const roadmapsTab = document.querySelector(
      '[data-tour-target="lab-mode-roadmaps-tab"]',
    );
    expect(roadmapsTab).toBeTruthy();
    fireEvent.click(roadmapsTab!);

    await waitFor(() => {
      expect(
        screen.getByText(/Alex demo SMART goal/i),
      ).toBeInTheDocument();
    });
  });

  it("Exit button calls onExit", async () => {
    const onExit = vi.fn();
    render(<DemoLabModeViewer onExit={onExit} />);
    fireEvent.click(screen.getByTestId("demo-lab-mode-exit"));
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
