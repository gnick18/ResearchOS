import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";

/**
 * Supplies v2 chunk 7: with INVENTORY_ENABLED on, the legacy /inventory +
 * /purchases routes are retired and redirect into the unified /supplies page,
 * mapping their known deep-link params so the loop-strip / search intent
 * survives.
 *
 *   /inventory?signal=expiring|low|stale -> /supplies?filter=attention
 *   /purchases?stage=needs_ordering       -> /supplies?filter=onorder
 *   anything else                         -> /supplies
 *
 * The flag-OFF path (pages render their standalone content) is covered by the
 * purchases-page.misc-filter / shared-gate suites, which run with the flag off.
 */

vi.mock("@/lib/inventory/config", () => ({
  INVENTORY_ENABLED: true,
}));

const { replaceSpy, searchValue } = vi.hoisted(() => ({
  replaceSpy: vi.fn(),
  searchValue: { v: "" },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: replaceSpy }),
  useSearchParams: () => new URLSearchParams(searchValue.v),
  usePathname: () => "/inventory",
}));

import InventoryPage from "../inventory/page";
import PurchasesPage from "../purchases/page";

beforeEach(() => {
  replaceSpy.mockClear();
  searchValue.v = "";
});

describe("/inventory redirect (flag on)", () => {
  it("maps ?signal=expiring onto the attention filter", async () => {
    searchValue.v = "signal=expiring";
    render(<InventoryPage />);
    await waitFor(() =>
      expect(replaceSpy).toHaveBeenCalledWith("/supplies?filter=attention"),
    );
  });

  it("maps ?signal=low and ?signal=stale onto the attention filter", async () => {
    for (const sig of ["low", "stale"]) {
      replaceSpy.mockClear();
      searchValue.v = `signal=${sig}`;
      const { unmount } = render(<InventoryPage />);
      await waitFor(() =>
        expect(replaceSpy).toHaveBeenCalledWith("/supplies?filter=attention"),
      );
      unmount();
    }
  });

  it("redirects to the bare /supplies for no recognized param", async () => {
    render(<InventoryPage />);
    await waitFor(() => expect(replaceSpy).toHaveBeenCalledWith("/supplies"));
  });
});

describe("/purchases redirect (flag on)", () => {
  it("maps ?stage=needs_ordering onto the on-order filter", async () => {
    searchValue.v = "stage=needs_ordering";
    render(<PurchasesPage />);
    await waitFor(() =>
      expect(replaceSpy).toHaveBeenCalledWith("/supplies?filter=onorder"),
    );
  });

  it("redirects to the bare /supplies for other stages", async () => {
    searchValue.v = "stage=ordered";
    render(<PurchasesPage />);
    await waitFor(() => expect(replaceSpy).toHaveBeenCalledWith("/supplies"));
  });

  it("redirects to the bare /supplies for no param", async () => {
    render(<PurchasesPage />);
    await waitFor(() => expect(replaceSpy).toHaveBeenCalledWith("/supplies"));
  });
});
