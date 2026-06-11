// chem-history bot (2026-06-11): coverage for the molecule editor version-control
// wiring. Locks:
//   - the additive on-disk namespace ("molecules"),
//   - the structured-projection payload round-trip through the engine (genesis +
//     deltas + reverse-walk for restore),
//   - the viewer adapter's projection + molecule-appropriate delta summaries,
//   - the no-op short-circuit (re-saving an unchanged molecule mints no version),
//   - the restore checkpoint (restoring produces a "revert" row with revert kind).

import { describe, expect, it } from "vitest";
import { HistoryEngine } from "@/lib/history/engine";
import { canonicalize } from "@/lib/history/canonicalize";
import { historyFilePath } from "@/lib/history/storage";
import { isGenesisRow, isDeltaRow } from "@/lib/history/types";
import { MemoryStorage, makeClock } from "@/lib/history/test-utils";
import {
  MOLECULES_ENTITY_TYPE,
  moleculePayload,
  projectMoleculeState,
  summarizeMoleculeChange,
  moleculeDigest,
  moleculeAdapter,
  recordMoleculeHistory,
  type MoleculeTrackedState,
  type MoleculeProjection,
} from "./molecule-history";

const OWNER = "alex";
const MOL_ID = "14"; // string id (per-user counter)

function makeEngine() {
  const storage = new MemoryStorage();
  const engine = new HistoryEngine({ storage, clock: makeClock() });
  return { engine, storage };
}

/** A minimal MoleculeMeta-like object for the tests. */
function meta(over: Partial<{
  name: string;
  formula: string;
  mol_weight: number | null;
  smiles: string;
  inchikey: string;
}> = {}) {
  return {
    name: "Aspirin",
    formula: "C9H8O4",
    mol_weight: 180.16,
    smiles: "CC(=O)Oc1ccccc1C(=O)O",
    inchikey: "BSYNRYMUTXBXSQ-UHFFFAOYSA-N",
    ...over,
  };
}

const MOL_A = `
  Mrv2211 06112600002D

  0  0  0  0  0  0            999 V2000
M  END
`.trimStart();

const MOL_B = `
  Mrv2211 06112600002D

  1  0  0  0  0  0            999 V2000
M  END
`.trimStart();

/** Build a tracked state for a given molfile + optional meta overrides. */
function state(molfile: string, metaOver = {}) {
  return moleculePayload(meta(metaOver), molfile);
}

describe("molecules entity type + path", () => {
  it("uses the additive namespace", () => {
    expect(MOLECULES_ENTITY_TYPE).toBe("molecules");
  });
  it("resolves the documented on-disk path", () => {
    expect(historyFilePath(OWNER, MOLECULES_ENTITY_TYPE, MOL_ID)).toBe(
      "users/alex/_history/molecules/14.jsonl",
    );
  });
  it("accepts string ids (per-user counter)", () => {
    // Molecule ids are strings, not numbers.
    expect(typeof MOL_ID).toBe("string");
    expect(historyFilePath(OWNER, MOLECULES_ENTITY_TYPE, MOL_ID)).toContain("14.jsonl");
  });
});

describe("moleculePayload projection", () => {
  it("normalizes trailing whitespace on molfile lines", () => {
    const raw = "  line1  \n  line2   \n";
    const s = moleculePayload(meta(), raw);
    expect(s.molfile).toBe("line1\n  line2");
  });

  it("rounds mol_weight through correctly", () => {
    const s = moleculePayload(meta({ mol_weight: 180.16 }), MOL_A);
    expect(s.mol_weight).toBe(180.16);
  });

  it("handles null mol_weight", () => {
    const s = moleculePayload(meta({ mol_weight: null }), MOL_A);
    expect(s.mol_weight).toBeNull();
  });

  it("sets all required fields", () => {
    const s = moleculePayload(meta(), MOL_A);
    expect(s.name).toBe("Aspirin");
    expect(s.formula).toBe("C9H8O4");
    expect(s.smiles).toBe("CC(=O)Oc1ccccc1C(=O)O");
    expect(s.inchikey).toBe("BSYNRYMUTXBXSQ-UHFFFAOYSA-N");
  });
});

