// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const get = vi.fn();
vi.mock("@/lib/chemistry/api", () => ({
  moleculesApi: { get: (...a: unknown[]) => get(...a) },
}));
// Stub the RDKit thumbnail so the renderer runs without wasm.
vi.mock("@/components/chemistry/MoleculeThumbnail", () => ({
  MoleculeThumbnail: () => <div data-testid="thumb" />,
}));

import MoleculeEmbed from "./MoleculeEmbed";
import type { EmbedDescriptor } from "@/lib/references";

const descriptor: EmbedDescriptor = {
  type: "molecule",
  id: "4",
  view: "card",
  isEmbed: true,
  opts: {},
};

describe("MoleculeEmbed", () => {
  it("renders the structure, caption, and identity facts once loaded", async () => {
    get.mockResolvedValue({
      meta: { id: "4", name: "Resveratrol", smiles: "Oc1ccc...", formula: "C14H12O3", mol_weight: 228.24 },
      molfile: "",
    });
    render(<MoleculeEmbed descriptor={descriptor} caption="Resveratrol" basePath="" />);
    await waitFor(() => expect(screen.getByTestId("thumb")).toBeInTheDocument());
    expect(screen.getByText("Resveratrol")).toBeInTheDocument();
    expect(screen.getByText(/C14H12O3/)).toBeInTheDocument();
    expect(screen.getByText(/228\.24 g\/mol/)).toBeInTheDocument();
  });

  it("shows the unavailable card when the molecule is gone", async () => {
    get.mockResolvedValue(null);
    render(<MoleculeEmbed descriptor={descriptor} caption="Resveratrol" basePath="" />);
    await waitFor(() => expect(screen.getByText("Resveratrol")).toBeInTheDocument());
    expect(screen.getByText(/Not available/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open" })).toBeNull();
  });
});
