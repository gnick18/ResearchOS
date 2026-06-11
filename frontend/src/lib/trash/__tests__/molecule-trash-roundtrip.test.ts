// chem-trash bot (2026-06-11): the ZERO-DATA-LOSS proof for the two-file
// molecule shape. Molecules are stored as a PAIR (`{id}.mol` + `{id}.meta.json`),
// identical structure to sequences (which have their own roundtrip test).
// These tests prove that trashing a molecule MOVES both files (neither
// orphaned), records ONE index entry, and that restoring puts BOTH files
// back BYTE-FOR-BYTE (the full Molfile) and FIELD-FOR-FIELD (the sidecar) —
// name, project_ids, smiles, inchikey, formula, mol_weight, source, all preserved.
//
// KEY DIFFERENCE from the sequence test: molecule ids are STRING (like "14"),
// NOT numeric. This test exercises that invariant throughout — no Number coercion.
//
// Coverage:
//   1. Single trash -> restore round-trip: Molfile byte equality + every sidecar
//      field + both files gone on trash + both back on restore.
//   2. Empty-Molfile (blank scaffold) round-trips without loss.
//   3. Two-file integrity: neither `.mol` nor `.meta.json` orphaned during trash.
//   4. Index consistency: entry added on trash, removed on restore.
//   5. Restore writes the `.mol` source BEFORE the sidecar (crash-safety order).
//   6. Missing record is a no-op (returns null).
//   7. Name collision disambiguation appends " (restored)".

import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory file system — same double harness as sequence-trash-roundtrip.test.ts.
const memFs = new Map<string, unknown>();

vi.mock("@/lib/file-system/file-service", () => ({
  fileService: {
    readJson: vi.fn(async (path: string) => {
      const v = memFs.get(path);
      return v === undefined ? null : v;
    }),
    writeJson: vi.fn(async (path: string, data: unknown) => {
      memFs.set(path, JSON.parse(JSON.stringify(data)));
    }),
    readText: vi.fn(async (path: string) => {
      const v = memFs.get(path);
      return typeof v === "string" ? v : null;
    }),
    writeText: vi.fn(async (path: string, text: string) => {
      memFs.set(path, text);
    }),
    ensureDir: vi.fn(async () => null),
    deleteFile: vi.fn(async (path: string) => {
      const had = memFs.has(path);
      memFs.delete(path);
      return had;
    }),
    isConnected: vi.fn(() => true),
    listFiles: vi.fn(async (dirPath: string) => {
      const prefix = `${dirPath}/`;
      const out: string[] = [];
      for (const key of memFs.keys()) {
        if (key.startsWith(prefix)) {
          const rest = key.slice(prefix.length);
          if (!rest.includes("/")) out.push(rest);
        }
      }
      return out.sort();
    }),
    fileExists: vi.fn(async (path: string) => memFs.has(path)),
  },
}));

vi.mock("@/lib/settings/user-settings", () => ({
  readUserSettings: vi.fn(async () => ({})),
  DEFAULT_SETTINGS: {},
}));

import {
  trashEntity,
  restoreEntity,
  restoreMoleculeFromTrash,
  listTrash,
  readTrashIndex,
} from "..";

const OWNER = "alex";

// A realistic MDL Molfile — caffeine with a few bond lines. This is the
// SOURCE OF TRUTH that must survive byte-for-byte across the trash/restore cycle.
const MOLFILE_SAMPLE = `
  Mrv2305 06112026 2D

  9  9  0  0  0  0            999 V2000
    1.4289    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0
    0.7145   -1.2374    0.0000 N   0  0  0  0  0  0  0  0  0  0  0  0
   -0.7145   -1.2374    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0
   -1.4289    0.0000    0.0000 N   0  0  0  0  0  0  0  0  0  0  0  0
   -0.7145    1.2374    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0
    0.7145    1.2374    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0
    1.4289   -2.4748    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0
   -1.4289   -2.4748    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0
    2.8579    0.0000    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0
  1  2  1  0  0  0  0
  2  3  1  0  0  0  0
  3  4  2  0  0  0  0
  4  5  1  0  0  0  0
  5  6  2  0  0  0  0
  6  1  1  0  0  0  0
  2  7  1  0  0  0  0
  3  8  2  0  0  0  0
  1  9  2  0  0  0  0
M  END
$$$$
`;

