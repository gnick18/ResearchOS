// Widget selector redesign (widget-selector bot, 2026-05-29): the
// "+ Add widget" palette now renders a rich card grid instead of a flat
// title + checkbox list.
//
// Pins the contract that the redesign must preserve (SELECTOR_REDESIGN §3):
//   1. Opening the palette renders one card per ELIGIBLE catalog widget.
//   2. Account/surface gating is unchanged: a labHead-only widget
//      (memberVisible: false) is ABSENT from a member's palette and a
//      surface-mismatched widget (canvas-only) is absent from the home
//      surface. The redesign reuses `visibleCatalog` + `widgetHasSurface`
//      verbatim, so this test catches any accidental visibility widening.
//   3. Clicking a card's Add button still adds the widget (single-add
//      semantics unchanged).
//
// The real `visibleCatalog` / `widgetHasSurface` (widgets/types.ts) run
// under test; only the catalog DATA, the SnapshotTile components, and the
// persistence layer are mocked, so the gating logic itself is exercised.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { WidgetDefinition } from "./widgets/types";

// ── A controlled three-widget catalog ──────────────────────────────────
// - `member-canvas`: visible to everyone, canvas + home eligible.
// - `pi-only-canvas`: lab_head only (memberVisible: false), canvas only.
// - `home-only`: visible to everyone, HOME surface only (not canvas).
//
// Built inside `vi.hoisted` so the hoisted `vi.mock("./widgets/registry")`
// factory below can safely reference it (vi.mock factories may not close
// over ordinary module-level consts).
const { TEST_CATALOG } = vi.hoisted(() => {
  const Stub = (label: string) => {
    const C = () => <div>{`stub:${label}`}</div>;
    C.displayName = `Stub_${label}`;
    return C;
  };
  const SidebarStub = () => null;
  const catalog: WidgetDefinition[] = [
    {
      id: "member-canvas",
      toolId: "comments",
      title: "Member canvas widget",
      description: "Visible to everyone on the canvas.",
      SnapshotTile: Stub("member-canvas"),
      SidebarTile: SidebarStub,
      defaultLayout: { w: 4, h: 4 },
      surfaces: { canvas: true, home: true },
      memberVisible: true,
    },
    {
      id: "pi-only-canvas",
      toolId: "metrics",
      title: "PI only widget",
      description: "Lab head only.",
      SnapshotTile: Stub("pi-only-canvas"),
      SidebarTile: SidebarStub,
      defaultLayout: { w: 4, h: 4 },
      surfaces: { canvas: true },
      memberVisible: false, // lab_head only
    },
    {
      id: "home-only",
      toolId: "calendar",
      title: "Home only widget",
      description: "Only eligible on the home surface.",
      SnapshotTile: Stub("home-only"),
      SidebarTile: SidebarStub,
      defaultLayout: { w: 4, h: 4 },
      surfaces: { home: true },
      memberVisible: true,
    },
  ];
  return { TEST_CATALOG: catalog };
});

vi.mock("./widgets/registry", () => ({
  WIDGET_CATALOG: TEST_CATALOG,
  getWidget: (id: string) => TEST_CATALOG.find((w) => w.id === id),
}));

// ── Persistence layer: an in-memory canvas order ────────────────────────
// `addCanvasWidget` pushes to the order; `readResolvedLayout` returns it.
// The canvas re-reads after every mutation, so this is enough to assert an
// add wired through. `vi.hoisted` builds the state + spies so the hoisted
// `vi.mock` factory below can safely close over them.
const persist = vi.hoisted(() => {
  const canvasOrder: string[] = [];
  const resolved = () => ({
    widgetOrder: { canvas: [...canvasOrder] },
    widgetConfig: {},
  });
  return {
    canvasOrder,
    resolved,
    addCanvasWidget: vi.fn(async (_u: string, w: { id: string }) => {
      if (!canvasOrder.includes(w.id)) canvasOrder.push(w.id);
    }),
    removeCanvasWidget: vi.fn(async (_u: string, id: string) => {
      const i = canvasOrder.indexOf(id);
      if (i >= 0) canvasOrder.splice(i, 1);
    }),
  };
});
const { canvasOrder, addCanvasWidget, removeCanvasWidget } = persist;

vi.mock("@/lib/lab-overview/layout-persistence", () => ({
  readResolvedLayout: vi.fn(async () => persist.resolved()),
  readResolvedHomeLayout: vi.fn(async () => persist.resolved()),
  readResolvedDashboardLayout: vi.fn(async () => persist.resolved()),
  patchCanvasOrder: vi.fn(async () => {}),
  patchHomeCanvasOrder: vi.fn(async () => {}),
  patchDashboardCanvasOrder: vi.fn(async () => {}),
  addCanvasWidget: persist.addCanvasWidget,
  addHomeCanvasWidget: persist.addCanvasWidget,
  addDashboardWidget: persist.addCanvasWidget,
  removeCanvasWidget: persist.removeCanvasWidget,
  removeHomeCanvasWidget: persist.removeCanvasWidget,
  removeDashboardWidget: persist.removeCanvasWidget,
  resetLayout: vi.fn(async () => {}),
  resetHomeLayout: vi.fn(async () => {}),
  resetDashboardLayout: vi.fn(async () => {}),
  patchWidgetConfig: vi.fn(async () => {}),
  patchHomeWidgetConfig: vi.fn(async () => {}),
  patchDashboardWidgetConfig: vi.fn(async () => {}),
  dashboardSurfaceFor: (accountType: string) =>
    accountType === "lab_head" ? "canvas" : "home",
}));

