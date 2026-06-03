import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Project, PurchaseItem } from "@/lib/types";

/**
 * Pins the F1 (Purchases manager 2026-05-22) item-name autocomplete
 * contract on `NewPurchaseModal`:
 *
 *   - The Item Name datalist is populated from prior PurchaseItems
 *     returned by `purchasesApi.listAll()`.
 *   - The list is de-duped by item name (case-insensitive). Within a
 *     name group, the highest-id entry wins (proxy for most-recent).
 *   - Picking a prior item (typing the exact name) auto-fills the
 *     Vendor and Price fields.
 *   - The Quantity field stays at the user-default ("1").
 *   - The Funding String field stays untouched.
 */

const realProject: Project = {
  id: 7,
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

const priorItems: PurchaseItem[] = [
  {
    id: 1,
    task_id: 100,
    item_name: "Premium Costa Rica Coffee Beans",
    quantity: 2,
    link: null,
    cas: null,
    price_per_unit: 18.99,
    shipping_fees: 0,
    total_price: 37.98,
    notes: null,
    funding_string: "Old funding",
    vendor: "BeakerBot's Boutique",
    category: null,
  },
  {
    id: 5,
    task_id: 105,
    item_name: "premium costa rica coffee beans", // dup lowercase
    quantity: 1,
    link: null,
    cas: null,
    price_per_unit: 19.5, // newer price (id=5 > id=1)
    shipping_fees: 0,
    total_price: 19.5,
    notes: null,
    funding_string: null,
    vendor: "BeakerBot's Boutique v2",
    category: null,
  },
  {
    id: 3,
    task_id: 110,
    item_name: "12-well plates",
    quantity: 1,
    link: null,
    cas: null,
    price_per_unit: 42,
    shipping_fees: 0,
    total_price: 42,
    notes: null,
    funding_string: null,
    vendor: "Sigma-Aldrich",
    category: null,
  },
];

const {
  tasksApiCreate,
  purchasesApiCreate,
  purchasesApiListAll,
  purchasesApiListFunding,
  purchasesApiCreateFunding,
  fetchAllProjectsIncludingShared,
  ensureMiscProject,
} = vi.hoisted(() => ({
  tasksApiCreate: vi.fn(async () => ({ id: 1000 })),
  purchasesApiCreate: vi.fn(async () => ({ id: 2000 })),
  // Typed as PurchaseItem[] so `.mockResolvedValue(priorItems)` in
  // beforeEach narrows correctly; without the cast, vi.fn infers the
  // default return as never[] and rejects the typed seed.
  purchasesApiListAll: vi.fn() as ReturnType<typeof vi.fn> & {
    mockResolvedValue: (value: PurchaseItem[]) => unknown;
  },
  purchasesApiListFunding: vi.fn(async () => []),
  purchasesApiCreateFunding: vi.fn(async () => ({ id: 1 })),
  fetchAllProjectsIncludingShared: vi.fn(),
  ensureMiscProject: vi.fn(),
}));

vi.mock("@/lib/local-api", () => ({
  tasksApi: { create: tasksApiCreate },
  purchasesApi: {
    create: purchasesApiCreate,
    listAll: purchasesApiListAll,
    listFundingAccounts: purchasesApiListFunding,
    createFundingAccount: purchasesApiCreateFunding,
  },
  fetchAllProjectsIncludingShared,
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ currentUser: "alex" }),
}));

vi.mock("@/lib/purchases/misc-project", async () => {
  const actual = await vi.importActual<typeof import("@/lib/purchases/misc-project")>(
    "@/lib/purchases/misc-project",
  );
  return {
    ...actual,
    ensureMiscProject,
  };
});

import NewPurchaseModal, {
  buildPriorItemEntries,
  buildRecentItemEntries,
} from "../NewPurchaseModal";

