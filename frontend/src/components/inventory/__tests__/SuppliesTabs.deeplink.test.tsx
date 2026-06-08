// Supplies hub loop-strip: the three glance counts (expiring soon / low or
// empty / to order) are clickable deep-links that jump to the matching filtered
// view. This pins the hrefs so the strip stays actionable (the Inventory /
// Purchases pages read these params to seed their filter).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Flag ON so the hub chrome renders (it returns null when off).
vi.mock("@/lib/inventory/config", () => ({ INVENTORY_ENABLED: true }));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ currentUser: "alex" }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/inventory",
  // FixtureLink reads useSearchParams to carry through fixture-capture params.
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/local-api", () => ({
  fetchAllInventoryItemsIncludingShared: vi.fn(async () => []),
  fetchAllInventoryStocksIncludingShared: vi.fn(async () => []),
  purchasesApi: { listAllIncludingShared: vi.fn(async () => []) },
}));

import SuppliesTabs from "../SuppliesTabs";

function renderHub() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <SuppliesTabs />
    </QueryClientProvider>,
  );
}

describe("SuppliesTabs loop strip deep-links", () => {
  beforeEach(() => cleanup());

  it("renders the three glance counts as links to their filtered views", () => {
    renderHub();
    const expiring = screen.getByRole("link", { name: /expiring soon/i });
    expect(expiring.getAttribute("href")).toBe("/inventory?signal=expiring");
    const low = screen.getByRole("link", { name: /low or empty/i });
    expect(low.getAttribute("href")).toBe("/inventory?signal=low");
    const toOrder = screen.getByRole("link", { name: /to order/i });
    expect(toOrder.getAttribute("href")).toBe("/purchases?stage=needs_ordering");
  });

  it("still renders the two working tabs", () => {
    renderHub();
    expect(screen.getByRole("link", { name: "Inventory" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Purchases" })).toBeTruthy();
  });
});
