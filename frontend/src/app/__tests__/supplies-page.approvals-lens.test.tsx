import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PurchaseItem } from "@/lib/types";

/**
 * Supplies v2 chunk 5: the lab-head "Orders & approvals" lens + the spending
 * drawer (SUPPLIES_V2_UNIFIED.md sections 4.2 + 4.5).
 *
 * Pins three things:
 *   - the "Awaiting approval" filter chip + the View spending / Manage funding
 *     buttons are lab-head-gated (hidden for members);
 *   - selecting the chip renders the order-grouped queue, and approve / decline
 *     call the existing pi-actions writers;
 *   - View spending mounts SpendingDashboard inside the drawer.
 */

// The whole /supplies route is behind INVENTORY_ENABLED; force it on so the
// page renders instead of the "not enabled" placeholder.
vi.mock("@/lib/inventory/config", () => ({
  INVENTORY_ENABLED: true,
}));

const {
  fetchAllInventoryItemsIncludingShared,
  fetchAllInventoryStocksIncludingShared,
  fetchAllStorageNodesIncludingShared,
  fetchAllProjectsIncludingShared,
  fetchAllTasksIncludingShared,
  labApi,
  purchasesApi,
} = vi.hoisted(() => ({
  fetchAllInventoryItemsIncludingShared: vi.fn(async () => []),
  fetchAllInventoryStocksIncludingShared: vi.fn(async () => []),
  fetchAllStorageNodesIncludingShared: vi.fn(async () => []),
  fetchAllProjectsIncludingShared: vi.fn(async () => []),
  fetchAllTasksIncludingShared: vi.fn(async () => []),
  labApi: {
    // Loosely typed returns so mockResolvedValue([makeItem(...)]) does not fight
    // an inferred never[] (the empty literal otherwise infers Promise<never[]>).
    getAllPurchaseItems: vi.fn(async (): Promise<unknown[]> => []),
    getTasks: vi.fn(async (): Promise<unknown[]> => []),
  },
  purchasesApi: {
    listAllIncludingShared: vi.fn(async () => []),
    listFundingAccounts: vi.fn(async () => []),
  },
}));

vi.mock("@/lib/local-api", () => ({
  fetchAllInventoryItemsIncludingShared,
  fetchAllInventoryStocksIncludingShared,
  fetchAllStorageNodesIncludingShared,
  fetchAllProjectsIncludingShared,
  fetchAllTasksIncludingShared,
  labApi,
  purchasesApi,
}));

// pi-actions: spy the three writers the lens wires. They return the success
// envelope so the components' PiActionResult handling takes the happy path.
const { setPurchaseApproval, declinePurchase, setFlagForReview } = vi.hoisted(
  () => ({
    setPurchaseApproval: vi.fn(async () => ({ ok: true, value: {} })),
    declinePurchase: vi.fn(async () => ({ ok: true, value: {} })),
    setFlagForReview: vi.fn(async () => ({ ok: true, value: {} })),
  }),
);
vi.mock("@/lib/lab/pi-actions", () => ({
  setPurchaseApproval,
  declinePurchase,
  setFlagForReview,
}));

const { isLabHeadValue } = vi.hoisted(() => ({ isLabHeadValue: { v: true } }));
vi.mock("@/hooks/useIsLabHead", () => ({
  useIsLabHead: () => isLabHeadValue.v,
}));

// The page reads a `filter` query param via useSearchParams; give it an empty
// URLSearchParams so the initial filter falls back to its default.
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ currentUser: "mira" }),
}));

vi.mock("@/hooks/useLabUserProfiles", () => ({
  useLabUserProfileMap: () => ({}),
}));

vi.mock("@/lib/store", () => ({
  useAppStore: (selector: (s: { selectedProjectIds: string[] }) => unknown) =>
    selector({ selectedProjectIds: [] }),
}));

vi.mock("@/components/AppShell", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// LivingPopup: render children only when open, so a click on "View spending"
// is observable as the dashboard appearing.
vi.mock("@/components/ui/LivingPopup", () => ({
  default: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div data-testid="living-popup">{children}</div> : null,
}));

vi.mock("@/components/SpendingDashboard", () => ({
  default: () => <div data-testid="spending-dashboard-stub" />,
}));

vi.mock("@/components/FundingAccountsManager", () => ({
  default: () => <div data-testid="funding-manager-stub" />,
}));

// The detail panel + cart review are imported by the page but only render on
// interaction we don't exercise here; stub them so their module graphs stay out
// of this suite.
// The page registers itself as a BeakerSearch source via this side-effect-only
// hook (no return value consumed). It needs a BeakerSearchProvider we don't
// mount and is orthogonal to the approvals lens, so stub it to a no-op.
vi.mock("../supplies/useSuppliesBeakerSource", () => ({
  useSuppliesBeakerSource: () => {},
}));

vi.mock("@/components/supplies/SupplyDetailPanel", () => ({
  default: () => null,
}));
vi.mock("@/components/supplies/ReorderCartReview", () => ({
  default: () => null,
}));

import SuppliesPage from "../supplies/page";

function makeItem(overrides: Partial<PurchaseItem> & { username: string }): PurchaseItem & {
  username: string;
} {
  return {
    id: 1,
    task_id: 5,
    item_name: "item",
    quantity: 1,
    price_per_unit: 10,
    shipping_fees: 0,
    total_price: 10,
    vendor: "NEB",
    catalog_number: null,
    cas: null,
    link: null,
    category: null,
    order_status: "needs_ordering",
    approved: false,
    approved_by: null,
    approved_at: null,
    declined_at: null,
    declined_by: null,
    flagged: null,
    funding_account_id: null,
    assignee: null,
    inventory_item_id: null,
    owner: overrides.username,
    ...overrides,
  } as unknown as PurchaseItem & { username: string };
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <SuppliesPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  isLabHeadValue.v = true;
});

