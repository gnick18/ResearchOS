// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const get = vi.fn();
vi.mock("@/lib/phylo/api", () => ({
  phyloApi: { get: (...a: unknown[]) => get(...a) },
}));

import PhyloEmbed from "./PhyloEmbed";
import type { EmbedDescriptor } from "@/lib/references";

const descriptor: EmbedDescriptor = {
  type: "phylo",
  id: "7",
  view: "studio",
  isEmbed: true,
  opts: {},
};

describe("PhyloEmbed", () => {
  it("renders the tree figure, title, and tip count once loaded", async () => {
    get.mockResolvedValue({
      meta: {
        id: "7",
        name: "Aspergillus sample",
        project_ids: [],
        added_at: "2026-06-12T00:00:00.000Z",
        format: "newick",
        tip_count: 3,
      },
      tree: "((A:0.5,B:0.5):0.3,C:0.8);",
    });
    const { container } = render(
      <PhyloEmbed descriptor={descriptor} caption="Aspergillus sample" basePath="" />,
    );
    await waitFor(() =>
      expect(screen.getByText("Aspergillus sample")).toBeInTheDocument(),
    );
    // The figure is the renderer's self-contained SVG string, injected as markup.
    expect(container.querySelector("svg")).not.toBeNull();
    expect(screen.getByText(/3 tips/)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Open phylogenetic tree/ }),
    ).toBeInTheDocument();
  });

  it("shows the unavailable card when the tree is gone", async () => {
    get.mockResolvedValue(null);
    render(
      <PhyloEmbed descriptor={descriptor} caption="Aspergillus sample" basePath="" />,
    );
    await waitFor(() =>
      expect(screen.getByText("Aspergillus sample")).toBeInTheDocument(),
    );
    expect(screen.getByText(/Not available/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open" })).toBeNull();
  });
});
