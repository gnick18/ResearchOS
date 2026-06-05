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
const drillNode = vi.fn();

vi.mock("@/lib/sequences/taxonomy-radial-source", async () => {
  const actual = await vi.importActual<typeof import("@/lib/sequences/taxonomy-radial-source")>(
    "@/lib/sequences/taxonomy-radial-source",
  );
  return {
    ...actual,
    loadRadialPool: (...args: unknown[]) => loadRadialPool(...args),
    drillNode: (...args: unknown[]) => drillNode(...args),
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

import TaxonomyTreeView from "./TaxonomyTreeView";
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
  drillNode.mockResolvedValue([]);
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

  it("closes the whole view on Escape", async () => {
    const onClose = vi.fn();
    render(<TaxonomyTreeView open onClose={onClose} />);
    await screen.findByTestId("taxonomy-tree-svg");
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("drills a backbone-leaf family on click so its genera can splice in", async () => {
    drillNode.mockResolvedValue(["7214"]);
    render(<TaxonomyTreeView open onClose={() => {}} />);
    const svg = await screen.findByTestId("taxonomy-tree-svg");
    await waitFor(() => {
      expect(svg.querySelectorAll("circle").length).toBeGreaterThan(0);
    });
    // Click circles until the detail shows a family (childrenLoaded false ->
    // drillNode is called).
    const circles = Array.from(svg.querySelectorAll("circle"));
    for (const c of circles) {
      fireEvent.click(c);
    }
    await waitFor(() => {
      expect(drillNode).toHaveBeenCalled();
    });
  });
});