describe("SuppliesPage — Orders & approvals lens (lab-head gating)", () => {
  it("hides the approval chip and spending controls for members", async () => {
    isLabHeadValue.v = false;
    labApi.getAllPurchaseItems.mockResolvedValue([
      makeItem({ id: 1, username: "alex", approved: false }),
    ]);

    renderPage();

    // The per-supply chips are present for everyone.
    await screen.findByRole("tab", { name: /^All/i });

    // Lab-head-only chrome is absent for a member.
    expect(
      screen.queryByRole("tab", { name: /Awaiting approval/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("supplies-view-spending")).not.toBeInTheDocument();
    expect(screen.queryByTestId("supplies-manage-funding")).not.toBeInTheDocument();
    expect(screen.queryByTestId("supplies-spend-summary")).not.toBeInTheDocument();
  });

  it("shows the approval chip with the pending count for a lab head", async () => {
    labApi.getAllPurchaseItems.mockResolvedValue([
      makeItem({ id: 1, task_id: 5, username: "mira", approved: false }),
      makeItem({ id: 2, task_id: 5, username: "mira", approved: false }),
      makeItem({ id: 3, task_id: 7, username: "mira", approved: true }),
    ]);

    renderPage();

    // Two pending items -> the chip reads "Awaiting approval 2".
    const chip = await screen.findByRole("tab", {
      name: /Awaiting approval\s*2/i,
    });
    expect(chip).toBeInTheDocument();
    // And the lab-head spending controls render.
    expect(screen.getByTestId("supplies-view-spending")).toBeInTheDocument();
    expect(screen.getByTestId("supplies-manage-funding")).toBeInTheDocument();
  });

  it("renders the order-grouped queue and wires approve + decline to pi-actions", async () => {
    labApi.getAllPurchaseItems.mockResolvedValue([
      makeItem({ id: 11, task_id: 5, username: "mira", item_name: "Taq polymerase" }),
      makeItem({ id: 12, task_id: 5, username: "mira", item_name: "dNTP mix" }),
    ]);
    labApi.getTasks.mockResolvedValue([
      { id: 5, name: "Cloning reagents", username: "mira" },
    ] as never);

    renderPage();

    const chip = await screen.findByRole("tab", { name: /Awaiting approval/i });
    fireEvent.click(chip);

    // The order group renders under its task name.
    await screen.findByText("Cloning reagents");
    expect(screen.getByTestId("orders-approvals-lens")).toBeInTheDocument();
    expect(screen.getByText("Taq polymerase")).toBeInTheDocument();
    expect(screen.getByText("dNTP mix")).toBeInTheDocument();

    // Approve the first row -> setPurchaseApproval fires for that item.
    const approveButtons = screen.getAllByTestId("lab-head-purchase-approval-toggle");
    fireEvent.click(approveButtons[0]);
    await waitFor(() => expect(setPurchaseApproval).toHaveBeenCalledTimes(1));
    expect(setPurchaseApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: "mira",
        targetOwner: "mira",
        purchaseItemId: 11,
        approved: true,
      }),
    );

    // Decline the second row -> declinePurchase fires for that item.
    const declineButtons = screen.getAllByTestId("lab-head-purchase-decline-button");
    fireEvent.click(declineButtons[1]);
    await waitFor(() => expect(declinePurchase).toHaveBeenCalledTimes(1));
    expect(declinePurchase).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: "mira",
        targetOwner: "mira",
        purchaseItemId: 12,
      }),
    );
  });

  it("mounts SpendingDashboard in the drawer when View spending is clicked", async () => {
    renderPage();

    const viewSpending = await screen.findByTestId("supplies-view-spending");
    // Closed by default.
    expect(screen.queryByTestId("spending-dashboard-stub")).not.toBeInTheDocument();

    fireEvent.click(viewSpending);

    // The drawer opens and SpendingDashboard mounts inside it.
    await screen.findByTestId("spending-dashboard-stub");
    expect(screen.getByTestId("living-popup")).toBeInTheDocument();
  });
});