interface MoleculeMetaFixture {
  id: string;
  name: string;
  project_ids: string[];
  added_at: string;
  smiles?: string;
  inchikey?: string;
  formula?: string;
  mol_weight?: number;
  source?: string;
  // A forward-compat field the trash path must NOT drop.
  custom_tag?: string;
}

function metaPath(id: string): string {
  return `users/${OWNER}/molecules/${id}.meta.json`;
}
function molPath(id: string): string {
  return `users/${OWNER}/molecules/${id}.mol`;
}

/** Seed a live molecule pair (`.mol` + `.meta.json`) on the fake disk. */
function seedMolecule(id: string, overrides?: Partial<MoleculeMetaFixture>) {
  const meta: MoleculeMetaFixture = {
    id,
    name: `Molecule ${id}`,
    project_ids: ["2", "5"],
    added_at: "2026-06-11T09:00:00.000Z",
    smiles: "CN1C=NC2=C1C(=O)N(C(=O)N2C)C",
    inchikey: "RYYVLZVUVIJVGH-UHFFFAOYSA-N",
    formula: "C8H10N4O2",
    mol_weight: 194.19,
    source: "drawn",
    custom_tag: "keep me",
    ...overrides,
  };
  memFs.set(molPath(id), MOLFILE_SAMPLE);
  memFs.set(metaPath(id), JSON.parse(JSON.stringify(meta)));
  return meta;
}

/** Strip the `_restore_audit` blob so content-equality assertions prove the
 *  ORIGINAL fields round-trip (the audit is the one sanctioned addition). */
function stripRestoreAudit(rec: unknown): Record<string, unknown> {
  const { _restore_audit, ...rest } = rec as Record<string, unknown>;
  void _restore_audit;
  return rest;
}

function findMoleculeTrashFile(id: string): string | undefined {
  const prefix = `users/${OWNER}/_trash/molecules/${id}-`;
  for (const key of memFs.keys()) {
    if (key.startsWith(prefix) && key.endsWith(".json")) return key;
  }
  return undefined;
}

beforeEach(() => {
  memFs.clear();
});

