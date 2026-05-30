// frontend/src/components/lab-overview/WidgetStoreModal.test.tsx
//
// Extension Store Phase U3 (extension-store U3 bot) coverage for the Widget
// store SHELL:
//   - renders one card per ELIGIBLE widget, preserving account + surface
//     gating (a member never sees a PI-only widget; a sidebar-only widget is
//     absent from the canvas store)
//   - the enable/disable toggle is wired to `setEnabled(id, !on)` with the
//     correct on/off state per widget
//   - a disabled (turned-off) widget renders greyed (the WidgetCard `disabled`
//     prop) with an "Off" badge; enabled widgets show "On"
//   - the request-a-widget stub link builds a valid prefilled GitHub URL
//
// `WidgetCard` is stubbed to a lightweight row so the store's logic (gating,
// toggle wiring, badge state) is tested without mounting live SnapshotTiles.
// `useEnabledWidgets` is mocked so the enabled set + setter are controllable.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { WidgetStoreModal } from "./WidgetStoreModal";
import { WIDGET_CATALOG } from "./widgets/registry";
import { visibleCatalog, widgetHasSurface } from "./widgets/types";

// Controllable enabled state + setter shared across a test.
const setEnabled = vi.fn(async () => {});
let enabledRaw: string[] | null = null;

vi.mock("@/hooks/useEnabledWidgets", () => ({
  useEnabledWidgets: () => ({ raw: enabledRaw, setEnabled }),
}));

// Stub WidgetCard to a minimal, deterministic row that surfaces the props the
// store drives: the title, the on/off via `isMounted`, the `disabled` flag,
// the badge, and a single toggle button.
// Partial mock: keep the real named exports the detail pane pulls from this
// module (WidgetPreviewBoundary, StaticHero, etc.) so it renders, but override
// the heavy default card with a deterministic row, and force useInViewport to
// report out-of-view so the live SnapshotTile is never mounted (and jsdom's
// missing IntersectionObserver is never touched). These are store-logic tests.
vi.mock("./WidgetCard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./WidgetCard")>();
  return {
    ...actual,
    useInViewport: () => false,
    default: ({
      widget,
      isMounted,
      disabled,
      onToggle,
      badgeSlot,
    }: {
      widget: { id: string; title: string };
      isMounted: boolean;
      disabled?: boolean;
      onToggle: () => void;
      badgeSlot?: React.ReactNode;
    }) => (
      <div data-widget-card-id={widget.id} data-on={isMounted ? "on" : "off"} data-disabled={disabled ? "yes" : "no"}>
        <span>{widget.title}</span>
        {badgeSlot}
        <button aria-label={`toggle ${widget.title}`} onClick={onToggle}>
          toggle
        </button>
      </div>
    ),
  };
});

beforeEach(() => {
  setEnabled.mockClear();
  enabledRaw = null; // absent => all enabled
});

function eligibleIds(
  accountType: "member" | "lab_head",
  surface: "canvas" | "home",
): string[] {
  return visibleCatalog(WIDGET_CATALOG, accountType, surface)
    .filter((w) => widgetHasSurface(w, surface))
    .map((w) => w.id);
}

describe("WidgetStoreModal", () => {
  it("renders one card per eligible widget, preserving account + surface gating", () => {
    render(
      <WidgetStoreModal
        username="mira"
        accountType="member"
        surfaceKey="canvas"
        onClose={() => {}}
      />,
    );
    const expected = eligibleIds("member", "canvas");
    const cards = screen.getAllByText("toggle");
    expect(cards.length).toBe(expected.length);
    // A PI-only widget (metrics) must NOT appear in a member's store.
    expect(
      document.querySelector('[data-widget-card-id="metrics"]'),
    ).toBeNull();
    // An eligible member widget IS present.
    expect(
      document.querySelector('[data-widget-card-id="announcements"]'),
    ).not.toBeNull();
  });

  it("shows PI-only widgets to a lab_head on the canvas surface", () => {
    render(
      <WidgetStoreModal
        username="alex"
        accountType="lab_head"
        surfaceKey="canvas"
        onClose={() => {}}
      />,
    );
    expect(
      document.querySelector('[data-widget-card-id="metrics"]'),
    ).not.toBeNull();
  });

  it("toggles a widget OFF (it was enabled) via setEnabled(id, false)", () => {
    render(
      <WidgetStoreModal
        username="mira"
        accountType="member"
        surfaceKey="canvas"
        onClose={() => {}}
      />,
    );
    // Absent enabled set => everything on. The announcements card shows "On".
    const card = document.querySelector(
      '[data-widget-card-id="announcements"]',
    ) as HTMLElement;
    expect(card.getAttribute("data-on")).toBe("on");
    expect(within(card).getByText("On")).toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", { name: /toggle/i }));
    expect(setEnabled).toHaveBeenCalledWith("announcements", false);
  });

  it("a disabled widget renders Off + greyed, and toggling it turns it back ON", () => {
    // Everything off EXCEPT we leave announcements out -> it reads as Off.
    enabledRaw = []; // empty = everything off
    render(
      <WidgetStoreModal
        username="mira"
        accountType="member"
        surfaceKey="canvas"
        onClose={() => {}}
      />,
    );
    const card = document.querySelector(
      '[data-widget-card-id="announcements"]',
    ) as HTMLElement;
    expect(card.getAttribute("data-on")).toBe("off");
    expect(within(card).getByText("Off")).toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", { name: /toggle/i }));
    expect(setEnabled).toHaveBeenCalledWith("announcements", true);
  });

  it("renders the request-a-widget stub with a valid prefilled GitHub URL", () => {
    render(
      <WidgetStoreModal
        username="mira"
        accountType="member"
        surfaceKey="canvas"
        onClose={() => {}}
      />,
    );
    const link = screen.getByRole("link", { name: /request a widget/i });
    const url = new URL(link.getAttribute("href") ?? "");
    expect(url.origin + url.pathname).toBe(
      "https://github.com/gnick18/ResearchOS/issues/new",
    );
    expect(url.searchParams.get("template")).toBe("feature.yml");
  });

  it("disables the toggles when signed out (username null)", () => {
    render(
      <WidgetStoreModal
        username={null}
        accountType="member"
        surfaceKey="canvas"
        onClose={() => {}}
      />,
    );
    const card = document.querySelector(
      '[data-widget-card-id="announcements"]',
    ) as HTMLElement;
    expect(card.getAttribute("data-disabled")).toBe("yes");
    // Clicking is a no-op when not curating.
    fireEvent.click(within(card).getByRole("button", { name: /toggle/i }));
    expect(setEnabled).not.toHaveBeenCalled();
  });
});
