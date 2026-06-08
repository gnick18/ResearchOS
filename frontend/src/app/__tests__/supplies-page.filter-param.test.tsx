import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * Supplies v2 chunk 7: /supplies reads a `?filter=all|attention|onorder` URL
 * param and seeds the filter chip on load, so the retired /inventory +
 * /purchases routes can map their legacy deep-links (?signal=, ?stage=) into
 * the unified surface. This pins that seeding.
 */

// The whole /supplies route is behind INVENTORY_ENABLED; force it on so the
// page renders instead of the "not enabled" placeholder.
vi.mock("@/lib/inventory/config", () => ({
  INVENTORY_ENABLED: true,
}));

// next/navigation: useSearchParams returns the per-test param string; useRouter
// is unused by the page itself but provided for safety.
const { searchValue } = vi.hoisted(() => ({ searchValue: { v: "" } }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(searchValue.v),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/supplies",
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

// Members get the default per-supply chips (no lab-head lens). This keeps the
// seedable chip set to all | attention | onorder.
vi.mock("@/hooks/useIsLabHead", () => ({
  useIsLabHead: () => false,
}));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ currentUser: "alex" }),
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
vi.mock("@/components/supplies/SupplyDetailPanel", () => ({
  default: () => null,
}));
vi.mock("@/components/supplies/ReorderCartReview", () => ({
  default: () => null,
}));

// The page registers a BeakerSearch source on mount; this test renders the page
// in isolation (AppShell stubbed, so no BeakerSearchProvider). Stub the
// registration hook so the page mounts without the provider (the source itself
// is unit-tested in supplies-beaker-source.test.ts).
vi.mock("@/app/supplies/useSuppliesBeakerSource", () => ({
  useSuppliesBeakerSource: () => {},
}));

// The right-click PI menu hook reaches for the PI-menu context; stub it to the
// shape the page consumes (handleContextMenu + a modals node).
vi.mock("@/hooks/usePiRecordMenu", () => ({
  usePiRecordMenu: () => ({ handleContextMenu: vi.fn(), modals: null }),
}));

import SuppliesPage from "../supplies/page";

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
  searchValue.v = "";
});

describe("SuppliesPage — ?filter= deep-link seeding", () => {
  it("defaults to the All filter with no param", async () => {
    renderPage();
    const all = await screen.findByRole("tab", { name: /^All/i });
    expect(all.getAttribute("aria-selected")).toBe("true");
  });

  it("seeds the On order filter from ?filter=onorder", async () => {
    searchValue.v = "filter=onorder";
    renderPage();
    const onorder = await screen.findByRole("tab", { name: /On order/i });
    expect(onorder.getAttribute("aria-selected")).toBe("true");
    const all = screen.getByRole("tab", { name: /^All/i });
    expect(all.getAttribute("aria-selected")).toBe("false");
  });

  it("seeds the Needs attention filter from ?filter=attention", async () => {
    searchValue.v = "filter=attention";
    renderPage();
    const attention = await screen.findByRole("tab", { name: /Needs attention/i });
    expect(attention.getAttribute("aria-selected")).toBe("true");
  });

  it("falls back to All for an unknown filter value", async () => {
    searchValue.v = "filter=bogus";
    renderPage();
    const all = await screen.findByRole("tab", { name: /^All/i });
    expect(all.getAttribute("aria-selected")).toBe("true");
  });
});
