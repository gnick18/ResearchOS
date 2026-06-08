// Regression for the BeakerSearch "Go to" rows. Every top-level NAV_ITEMS route
// renders a global command whose iconName is drawn through <Icon>, so each route
// MUST map to a REAL registry key. A new nav route added without an icon mapping
// (here: /inventory) previously fell back to a non-existent "concept" glyph,
// which crashed <Icon> on the very first palette open. <Icon> now degrades
// gracefully, but the mapping must still be complete + valid so the row shows a
// meaningful glyph rather than the neutral fallback.

import { describe, expect, it } from "vitest";
import { NAV_ICON_BY_HREF } from "../useGlobalCommands";
import { NAV_ITEMS } from "@/lib/nav";
import { ICONS } from "@/components/icons";

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
