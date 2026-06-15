import { describe, it, expect } from "vitest";
import {
  withOverlayWizardUi,
  overlayWizardFromResult,
  candidatesToFacts,
  type OverlayWizardPayload,
} from "../overlay-wizard";
import { recordSetFromResult } from "../record-set";
import type { JoinCandidate } from "@/lib/phylo/smart-binding";

const candidate: JoinCandidate = {
  tableId: "t1",
  tableName: "Strain metadata",
  joinColumnId: "c_taxon",
  joinColumnName: "taxon",
  joinRate: 0.857,
  matchedTips: 6,
  totalTips: 7,
  overlays: [
    {
      columnId: "c_loc",
      columnName: "Location",
      columnKind: "categorical",
      geoms: ["strip"],
      recommendedGeom: "strip",
    },
    {
      columnId: "c_len",
      columnName: "Length",
      columnKind: "numeric",
      geoms: ["bars", "heat", "dots", "point"],
      recommendedGeom: "bars",
    },
  ],
};

const payload: OverlayWizardPayload = {
  widget: "overlayWizard",
  treeId: "tree9",
  treeName: "cyp51A",
  candidates: [candidate],
};

describe("overlay-wizard _ui seam", () => {
  it("attaches the payload under _ui and reads it back", () => {
    const result = withOverlayWizardUi({ ok: true, treeName: "cyp51A" }, payload);
    expect((result as { _ui: unknown })._ui).toEqual(payload);
    expect(overlayWizardFromResult(result)).toEqual(payload);
  });

  it("is ignored by recordSetFromResult (no items array)", () => {
    const result = withOverlayWizardUi({ ok: true }, payload);
    expect(recordSetFromResult(result)).toBeNull();
  });

  it("returns null for a result with no overlay-wizard _ui", () => {
    expect(overlayWizardFromResult({ ok: true })).toBeNull();
    expect(overlayWizardFromResult(null)).toBeNull();
    expect(overlayWizardFromResult({ _ui: { kind: "experiments", items: [] } })).toBeNull();
  });

  it("rejects a malformed payload (missing treeId / candidates)", () => {
    expect(overlayWizardFromResult({ _ui: { widget: "overlayWizard" } })).toBeNull();
    expect(
      overlayWizardFromResult({ _ui: { widget: "overlayWizard", treeId: "x" } }),
    ).toBeNull();
  });

  it("builds compact model-facing facts (percent + columns)", () => {
    const facts = candidatesToFacts([candidate]);
    expect(facts).toEqual([
      {
        tableName: "Strain metadata",
        joinPercent: 86,
        matchedTips: 6,
        totalTips: 7,
        columns: [
          { name: "Location", kind: "categorical", geoms: ["strip"] },
          { name: "Length", kind: "numeric", geoms: ["bars", "heat", "dots", "point"] },
        ],
      },
    ]);
  });
});
