import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PurchaseItem } from "@/lib/types";

/**
 * PI capability revamp Phase 2 (sharing + collaboration manager, 2026-06-07):
 * row-level check that right-clicking a MEMBER's purchase line item opens the
 * shared context menu with the PI actions, while a non-PI (member) viewer's
 * right-click opens no PI menu (falls through). Mirrors the pi-gate harness;
 * the editor is wrapped in the real ContextMenuProvider so the shared menu
 * actually renders.
 */

const { purchasesApi, labApi } = vi.hoisted(() => ({
  purchasesApi: {
    listByTask: vi.fn(async () => [] as PurchaseItem[]),
    listAllIncludingShared: vi.fn(async () => []),
    listFundingAccounts: vi.fn(async () => []),
    searchCatalog: vi.fn(async () => []),
    create: vi.fn(async () => ({}) as PurchaseItem),
    update: vi.fn(async () => ({}) as PurchaseItem),
    delete: vi.fn(async () => {}),
    updateCatalogItem: vi.fn(async () => {}),
    createCatalogItem: vi.fn(async () => {}),
  },
  labApi: {
    getUserPurchaseItems: vi.fn(async () => [] as PurchaseItem[]),
  },
}));

vi.mock("@/lib/local-api", () => ({ purchasesApi, labApi }));

// Account-type swappable per test (lab head vs member).
const { accountTypeRef } = vi.hoisted(() => ({
  accountTypeRef: { current: "lab_head" as "lab_head" | "member" },
}));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ currentUser: "alex" }),
}));
vi.mock("@/hooks/useAccountType", () => ({
  useAccountType: () => accountTypeRef.current,
}));

vi.mock("@/hooks/useLabData", () => ({
  useLabData: () => ({ users: [], tasks: [], projects: [], isLoading: false, errorMessage: null, retry: () => {} }),
}));
vi.mock("@/hooks/useLabUserProfiles", () => ({
  useLabUserProfileMap: () => ({}),
}));
vi.mock("@/hooks/useArchivedUsers", () => ({
  useArchivedUsers: () => new Set<string>(),
}));

const { savePiRecordEdit } = vi.hoisted(() => ({
  savePiRecordEdit: vi.fn(async (args: { dataWrite: () => Promise<unknown> }) =>
    args.dataWrite(),
  ),
}));
vi.mock("@/lib/lab/pi-record-edit", () => ({ savePiRecordEdit }));

import { clearPiEditConfirmations } from "@/lib/lab/pi-edit-guard";
import PurchaseEditor from "@/components/PurchaseEditor";
import { ContextMenuProvider } from "@/components/context-menu/ContextMenuProvider";

function makeItem(overrides: Partial<PurchaseItem> = {}): PurchaseItem {
  return {
    id: 7,
    task_id: 42,
    item_name: "Morgan primer",
    quantity: 2,
    link: null,
    cas: null,
    price_per_unit: 50,
    shipping_fees: 0,
    total_price: 100,
    notes: null,
    funding_string: null,
    vendor: null,
    catalog_number: null,
    category: null,
    ...overrides,
  };
}

function renderEditor() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ContextMenuProvider>
        <PurchaseEditor taskId={42} taskType="purchase" readOnly username="morgan" />
      </ContextMenuProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  clearPiEditConfirmations();
  accountTypeRef.current = "lab_head";
});

describe("PurchaseEditor PI right-click menu on member rows", () => {
  it("opens the PI action menu when a lab head right-clicks a member's row", async () => {
    labApi.getUserPurchaseItems.mockResolvedValue([makeItem()]);
    renderEditor();

    const cell = await screen.findByText("Morgan primer");
    const row = cell.closest("tr")!;
    fireEvent.contextMenu(row);

    // The shared SequenceContextMenu renders the PI items. Scope queries to
    // the menu so they do not collide with the row's own approval controls.
    const menu = await screen.findByTestId("sequence-context-menu");
    const { getByText } = within(menu);
    expect(getByText("Edit as lab head")).toBeTruthy();
    // Pending item: both Approve and Decline are offered.
    expect(getByText("Approve")).toBeTruthy();
    expect(getByText("Decline")).toBeTruthy();
  });

  it("opens no PI menu when a member (non-PI) right-clicks the same row", async () => {
    accountTypeRef.current = "member";
    labApi.getUserPurchaseItems.mockResolvedValue([makeItem()]);
    renderEditor();

    const cell = await screen.findByText("Morgan primer");
    const row = cell.closest("tr")!;
    fireEvent.contextMenu(row);

    // No PI menu: the shared menu never opens for a non-PI viewer.
    await waitFor(() => {
      expect(screen.queryByTestId("sequence-context-menu")).toBeNull();
    });
    expect(screen.queryByText("Edit as lab head")).toBeNull();
  });
});
