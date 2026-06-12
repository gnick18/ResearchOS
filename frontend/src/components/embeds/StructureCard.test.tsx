// @vitest-environment jsdom
//
// P7-4 follow-up: a bare SMILES "Add to library" imports a real molecule with
// geometry and identity, no editor round-trip. The card converts the SMILES to a
// molblock with RDKit (toMolblock), the same path the file importer uses, then
// hands that molblock to moleculesApi.create (which derives identity from it). The
// old behavior stored an empty-geometry V2000 stub; this guards against that
// regressing.
//
// Voice: no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const create = vi.fn();
const toMolblock = vi.fn();

vi.mock("@/lib/chemistry/api", () => ({
  moleculesApi: { create: (...a: unknown[]) => create(...a) },
}));
vi.mock("@/lib/chemistry/rdkit", () => ({
  toMolblock: (...a: unknown[]) => toMolblock(...a),
}));
// Stub the RDKit thumbnail so the card renders without wasm.
vi.mock("@/components/chemistry/MoleculeThumbnail", () => ({
  MoleculeThumbnail: () => <div data-testid="thumb" />,
}));
// No sidecar cache in these tests, so the card builds its state from the descriptor.
vi.mock("@/lib/embeds/external-cache", () => ({
  getExternalCache: vi.fn().mockResolvedValue(null),
  putExternalCache: vi.fn().mockResolvedValue(undefined),
}));

import StructureCard from "./StructureCard";
import type { ExternalEmbedDescriptor } from "@/lib/embeds/external-embeds";

const SMILES = "c1ccccc1";
const MOLBLOCK = "\n  RDKit\n\n  6  6  0  0  0  0  0  0  0  0999 V2000\nM  END\n";

const smilesDescriptor: ExternalEmbedDescriptor = {
  href: `${SMILES}#ros=structure`,
  url: SMILES,
  kind: "structure",
  smiles: SMILES,
};

describe("StructureCard add to library (bare SMILES)", () => {
  beforeEach(() => {
    create.mockReset();
    toMolblock.mockReset();
  });

  it("converts the SMILES to a real molblock and imports it, no empty stub", async () => {
    toMolblock.mockResolvedValue(MOLBLOCK);
    create.mockResolvedValue({ meta: { id: "m1" }, molfile: MOLBLOCK });

    render(<StructureCard descriptor={smilesDescriptor} caption="Benzene" />);

    const button = await screen.findByRole("button", { name: /Add to library/ });
    await userEvent.click(button);

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));

    // The SMILES went through RDKit, not the old empty-geometry stub.
    expect(toMolblock).toHaveBeenCalledWith(SMILES);
    const [molfile, input] = create.mock.calls[0];
    expect(molfile).toBe(MOLBLOCK);
    expect(molfile).not.toContain("0  0  0  0  0  0  0  0  0  0999 V2000\nM  END");
    expect(input).toMatchObject({ name: "Benzene", source: "imported" });
    expect(input.pubchem_cid).toBeUndefined();

    await waitFor(() => expect(screen.getByText("Saved")).toBeTruthy());
  });

  it("surfaces an error and saves nothing when RDKit cannot parse the SMILES", async () => {
    toMolblock.mockRejectedValue(new Error("RDKit could not parse the structure"));

    render(<StructureCard descriptor={smilesDescriptor} caption="Benzene" />);

    const button = await screen.findByRole("button", { name: /Add to library/ });
    await userEvent.click(button);

    await waitFor(() => expect(screen.getByText("Error")).toBeTruthy());
    expect(create).not.toHaveBeenCalled();
  });
});