describe("molecule trash: single round-trip — zero data loss", () => {
  it("trashes BOTH files, records one index entry, restores byte-for-byte", async () => {
    const original = seedMolecule("14");
    const originalMolfile = memFs.get(molPath("14")) as string;

    // --- TRASH ---
    const trashed = await trashEntity({
      owner: OWNER,
      entityType: "molecule",
      id: "14",
      deletedBy: OWNER,
    });
    expect(trashed).not.toBeNull();
    expect(trashed?._trash.deleted_by).toBe(OWNER);

    // Both live files are GONE (neither orphaned).
    expect(memFs.has(metaPath("14"))).toBe(false);
    expect(memFs.has(molPath("14"))).toBe(false);

    // It is gone from the live list (no `.meta.json` for the scan to find).
    const liveMetas = (
      await (
        await import("@/lib/file-system/file-service")
      ).fileService.listFiles(`users/${OWNER}/molecules`)
    ).filter((f) => f.endsWith(".meta.json"));
    expect(liveMetas).toHaveLength(0);

    // Exactly ONE trash file landed, and ONE index entry.
    expect(findMoleculeTrashFile("14")).toBeDefined();
    const index = await readTrashIndex(OWNER);
    const molEntries = index.entries.filter((e) => e.entity_type === "molecule");
    expect(molEntries).toHaveLength(1);
    // id is stored as a STRING — must not have been coerced to Number.
    expect(molEntries[0].id).toBe("14");
    expect(typeof molEntries[0].id).toBe("string");
    expect(molEntries[0].original_path).toBe(metaPath("14"));

    // The trash record embeds the Molfile source verbatim.
    const trashFile = memFs.get(findMoleculeTrashFile("14")!) as Record<
      string,
      unknown
    >;
    expect(trashFile._molecule_molfile).toBe(originalMolfile);

    // --- RESTORE ---
    const restored = await restoreEntity(OWNER, "molecule", "14");
    expect(restored).not.toBeNull();

    // Both files are BACK.
    expect(memFs.has(metaPath("14"))).toBe(true);
    expect(memFs.has(molPath("14"))).toBe(true);

    // Molfile is byte-for-byte identical.
    expect(memFs.get(molPath("14"))).toBe(originalMolfile);

    // Sidecar is field-for-field identical (name, project_ids, smiles,
    // inchikey, formula, mol_weight, source, forward-compat field) with NO
    // `_trash` / `_molecule_molfile` leakage.
    const restoredSidecar = memFs.get(metaPath("14")) as Record<string, unknown>;
    expect(stripRestoreAudit(restoredSidecar)).toEqual(original);
    expect(restoredSidecar._restore_audit).toBeDefined();
    expect(restoredSidecar._trash).toBeUndefined();
    expect(restoredSidecar._molecule_molfile).toBeUndefined();

    // Trash file + index entry are gone after restore.
    expect(findMoleculeTrashFile("14")).toBeUndefined();
    const afterIndex = await readTrashIndex(OWNER);
    expect(
      afterIndex.entries.filter((e) => e.entity_type === "molecule"),
    ).toHaveLength(0);
  });

  it("preserves name, smiles, inchikey, and project links across the cycle", async () => {
    const original = seedMolecule("7", {
      name: "Aspirin",
      smiles: "CC(=O)Oc1ccccc1C(=O)O",
      inchikey: "BSYNRYMUTXBXSQ-UHFFFAOYSA-N",
      project_ids: ["1"],
    });
    const beforeMol = memFs.get(molPath("7")) as string;

    await trashEntity({ owner: OWNER, entityType: "molecule", id: "7", deletedBy: OWNER });
    await restoreEntity(OWNER, "molecule", "7");

    const sidecar = memFs.get(metaPath("7")) as MoleculeMetaFixture;
    expect(sidecar.name).toBe("Aspirin");
    expect(sidecar.smiles).toBe("CC(=O)Oc1ccccc1C(=O)O");
    expect(sidecar.inchikey).toBe("BSYNRYMUTXBXSQ-UHFFFAOYSA-N");
    expect(sidecar.project_ids).toEqual(["1"]);
    expect(stripRestoreAudit(sidecar)).toEqual(original);
    // The Molfile (which determines the 2D structure) is unchanged.
    expect(memFs.get(molPath("7"))).toBe(beforeMol);
  });

  it("id stays a STRING throughout — never coerced to Number", async () => {
    seedMolecule("3");
    await trashEntity({ owner: OWNER, entityType: "molecule", id: "3", deletedBy: OWNER });

    const index = await readTrashIndex(OWNER);
    const entry = index.entries.find((e) => e.entity_type === "molecule");
    expect(entry).toBeDefined();
    expect(entry!.id).toBe("3");
    expect(typeof entry!.id).toBe("string");

    const sidecar = await restoreMoleculeFromTrash(OWNER, "3");
    expect(sidecar).not.toBeNull();
    expect(sidecar!.id).toBe("3");
    expect(typeof sidecar!.id).toBe("string");
  });
});

describe("molecule trash: empty-Molfile scaffold round-trips", () => {
  it("an empty `.mol` is preserved (not lost) across trash/restore", async () => {
    seedMolecule("9", { name: "Blank scaffold" });
    memFs.set(molPath("9"), ""); // a legitimately empty source

    await trashEntity({ owner: OWNER, entityType: "molecule", id: "9", deletedBy: OWNER });
    expect(memFs.has(molPath("9"))).toBe(false);

    await restoreEntity(OWNER, "molecule", "9");
    expect(memFs.has(molPath("9"))).toBe(true);
    expect(memFs.get(molPath("9"))).toBe("");
  });
});

