import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Task, Project } from "@/lib/types";

/**
 * Pins the Miscellaneous category filter on /purchases.
 *
 * Three chips: "All | Project purchases | Miscellaneous". Switching the
 * chip filters `sortedTasks` to:
 *   - all: every purchase task
 *   - project: purchase tasks whose project does NOT match isMiscProject
 *   - misc: purchase tasks whose project IS the hidden `_misc_purchases`
 *
 * Display rule: the misc project renders as "Miscellaneous", not the
 * raw `_misc_purchases` name.
 */

const {
  tasksApi,
  purchasesApi,
  labApi,
  fetchAllProjectsIncludingShared,
  fetchAllTasksIncludingShared,
} = vi.hoisted(() => {
  const realProject: Project = {
    id: 1,
    name: "Project A",
    weekend_active: false,
    tags: null,
    color: null,
    created_at: "2026-05-01T00:00:00Z",
    sort_order: 0,
    is_archived: false,
    archived_at: null,
    owner: "alex",
    shared_with: [],
  };
  const miscProject: Project = {
    id: 99,
    name: "_misc_purchases",
    weekend_active: false,
    tags: null,
    color: "#9ca3af",
    created_at: "2026-05-01T00:00:00Z",
    sort_order: 999_999,
    is_archived: false,
    archived_at: null,
    owner: "alex",
    shared_with: [],
    is_hidden: true,
  };
  return {
    tasksApi: {
      delete: vi.fn(async () => {}),
      update: vi.fn(async () => null),
    },
    purchasesApi: {
      listAllIncludingShared: vi.fn(async () => []),
      listFundingAccounts: vi.fn(async () => []),
    },
    // Purchases UX fix Bug 3 (2026-05-24): /purchases now reads the
    // canonical lab-wide queue via `labApi.getAllPurchaseItems` to
    // drive the lab-head banner. Members never trigger the query, but
    // the mock must exist so the import resolves.
    labApi: {
      getAllPurchaseItems: vi.fn(async () => []),
    },
    fetchAllProjectsIncludingShared: vi.fn(async () => [realProject, miscProject]),
    fetchAllTasksIncludingShared: vi.fn(),
  };
});

vi.mock("@/lib/local-api", () => ({
  tasksApi,
  purchasesApi,
  labApi,
  fetchAllProjectsIncludingShared,
  fetchAllTasksIncludingShared,
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ currentUser: "alex" }),
}));

// Purchases UX fix Bug 2 (2026-05-24): the page reads the active
// user's account_type to pick the awaiting-approval chip label. The
// misc-filter suite renders as "alex" with no opinion about role, so
// the safe default is "member" (matches the production default in
// `useAccountType.ts`).
vi.mock("@/hooks/useAccountType", () => ({
  useAccountType: () => "member",
}));

// The awaiting-approval chip renders only in lab mode (showApprovalFilter =
// useIsLabMode() === true). This suite tests the chip in a lab-mode context
// where a member is waiting on the lab head for approval.
vi.mock("@/hooks/useIsLabMode", () => ({
  useIsLabMode: () => true,
}));

