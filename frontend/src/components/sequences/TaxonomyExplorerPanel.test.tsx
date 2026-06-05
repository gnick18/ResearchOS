// sequence editor master. Render tests for the taxonomy tree explorer panel.
// The data layer (taxonomy-explorer) and the live client (ncbi-datasets suggest)
// are mocked, so the panel's structure is asserted without network: the centered
// node card, the parent (up) card, sibling chips, child chips, the breadcrumb,
// the species/assemblies count toggle, the species-node import action, and the
// empty-children state. Also covers the pure buildCrumbs helper.

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import type { ResolvedNode, NeighborRef } from "@/lib/sequences/taxonomy-explorer";

// --- Mocks ------------------------------------------------------------------

const resolveExplorerNode = vi.fn();
const resolveSiblings = vi.fn();
const resolveChildNames = vi.fn();
const fetchAssembliesCount = vi.fn();

vi.mock("@/lib/sequences/taxonomy-explorer", () => ({
  resolveExplorerNode: (...args: unknown[]) => resolveExplorerNode(...args),
  resolveSiblings: (...args: unknown[]) => resolveSiblings(...args),
  resolveChildNames: (...args: unknown[]) => resolveChildNames(...args),
  fetchAssembliesCount: (...args: unknown[]) => fetchAssembliesCount(...args),
}));

const suggestTaxa = vi.fn(async () => []);
vi.mock("@/lib/sequences/ncbi-datasets", async () => {
  const actual = await vi.importActual<typeof import("@/lib/sequences/ncbi-datasets")>(
    "@/lib/sequences/ncbi-datasets",
  );
  return { ...actual, suggestTaxa: () => suggestTaxa() };
});

import TaxonomyExplorerPanel, {
  buildCrumbs,
} from "./TaxonomyExplorerPanel";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// A centered GENUS node (Homo) with a parent (Hominidae family), two siblings,
// and two children. Live origin so its classification feeds the breadcrumb.
function homoNode(): ResolvedNode {
  return {
    taxId: "9605",
    name: "Homo",
    rank: "genus",
    origin: "live",
    parentId: "9604",
    childRefs: [
      { taxId: "9606", name: "Homo sapiens", rank: "species" },
      { taxId: "1425170", name: "Homo heidelbergensis", rank: "species" },
    ],
    speciesCount: undefined,
    assembliesCount: 2564,
    classification: {
      domain: "Eukaryota",
      kingdom: "Metazoa",
      family: "Hominidae",
      genus: "Homo",
    },
  };
}

function hominidaeParent(): ResolvedNode {
  return {
    taxId: "9604",
    name: "Hominidae",
    rank: "family",
    origin: "backbone",
    parentId: "9443",
    childRefs: [],
    speciesCount: 16,
    classification: {},
  };
}

const homoSiblings: NeighborRef[] = [
  { taxId: "9596", name: "Pan", rank: "genus" },
  { taxId: "9592", name: "Gorilla", rank: "genus" },
];

describe("TaxonomyExplorerPanel", () => {
  beforeEach(() => {
    resolveExplorerNode.mockImplementation(async (id: string) => {
      if (id === "9604") return hominidaeParent();
      return homoNode();
    });
    resolveSiblings.mockResolvedValue(homoSiblings);
    resolveChildNames.mockResolvedValue(homoNode().childRefs);
    fetchAssembliesCount.mockResolvedValue(2564);
  });

  it("renders nothing when closed", () => {
    const { container } = render(
      <TaxonomyExplorerPanel open={false} onClose={() => {}} initialTaxId="9605" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the centered node, parent, siblings, children, and breadcrumb", async () => {
    render(
      <TaxonomyExplorerPanel open onClose={() => {}} initialTaxId="9605" />,
    );

    // Centered node card (the h3, not the breadcrumb span).
    expect(
      await screen.findByRole("heading", { level: 3, name: "Homo" }),
    ).toBeInTheDocument();
    // Parent (up) card. Hominidae shows twice (the up-card and the breadcrumb
    // crumb, both clickable), so assert both are present.
    await waitFor(() =>
      expect(
        screen.getAllByRole("button", { name: /Hominidae/i }).length,
      ).toBeGreaterThanOrEqual(2),
    );
    // Sibling chips.
    expect(screen.getByRole("button", { name: "Pan" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Gorilla" })).toBeInTheDocument();
    // Child chips.
    expect(
      screen.getByRole("button", { name: "Homo sapiens" }),
    ).toBeInTheDocument();
    // Breadcrumb crumb (from classification).
    expect(screen.getByText("Eukaryota")).toBeInTheDocument();
  });

  it("toggles the count badge between species and assemblies", async () => {
    render(
      <TaxonomyExplorerPanel open onClose={() => {}} initialTaxId="9605" />,
    );
    await screen.findByRole("heading", { level: 3, name: "Homo" });
    // A genus is live, so species is unavailable; the badge says so first.
    const badge = await screen.findByText(/species count unavailable/i);
    fireEvent.click(badge);
    // Toggling to assemblies fetches the live count.
    await waitFor(() => expect(fetchAssembliesCount).toHaveBeenCalled());
    expect(await screen.findByText(/2,564 assemblies/)).toBeInTheDocument();
  });

  it("offers an import-from-NCBI action on a species node", async () => {
    // Center on a species node.
    resolveExplorerNode.mockImplementation(async () => ({
      taxId: "9606",
      name: "Homo sapiens",
      rank: "species",
      origin: "live",
      parentId: "9605",
      childRefs: [],
      speciesCount: undefined,
      assembliesCount: 10,
      classification: { genus: "Homo", species: "Homo sapiens" },
    }));
    resolveSiblings.mockResolvedValue([]);
    resolveChildNames.mockResolvedValue([]);
    const onImportOrganism = vi.fn();
    render(
      <TaxonomyExplorerPanel
        open
        onClose={() => {}}
        initialTaxId="9606"
        onImportOrganism={onImportOrganism}
      />,
    );
    const importBtn = await screen.findByRole("button", {
      name: /Import from NCBI/i,
    });
    fireEvent.click(importBtn);
    expect(onImportOrganism).toHaveBeenCalledWith({ organism: "Homo sapiens" });
  });

  it("shows the empty-children state on a node with no children", async () => {
    resolveExplorerNode.mockImplementation(async () => ({
      taxId: "9606",
      name: "Homo sapiens",
      rank: "species",
      origin: "live",
      parentId: "9605",
      childRefs: [],
      speciesCount: undefined,
      assembliesCount: 10,
      classification: {},
    }));
    resolveSiblings.mockResolvedValue([]);
    resolveChildNames.mockResolvedValue([]);
    render(
      <TaxonomyExplorerPanel open onClose={() => {}} initialTaxId="9606" />,
    );
    expect(await screen.findByText(/No child taxa\./i)).toBeInTheDocument();
  });
});

describe("buildCrumbs", () => {
  it("orders a root -> leaf breadcrumb from classification and ends on the node", () => {
    const crumbs = buildCrumbs(homoNode(), hominidaeParent());
    const names = crumbs.map((c) => c.name);
    expect(names[0]).toBe("Eukaryota");
    expect(names[names.length - 1]).toBe("Homo");
    // The family crumb is the parent, so it carries the parent's tax id (clickable).
    const family = crumbs.find((c) => c.name === "Hominidae");
    expect(family?.taxId).toBe("9604");
    // The genus crumb is the node itself.
    const genus = crumbs.find((c) => c.name === "Homo");
    expect(genus?.taxId).toBe("9605");
  });
});
