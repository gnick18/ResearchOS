import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { WidgetStoreDetail } from "./WidgetStoreDetail";
import type { WidgetDefinition } from "./widgets/types";

/**
 * Widget store detail-pane tests (Extension Store Phase D). Verify the large
 * live preview mounts, the blurb + metadata render, and the footer toggle
 * routes through the same setter the card uses.
 */

function fakeWidget(overrides: Partial<WidgetDefinition> = {}): WidgetDefinition {
  const Tile = () => <div>LIVE-PREVIEW-BODY</div>;
  const Sidebar = () => <div>sidebar</div>;
  return {
    id: "demo-widget",
    title: "Demo widget",
    description: "Shows a demo stat.",
    helpText: "Use this when you want a demo.",
    toolId: "demo-tool-unregistered",
    SnapshotTile: Tile,
    SidebarTile: Sidebar,
    defaultLayout: { w: 1, h: 1 },
    surfaces: { canvas: true, home: true },
    memberVisible: true,
    labHeadVisible: true,
    ...overrides,
  } as unknown as WidgetDefinition;
}

afterEach(cleanup);

describe("WidgetStoreDetail", () => {
  it("mounts the large live preview (SnapshotTile) when in view", () => {
    // jsdom has no IntersectionObserver, so useInViewport mounts immediately.
    render(
      <WidgetStoreDetail
        widget={fakeWidget()}
        on={false}
        curating
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByText("LIVE-PREVIEW-BODY")).toBeInTheDocument();
  });

  it("renders the description + helpText blurb", () => {
    render(
      <WidgetStoreDetail
        widget={fakeWidget()}
        on={false}
        curating
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByText("Shows a demo stat.")).toBeInTheDocument();
    expect(
      screen.getByText("Use this when you want a demo."),
    ).toBeInTheDocument();
  });

  it("renders metadata: supported surfaces + visibility", () => {
    render(
      <WidgetStoreDetail
        widget={fakeWidget()}
        on={false}
        curating
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByText("Lab overview canvas")).toBeInTheDocument();
    expect(screen.getByText("Home")).toBeInTheDocument();
    // No sidebar surface set, so it must not appear.
    expect(screen.queryByText("Sidebar rail")).not.toBeInTheDocument();
    expect(screen.getByText("PI and lab members")).toBeInTheDocument();
  });

  it("PI-only visibility when the widget is not member-visible", () => {
    render(
      <WidgetStoreDetail
        widget={fakeWidget({ memberVisible: false })}
        on={false}
        curating
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByText("PI only")).toBeInTheDocument();
  });

  it("toggles enablement via the footer switch", () => {
    const onToggle = vi.fn();
    render(
      <WidgetStoreDetail
        widget={fakeWidget()}
        on={false}
        curating
        onToggle={onToggle}
      />,
    );
    fireEvent.click(screen.getByRole("switch"));
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it("disables the toggle when not curating", () => {
    const onToggle = vi.fn();
    render(
      <WidgetStoreDetail
        widget={fakeWidget()}
        on
        curating={false}
        onToggle={onToggle}
      />,
    );
    const sw = screen.getByRole("switch");
    expect(sw).toBeDisabled();
    fireEvent.click(sw);
    expect(onToggle).not.toHaveBeenCalled();
  });
});