describe("structured payload round-trip through the engine", () => {
  it("creates two checkpoints: genesis + delta on first Save", async () => {
    const { engine } = makeEngine();

    await engine.appendEdit({
      type: "create",
      entityType: MOLECULES_ENTITY_TYPE,
      id: MOL_ID,
      owner: OWNER,
      actor: OWNER,
      prevState: null,
      nextState: state(MOL_A),
    });

    const rows = await engine.readHistory(MOLECULES_ENTITY_TYPE, OWNER, MOL_ID);
    expect(rows).toHaveLength(2); // genesis + 1 delta
    expect(isGenesisRow(rows[0])).toBe(true);
    expect(isDeltaRow(rows[1])).toBe(true);
    expect(rows[1].kind).toBe("create");
  });

  it("create then edit produce two delta checkpoints (3 rows total)", async () => {
    const { engine } = makeEngine();

    await engine.appendEdit({
      type: "create",
      entityType: MOLECULES_ENTITY_TYPE,
      id: MOL_ID,
      owner: OWNER,
      actor: OWNER,
      prevState: null,
      nextState: state(MOL_A),
    });
    await engine.appendEdit({
      type: "update",
      entityType: MOLECULES_ENTITY_TYPE,
      id: MOL_ID,
      owner: OWNER,
      actor: OWNER,
      prevState: state(MOL_A),
      nextState: state(MOL_B, { name: "Edited" }),
    });

    const rows = await engine.readHistory(MOLECULES_ENTITY_TYPE, OWNER, MOL_ID);
    expect(rows).toHaveLength(3); // genesis + 2 deltas
    expect(isGenesisRow(rows[0])).toBe(true);
  });

  it("reconstruct returns the right prior molfile at version 1", async () => {
    const { engine } = makeEngine();
    const stateA = state(MOL_A);
    const stateB = state(MOL_B, { name: "Edited" });

    await engine.appendEdit({
      type: "create",
      entityType: MOLECULES_ENTITY_TYPE,
      id: MOL_ID,
      owner: OWNER,
      actor: OWNER,
      prevState: null,
      nextState: stateA,
    });
    await engine.appendEdit({
      type: "update",
      entityType: MOLECULES_ENTITY_TYPE,
      id: MOL_ID,
      owner: OWNER,
      actor: OWNER,
      prevState: stateA,
      nextState: stateB,
    });

    const rows = await engine.readHistory(MOLECULES_ENTITY_TYPE, OWNER, MOL_ID);
    // headCanonical = the live (stateB) canonical
    const headCanonical = canonicalize(stateB);

    // Version 1 (first delta = stateA)
    const v1canonical = await engine.reconstructState(
      MOLECULES_ENTITY_TYPE,
      OWNER,
      MOL_ID,
      1,
      headCanonical,
    );
    const v1proj = projectMoleculeState(v1canonical);
    expect(v1proj.name).toBe("Aspirin");
    expect(v1proj.molfile).toBe(stateA.molfile);

    // Version 2 (second delta = stateB)
    const v2canonical = await engine.reconstructState(
      MOLECULES_ENTITY_TYPE,
      OWNER,
      MOL_ID,
      2,
      headCanonical,
    );
    const v2proj = projectMoleculeState(v2canonical);
    expect(v2proj.name).toBe("Edited");
    expect(v2proj.molfile).toBe(stateB.molfile);
  });

  it("short-circuits a no-op Save (re-saving unchanged molecule mints no version)", async () => {
    const { engine } = makeEngine();
    const stateA = state(MOL_A);

    await engine.appendEdit({
      type: "create",
      entityType: MOLECULES_ENTITY_TYPE,
      id: MOL_ID,
      owner: OWNER,
      actor: OWNER,
      prevState: null,
      nextState: stateA,
    });
    const before = await engine.readHistory(MOLECULES_ENTITY_TYPE, OWNER, MOL_ID);

    // Re-save identical state: empty-delta short-circuit drops it.
    await engine.appendEdit({
      type: "update",
      entityType: MOLECULES_ENTITY_TYPE,
      id: MOL_ID,
      owner: OWNER,
      actor: OWNER,
      prevState: stateA,
      nextState: stateA,
    });
    const after = await engine.readHistory(MOLECULES_ENTITY_TYPE, OWNER, MOL_ID);
    expect(after).toHaveLength(before.length);
  });

  it("restore writes a 'revert' checkpoint and adds a forward row", async () => {
    const { engine } = makeEngine();
    const stateA = state(MOL_A, { name: "A" });
    const stateB = state(MOL_B, { name: "B" });

    await engine.appendEdit({
      type: "create",
      entityType: MOLECULES_ENTITY_TYPE,
      id: MOL_ID,
      owner: OWNER,
      actor: OWNER,
      prevState: null,
      nextState: stateA,
    });
    await engine.appendEdit({
      type: "update",
      entityType: MOLECULES_ENTITY_TYPE,
      id: MOL_ID,
      owner: OWNER,
      actor: OWNER,
      prevState: stateA,
      nextState: stateB,
    });
    const beforeRows = await engine.readHistory(MOLECULES_ENTITY_TYPE, OWNER, MOL_ID);
    const beforeCount = beforeRows.length;

    // Simulate a restore: write a "revert" row where prev=stateB (HEAD), next=stateA (restored).
    await engine.appendEdit({
      type: "revert",
      entityType: MOLECULES_ENTITY_TYPE,
      id: MOL_ID,
      owner: OWNER,
      actor: OWNER,
      prevState: stateB,
      nextState: stateA,
      revertTargetVersion: 1,
    });

    const afterRows = await engine.readHistory(MOLECULES_ENTITY_TYPE, OWNER, MOL_ID);
    expect(afterRows).toHaveLength(beforeCount + 1);
    const revertRow = afterRows[afterRows.length - 1];
    expect(revertRow.kind).toBe("revert");
  });

  it("reverse-walks to an earlier version for restore", async () => {
    const { engine } = makeEngine();
    const states = [
      state(MOL_A, { name: "v1" }),
      state(MOL_B, { name: "v2" }),
    ];
    let prev: MoleculeTrackedState | null = null;
    for (const s of states) {
      await engine.appendEdit({
        type: prev ? "update" : "create",
        entityType: MOLECULES_ENTITY_TYPE,
        id: MOL_ID,
        owner: OWNER,
        actor: OWNER,
        prevState: prev,
        nextState: s,
      });
      prev = s;
    }
    const rows = await engine.readHistory(MOLECULES_ENTITY_TYPE, OWNER, MOL_ID);
    const headCanonical = canonicalize(states[states.length - 1]);
    // Reverse-walk to version 1 (stateA)
    const v1canonical = engine.reverseWalkTo(rows, 1, headCanonical);
    const v1 = projectMoleculeState(v1canonical);
    expect(v1.name).toBe("v1");
    expect(v1.molfile).toBe(states[0].molfile);
  });
});

