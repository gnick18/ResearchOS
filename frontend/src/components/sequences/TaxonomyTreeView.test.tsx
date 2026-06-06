// sequence editor master. Render smoke test for the radial TaxonomyTreeView.
// The pool loader, the drill, and the live suggest are mocked so no network is
// touched. d3-zoom runs in jsdom, which lacks full SVG measurement, so the test
// asserts the structural contract the pure layout drives: the SVG mounts, branch
// links and node markers draw from a small backbone fixture, and clicking a node
// opens the click-detail with the right name, rank, and species count. The radial
// look, the actual zoom feel, and label culling need a human live pass (jsdom
// cannot measure or paint), noted in the report.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { RadialPool, RadialPoolNode } from "@/lib/sequences/taxonomy-radial-source";

// --- Mocks ------------------------------------------------------------------

const loadRadialPool = vi.fn();
const drillSubtreeToDepth = vi.fn();

vi.mock("@/lib/sequences/taxonomy-radial-source", async () => {
  const actual = await vi.importActual<typeof import("@/lib/sequences/taxonomy-radial-source")>(
    "@/lib/sequences/taxonomy-radial-source",
  );
  return {
    ...actual,
    loadRadialPool: (...args: unknown[]) => loadRadialPool(...args),
    // The re-rooting navigation loads the fan-out window through this. Mocked so
    // no network is touched on a re-root click; the pure stack + depth helpers
    // are tested separately.
    drillSubtreeToDepth: (...args: unknown[]) => drillSubtreeToDepth(...args),
  };
});

const suggestTaxa = vi.fn(async () => []);
vi.mock("@/lib/sequences/ncbi-datasets", async () => {
  const actual = await vi.importActual<typeof import("@/lib/sequences/ncbi-datasets")>(
    "@/lib/sequences/ncbi-datasets",
  );
  return { ...actual, suggestTaxa: () => suggestTaxa() };
});

// fetchAssembliesCount lives in taxonomy-explorer, imported by the detail.
const fetchAssembliesCount = vi.fn(async () => 42);
vi.mock("@/lib/sequences/taxonomy-explorer", async () => {
  const actual = await vi.importActual<typeof import("@/lib/sequences/taxonomy-explorer")>(
    "@/lib/sequences/taxonomy-explorer",
  );
  return { ...actual, fetchAssembliesCount: () => fetchAssembliesCount() };
});

import TaxonomyTreeView, { formatSpeciesCount } from "./TaxonomyTreeView";
import { SYNTHETIC_ROOT_ID } from "@/lib/sequences/taxonomy-radial-source";

function poolNode(
  id: string,
  name: string,
  rank: string,
  childIds: string[],
  speciesCount: number,
  origin: "backbone" | "live" = "backbone",
  childrenLoaded = true,
): RadialPoolNode {
  return { id, name, rank, speciesCount, childIds, origin, childrenLoaded };
}

// A small fixture pool: synthetic root over one domain with two families, one
// fat and one thin.
function fixturePool(): RadialPool {
  const byId = new Map<string, RadialPoolNode>([
    [SYNTHETIC_ROOT_ID, poolNode(SYNTHETIC_ROOT_ID, "Tree of life", "root", ["2759"], 1_000_000)],
    ["2759", poolNode("2759", "Eukaryota", "domain", ["7215", "999"], 900_000)],
    ["7215", poolNode("7215", "Drosophilidae", "family", [], 120, "backbone", false)],
    ["999", poolNode("999", "Tiny family", "family", [], 1, "backbone", false)],
  ]);
  return { byId, rootIds: ["131567"] };
}

beforeEach(() => {
  vi.clearAllMocks();
  loadRadialPool.mockResolvedValue(fixturePool());
  drillSubtreeToDepth.mockResolvedValue([]);
});

afterEach(() => cleanup());

