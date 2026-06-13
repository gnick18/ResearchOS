// Phylo Phase 3: the template-apply path (the flicker fix).
//
// The flicker was a transient render where the panels had changed but the picker
// still showed the placeholder. The fix commits the whole next state atomically
// (panels + cleared selection + the applied-template marker) and binds the picker
// to the applied id so it does not snap back. The pure, testable core of that
// apply is buildTemplate: given the available columns it returns a COMPLETE,
// self-contained layer stack in one call (no partial / two-step state), so the
// apply has nothing to revert. These tests pin that contract.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import { buildTemplate, TEMPLATE_IDS } from "./PhyloLayers";
import type { AlignedPanel } from "@/lib/phylo/types";

const COLUMNS = ["section", "genome", "gliP", "load"];
const NUMERIC = ["genome", "load"];

describe("buildTemplate", () => {
  it("returns a complete layer stack for every template id", () => {
    for (const id of TEMPLATE_IDS) {
      const stack = buildTemplate(id, COLUMNS, NUMERIC);
      expect(Array.isArray(stack)).toBe(true);
      expect(stack.length).toBeGreaterThan(0);
      // Every layer is a fully-formed panel (id + kind + visible), nothing partial.
      for (const p of stack) {
        expect(typeof p.id).toBe("string");
        expect(p.id.length).toBeGreaterThan(0);
        expect(typeof p.kind).toBe("string");
        expect(p.visible).toBe(true);
      }
    }
  });

  it("is structurally deterministic (same kinds + bindings across calls)", () => {
    // Ids carry a timestamp + counter (unique per call by design), so compare the
    // STRUCTURE the apply commits: kinds + bound columns, which must be identical.
    const shape = (s: AlignedPanel[]) =>
      s.map((p) => ({
        kind: p.kind,
        column: p.column ?? null,
        columns: p.columns ?? null,
      }));
    for (const id of TEMPLATE_IDS) {
      const a = shape(buildTemplate(id, COLUMNS, NUMERIC));
      const b = shape(buildTemplate(id, COLUMNS, NUMERIC));
      expect(a).toEqual(b);
    }
  });

  it("binds the gheatmap template to the numeric columns", () => {
    const stack = buildTemplate("gheatmap", COLUMNS, NUMERIC);
    const heat = stack.find((p) => p.kind === "heat");
    expect(heat).toBeTruthy();
    expect(heat?.columns?.length).toBeGreaterThan(0);
    // Heat columns are the numeric ones (a value matrix), not the tip-id column.
    for (const c of heat?.columns ?? []) expect(NUMERIC).toContain(c);
  });

  it("never binds a layer to an absent column when columns are empty", () => {
    for (const id of TEMPLATE_IDS) {
      const stack = buildTemplate(id, [], []);
      // With no columns, only structural (column-free) layers survive, so no
      // layer carries a phantom binding.
      for (const p of stack) {
        expect(p.column ?? "").toBe("");
        expect(p.columns ?? []).toEqual([]);
      }
    }
  });
});