describe("recordMoleculeHistory (best-effort wrapper)", () => {
  it("swallows errors and does not throw", async () => {
    // Pass invalid state to trigger a potential internal failure; must not throw.
    await expect(
      recordMoleculeHistory({
        type: "update",
        id: MOL_ID,
        owner: OWNER,
        actor: OWNER,
        prevState: null,
        nextState: state(MOL_A),
      }),
    ).resolves.toBeUndefined();
  });
});

describe("molecule adapter projection + summaries", () => {
  it("projects a malformed/empty canonical to the empty shape", () => {
    expect(projectMoleculeState(null).name).toBe("");
    expect(projectMoleculeState("").formula).toBe("");
    expect(projectMoleculeState("not json").body).toBe("");
  });

  it("builds the compact digest", () => {
    const p: MoleculeProjection = {
      body: "",
      name: "Aspirin",
      formula: "C9H8O4",
      mol_weight: 180.16,
      smiles: "CC(=O)Oc1ccccc1C(=O)O",
      inchikey: "BSYNRYMUTXBXSQ-UHFFFAOYSA-N",
      molfile: MOL_A,
    };
    expect(moleculeDigest(p)).toBe("Aspirin, C9H8O4, 180.16 g/mol");
  });

  it("digest omits absent fields gracefully", () => {
    const p: MoleculeProjection = {
      body: "",
      name: "",
      formula: "",
      mol_weight: null,
      smiles: "",
      inchikey: "",
      molfile: "",
    };
    expect(moleculeDigest(p)).toBe("");
  });

  const base: MoleculeProjection = {
    body: "Aspirin, C9H8O4, 180.16 g/mol",
    name: "Aspirin",
    formula: "C9H8O4",
    mol_weight: 180.16,
    smiles: "CC(=O)Oc1ccccc1C(=O)O",
    inchikey: "BSYNRYMUTXBXSQ-UHFFFAOYSA-N",
    molfile: MOL_A,
  };

  it("summarizes created / name / structure / no-change cases", () => {
    expect(summarizeMoleculeChange(null, base)).toBe("created structure");
    expect(
      summarizeMoleculeChange(base, { ...base, name: "Ibuprofen" }),
    ).toBe("renamed to Ibuprofen");
    expect(
      summarizeMoleculeChange(base, { ...base, molfile: MOL_B, smiles: "different" }),
    ).toBe("edited structure");
    expect(summarizeMoleculeChange(base, { ...base })).toBe("saved (no change)");
  });

  it("labels restore / undo rows", () => {
    expect(summarizeMoleculeChange(base, base, "revert")).toBe(
      "Restored an earlier version",
    );
    expect(summarizeMoleculeChange(base, base, "undo-revert")).toBe(
      "Undid a restore",
    );
  });

  it("detects identity change when structure is unchanged", () => {
    const updated = { ...base, formula: "C10H10O4", mol_weight: 194.18 };
    expect(summarizeMoleculeChange(base, updated)).toBe("updated identity");
  });

  it("exposes the adapter shape the panel consumes", () => {
    expect(moleculeAdapter.projectBody("not json").body).toBe("");
    expect(moleculeAdapter.summarize(null, base)).toBe("created structure");
  });
});
