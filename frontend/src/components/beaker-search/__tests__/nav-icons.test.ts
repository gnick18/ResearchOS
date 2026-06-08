// @vitest-environment jsdom
//
// Regression for the BeakerSearch "Go to" rows. Every top-level NAV_ITEMS route
// renders a global command whose iconName is drawn through <Icon>, so each route
// MUST map to a REAL registry key. A new nav route added without an icon mapping
// (here: /inventory) previously fell back to a non-existent "concept" glyph,
// which crashed <Icon> on the very first palette open. <Icon> now degrades
// gracefully, but the mapping must still be complete + valid so the row shows a
// meaningful glyph rather than the neutral fallback.

import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { NAV_ICON_BY_HREF, useGlobalCommands } from "../useGlobalCommands";
import { NAV_ITEMS } from "@/lib/nav";
import { ICONS } from "@/components/icons";
import { INVENTORY_ENABLED } from "@/lib/inventory/config";

// The global command list is built under the Next router + theme. Stub both so
// the hook renders in isolation, no provider tree needed.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  // Return a path that matches no NAV_ITEMS route so no "Go to" row is
  // suppressed during the icon-coverage check.
  usePathname: () => "/settings",
}));
vi.mock("@/lib/theme/use-theme", () => ({
  useTheme: () => ({ resolved: "light", setTheme: vi.fn() }),
}));

describe("NAV_ICON_BY_HREF", () => {
  it("maps every NAV_ITEMS route to a registered icon", () => {
    for (const item of NAV_ITEMS) {
      const icon = NAV_ICON_BY_HREF[item.href];
      expect(icon, `no icon mapping for nav route ${item.href}`).toBeTruthy();
      expect(
        ICONS[icon as keyof typeof ICONS],
        `nav route ${item.href} maps to unregistered icon "${icon}"`,
      ).toBeTruthy();
    }
  });

  it("only references real registry keys (no phantom glyphs)", () => {
    for (const [href, icon] of Object.entries(NAV_ICON_BY_HREF)) {
      expect(
        ICONS[icon as keyof typeof ICONS],
        `${href} -> "${icon}" is not in the icon registry`,
      ).toBeTruthy();
    }
  });
});

describe("useGlobalCommands flag gating", () => {
  it("omits the Inventory 'Go to' row while INVENTORY_ENABLED is off", () => {
    // Guard against the flag being flipped on under us: this assertion only
    // proves the gate when the flag is actually off (its default on main).
    expect(INVENTORY_ENABLED).toBe(false);

    const { result } = renderHook(() => useGlobalCommands());
    const ids = result.current.map((cmd) => cmd.id);

    expect(ids).not.toContain("goto-/inventory");
    // Sibling routes still render, so this is gating, not a broken list.
    expect(ids).toContain("goto-/workbench");
  });
});
