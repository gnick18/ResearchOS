// @vitest-environment jsdom
//
// Supplies v2 chunk 7: with INVENTORY_ENABLED on, the BeakerSearch "Go to" rows
// collapse the legacy /inventory + /purchases routes into a single unified
// "Go to Supplies" row pointing at /supplies, mirroring the AppShell nav
// collapse. This pins that behavior with the flag forced on.

import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

vi.mock("@/lib/inventory/config", () => ({ INVENTORY_ENABLED: true }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  // A path matching no NAV route so no "Go to" row is suppressed as same-route.
  usePathname: () => "/settings",
}));
vi.mock("@/lib/theme/use-theme", () => ({
  useTheme: () => ({ resolved: "light", setTheme: vi.fn() }),
}));

import { NAV_ICON_BY_HREF, useGlobalCommands } from "../useGlobalCommands";
import { ICONS } from "@/components/icons";

describe("useGlobalCommands — Supplies collapse (flag on)", () => {
  it("collapses Inventory + Purchases into a single Go to Supplies row", () => {
    const { result } = renderHook(() => useGlobalCommands());
    const ids = result.current.map((cmd) => cmd.id);

    expect(ids).toContain("goto-/supplies");
    // The two legacy routes no longer get their own rows under the flag.
    expect(ids).not.toContain("goto-/inventory");
    expect(ids).not.toContain("goto-/purchases");
    // Sibling routes still render, so this is a collapse, not a broken list.
    expect(ids).toContain("goto-/workbench");
  });

  it("maps /supplies to a real registry icon", () => {
    const icon = NAV_ICON_BY_HREF["/supplies"];
    expect(icon).toBeTruthy();
    expect(ICONS[icon as keyof typeof ICONS]).toBeTruthy();
  });
});