describe("molecule trash: two-file integrity", () => {
  it("neither the `.mol` nor the `.meta.json` is orphaned during trash", async () => {
    seedMolecule("55");
    await trashEntity({ owner: OWNER, entityType: "molecule", id: "55", deletedBy: OWNER });

    // Nothing left in the live molecules dir for this id.
    const liveLeftovers = Array.from(memFs.keys()).filter((k) =>
      k.startsWith(`users/${OWNER}/molecules/55`),
    );
    expect(liveLeftovers).toHaveLength(0);

    // Exactly one artifact on disk for this id: the single trash `.json`.
    const trashArtifacts = Array.from(memFs.keys()).filter((k) =>
      k.includes("/_trash/molecules/55-"),
    );
    expect(trashArtifacts).toHaveLength(1);
  });

  it("restore writes the `.mol` source BEFORE the sidecar (no torn-record window)", async () => {
    const { fileService } = await import("@/lib/file-system/file-service");
    seedMolecule("56");
    await trashEntity({ owner: OWNER, entityType: "molecule", id: "56", deletedBy: OWNER });

    // Track only the writes that target THIS molecule's live pair.
    // The `.mol` source must land before the `.meta.json` sidecar so a torn
    // restore never surfaces a sidecar without its Molfile.
    const pairWrites: string[] = [];
    const writeTextMock = fileService.writeText as unknown as ReturnType<typeof vi.fn>;
    const writeJsonMock = fileService.writeJson as unknown as ReturnType<typeof vi.fn>;
    const origWriteText = writeTextMock.getMockImplementation() as (
      p: string,
      t: string,
    ) => Promise<void>;
    const origWriteJson = writeJsonMock.getMockImplementation() as (
      p: string,
      d: unknown,
    ) => Promise<void>;
    writeTextMock.mockImplementation(async (p: string, t: string) => {
      if (p === molPath("56")) pairWrites.push(`text:${p}`);
      return origWriteText(p, t);
    });
    writeJsonMock.mockImplementation(async (p: string, d: unknown) => {
      if (p === metaPath("56")) pairWrites.push(`json:${p}`);
      return origWriteJson(p, d);
    });

    await restoreMoleculeFromTrash(OWNER, "56");
    writeTextMock.mockImplementation(origWriteText);
    writeJsonMock.mockImplementation(origWriteJson);
    expect(pairWrites).toEqual([`text:${molPath("56")}`, `json:${metaPath("56")}`]);
  });
});

describe("molecule trash: index consistency", () => {
  it("entry added on trash, removed on restore", async () => {
    seedMolecule("200");
    expect(await listTrash(OWNER, "molecule")).toHaveLength(0);
    await trashEntity({ owner: OWNER, entityType: "molecule", id: "200", deletedBy: OWNER });
    expect(await listTrash(OWNER, "molecule")).toHaveLength(1);
    await restoreEntity(OWNER, "molecule", "200");
    expect(await listTrash(OWNER, "molecule")).toHaveLength(0);
  });
});

describe("molecule trash: missing record is a no-op", () => {
  it("trashing a non-existent molecule returns null (nothing to undo)", async () => {
    const t = await trashEntity({
      owner: OWNER,
      entityType: "molecule",
      id: "999",
      deletedBy: OWNER,
    });
    expect(t).toBeNull();
  });

  it("restoring a molecule not in trash returns null", async () => {
    const r = await restoreMoleculeFromTrash(OWNER, "999");
    expect(r).toBeNull();
  });
});

describe("molecule trash: name collision disambiguation", () => {
  it("appends ' (restored)' when a live molecule already has the same name", async () => {
    // Seed molecule "10" with name "Caffeine" and trash it.
    seedMolecule("10", { name: "Caffeine" });
    await trashEntity({ owner: OWNER, entityType: "molecule", id: "10", deletedBy: OWNER });

    // Create a NEW live molecule "11" also named "Caffeine".
    seedMolecule("11", { name: "Caffeine" });

    // Restore "10" — should rename to "Caffeine (restored)" to avoid collision.
    const sidecar = await restoreMoleculeFromTrash(OWNER, "10");
    expect(sidecar).not.toBeNull();
    expect(sidecar!.name).toBe("Caffeine (restored)");

    // The impostor "11" is still named "Caffeine".
    const live11 = memFs.get(metaPath("11")) as MoleculeMetaFixture;
    expect(live11.name).toBe("Caffeine");
  });
});
