import { describe, it, expect } from "vitest";
import {
  resolveCompoundComponents,
  distinctComponentTypes,
  missingComponentTypes,
} from "./compound-template-detail";
import type { Method } from "@/lib/types";
import type { MethodTypeId } from "./method-type-registry";

/**
 * Compound (combination) template resolver tests (Extension Store Phase D).
 * Covers reading component types OFF the components graph (not a parallel
 * array), ordering, orphan handling, and the all-types gating set, against a
 * compound METHOD fixture (compound catalog entries are not yet in main).
 */

function method(partial: Partial<Method>): Method {
  return {
    id: 0,
    name: "m",
    owner: "alex",
    method_type: "markdown",
    ...partial,
  } as unknown as Method;
}

// An LC-MS kit fixture: a compound bundling an lc_gradient child + a mass_spec
// child, expressed via the components graph (the locked encoding).
const lcChild = method({ id: 1, owner: "alex", method_type: "lc_gradient", name: "RP gradient" });
const msChild = method({ id: 2, owner: "alex", method_type: "mass_spec", name: "Orbitrap MS" });
const compound = method({
  id: 99,
  owner: "alex",
  method_type: "compound",
  name: "Peptide LC-MS kit",
  components: [
    { method_id: 2, owner: "alex", ordering: 1, label: "MS setup" },
    { method_id: 1, owner: "alex", ordering: 0 },
  ],
});

describe("resolveCompoundComponents", () => {
  it("resolves components in ordering order, reading method_type off the graph", () => {
    const resolved = resolveCompoundComponents(compound, [lcChild, msChild, compound]);
    expect(resolved.map((c) => c.method_id)).toEqual([1, 2]); // ordering 0, then 1
    expect(resolved[0].method_type).toBe("lc_gradient");
    expect(resolved[0].label).toBe("RP gradient"); // falls back to child name
    expect(resolved[1].method_type).toBe("mass_spec");
    expect(resolved[1].label).toBe("MS setup"); // label override wins
  });

  it("marks an orphan reference with a null type and a fallback label", () => {
    const orphanCompound = method({
      id: 5,
      owner: "alex",
      method_type: "compound",
      components: [{ method_id: 404, owner: "alex", ordering: 0 }],
    });
    const resolved = resolveCompoundComponents(orphanCompound, [orphanCompound]);
    expect(resolved).toHaveLength(1);
    expect(resolved[0].method_type).toBeNull();
    expect(resolved[0].label).toBe("Method 404");
  });

  it("defaults a component owner to the compound's owner when unset", () => {
    const c = method({
      id: 7,
      owner: "morgan",
      method_type: "compound",
      components: [{ method_id: 1, owner: null, ordering: 0 }],
    });
    const morganChild = method({ id: 1, owner: "morgan", method_type: "plate", name: "Plate" });
    const resolved = resolveCompoundComponents(c, [morganChild, c]);
    expect(resolved[0].method_type).toBe("plate");
  });
});

describe("distinctComponentTypes", () => {
  it("dedupes and drops orphan (null) types, preserving first-seen order", () => {
    const resolved = resolveCompoundComponents(compound, [lcChild, msChild, compound]);
    expect(distinctComponentTypes(resolved)).toEqual(["lc_gradient", "mass_spec"]);
  });
});

describe("missingComponentTypes", () => {
  const types: MethodTypeId[] = ["lc_gradient", "mass_spec"];

  it("returns all when none are enabled", () => {
    expect(missingComponentTypes(types, new Set())).toEqual([
      "lc_gradient",
      "mass_spec",
    ]);
  });

  it("returns only the not-yet-enabled types", () => {
    expect(
      missingComponentTypes(types, new Set<MethodTypeId>(["lc_gradient"])),
    ).toEqual(["mass_spec"]);
  });

  it("returns empty when all are enabled (kit unlocked)", () => {
    expect(
      missingComponentTypes(
        types,
        new Set<MethodTypeId>(["lc_gradient", "mass_spec"]),
      ),
    ).toEqual([]);
  });
});
