// Widget selector redesign (widget-selector bot, 2026-05-29): the rich
// card that replaces the old title + checkbox palette row.
//
// Pins the load-bearing behaviors from SELECTOR_REDESIGN §3:
//   1. The card renders the widget name + description.
//   2. When in view, the LIVE SnapshotTile preview mounts as the hero.
//   3. A SnapshotTile that THROWS is caught by the preview boundary and
//      the card falls back to the static glyph + description (the palette
//      keeps working; the throw does not propagate).
//   4. The Add affordance toggles: an unmounted widget shows "Add" and a
//      mounted widget shows "Added"; clicking fires onToggle exactly once.
//   5. The live preview region is aria-hidden + non-interactive so a
//      screen reader hears name/description, not the tile internals.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ComponentType } from "react";
import WidgetCard from "./WidgetCard";
import type {
  SnapshotTileProps,
  WidgetDefinition,
} from "./widgets/types";

// IntersectionObserver is not implemented in jsdom. Stub it so a card is
// reported "in view", which exercises the live-preview path. Real browser
// IO callbacks are always asynchronous; we mirror that with queueMicrotask
// so the resulting `setSeen(true)` re-render (and, in the throwing-tile
// case, the boundary's catch) runs as a normal scheduled update inside
// `act()` rather than synchronously during the observe() call.
class MockIO {
  cb: IntersectionObserverCallback;
  constructor(cb: IntersectionObserverCallback) {
    this.cb = cb;
  }
  observe(el: Element) {
    queueMicrotask(() =>
      this.cb(
        [{ isIntersecting: true, target: el } as IntersectionObserverEntry],
        this as unknown as IntersectionObserver,
      ),
    );
  }
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", MockIO as unknown as typeof IntersectionObserver);
  // Silence the expected boundary warning in the throwing-tile case.
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

// A minimal widget def whose SnapshotTile we control per-test.
function makeWidget(
  Tile: ComponentType<SnapshotTileProps>,
  over: Partial<WidgetDefinition> = {},
): WidgetDefinition {
  const Sidebar = () => null;
  return {
    id: "test-widget",
    toolId: "comments",
    title: "Lab comments",
    description: "Every comment thread across the lab, newest first.",
    SnapshotTile: Tile,
    SidebarTile: Sidebar,
    defaultLayout: { w: 4, h: 4 },
    surfaces: { canvas: true },
    memberVisible: true,
    ...over,
  };
}

describe("WidgetCard", () => {
  it("renders the widget name + description and mounts the live preview", async () => {
    const LiveTile = () => <div>LIVE_PREVIEW_CONTENT</div>;
    render(
      <WidgetCard
        widget={makeWidget(LiveTile)}
        isMounted={false}
        onToggle={() => {}}
      />,
    );
    expect(screen.getByText("Lab comments")).toBeInTheDocument();
    // The description renders in the card body (and, before the preview
    // mounts, also in the static placeholder hero), so query all.
    expect(
      screen.getAllByText(/Every comment thread across the lab/).length,
    ).toBeGreaterThanOrEqual(1);
    // The live tile mounts once the (async) IntersectionObserver reports
    // the hero in view, replacing the placeholder.
    expect(
      await screen.findByText("LIVE_PREVIEW_CONTENT"),
    ).toBeInTheDocument();
  });

  it("falls back to the static glyph + description when the live tile throws", async () => {
    const ThrowingTile = () => {
      throw new Error("tile blew up");
    };
    render(
      <WidgetCard
        widget={makeWidget(ThrowingTile)}
        isMounted={false}
        onToggle={() => {}}
      />,
    );
    // The card survives the throw: name + Add affordance stay present and
    // the boundary swaps the hero for the static description fallback (so
    // the description text is present in both the body + the fallback hero).
    expect(screen.getByText("Lab comments")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /add lab comments to canvas/i }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(
        screen.getAllByText(/Every comment thread across the lab/).length,
      ).toBeGreaterThanOrEqual(2);
    });
  });

  it("shows Add when unmounted and Added when mounted, firing onToggle once", () => {
    const LiveTile = () => <div>tile</div>;
    const onToggle = vi.fn();
    const widget = makeWidget(LiveTile);
    const { rerender } = render(
      <WidgetCard widget={widget} isMounted={false} onToggle={onToggle} />,
    );
    const addBtn = screen.getByRole("button", {
      name: /add lab comments to canvas/i,
    });
    expect(addBtn).toHaveTextContent("Add");
    expect(addBtn).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(addBtn);
    expect(onToggle).toHaveBeenCalledTimes(1);

    rerender(
      <WidgetCard widget={widget} isMounted={true} onToggle={onToggle} />,
    );
    const addedBtn = screen.getByRole("button", {
      name: /remove lab comments from canvas/i,
    });
    expect(addedBtn).toHaveTextContent("Added");
    expect(addedBtn).toHaveAttribute("aria-pressed", "true");
  });

  it("renders the live preview region as aria-hidden + non-interactive", () => {
    const LiveTile = () => <div>tile</div>;
    const { container } = render(
      <WidgetCard
        widget={makeWidget(LiveTile)}
        isMounted={false}
        onToggle={() => {}}
      />,
    );
    const hero = container.querySelector('[aria-hidden="true"].pointer-events-none');
    expect(hero).not.toBeNull();
  });

  it("disables the Add affordance when disabled (forward-compat store gate)", () => {
    const LiveTile = () => <div>tile</div>;
    const onToggle = vi.fn();
    render(
      <WidgetCard
        widget={makeWidget(LiveTile)}
        isMounted={false}
        onToggle={onToggle}
        disabled
      />,
    );
    const addBtn = screen.getByRole("button", {
      name: /add lab comments to canvas/i,
    });
    expect(addBtn).toBeDisabled();
  });
});
