import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PurchaseItem } from "@/lib/types";

/**
 * PI capability revamp Phase 1 (2026-06-07): pins the PurchaseEditor PI-edit
 * gate. A lab head viewing a MEMBER's purchase order (lab read-only mode) can
 * edit a line item inline, but only after crossing a once-per-session confirm.
 * Until then the row is read-only. After confirm, the save routes to the OWNER's
 * folder AND lands an audit entry (savePiRecordEdit).
 *
 * Mirrors the harness in purchase-editor.shared-gate.test.tsx, with
 * useAccountType stubbed to "lab_head" and the heavy file-system graph mocked.
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

// Purchase items on Loro (PURCHASE_LORO_ENABLED, now on in prod): the row's
// read handle (chunk 2) and the save write (chunk 3) route through Loro. Stub
// the read hook to a no-op handle and capture the write-through so the gate +
// audit flow is exercised under the real flag-on path without standing up the
// Loro/WASM graph. The write-through merge mirrors what the legacy update gave.
const { writeThroughLoro } = vi.hoisted(() => ({
  writeThroughLoro: vi.fn(
    async (_owner: string, _id: number, patch: Record<string, unknown>) => ({
      id: 7,
      item_name: (patch.item_name as string) ?? "Primer mix",
      ...patch,
    }),
  ),
}));
vi.mock("@/lib/loro/use-purchase-row-loro", () => ({
  usePurchaseRowLoro: () => ({ handle: null, opening: false, ephemeral: null }),
}));
vi.mock("@/lib/loro/purchase-write-through", () => ({
  writePurchaseUpdateThroughLoro: (...a: unknown[]) =>
    (writeThroughLoro as (...a: unknown[]) => unknown)(...a),
}));

// Active user is the lab head "alex" viewing member "morgan"'s order.
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ currentUser: "alex" }),
}));
vi.mock("@/hooks/useAccountType", () => ({
  useAccountType: () => "lab_head",
}));

// PurchaseAssigneePicker data hooks — stub like the shared-gate test does.
vi.mock("@/hooks/useLabData", () => ({
  useLabData: () => ({ users: [], tasks: [], projects: [], isLoading: false, errorMessage: null, retry: () => {} }),
}));
vi.mock("@/hooks/useLabUserProfiles", () => ({
  useLabUserProfileMap: () => ({}),
}));
vi.mock("@/hooks/useArchivedUsers", () => ({
  useArchivedUsers: () => new Set<string>(),
}));

// pi-record-edit pulls pi-actions (heavy graph) for the session constant, and
// pi-audit for the write. Mock both: capture the savePiRecordEdit calls and run
// their dataWrite so the underlying purchasesApi.update still fires.
const { savePiRecordEdit } = vi.hoisted(() => ({
  savePiRecordEdit: vi.fn(async (args: { dataWrite: () => Promise<unknown> }) =>
    args.dataWrite(),
  ),
}));
vi.mock("@/lib/lab/pi-record-edit", () => ({ savePiRecordEdit }));

import { clearPiEditConfirmations } from "@/lib/lab/pi-edit-guard";
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
    category: null,
    ...overrides,
  };
}

function renderEditor() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  // Lab read-only view of member "morgan"'s purchase order: readOnly + username.
  return render(
    <QueryClientProvider client={client}>
      <PurchaseEditor taskId={42} taskType="purchase" readOnly username="morgan" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  clearPiEditConfirmations();
});

describe("PurchaseEditor — PI edit gate", () => {
  it("keeps the member's row read-only until the PI confirms, then edits + audits", async () => {
    labApi.getUserPurchaseItems.mockResolvedValue([
      makeItem({ id: 7, item_name: "Morgan primer" }),
    ]);

    renderEditor();

    const cell = await screen.findByText("Morgan primer");

    // First click on a not-yet-confirmed row opens the are-you-sure dialog and
    // does NOT make the row editable (no input rendered).
    fireEvent.click(cell);
    expect(await screen.findByTestId("pi-edit-confirm-dialog")).toBeTruthy();
    expect(screen.queryByPlaceholderText(/item name\.\.\./i)).toBeNull();
    expect(purchasesApi.update).not.toHaveBeenCalled();

    // Confirm: the dialog closes and the editor row opens (input appears).
    fireEvent.click(screen.getByTestId("pi-edit-confirm-button"));
    const input = await screen.findByPlaceholderText(/item name\.\.\./i);
    expect((input as HTMLInputElement).value).toBe("Morgan primer");

    // Edit a field and save — routes through savePiRecordEdit (audited) and the
    // underlying write targets morgan's folder.
    fireEvent.change(input, { target: { value: "Morgan primer v2" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(savePiRecordEdit).toHaveBeenCalledOnce());
    const call = savePiRecordEdit.mock.calls[0][0] as unknown as {
      targetOwner: string;
      actor: string;
      recordType: string;
      recordId: number;
    };
    expect(call.targetOwner).toBe("morgan");
    expect(call.actor).toBe("alex");
    // Audit record_type for a purchase is "purchase_item" (Phase 4 pass B
    // standardized it so a purchase's content edits group with the approve /
    // decline rows in the audit log via auditRecordTypeFor).
    expect(call.recordType).toBe("purchase_item");
    expect(call.recordId).toBe(7);
    // The dataWrite ran the real owner-routed update. PURCHASE_LORO_ENABLED is
    // on in prod, so the save routes through the Loro write-through targeting
    // morgan's folder (owner, id, payload, actor) rather than the legacy update.
    await waitFor(() =>
      expect(writeThroughLoro).toHaveBeenCalledWith(
        "morgan",
        7,
        expect.objectContaining({ item_name: "Morgan primer v2" }),
        "alex",
      ),
    );
    expect(purchasesApi.update).not.toHaveBeenCalled();
  });
});
