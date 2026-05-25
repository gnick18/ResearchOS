// Mira PI R1 fix manager (Fix 4, 2026-05-25): toggle + single-active-
// tooltip semantics for `<WidgetHelpBadge>`. Pin the contract surfaced
// by the fresh-eyes verifier: clicking a badge a second time closes the
// tooltip (was a no-op before the fix); clicking a different badge
// while one is open closes the previous one and opens the new one
// (was leaving up to 13 tooltips open simultaneously).
//
// Cases:
//   (a) First click on a badge opens its tooltip.
//   (b) Second click on the SAME badge closes the tooltip.
//   (c) Clicking badge B while badge A is open closes A and opens B
//       (single-active-tooltip semantics).

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";

// Tooltip uses createPortal — render into the body directly so the
// portal's host node is always available in jsdom.
import WidgetHelpBadge, {
  _resetActiveBadgeRegistryForTest,
} from "./WidgetHelpBadge";

beforeEach(() => {
  _resetActiveBadgeRegistryForTest();
});

afterEach(() => {
  // Let RTL tear down portal hosts in-order, then reset the registry
  // so a leaked close-callback from a still-mounted node doesn't fire
  // into the next test.
  cleanup();
  _resetActiveBadgeRegistryForTest();
});

function getBadgeButton(name: RegExp): HTMLButtonElement {
  return screen.getByRole("button", { name }) as HTMLButtonElement;
}

describe("WidgetHelpBadge — click toggle + single-active-tooltip", () => {
  it("(a) opens the tooltip on first click", () => {
    render(<WidgetHelpBadge title="Announcements" body="Pinned posts." />);
    const btn = getBadgeButton(/what is the announcements widget/i);
    expect(btn.getAttribute("aria-expanded")).toBe("false");

    act(() => {
      btn.click();
    });

    expect(btn.getAttribute("aria-expanded")).toBe("true");
  });

  it("(b) closes the tooltip on second click of the same badge", () => {
    render(<WidgetHelpBadge title="Announcements" body="Pinned posts." />);
    const btn = getBadgeButton(/what is the announcements widget/i);

    act(() => {
      btn.click();
    });
    expect(btn.getAttribute("aria-expanded")).toBe("true");

    act(() => {
      btn.click();
    });
    expect(btn.getAttribute("aria-expanded")).toBe("false");
  });

  it("(c) clicking badge B while badge A is open closes A and opens B", () => {
    render(
      <>
        <WidgetHelpBadge title="Announcements" body="Pinned posts." />
        <WidgetHelpBadge title="Lab metrics" body="Cross-lab rollup." />
      </>,
    );
    const a = getBadgeButton(/what is the announcements widget/i);
    const b = getBadgeButton(/what is the lab metrics widget/i);

    act(() => {
      a.click();
    });
    expect(a.getAttribute("aria-expanded")).toBe("true");
    expect(b.getAttribute("aria-expanded")).toBe("false");

    act(() => {
      b.click();
    });
    expect(a.getAttribute("aria-expanded")).toBe("false");
    expect(b.getAttribute("aria-expanded")).toBe("true");
  });
});
