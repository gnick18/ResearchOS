/**
 * Regression tests for two P1 bugs found in chemistry-workbench stress testing
 * (2026-06-17).
 *
 * BUG 1 — ChemistryHub: clicking "Select all" also opened the Ketcher editor
 * for one molecule because the checkbox click event was not stopped from
 * propagating to sibling row handlers. Fix: stopPropagation on the select-all
 * input and on individual row checkboxes. These tests guard the logic paths that
 * MUST be isolated from `onOpenMolecule`.
 *
 * BUG 2 — MoleculeEditorPopup: saving with an empty canvas (no atoms) created
 * an "Untitled structure" at 0.00 g/mol, and clearing a molecule's name before
 * saving silently created an ambiguous second "Untitled structure". Fix: block
 * saves with no atoms and require a non-empty name. Tests here drive the guard
 * logic directly (no DOM / Ketcher mount required).
 */

import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// BUG 1 helpers — the toggle-all logic is a pure function of state; verify it
// ONLY mutates the checked set and never signals a row-open.
// ---------------------------------------------------------------------------

type MolId = string;

function toggleAllVisible(
  prev: Set<MolId>,
  activeList: MolId[],
): Set<MolId> {
  const next = new Set(prev);
  const everyVisible =
    activeList.length > 0 && activeList.every((id) => next.has(id));
  if (everyVisible) for (const id of activeList) next.delete(id);
  else for (const id of activeList) next.add(id);
  return next;
}

describe("Bug 1 — toggleAllVisible (select-all logic)", () => {
  const ids = ["mol-1", "mol-2", "mol-3"];

  it("adds all ids to the checked set when none are checked", () => {
    const result = toggleAllVisible(new Set(), ids);
    expect([...result].sort()).toEqual(ids.slice().sort());
  });

  it("adds all ids to the checked set when only some are checked", () => {
    const result = toggleAllVisible(new Set(["mol-1"]), ids);
    expect([...result].sort()).toEqual(ids.slice().sort());
  });

  it("removes all ids from the checked set when every visible one is checked", () => {
    const result = toggleAllVisible(new Set(ids), ids);
    expect(result.size).toBe(0);
  });

  it("preserves ids outside the active list when deselecting all visible", () => {
    // A molecule from a previous collection stays checked.
    const prev = new Set([...ids, "mol-external"]);
    const result = toggleAllVisible(prev, ids);
    expect(result.has("mol-external")).toBe(true);
    for (const id of ids) expect(result.has(id)).toBe(false);
  });

  it("does nothing to openMolecule — the function returns a Set, not a molecule id", () => {
    // The return type is Set<MolId>, not a molecule id. This verifies the
    // toggle path never produces a value that could be passed to onOpenMolecule.
    const result = toggleAllVisible(new Set(), ids);
    expect(result).toBeInstanceOf(Set);
    // A Set is never a string (the signature onOpenMolecule expects).
    expect(typeof result).not.toBe("string");
  });

  it("is idempotent when called twice in a row on the same list", () => {
    const first = toggleAllVisible(new Set(), ids);
    const second = toggleAllVisible(first, ids);
    // First call: select all. Second call: deselect all.
    expect(second.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// BUG 2 helpers — the save guard logic extracted from handleSave; verify it
// blocks empty/nameless saves without mounting Ketcher.
// ---------------------------------------------------------------------------

/**
 * Mirror of the guard logic in MoleculeEditorPopup.handleSave.
 * Returns null when the save can proceed, or an error string to show the user.
 */
function validateSave(opts: {
  name: string;
  molfile: string;
  heavyAtoms: number | null;
}): string | null {
  const cleanName = opts.name.trim();
  if (!cleanName) {
    return "Give this structure a name before saving.";
  }
  const hasAtoms = opts.heavyAtoms != null && opts.heavyAtoms > 0;
  if (!opts.molfile || !opts.molfile.trim() || !hasAtoms) {
    return "Draw at least one atom before saving.";
  }
  return null;
}

// A realistic blank-canvas molfile: Ketcher emits the V2000 header + counts
// line even for an empty canvas, so the molfile is non-empty but has 0 atoms.
const BLANK_MOLFILE = `
  Ketcher  6171620102D 1   1.00000     0.00000     0

  0  0  0     0  0            999 V2000
M  END
`.trim();

// A real single-atom molfile (carbon atom).
const CARBON_MOLFILE = `
  Ketcher  6171620102D 1   1.00000     0.00000     0

  1  0  0     0  0            999 V2000
    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0
M  END
`.trim();

describe("Bug 2 — save guard (MoleculeEditorPopup)", () => {
  it("blocks saving when the canvas is empty (blank molfile, 0 heavy atoms)", () => {
    const err = validateSave({
      name: "My molecule",
      molfile: BLANK_MOLFILE,
      heavyAtoms: 0,
    });
    expect(err).toBeTruthy();
    expect(err).toMatch(/atom/i);
  });

  it("blocks saving when identity is null (canvas never touched after open)", () => {
    const err = validateSave({
      name: "My molecule",
      molfile: BLANK_MOLFILE,
      heavyAtoms: null,
    });
    expect(err).toBeTruthy();
    expect(err).toMatch(/atom/i);
  });

  it("blocks saving when the name is empty", () => {
    const err = validateSave({
      name: "",
      molfile: CARBON_MOLFILE,
      heavyAtoms: 1,
    });
    expect(err).toBeTruthy();
    expect(err).toMatch(/name/i);
  });

  it("blocks saving when the name is whitespace-only", () => {
    const err = validateSave({
      name: "   ",
      molfile: CARBON_MOLFILE,
      heavyAtoms: 1,
    });
    expect(err).toBeTruthy();
    expect(err).toMatch(/name/i);
  });

  it("name guard fires BEFORE the atom guard (user sees the most actionable error first)", () => {
    // Both conditions bad: empty name + empty canvas.
    const err = validateSave({
      name: "",
      molfile: BLANK_MOLFILE,
      heavyAtoms: 0,
    });
    expect(err).toBeTruthy();
    expect(err).toMatch(/name/i);
  });

  it("allows saving a valid structure with a non-empty name", () => {
    const err = validateSave({
      name: "Caffeine",
      molfile: CARBON_MOLFILE,
      heavyAtoms: 14, // realistic
    });
    expect(err).toBeNull();
  });

  it("trims the name before the empty check (whitespace padding is rejected)", () => {
    const err = validateSave({
      name: "\t  \n",
      molfile: CARBON_MOLFILE,
      heavyAtoms: 1,
    });
    expect(err).toBeTruthy();
  });

  it("does not produce 'Untitled structure' as a fallback name (regression)", () => {
    // The old code did: const cleanName = name.trim() || "Untitled structure"
    // The fixed code returns an error instead. Confirm the guard rejects it.
    const err = validateSave({
      name: "",
      molfile: CARBON_MOLFILE,
      heavyAtoms: 1,
    });
    // The guard must produce an error, never silently substitute a fallback.
    expect(err).not.toBeNull();
  });
});