function renderModal() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <NewPurchaseModal open onClose={() => {}} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // The modal persists a draft to sessionStorage; clear it so a filled
  // form from one test (e.g. the reorder-row click) never restores into
  // the next test's fresh render.
  try {
    window.sessionStorage.clear();
  } catch {
    /* jsdom may not expose sessionStorage in every config; ignore. */
  }
  fetchAllProjectsIncludingShared.mockResolvedValue([realProject]);
  ensureMiscProject.mockResolvedValue(null);
  purchasesApiListAll.mockResolvedValue(priorItems);
});

describe("buildPriorItemEntries — pure dedupe contract", () => {
  it("returns one entry per case-insensitive item name", () => {
    const entries = buildPriorItemEntries(priorItems);
    const names = entries.map((e) => e.itemName.toLowerCase());
    const uniqueNames = new Set(names);
    expect(names.length).toBe(uniqueNames.size);
  });

  it("keeps the highest-id record's vendor + price within a name group", () => {
    const entries = buildPriorItemEntries(priorItems);
    const coffee = entries.find(
      (e) => e.itemName.toLowerCase() === "premium costa rica coffee beans",
    );
    expect(coffee).toBeTruthy();
    // id=5 wins over id=1.
    expect(coffee?.sourceId).toBe(5);
    expect(coffee?.vendor).toBe("BeakerBot's Boutique v2");
    expect(coffee?.pricePerUnit).toBe(19.5);
  });

  it("drops blank / whitespace-only item names", () => {
    const entries = buildPriorItemEntries([
      { id: 1, item_name: "", vendor: null, price_per_unit: 0 },
      { id: 2, item_name: "   ", vendor: null, price_per_unit: 0 },
      { id: 3, item_name: "ok", vendor: null, price_per_unit: 5 },
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0].itemName).toBe("ok");
  });

  it("sorts entries alphabetically", () => {
    const entries = buildPriorItemEntries(priorItems);
    const names = entries.map((e) => e.itemName);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });
});

describe("buildRecentItemEntries — recency quick-pick contract", () => {
  it("ranks distinct items newest-first by most-recent record id", () => {
    const recent = buildRecentItemEntries(priorItems);
    // Coffee's newest record is id=5 (> 12-well plates' id=3), so coffee
    // leads. The collapsed coffee entry carries the id=5 record's exact
    // (lowercase) name, since the highest-id record wins the dedupe.
    expect(recent.map((e) => e.itemName)).toEqual([
      "premium costa rica coffee beans",
      "12-well plates",
    ]);
    // The pinned vendor/price reflect the most-recent coffee record (id=5).
    expect(recent[0].vendor).toBe("BeakerBot's Boutique v2");
    expect(recent[0].pricePerUnit).toBe(19.5);
  });

  it("caps the list at the requested limit", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      id: i + 1,
      item_name: `Item ${i + 1}`,
      vendor: null,
      price_per_unit: i,
    }));
    expect(buildRecentItemEntries(many, 5)).toHaveLength(5);
    // Newest ids lead.
    expect(buildRecentItemEntries(many, 3).map((e) => e.itemName)).toEqual([
      "Item 9",
      "Item 8",
      "Item 7",
    ]);
  });
});

