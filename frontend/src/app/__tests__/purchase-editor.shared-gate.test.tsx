import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PurchaseItem } from "@/lib/types";

/**
 * Pins the second half of the /purchases destructive-surface gate (follow-up
 * to a87dfeb0 / ad0ad544). The parent chip gated the task-level delete +
 * complete buttons on the row header. This test pins the in-body write
 * affordances inside PurchaseEditor:
 *
 *   - `purchasesApi.create`         (Add row)
 *   - `purchasesApi.update`         (Edit row save)
 *   - `purchasesApi.delete`         (Per-row ✕)
 *   - `purchasesApi.updateCatalogItem` / `createCatalogItem`
 *
 * All four are CURRENT-USER scoped (no owner arg). On a shared purchase
 * task, an item written via any of them lands in the receiver's
 * `purchase_items/` directory under `task_id = task.id`. If the receiver
 * has an own task with the same numeric id, the items leak into the wrong
 * task; otherwise they orphan into a nonexistent task. Threading
 * `isSharedWithMe` into the editor + disabling the buttons closes this
 * without touching the purchasesApi surface (per AGENTS.md).
 */

const {
  purchasesApi,
  labApi,
} = vi.hoisted(() => ({
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

vi.mock("@/lib/local-api", () => ({
  purchasesApi,
  labApi,
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ currentUser: "alex" }),
}));

// Lab-manager ordering workflow (purchases-assignee fix, 2026-05-29): the
// per-item PurchaseAssigneePicker pulls lab roster + profile + archived
// data via these hooks (each reads the FileSystemProvider). Stub them so
// the editor renders without a real provider — the shared-gate assertions
// here are about write affordances, not the assignee picker.
vi.mock("@/hooks/useLabData", () => ({
  useLabData: () => ({ users: [], tasks: [], projects: [], isLoading: false, errorMessage: null, retry: () => {} }),
}));
vi.mock("@/hooks/useLabUserProfiles", () => ({
  useLabUserProfileMap: () => ({}),
}));
vi.mock("@/hooks/useArchivedUsers", () => ({
  useArchivedUsers: () => new Set<string>(),
}));

import PurchaseEditor from "@/components/PurchaseEditor";

function makeItem(overrides: Partial<PurchaseItem> = {}): PurchaseItem {
  return {
    id: 7,
    task_id: 42,
    item_name: "Primer mix",
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

function renderEditor(props: {
  isSharedWithMe?: boolean;
  ownerLabel?: string;
  username?: string;
}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <PurchaseEditor
        taskId={42}
        taskType="purchase"
        isSharedWithMe={props.isSharedWithMe}
        ownerLabel={props.ownerLabel}
        username={props.username}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PurchaseEditor — shared-task write gate", () => {
  it("renders the Add row + per-row Delete button enabled for an OWN purchase task", async () => {
    // Own task: items come from purchasesApi.listByTask (current-user
    // scope), no username plumbing required.
    purchasesApi.listByTask.mockResolvedValueOnce([
      makeItem({ id: 7, item_name: "Own primer" }),
    ]);

    renderEditor({ isSharedWithMe: false });

    // Add row visible — its + button is exposed via the "Add item"
    // Tooltip label/aria-label.
    const addBtn = await screen.findByRole("button", { name: /add item/i });
    expect(addBtn).toBeDisabled(); // disabled because item_name + quantity blank

    // Per-row delete is exposed via Tooltip label "Delete item".
    const deleteBtn = await screen.findByRole("button", { name: /^delete item$/i });
    expect(deleteBtn).not.toBeDisabled();
  });

  it("hides Add row and disables per-row Delete with owner-aware tooltip for a SHARED purchase task", async () => {
    // Shared task: items are read from the owner's data dir via labApi
    // (username plumbing), so the table is populated and viewable.
    labApi.getUserPurchaseItems.mockResolvedValueOnce([
      makeItem({ id: 7, item_name: "Shared primer" }),
    ]);

    renderEditor({
      isSharedWithMe: true,
      ownerLabel: "morgan",
      username: "morgan",
    });

    // Add row is hidden in shared mode — no "Add item" button.
    expect(screen.queryByRole("button", { name: /add item/i })).toBeNull();

    // Per-row Delete is visible but disabled + carries the owner-aware
    // label (matches the parent-chip aria-label pattern).
    const deleteBtn = await screen.findByRole("button", {
      name: /only the owner \(morgan\) can edit this shared purchase order/i,
    });
    expect(deleteBtn).toBeDisabled();

    // Clicking the disabled button must NOT invoke any write fn. jsdom
    // still dispatches onClick on disabled <button>, so this is the
    // belt-and-braces check the parent test established.
    fireEvent.click(deleteBtn);
    expect(purchasesApi.delete).not.toHaveBeenCalled();
    expect(purchasesApi.create).not.toHaveBeenCalled();
    expect(purchasesApi.update).not.toHaveBeenCalled();
    expect(purchasesApi.updateCatalogItem).not.toHaveBeenCalled();
    expect(purchasesApi.createCatalogItem).not.toHaveBeenCalled();
  });

  it("does not turn view-mode rows into click-to-edit triggers in shared mode", async () => {
    labApi.getUserPurchaseItems.mockResolvedValueOnce([
      makeItem({ id: 7, item_name: "Shared primer" }),
    ]);

    renderEditor({
      isSharedWithMe: true,
      ownerLabel: "morgan",
      username: "morgan",
    });

    // Clicking the row text in shared mode must NOT enter edit mode.
    // If it did, the editing input would render and a subsequent save
    // would call purchasesApi.update.
    const cell = await screen.findByText("Shared primer");
    fireEvent.click(cell);
    fireEvent.click(cell);

    // No edit input appears — the row stays in view mode.
    expect(screen.queryByPlaceholderText(/item name\.\.\./i)).toBeNull();
    expect(purchasesApi.update).not.toHaveBeenCalled();
  });

  it("falls back to a tooltip without an owner name when ownerLabel is omitted", async () => {
    labApi.getUserPurchaseItems.mockResolvedValueOnce([makeItem({ id: 7 })]);

    renderEditor({
      isSharedWithMe: true,
      username: "morgan",
      // ownerLabel intentionally omitted
    });

    // The fallback wording drops the "(<owner>)" parenthetical but
    // still carries the shared-edit gate.
    const deleteBtn = await screen.findByRole("button", {
      name: /^only the owner can edit this shared purchase order$/i,
    });
    expect(deleteBtn).toBeDisabled();
  });
});
