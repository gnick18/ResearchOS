// @vitest-environment jsdom
//
// P7-6 a11y tests for MoleculeEmbed. Separated from the main a11y.test.tsx so
// the ./MoleculeEmbed stub used by ObjectEmbed tests does not conflict with
// importing the real MoleculeEmbed component here.
//
// Voice: no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";

const getMolecule = vi.fn();
vi.mock("@/lib/chemistry/api", () => ({
  moleculesApi: { get: (...a: unknown[]) => getMolecule(...a) },
}));
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

describe("MoleculeEmbed a11y (P7-6)", () => {
  it("structure wrapper carries role=img with descriptive aria-label", async () => {
    getMolecule.mockResolvedValue({
      meta: { id: "4", name: "Resveratrol", smiles: "Oc1ccc...", formula: "C14H12O3", mol_weight: 228.24 },
      molfile: "",
    });
    const { container } = render(
      <MoleculeEmbed descriptor={descriptor} caption="Resveratrol" />,
    );
    await waitFor(() => {
      const imgWrapper = container.querySelector("[role='img']");
      expect(imgWrapper).toBeTruthy();
    });
    const imgWrapper = container.querySelector("[role='img']") as HTMLElement;
    const label = imgWrapper.getAttribute("aria-label") ?? "";
    expect(label).toContain("Resveratrol");
    expect(label.toLowerCase()).toContain("structure");
  });

  it("Open link in the header carries aria-label once loaded", async () => {
    getMolecule.mockResolvedValue({
      meta: { id: "4", name: "Resveratrol", smiles: "Oc1ccc...", formula: "C14H12O3", mol_weight: 228.24 },
      molfile: "",
    });
    const { container } = render(
      <MoleculeEmbed descriptor={descriptor} caption="Resveratrol" />,
    );
    await waitFor(() => {
      const link = container.querySelector("a[aria-label]");
      expect(link).toBeTruthy();
    });
    const link = container.querySelector("a[aria-label]") as HTMLAnchorElement;
    expect(link.getAttribute("aria-label")).toContain("Resveratrol");
  });

  it("Open link carries focus-visible ring class", async () => {
    getMolecule.mockResolvedValue({
      meta: { id: "4", name: "Resveratrol", smiles: "Oc1ccc...", formula: "C14H12O3", mol_weight: 228.24 },
      molfile: "",
    });
    const { container } = render(
      <MoleculeEmbed descriptor={descriptor} caption="Resveratrol" />,
    );
    await waitFor(() => {
      const link = container.querySelector("a");
      expect(link).toBeTruthy();
    });
    const link = container.querySelector("a") as HTMLAnchorElement;
    expect(link.className).toContain("focus-visible:ring-2");
  });
});