vi.mock("@/lib/lab-overview/tool-registry", () => ({
  resolveExpandedView: () => () => null,
  resolveToolTitle: (w: { title: string }) => w.title,
}));

// The placed-widget grid mounts each tile inside `<Widget>`, which calls
// `useFirstPaintHint` (sidecar / file-system reads). Stub it so the canvas
// renders without touching the file system.
vi.mock("@/lib/lab-overview/useFirstPaintHint", () => ({
  useFirstPaintHint: () => ({ shouldAutoOpen: false, markSeen: () => {} }),
}));

// IntersectionObserver stub → cards report in view immediately so the
// preview path runs. The stub-tile content is trivial so it can't throw.
class MockIO {
  cb: IntersectionObserverCallback;
  constructor(cb: IntersectionObserverCallback) {
    this.cb = cb;
  }
  observe(el: Element) {
    this.cb(
      [{ isIntersecting: true, target: el } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

import SnapshotCanvas from "./SnapshotCanvas";

beforeEach(() => {
  canvasOrder.length = 0;
  addCanvasWidget.mockClear();
  removeCanvasWidget.mockClear();
  vi.stubGlobal("IntersectionObserver", MockIO as unknown as typeof IntersectionObserver);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

async function openPalette() {
  // The Add-widget button is found by its label; the palette is a dialog.
  const addWidgetBtn = await screen.findByRole("button", { name: "+ Add widget" });
  fireEvent.click(addWidgetBtn);
  return screen.findByRole("dialog", { name: /add widget palette/i });
}

describe("SnapshotCanvas widget selector palette", () => {
  it("renders one card per eligible widget for a MEMBER on the canvas surface", async () => {
    render(<SnapshotCanvas username="mia" accountType="member" surface="canvas" />);
    const dialog = await openPalette();

    // Member + canvas surface: only `member-canvas` is eligible.
    // - pi-only-canvas is memberVisible:false → gated out.
    // - home-only is not canvas-eligible → gated out.
    expect(within(dialog).getByText("Member canvas widget")).toBeInTheDocument();
    expect(within(dialog).queryByText("PI only widget")).toBeNull();
    expect(within(dialog).queryByText("Home only widget")).toBeNull();

    // Exactly one Add affordance ⇒ one card.
    const addButtons = within(dialog).getAllByRole("button", {
      name: /add .* to canvas/i,
    });
    expect(addButtons).toHaveLength(1);
  });

  it("shows the PI-only widget for a LAB HEAD on the canvas surface", async () => {
    render(<SnapshotCanvas username="pat" accountType="lab_head" surface="canvas" />);
    const dialog = await openPalette();

    // lab_head + canvas: member-canvas + pi-only-canvas are both eligible;
    // home-only is still surface-gated out.
    expect(within(dialog).getByText("Member canvas widget")).toBeInTheDocument();
    expect(within(dialog).getByText("PI only widget")).toBeInTheDocument();
    expect(within(dialog).queryByText("Home only widget")).toBeNull();
  });

  it("applies the home surface filter (home-only appears, canvas-only does not)", async () => {
    render(<SnapshotCanvas username="mia" accountType="member" surface="home" />);
    const dialog = await openPalette();

    // home surface: home-only + member-canvas (canvas+home) are eligible;
    // pi-only-canvas is canvas-only AND memberVisible:false → gated out.
    expect(within(dialog).getByText("Home only widget")).toBeInTheDocument();
    expect(within(dialog).getByText("Member canvas widget")).toBeInTheDocument();
    expect(within(dialog).queryByText("PI only widget")).toBeNull();
  });

  it("adds a widget when its card Add button is clicked", async () => {
    render(<SnapshotCanvas username="mia" accountType="member" surface="canvas" />);
    const dialog = await openPalette();

    const addBtn = within(dialog).getByRole("button", {
      name: /add member canvas widget to canvas/i,
    });
    fireEvent.click(addBtn);

    await waitFor(() => {
      expect(addCanvasWidget).toHaveBeenCalledTimes(1);
    });
    expect(addCanvasWidget.mock.calls[0][1].id).toBe("member-canvas");
    // Single-add semantics: the order now contains exactly the one id.
    expect(canvasOrder).toEqual(["member-canvas"]);
  });
});