// Purchases UX fix Bug 3 (2026-05-24): the new banner CTA uses
// `useRouter().push("/lab-overview")`. The misc-filter suite never
// triggers it (account_type is "member"), but the hook still has to
// resolve at render time.
vi.mock("@/lib/file-system/file-system-context", () => ({
  // Pre-existing gap: a child of the page reads useFileSystem; provide a stub.
  useFileSystem: () => ({ currentUser: "alex", isLoading: false, directoryName: "Lab" }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  // The page reads useSearchParams for the retired `?stage=` deep-link (now
  // handled by the flag-gated redirect, inert under the flag-off default here).
  useSearchParams: () => new URLSearchParams(),
}));

// Supplies v2 chunk 7 retired the SuppliesTabs hub header; the Purchases page
// no longer mounts it (this suite runs with INVENTORY_ENABLED off, so the page
// renders its standalone content), so no stub is needed.

vi.mock("@/lib/store", () => ({
  useAppStore: (selector: (s: { selectedProjectIds: number[] }) => unknown) =>
    selector({ selectedProjectIds: [] }),
}));

vi.mock("@/components/AppShell", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// The page registers a BeakerSearch source on mount; this test renders the page
// in isolation (AppShell stubbed, so no BeakerSearchProvider). Stub the
// registration hook so the page mounts without the provider (the source itself
// is unit-tested in purchases-beaker-source.test.ts).
vi.mock("@/app/purchases/usePurchasesBeakerSource", () => ({
  usePurchasesBeakerSource: () => {},
}));

vi.mock("@/components/PurchaseEditor", () => ({
  default: () => <div data-testid="purchase-editor-stub" />,
}));

vi.mock("@/components/SpendingDashboard", () => ({
  default: () => <div data-testid="spending-dashboard-stub" />,
}));

vi.mock("@/components/NewPurchaseModal", () => ({
  default: () => null,
}));

import PurchasesPage from "../purchases/page";

function makePurchaseTask(overrides: Partial<Task>): Task {
  return {
    id: 42,
    project_id: 1,
    name: "default purchase",
    start_date: "2026-05-10",
    duration_days: 1,
    end_date: "2026-05-10",
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
    ...overrides,
  };
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <PurchasesPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PurchasesPage — Miscellaneous category filter", () => {
  it("renders the category chips with per-bucket counts", async () => {
    fetchAllTasksIncludingShared.mockResolvedValueOnce([
      makePurchaseTask({ id: 10, project_id: 1, name: "Pipette tips" }),
      makePurchaseTask({ id: 11, project_id: 1, name: "Centrifuge tubes" }),
      makePurchaseTask({ id: 20, project_id: 99, name: "Conference flight" }),
    ]);

    renderPage();

    // Wait for the page to populate by finding a known row.
    await screen.findByText("Pipette tips");

    // "All" chip exists and shows the total count (3).
    const allChip = screen.getByRole("tab", { name: /^All\s*3$/i });
    expect(allChip).toHaveAttribute("aria-selected", "true");

    // "Project purchases" chip shows 2.
    const projectChip = screen.getByRole("tab", {
      name: /Project purchases\s*2/i,
    });
    expect(projectChip).toHaveAttribute("aria-selected", "false");

    // "Miscellaneous" chip shows 1.
    const miscChip = screen.getByRole("tab", { name: /Miscellaneous\s*1/i });
    expect(miscChip).toHaveAttribute("aria-selected", "false");

    // Purchases UX fix Bug 2 (2026-05-24): "Awaiting approval" chip is
    // visible to members. No items in this fixture have approvals
    // tracked, so the count is 0 (the mocked
    // `purchasesApi.listAllIncludingShared` returns []).
    const awaitingChip = screen.getByRole("tab", {
      name: /Awaiting approval\s*0/i,
    });
    expect(awaitingChip).toHaveAttribute("aria-selected", "false");
  });

  it("filters to only misc purchases when the Miscellaneous chip is clicked", async () => {
    fetchAllTasksIncludingShared.mockResolvedValueOnce([
      makePurchaseTask({ id: 10, project_id: 1, name: "Pipette tips" }),
      makePurchaseTask({ id: 20, project_id: 99, name: "Conference flight" }),
    ]);

    renderPage();

    // Both rows visible under "All" (the default).
    expect(await screen.findByText("Pipette tips")).toBeInTheDocument();
    expect(screen.getByText("Conference flight")).toBeInTheDocument();

    // Click "Miscellaneous".
    const miscChip = screen.getByRole("tab", { name: /Miscellaneous/i });
    fireEvent.click(miscChip);

    // Only the misc row should remain.
    expect(screen.queryByText("Pipette tips")).not.toBeInTheDocument();
    expect(screen.getByText("Conference flight")).toBeInTheDocument();
  });

  it("filters to only project purchases when the Project purchases chip is clicked", async () => {
    fetchAllTasksIncludingShared.mockResolvedValueOnce([
      makePurchaseTask({ id: 10, project_id: 1, name: "Pipette tips" }),
      makePurchaseTask({ id: 20, project_id: 99, name: "Conference flight" }),
    ]);

    renderPage();

    await screen.findByText("Pipette tips");
    const projectChip = screen.getByRole("tab", { name: /Project purchases/i });
    fireEvent.click(projectChip);

    expect(screen.getByText("Pipette tips")).toBeInTheDocument();
    expect(screen.queryByText("Conference flight")).not.toBeInTheDocument();
  });

  it("renders the misc project label as 'Miscellaneous' in the per-task subhead, not the on-disk underscore name", async () => {
    fetchAllTasksIncludingShared.mockResolvedValueOnce([
      makePurchaseTask({ id: 20, project_id: 99, name: "Conference flight" }),
    ]);

    renderPage();
    await screen.findByText("Conference flight");

    // The subhead reads "<project> · <date> · N items". We don't see
    // the raw `_misc_purchases` text anywhere on the page.
    expect(screen.queryByText(/_misc_purchases/)).not.toBeInTheDocument();
    // And the friendly label IS present somewhere (chip + subhead both
    // count). Use a forgiving regex because the subhead joins fields
    // with bullets.
    const miscMentions = screen.getAllByText(/Miscellaneous/);
    expect(miscMentions.length).toBeGreaterThan(0);
  });
});
