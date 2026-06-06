// sequence editor master. Pure tests for the context-specific menu BUILDERS.
// They assert which items each kind of menu includes (selection / primer / CDS /
// plain feature), plus enablement of the destructive + read-out rows.

import { describe, it, expect, vi } from "vitest";
import {
  buildFeatureMenuItems,
  buildPrimerMenuItems,
  buildSelectionMenuItems,
  isPrimerFeature,
  type FeatureMenuDeps,
  type PrimerMenuDeps,
  type SelectionMenuDeps,
} from "./context-menu-items";
import type { EditFeature } from "./edit-model";
import type { EditMenuItem } from "@/components/sequences/SequenceEditMenu";

function feat(over: Partial<EditFeature> = {}): EditFeature {
  return { name: "f", type: "misc_feature", start: 0, end: 9, strand: 1, ...over };
}

function ids(items: EditMenuItem[]): string[] {
  return items.map((i) => i.id);
}

function byId(items: EditMenuItem[], id: string): EditMenuItem | undefined {
  return items.find((i) => i.id === id);
}

const noop = () => {};

function featureDeps(over: Partial<FeatureMenuDeps> = {}): FeatureMenuDeps {
  return {
    idx: 0,
    feature: feat(),
    isCoding: false,
    swatchColors: ["#aaa", "#bbb"],
    recolor: noop,
    rename: noop,
    add: noop,
    edit: noop,
    duplicate: noop,
    remove: noop,
    openProtein: noop,
    ...over,
  };
}

function primerDeps(over: Partial<PrimerMenuDeps> = {}): PrimerMenuDeps {
  return {
    idx: 1,
    feature: feat({ type: "primer_bind" }),
    oligo: "ATGCATGCATGC",
    tm: 52.3,
    readOnly: false,
    edit: noop,
    copyOligo: noop,
    remove: noop,
    ...over,
  };
}

function selectionDeps(over: Partial<SelectionMenuDeps> = {}): SelectionMenuDeps {
  return {
    hasRange: true,
    readOnly: false,
    isNucleotide: true,
    seqLength: 100,
    createFeature: noop,
    designPrimers: noop,
    proteinProps: noop,
    reverseComplementInPlace: noop,
    copyAsFasta: noop,
    basesMenu: [
      { id: "copy", label: "Copy", enabled: true, onRun: noop },
      { id: "cut", label: "Cut", enabled: true, destructive: true, onRun: noop },
    ],
    ...over,
  };
}

describe("isPrimerFeature", () => {
  it("matches primer_bind case-insensitively, nothing else", () => {
    expect(isPrimerFeature(feat({ type: "primer_bind" }))).toBe(true);
    expect(isPrimerFeature(feat({ type: "Primer_Bind" }))).toBe(true);
    expect(isPrimerFeature(feat({ type: "CDS" }))).toBe(false);
    expect(isPrimerFeature(null)).toBe(false);
  });
});

describe("buildFeatureMenuItems", () => {
  it("a plain (non-coding) feature has the feature ops and NO protein group", () => {
    const items = buildFeatureMenuItems(featureDeps({ feature: feat({ type: "misc_feature" }) }));
    expect(ids(items)).toEqual([
      "feat-recolor",
      "feat-rename",
      "feat-add",
      "feat-edit",
      "feat-dup",
      "feat-remove",
    ]);
    // Feature-bound rows are enabled when a feature is present.
    expect(byId(items, "feat-edit")!.enabled).toBe(true);
    // Remove is the destructive row.
    expect(byId(items, "feat-remove")!.destructive).toBe(true);
  });

  it("a CDS feature ADDS the protein group (Translate + Find domains)", () => {
    const items = buildFeatureMenuItems(featureDeps({ feature: feat({ type: "CDS" }), isCoding: true }));
    expect(ids(items)).toContain("feat-translate");
    expect(ids(items)).toContain("feat-find-domains");
    // Both fire the protein opener.
    const openProtein = vi.fn();
    const cdsItems = buildFeatureMenuItems(
      featureDeps({ idx: 3, feature: feat({ type: "CDS" }), isCoding: true, openProtein }),
    );
    byId(cdsItems, "feat-translate")!.onRun();
    byId(cdsItems, "feat-find-domains")!.onRun();
    expect(openProtein).toHaveBeenCalledTimes(2);
    expect(openProtein).toHaveBeenCalledWith(3);
  });

  it("a null feature greys the feature-bound rows but keeps Add", () => {
    const items = buildFeatureMenuItems(featureDeps({ idx: null, feature: null }));
    expect(byId(items, "feat-recolor")!.enabled).toBe(false);
    expect(byId(items, "feat-edit")!.enabled).toBe(false);
    expect(byId(items, "feat-remove")!.enabled).toBe(false);
    expect(byId(items, "feat-add")!.enabled).toBe(true);
    // No protein group without a coding feature.
    expect(ids(items)).not.toContain("feat-translate");
  });
});

