import { describe, expect, it } from "vitest";
import type { CompoundComponent, Method } from "@/lib/types";
import {
  MAX_COMPOUND_DEPTH,
  computeCompoundDepth,
  validateCompoundComponents,
} from "./compound-graph";

function method(partial: Partial<Method> & { id: number; owner: string }): Method {
  return {
    name: `method-${partial.id}-${partial.owner}`,
    source_path: null,
    method_type: "markdown",
    folder_path: null,
    parent_method_id: null,
    tags: null,
    is_public: partial.owner === "public",
    created_by: null,
    shared_with: [],
    ...partial,
  };
}

function compound(
  id: number,
  owner: string,
  components: CompoundComponent[],
): Method {
  return method({ id, owner, method_type: "compound", components });
}

function leaf(id: number, owner: string): Method {
  return method({ id, owner, method_type: "markdown" });
}

function ref(method_id: number, owner: string | null = null, ordering = 0): CompoundComponent {
  return { method_id, owner, ordering };
}

describe("validateCompoundComponents", () => {
  it("accepts a flat compound with a single leaf child", () => {
    const all = [leaf(1, "alex"), compound(2, "alex", [ref(1, "alex")])];
    const result = validateCompoundComponents(
      [ref(1, "alex")],
      all,
      { id: 2, owner: "alex" },
    );
    expect(result.ok).toBe(true);
  });

  it("flags an orphan when a top-level component references a missing method", () => {
    const all = [compound(2, "alex", [ref(999, "alex")])];
    const result = validateCompoundComponents(
      [ref(999, "alex")],
      all,
      { id: 2, owner: "alex" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("orphan_reference");
      expect(result.details.orphan).toEqual({ method_id: 999, owner: "alex" });
    }
  });

  // ── Load-bearing invariant: depth-4 chain renders without error ────────────
  // Master callout: depth=4 is the chain length we ship; a top-level kit
  // bundling 3 nested sub-kits ending in a non-compound leaf must validate
  // cleanly. Regression here means flattening pressure on real lab kits.
  it("depth=4 chain renders without error", () => {
    expect(MAX_COMPOUND_DEPTH).toBe(4);
    // A → B → C → D → leaf. A,B,C,D are compounds; leaf is markdown.
    const all: Method[] = [
      leaf(100, "alex"),
      compound(40, "alex", [ref(100, "alex")]),
      compound(30, "alex", [ref(40, "alex")]),
      compound(20, "alex", [ref(30, "alex")]),
      compound(10, "alex", [ref(20, "alex")]),
    ];
    const result = validateCompoundComponents(
      [ref(20, "alex")],
      all,
      { id: 10, owner: "alex" },
    );
    expect(result.ok).toBe(true);
  });

  // ── Load-bearing invariant: depth-5 chain creation rejects ────────────────
  // Master callout: the depth cap is the safety property keeping the chip-
  // strip TOC navigable. A 5-deep chain must reject with reason
  // "depth_exceeded" so the builder can surface a clear inline message.
  it("depth=5 chain creation rejects with clear error", () => {
    // A → B → C → D → E → leaf, with A,B,C,D,E all compounds.
    const all: Method[] = [
      leaf(100, "alex"),
      compound(50, "alex", [ref(100, "alex")]),
      compound(40, "alex", [ref(50, "alex")]),
      compound(30, "alex", [ref(40, "alex")]),
      compound(20, "alex", [ref(30, "alex")]),
      compound(10, "alex", [ref(20, "alex")]),
    ];
    const result = validateCompoundComponents(
      [ref(20, "alex")],
      all,
      { id: 10, owner: "alex" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("depth_exceeded");
      expect(result.details.depthPath).toBeDefined();
      expect(result.details.depthPath!.length).toBeGreaterThan(0);
    }
  });

  // ── Load-bearing invariant: A → B → A cycle is detected and rejected ──────
  // Master callout: cycle detection is the other half of the recursion-allowed
  // lock. A → B → A must reject with reason "cycle" so the builder can hard-
  // block save before bad data lands on disk.
  it("cycle (A → B → A) is detected and rejected", () => {
    // A references B; B references A. The validator is called for A's
    // in-progress component list referencing B; B's on-disk components
    // already reference A.
    const all: Method[] = [
      compound(1, "alex", [ref(2, "alex")]),
      compound(2, "alex", [ref(1, "alex")]),
    ];
    const result = validateCompoundComponents(
      [ref(2, "alex")],
      all,
      { id: 1, owner: "alex" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("cycle");
      expect(result.details.cyclePath).toBeDefined();
      // The path must include both compounds (the cycle close).
      const ids = result.details.cyclePath!.map((p) => p.method_id);
      expect(ids).toContain(1);
      expect(ids).toContain(2);
    }
  });

  it("flags a self-referential compound (A → A)", () => {
    const all = [compound(1, "alex", [ref(1, "alex")])];
    const result = validateCompoundComponents(
      [ref(1, "alex")],
      all,
      { id: 1, owner: "alex" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("cycle");
    }
  });

  it("treats null component.owner as the compound's owner", () => {
    // The compound at alex/2 references method 1 with owner: null; the
    // resolver should treat that as alex's method 1.
    const all = [leaf(1, "alex")];
    const result = validateCompoundComponents(
      [ref(1, null)],
      all,
      { id: 2, owner: "alex" },
    );
    expect(result.ok).toBe(true);
  });
});

describe("computeCompoundDepth", () => {
  it("returns 1 for a flat compound with only leaf children", () => {
    const all = [leaf(1, "alex")];
    const d = computeCompoundDepth([ref(1, "alex")], all, "alex");
    expect(d).toBe(1);
  });

  it("returns 4 for a 4-level nested chain", () => {
    const all: Method[] = [
      leaf(100, "alex"),
      compound(40, "alex", [ref(100, "alex")]),
      compound(30, "alex", [ref(40, "alex")]),
      compound(20, "alex", [ref(30, "alex")]),
    ];
    const d = computeCompoundDepth([ref(20, "alex")], all, "alex");
    expect(d).toBe(4);
  });
});