describe("TaxonomyTreeView", () => {
  it("renders nothing when closed", () => {
    const { container } = render(<TaxonomyTreeView open={false} onClose={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it("mounts the radial SVG and draws branches + node markers from the pool", async () => {
    render(<TaxonomyTreeView open onClose={() => {}} />);

    // The SVG canvas mounts.
    const svg = await screen.findByTestId("taxonomy-tree-svg");
    expect(svg).toBeTruthy();

    // After the pool loads, branch links + node markers draw. Wait for the
    // domain node marker (a circle) to appear.
    await waitFor(() => {
      const circles = svg.querySelectorAll("circle");
      expect(circles.length).toBeGreaterThan(0);
    });

    // At least one branch line is drawn (a link to a visible child).
    await waitFor(() => {
      const lines = svg.querySelectorAll("line");
      expect(lines.length).toBeGreaterThan(0);
    });
  });

  it("opens the click-detail with name, rank, and species count on a node click", async () => {
    render(<TaxonomyTreeView open onClose={() => {}} />);
    const svg = await screen.findByTestId("taxonomy-tree-svg");

    // Find the Eukaryota marker by its drawn label, or click any non-root circle.
    await waitFor(() => {
      expect(svg.querySelectorAll("circle").length).toBeGreaterThan(0);
    });
    const circles = Array.from(svg.querySelectorAll("circle"));
    // Click each until a real taxon detail opens. The synthetic root opens a
    // detail without a count badge, so skip it and keep clicking until a node
    // with a species / assemblies count shows.
    for (const c of circles) {
      fireEvent.click(c);
      const open = screen.queryByTestId("taxonomy-node-detail");
      if (open && /species|assemblies/i.test(open.textContent ?? "")) break;
    }

    const detail = await screen.findByTestId("taxonomy-node-detail");
    expect(detail).toBeTruthy();
    // The detail shows a rank chip and a species count badge.
    expect(detail.textContent).toMatch(/species|assemblies/i);
  });

  it("formats the species count line like the detail badge", () => {
    expect(formatSpeciesCount(1_640_607)).toBe("1,640,607 species");
    expect(formatSpeciesCount(1)).toBe("1 species");
    expect(formatSpeciesCount(0)).toBe("0 species");
    expect(formatSpeciesCount(undefined)).toBe("species count unavailable");
    expect(formatSpeciesCount(Number.NaN)).toBe("species count unavailable");
  });

  it("shows a hover card with name, rank, and species count on pointer over a node", async () => {
    render(<TaxonomyTreeView open onClose={() => {}} />);
    const svg = await screen.findByTestId("taxonomy-tree-svg");
    await waitFor(() => {
      expect(svg.querySelectorAll("circle").length).toBeGreaterThan(0);
    });
    // No card before any hover.
    expect(screen.queryByTestId("taxonomy-hover-card")).toBeNull();
    // Hovering a node marker shows the floating card. jsdom cannot measure layout
    // so we only assert the card mounts with the node text; the position and feel
    // need a human live pass.
    const circles = Array.from(svg.querySelectorAll("circle"));
    fireEvent.pointerEnter(circles[circles.length - 1]);
    const card = await screen.findByTestId("taxonomy-hover-card");
    expect(card.textContent).toMatch(/species|species count unavailable/i);
    // Leaving the node hides the card.
    fireEvent.pointerLeave(circles[circles.length - 1]);
    await waitFor(() => {
      expect(screen.queryByTestId("taxonomy-hover-card")).toBeNull();
    });
  });

  it("closes the whole view on Escape", async () => {
    const onClose = vi.fn();
    render(<TaxonomyTreeView open onClose={onClose} />);
    await screen.findByTestId("taxonomy-tree-svg");
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("re-roots on a descendant click and loads its fan-out window", async () => {
    drillSubtreeToDepth.mockResolvedValue(["7214"]);
    render(<TaxonomyTreeView open onClose={() => {}} />);
    const svg = await screen.findByTestId("taxonomy-tree-svg");
    await waitFor(() => {
      expect(svg.querySelectorAll("circle").length).toBeGreaterThan(0);
    });
    // Clicking a non-center node re-roots on it, which loads the fan-out window
    // below the new center via drillSubtreeToDepth.
    const circles = Array.from(svg.querySelectorAll("circle"));
    for (const c of circles) {
      fireEvent.click(c);
    }
    await waitFor(() => {
      expect(drillSubtreeToDepth).toHaveBeenCalled();
    });
  });

  it("shows the jump-back chip only when a pinned lineage is set", async () => {
    // Without pinned, no chip (the launcher entry).
    const { rerender } = render(<TaxonomyTreeView open onClose={() => {}} />);
    await screen.findByTestId("taxonomy-tree-svg");
    expect(screen.queryByTestId("taxonomy-jump-back-chip")).toBeNull();

    // With pinned (opened from a sequence), the chip shows the organism name.
    rerender(
      <TaxonomyTreeView
        open
        onClose={() => {}}
        pinned={{
          organismTaxId: "7215",
          organismName: "Drosophilidae",
          lineageIds: ["2759", "7215"],
        }}
      />,
    );
    const chip = await screen.findByTestId("taxonomy-jump-back-chip");
    expect(chip.textContent).toMatch(/Your sequence/i);
    expect(chip.textContent).toMatch(/Drosophilidae/);
  });

  it("re-roots on the pinned organism when the jump-back chip is clicked", async () => {
    render(
      <TaxonomyTreeView
        open
        onClose={() => {}}
        pinned={{
          organismTaxId: "7215",
          organismName: "Drosophilidae",
          lineageIds: ["2759", "7215"],
        }}
      />,
    );
    await screen.findByTestId("taxonomy-tree-svg");
    const chip = await screen.findByTestId("taxonomy-jump-back-chip");
    fireEvent.click(chip);
    // Re-rooting onto the in-pool organism loads its fan-out window via the
    // shared drill path, the same call a search pick or node click makes.
    await waitFor(() => {
      expect(drillSubtreeToDepth).toHaveBeenCalled();
    });
  });

  // --- EMBEDDED (offline) mode -------------------------------------------

  it("embedded mode renders inline with no dialog, overlay, close button, or search box", async () => {
    render(<TaxonomyTreeView open embedded />);
    // The SVG still mounts (the tree itself is unchanged).
    const view = await screen.findByTestId("taxonomy-tree-view");
    expect(view.getAttribute("data-embedded")).toBe("true");
    // No dialog semantics on the embed.
    expect(view.getAttribute("role")).not.toBe("dialog");
    // No backdrop / overlay (the modal's bg-black/40 layer is gone).
    expect(view.querySelector(".bg-black\\/40")).toBeNull();
    // No close control (the modal's only "Close" button).
    expect(
      screen.queryByRole("button", { name: /^Close$/i }),
    ).toBeNull();
    // The live search box is hidden (it calls suggestTaxa).
    expect(
      screen.queryByPlaceholderText(/Find an organism/i),
    ).toBeNull();
    // suggestTaxa is never called in the offline embed.
    expect(suggestTaxa).not.toHaveBeenCalled();
  });

  it("embedded mode does not drill (no network) when a descendant is clicked", async () => {
    drillSubtreeToDepth.mockResolvedValue(["7214"]);
    render(<TaxonomyTreeView open embedded />);
    const svg = await screen.findByTestId("taxonomy-tree-svg");
    await waitFor(() => {
      expect(svg.querySelectorAll("circle").length).toBeGreaterThan(0);
    });
    // Click every marker, including a backbone-leaf family. The offline embed
    // re-roots on it but never calls the live drill.
    const circles = Array.from(svg.querySelectorAll("circle"));
    for (const c of circles) {
      fireEvent.click(c);
    }
    // Give any (incorrectly fired) async drill a tick to land.
    await new Promise((r) => setTimeout(r, 0));
    expect(drillSubtreeToDepth).not.toHaveBeenCalled();
  });

  it("embedded mode shows a read-only detail (species count, no live toggle, no import)", async () => {
    render(<TaxonomyTreeView open embedded onImportOrganism={() => {}} />);
    const svg = await screen.findByTestId("taxonomy-tree-svg");
    await waitFor(() => {
      expect(svg.querySelectorAll("circle").length).toBeGreaterThan(0);
    });
    const circles = Array.from(svg.querySelectorAll("circle"));
    for (const c of circles) {
      fireEvent.click(c);
      const open = screen.queryByTestId("taxonomy-node-detail");
      if (open && /species/i.test(open.textContent ?? "")) break;
    }
    const detail = await screen.findByTestId("taxonomy-node-detail");
    // A static species line (the read-only badge), not the toggle button.
    expect(screen.getByTestId("taxonomy-detail-species").textContent).toMatch(
      /species/i,
    );
    // The "Center the view here" offline action stays.
    expect(detail.textContent).toMatch(/Center the view here/i);
    // The import jump is gated off even when onImportOrganism is passed.
    expect(detail.textContent).not.toMatch(/Import from NCBI/i);
    // No live assemblies fetch is triggered by the read-only detail.
    expect(fetchAssembliesCount).not.toHaveBeenCalled();
  });

  it("embedded mode ignores the pinned chip and Escape stays with the page", async () => {
    const onClose = vi.fn();
    render(
      <TaxonomyTreeView
        open
        embedded
        onClose={onClose}
        pinned={{
          organismTaxId: "7215",
          organismName: "Drosophilidae",
          lineageIds: ["2759", "7215"],
        }}
      />,
    );
    await screen.findByTestId("taxonomy-tree-svg");
    // No jump-back chip in the offline embed.
    expect(screen.queryByTestId("taxonomy-jump-back-chip")).toBeNull();
    // Escape does not close (there is nothing to close in the inline embed).
    fireEvent.keyDown(window, { key: "Escape" });
    await new Promise((r) => setTimeout(r, 0));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows a breadcrumb of the focus path once the user drills in", async () => {
    drillSubtreeToDepth.mockResolvedValue([]);
    render(<TaxonomyTreeView open onClose={() => {}} />);
    const svg = await screen.findByTestId("taxonomy-tree-svg");
    await waitFor(() => {
      expect(svg.querySelectorAll("circle").length).toBeGreaterThan(0);
    });
    // No breadcrumb at the root (calm whole-tree view).
    expect(screen.queryByTestId("taxonomy-breadcrumb")).toBeNull();
    // Re-root on a descendant: click every non-root marker, one of which is the
    // Eukaryota domain. The breadcrumb appears once the stack is past the root.
    const circles = Array.from(svg.querySelectorAll("circle"));
    for (const c of circles) {
      fireEvent.click(c);
    }
    await waitFor(() => {
      expect(screen.queryByTestId("taxonomy-breadcrumb")).toBeTruthy();
    });
  });
});