describe("buildPrimerMenuItems", () => {
  it("a primer has Edit / Copy / Tm read-out / Delete", () => {
    const items = buildPrimerMenuItems(primerDeps());
    expect(ids(items)).toEqual([
      "primer-ctx-edit",
      "primer-ctx-copy",
      "primer-ctx-tm",
      "primer-ctx-delete",
    ]);
    // Tm is a disabled READ-OUT row carrying the value.
    const tm = byId(items, "primer-ctx-tm")!;
    expect(tm.enabled).toBe(false);
    expect(tm.label).toBe("Tm 52.3 C");
    // Delete is destructive.
    expect(byId(items, "primer-ctx-delete")!.destructive).toBe(true);
  });

  it("Copy fires with the oligo, Delete / Edit with the index", () => {
    const copyOligo = vi.fn();
    const edit = vi.fn();
    const remove = vi.fn();
    const items = buildPrimerMenuItems(primerDeps({ idx: 4, copyOligo, edit, remove }));
    byId(items, "primer-ctx-copy")!.onRun();
    byId(items, "primer-ctx-edit")!.onRun();
    byId(items, "primer-ctx-delete")!.onRun();
    expect(copyOligo).toHaveBeenCalledWith("ATGCATGCATGC");
    expect(edit).toHaveBeenCalledWith(4);
    expect(remove).toHaveBeenCalledWith(4);
  });

  it("shows a plain Tm placeholder when there is no Tm", () => {
    expect(
      byId(buildPrimerMenuItems(primerDeps({ oligo: "A", tm: null })), "primer-ctx-tm")!.label,
    ).toBe("Tm not available");
    // Copy is disabled when the oligo could not be derived (empty).
    expect(
      byId(buildPrimerMenuItems(primerDeps({ oligo: "", tm: null })), "primer-ctx-copy")!.enabled,
    ).toBe(false);
  });

  it("hides Edit and Delete on a read-only surface", () => {
    const items = buildPrimerMenuItems(primerDeps({ readOnly: true }));
    expect(ids(items)).not.toContain("primer-ctx-delete");
    expect(byId(items, "primer-ctx-edit")!.enabled).toBe(false);
  });
});

describe("buildSelectionMenuItems", () => {
  it("leads with the selection power moves, then the full bases menu", () => {
    const items = buildSelectionMenuItems(selectionDeps());
    expect(ids(items)).toEqual([
      "sel-create-feature",
      "sel-design-primers",
      "sel-protein-props",
      "sel-rev-comp-inplace",
      "sel-copy-fasta",
      // the appended bases menu (verbatim, first item opens a new group)
      "copy",
      "cut",
    ]);
    // The bases menu still carries its destructive Cut.
    expect(byId(items, "cut")!.destructive).toBe(true);
    // A divider opens the bases group.
    expect(byId(items, "copy")!.group).toBe(true);
  });

  it("omits Reverse complement on a protein or read-only surface", () => {
    expect(ids(buildSelectionMenuItems(selectionDeps({ isNucleotide: false })))).not.toContain(
      "sel-rev-comp-inplace",
    );
    expect(ids(buildSelectionMenuItems(selectionDeps({ readOnly: true })))).not.toContain(
      "sel-rev-comp-inplace",
    );
  });

  it("each selection action fires its callback", () => {
    const createFeature = vi.fn();
    const designPrimers = vi.fn();
    const proteinProps = vi.fn();
    const reverseComplementInPlace = vi.fn();
    const copyAsFasta = vi.fn();
    const items = buildSelectionMenuItems(
      selectionDeps({
        createFeature,
        designPrimers,
        proteinProps,
        reverseComplementInPlace,
        copyAsFasta,
      }),
    );
    byId(items, "sel-create-feature")!.onRun();
    byId(items, "sel-design-primers")!.onRun();
    byId(items, "sel-protein-props")!.onRun();
    byId(items, "sel-rev-comp-inplace")!.onRun();
    byId(items, "sel-copy-fasta")!.onRun();
    expect(createFeature).toHaveBeenCalledOnce();
    expect(designPrimers).toHaveBeenCalledOnce();
    expect(proteinProps).toHaveBeenCalledOnce();
    expect(reverseComplementInPlace).toHaveBeenCalledOnce();
    expect(copyAsFasta).toHaveBeenCalledOnce();
  });
});
