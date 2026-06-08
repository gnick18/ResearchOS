// v3 registry phase: tests for the typed-row summary helper (design §7).
// Covers the antibody summary, the plasmid summary, a plain reagent (-> null),
// and graceful skipping of empty / absent fields.

import { describe, expect, it } from "vitest";

import { typedSummary } from "../inventory-ui";
import type {
  AntibodyRegistry,
  InventoryItem,
  PlasmidRegistry,
} from "@/lib/types";

function makeItem(over: Partial<InventoryItem> = {}): InventoryItem {
  return {
    id: 1,
    name: "Item",
    category: "reagent",
    catalog_number: null,
    vendor: "NEB",
    cas: null,
    url: null,
    container_label: "vial",
    storage_class: null,
    hazard_note: null,
    sds_url: null,
    notes: null,
    low_at_count: null,
    track_consumption: false,
    product_barcode: null,
    registry: null,
    owner: "me",
    shared_with: [],
    created_by: "me",
    ...over,
  };
}

describe("typedSummary", () => {
  it("summarizes a fully-typed antibody", () => {
    const registry: AntibodyRegistry = {
      target: "beta-actin",
      host_species: "Rabbit",
      clonality: "monoclonal",
      conjugate: "HRP",
      isotype: "IgG1",
      applications: ["WB", "FACS"],
      rrid: "AB_123456",
      recommended_dilution: "1:1000",
    };
    const item = makeItem({ category: "antibody", registry });
    expect(typedSummary(item)).toBe("Rabbit monoclonal, HRP, WB / FACS, 1:1000");
  });

  it("summarizes a fully-typed plasmid with abbreviated resistance", () => {
    const registry: PlasmidRegistry = {
      backbone: "pUC19",
      insert: "GFP",
      resistance: "Ampicillin",
      bacterial_host: "DH5-alpha",
      size_bp: 2686,
      source: "in-house",
    };
    const item = makeItem({ category: "plasmid", registry });
    expect(typedSummary(item)).toBe("pUC19 backbone, GFP insert, AmpR, 2686 bp");
  });

  it("returns null for a plain reagent (no registry)", () => {
    expect(typedSummary(makeItem())).toBeNull();
  });

  it("returns null for a typed category whose registry is null", () => {
    expect(typedSummary(makeItem({ category: "antibody" }))).toBeNull();
    expect(typedSummary(makeItem({ category: "plasmid" }))).toBeNull();
  });

  it("skips empty / absent antibody fields gracefully", () => {
    const registry: AntibodyRegistry = {
      host_species: "Mouse",
      clonality: null,
      conjugate: "  ", // whitespace-only is dropped
      applications: [],
      recommended_dilution: null,
    };
    const item = makeItem({ category: "antibody", registry });
    expect(typedSummary(item)).toBe("Mouse");
  });

  it("skips empty / absent plasmid fields gracefully", () => {
    const registry: PlasmidRegistry = {
      backbone: "pET-28a",
      insert: null,
      resistance: "",
      size_bp: null,
    };
    const item = makeItem({ category: "plasmid", registry });
    expect(typedSummary(item)).toBe("pET-28a backbone");
  });

  it("returns null when every typed field is empty", () => {
    const registry: PlasmidRegistry = {
      backbone: null,
      insert: "  ",
      resistance: "",
      size_bp: null,
    };
    expect(typedSummary(makeItem({ category: "plasmid", registry }))).toBeNull();
  });

  it("passes an unknown resistance through verbatim", () => {
    const registry: PlasmidRegistry = { resistance: "G418" };
    expect(typedSummary(makeItem({ category: "plasmid", registry }))).toBe(
      "G418",
    );
  });

  it("joins host and clonality, or shows either alone", () => {
    expect(
      typedSummary(
        makeItem({ category: "antibody", registry: { clonality: "polyclonal" } }),
      ),
    ).toBe("polyclonal");
    expect(
      typedSummary(
        makeItem({ category: "antibody", registry: { host_species: "Goat" } }),
      ),
    ).toBe("Goat");
  });
});