describe("NewPurchaseModal — one-tap reorder row", () => {
  it("renders a reorder chip per recent item and fills the form on tap", async () => {
    renderModal();
    await waitFor(() => {
      expect(purchasesApiListAll).toHaveBeenCalled();
    });
    const row = await waitFor(() => {
      const el = document.querySelector(
        '[data-tour-target="purchases-form-reorder"]',
      );
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    const chips = row.querySelectorAll("button");
    expect(chips.length).toBe(2);

    act(() => {
      fireEvent.click(chips[0]);
    });

    await waitFor(() => {
      const name = document.querySelector(
        '[data-tour-target="purchases-form-name"]',
      ) as HTMLInputElement | null;
      const vendor = document.querySelector(
        '[data-tour-target="purchases-form-vendor"]',
      ) as HTMLInputElement | null;
      const price = document.querySelector(
        '[data-tour-target="purchases-form-price"]',
      ) as HTMLInputElement | null;
      expect(name?.value).toBe("premium costa rica coffee beans");
      expect(vendor?.value).toBe("BeakerBot's Boutique v2");
      expect(price?.value).toBe("19.50");
    });
  });
});

describe("NewPurchaseModal — Item Name autocomplete", () => {
  it("renders a datalist option per de-duped prior item", async () => {
    renderModal();
    await waitFor(() => {
      expect(purchasesApiListAll).toHaveBeenCalled();
    });
    // The datalist has 2 options (coffee beans + 12-well plates) since
    // the duplicate coffee name collapses.
    const datalist = document.querySelector(
      `datalist[id="new-purchase-item-name-options"]`,
    );
    expect(datalist).toBeTruthy();
    await waitFor(() => {
      const options = datalist!.querySelectorAll("option");
      expect(options.length).toBe(2);
    });
  });

  it("auto-fills vendor + price when the user types an exact prior name", async () => {
    renderModal();
    // Wait for the datalist to actually populate (i.e. the React Query
    // resolves and the modal re-renders with priorItems in scope). Only
    // after that does the input's onChange handler have data to match
    // against.
    await waitFor(() => {
      const datalist = document.querySelector(
        `datalist[id="new-purchase-item-name-options"]`,
      );
      expect(datalist?.querySelectorAll("option").length ?? 0).toBeGreaterThan(0);
    });
    const itemNameInput = screen.getByPlaceholderText(
      /12-well plates/i,
    ) as HTMLInputElement;
    act(() => {
      fireEvent.change(itemNameInput, {
        target: { value: "Premium Costa Rica Coffee Beans" },
      });
    });
    await waitFor(() => {
      const vendor = document.querySelector(
        '[data-tour-target="purchases-form-vendor"]',
      ) as HTMLInputElement | null;
      const price = document.querySelector(
        '[data-tour-target="purchases-form-price"]',
      ) as HTMLInputElement | null;
      expect(vendor?.value).toBe("BeakerBot's Boutique v2");
      expect(price?.value).toBe("19.50");
    });
  });

  it("leaves quantity at the default '1' on autocomplete", async () => {
    renderModal();
    await waitFor(() => {
      const datalist = document.querySelector(
        `datalist[id="new-purchase-item-name-options"]`,
      );
      expect(datalist?.querySelectorAll("option").length ?? 0).toBeGreaterThan(0);
    });
    const itemNameInput = screen.getByPlaceholderText(
      /12-well plates/i,
    ) as HTMLInputElement;
    act(() => {
      fireEvent.change(itemNameInput, {
        target: { value: "Premium Costa Rica Coffee Beans" },
      });
    });
    await waitFor(() => {
      const quantity = document.querySelector(
        '[data-tour-target="purchases-form-quantity"]',
      ) as HTMLInputElement | null;
      expect(quantity?.value).toBe("1");
    });
  });

  it("does NOT auto-fill on a partial / non-matching name", async () => {
    renderModal();
    await waitFor(() => {
      expect(purchasesApiListAll).toHaveBeenCalled();
    });
    const itemNameInput = screen.getByPlaceholderText(
      /12-well plates/i,
    ) as HTMLInputElement;
    act(() => {
      fireEvent.change(itemNameInput, { target: { value: "coff" } });
    });
    // The vendor + price fields should remain empty.
    await waitFor(() => {
      expect(itemNameInput.value).toBe("coff");
    });
    const vendor = document.querySelector(
      '[data-tour-target="purchases-form-vendor"]',
    ) as HTMLInputElement | null;
    const price = document.querySelector(
      '[data-tour-target="purchases-form-price"]',
    ) as HTMLInputElement | null;
    expect(vendor?.value ?? "").toBe("");
    expect(price?.value ?? "").toBe("");
  });
});
