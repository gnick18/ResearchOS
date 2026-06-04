// seq delete trash bot (2026-06-04): the ZERO-DATA-LOSS proof for the
// two-file sequence shape. Sequences are stored as a PAIR (`{id}.gb` +
// `{id}.meta.json`), unlike every other trash type (single `{id}.json`).
// These tests prove that trashing a sequence MOVES both files (neither
// orphaned), records ONE index entry, and that restoring puts BOTH files
// back BYTE-FOR-BYTE (the full GenBank) and FIELD-FOR-FIELD (the sidecar) —
// bases, features, seqType, length, name, project links, all preserved.
//
// Coverage:
//   1. Single trash -> restore round-trip, asserting GenBank byte equality +
//      every sidecar field + both files gone on trash + both back on restore.
//   2. Bulk trash -> restore (several sequences).
//   3. Two-file integrity: neither `.gb` nor `.meta.json` orphaned/lost.
//   4. Index consistency: entry added on trash, removed on restore.
//   5. Empty-GenBank (blank scaffold) round-trips without loss.
//   6. Regression: the existing single-`.json` entity path still works.

import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory file system that backs BOTH the JSON record store and the raw
// text store sequences use. The R2 harness only mocked readJson/writeJson;
// sequences also need readText/writeText, so this double carries both.
const memFs = new Map<string, unknown>();

vi.mock("@/lib/file-system/file-service", () => ({
  fileService: {
    readJson: vi.fn(async (path: string) => {
      const v = memFs.get(path);
      return v === undefined ? null : v;
    }),
    writeJson: vi.fn(async (path: string, data: unknown) => {
      // Clone so callers can't mutate what's "on disk" (matches the real
      // serialize-to-disk boundary) — this is what makes byte-for-byte
      // assertions meaningful.
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
  restoreSequenceFromTrash,
  listTrash,
  readTrashIndex,
} from "..";

const OWNER = "mira";

// A realistic GenBank record: a small circular plasmid with bases + two
// annotated features. This is the SOURCE OF TRUTH that must survive
// byte-for-byte across the trash/restore cycle.
const GENBANK_SAMPLE = `LOCUS       pTEST                 60 bp ds-DNA     circular     04-JUN-2026
DEFINITION  A test plasmid with two features.
FEATURES             Location/Qualifiers
     promoter        1..20
                     /label="T7 promoter"
     CDS             21..50
                     /label="ORF"
                     /translation="MAAS"
ORIGIN
        1 atggcagcat ctgacgtacg ttagccatgg ctagcttaag ccatggctag cttaagccat
//
`;

interface SequenceSidecar {
  id: number;
  display_name: string;
  project_ids: string[];
  added_at: string;
  seq_type: "dna" | "rna" | "protein";
  // A forward-compat field the trash path must NOT drop.
  custom_note?: string;
}

function metaPath(id: number): string {
  return `users/${OWNER}/sequences/${id}.meta.json`;
}
function gbPath(id: number): string {
  return `users/${OWNER}/sequences/${id}.gb`;
}

/** Seed a live sequence pair (`.gb` + `.meta.json`) on the fake disk. */
function seedSequence(id: number, overrides?: Partial<SequenceSidecar>) {
  const sidecar: SequenceSidecar = {
    id,
    display_name: `Plasmid ${id}`,
    project_ids: ["3", "7"],
    added_at: "2026-06-01T12:00:00.000Z",
    seq_type: "dna",
    custom_note: "keep me",
    ...overrides,
  };
  memFs.set(gbPath(id), GENBANK_SAMPLE);
  memFs.set(metaPath(id), JSON.parse(JSON.stringify(sidecar)));
  return sidecar;
}

function findSequenceTrashFile(id: number): string | undefined {
  const prefix = `users/${OWNER}/_trash/sequences/${id}-`;
  for (const key of memFs.keys()) {
    if (key.startsWith(prefix) && key.endsWith(".json")) return key;
  }
  return undefined;
}

beforeEach(() => {
  memFs.clear();
});

describe("seq trash: single round-trip — zero data loss", () => {
  it("trashes BOTH files, records one index entry, restores byte-for-byte", async () => {
    const original = seedSequence(42);
    const originalGenbank = memFs.get(gbPath(42)) as string;

    // --- TRASH ---
    const trashed = await trashEntity({
      owner: OWNER,
      entityType: "sequence",
      id: 42,
      deletedBy: OWNER,
    });
    expect(trashed).not.toBeNull();
    expect(trashed?._trash.deleted_by).toBe(OWNER);

    // Both live files are GONE (neither orphaned).
    expect(memFs.has(metaPath(42))).toBe(false);
    expect(memFs.has(gbPath(42))).toBe(false);

    // It's gone from the live list (no `.meta.json` for the scan to find).
    const liveMetas = (await (
      await import("@/lib/file-system/file-service")
    ).fileService.listFiles(`users/${OWNER}/sequences`)).filter((f) =>
      f.endsWith(".meta.json"),
    );
    expect(liveMetas).toHaveLength(0);

    // Exactly ONE trash file landed, and ONE index entry.
    expect(findSequenceTrashFile(42)).toBeDefined();
    const index = await readTrashIndex(OWNER);
    const seqEntries = index.entries.filter((e) => e.entity_type === "sequence");
    expect(seqEntries).toHaveLength(1);
    expect(seqEntries[0].id).toBe(42);
    expect(seqEntries[0].original_path).toBe(metaPath(42));

    // The trash record embeds the GenBank source verbatim.
    const trashFile = memFs.get(findSequenceTrashFile(42)!) as Record<
      string,
      unknown
    >;
    expect(trashFile._sequence_genbank).toBe(originalGenbank);

    // --- RESTORE ---
    const restored = await restoreEntity(OWNER, "sequence", 42);
    expect(restored).not.toBeNull();

    // Both files are BACK.
    expect(memFs.has(metaPath(42))).toBe(true);
    expect(memFs.has(gbPath(42))).toBe(true);

    // GenBank is byte-for-byte identical (bases + features + translation).
    expect(memFs.get(gbPath(42))).toBe(originalGenbank);

    // Sidecar is field-for-field identical (name, project links, seqType,
    // added_at, the forward-compat custom field) with NO `_trash` /
    // `_sequence_genbank` leakage.
    const restoredSidecar = memFs.get(metaPath(42)) as Record<string, unknown>;
    expect(restoredSidecar).toEqual(original);
    expect(restoredSidecar._trash).toBeUndefined();
    expect(restoredSidecar._sequence_genbank).toBeUndefined();

    // Trash file + index entry are gone after restore.
    expect(findSequenceTrashFile(42)).toBeUndefined();
    const afterIndex = await readTrashIndex(OWNER);
    expect(
      afterIndex.entries.filter((e) => e.entity_type === "sequence"),
    ).toHaveLength(0);
  });

  it("preserves seq_type, length-bearing bases, and name across the cycle", async () => {
    const original = seedSequence(7, {
      display_name: "Important RNA construct",
      seq_type: "rna",
      project_ids: [],
    });
    const beforeGb = memFs.get(gbPath(7)) as string;

    await trashEntity({ owner: OWNER, entityType: "sequence", id: 7, deletedBy: OWNER });
    await restoreEntity(OWNER, "sequence", 7);

    const sidecar = memFs.get(metaPath(7)) as SequenceSidecar;
    expect(sidecar.seq_type).toBe("rna");
    expect(sidecar.display_name).toBe("Important RNA construct");
    expect(sidecar.project_ids).toEqual([]);
    expect(sidecar).toEqual(original);
    // The bases (which determine length) are unchanged.
    expect(memFs.get(gbPath(7))).toBe(beforeGb);
  });
});

describe("seq trash: empty-GenBank scaffold round-trips", () => {
  it("an empty `.gb` is preserved (not lost) across trash/restore", async () => {
    seedSequence(9, { display_name: "Blank scaffold" });
    memFs.set(gbPath(9), ""); // a legitimately empty source

    await trashEntity({ owner: OWNER, entityType: "sequence", id: 9, deletedBy: OWNER });
    expect(memFs.has(gbPath(9))).toBe(false);

    await restoreEntity(OWNER, "sequence", 9);
    expect(memFs.has(gbPath(9))).toBe(true);
    expect(memFs.get(gbPath(9))).toBe("");
  });
});

describe("seq trash: bulk round-trip", () => {
  it("trashes + restores several sequences, each pair intact", async () => {
    const ids = [101, 102, 103, 104];
    const originals = new Map<number, SequenceSidecar>();
    const gbs = new Map<number, string>();
    for (const id of ids) {
      originals.set(id, seedSequence(id, { display_name: `Seq ${id}` }));
      gbs.set(id, memFs.get(gbPath(id)) as string);
    }

    // Bulk trash.
    for (const id of ids) {
      const t = await trashEntity({
        owner: OWNER,
        entityType: "sequence",
        id,
        deletedBy: OWNER,
      });
      expect(t).not.toBeNull();
    }
    // All gone from live; all four in the trash index.
    for (const id of ids) {
      expect(memFs.has(metaPath(id))).toBe(false);
      expect(memFs.has(gbPath(id))).toBe(false);
    }
    const trashList = await listTrash(OWNER, "sequence");
    expect(trashList).toHaveLength(4);

    // Bulk restore.
    for (const id of ids) {
      const r = await restoreSequenceFromTrash(OWNER, id);
      expect(r).not.toBeNull();
    }
    // Every pair is back + identical.
    for (const id of ids) {
      expect(memFs.get(metaPath(id))).toEqual(originals.get(id));
      expect(memFs.get(gbPath(id))).toBe(gbs.get(id));
    }
    // Trash is empty.
    expect(await listTrash(OWNER, "sequence")).toHaveLength(0);
  });
});

describe("seq trash: two-file integrity", () => {
  it("neither the `.gb` nor the `.meta.json` is orphaned during trash", async () => {
    seedSequence(55);
    await trashEntity({ owner: OWNER, entityType: "sequence", id: 55, deletedBy: OWNER });

    // Nothing left in the live sequences dir for this id.
    const liveLeftovers = Array.from(memFs.keys()).filter((k) =>
      k.startsWith(`users/${OWNER}/sequences/55`),
    );
    expect(liveLeftovers).toHaveLength(0);

    // Exactly one artifact on disk for this id: the single trash `.json`.
    const trashArtifacts = Array.from(memFs.keys()).filter((k) =>
      k.includes("/_trash/sequences/55-"),
    );
    expect(trashArtifacts).toHaveLength(1);
  });

  it("restore writes the `.gb` source BEFORE the sidecar (no torn-record window)", async () => {
    const { fileService } = await import("@/lib/file-system/file-service");
    seedSequence(56);
    await trashEntity({ owner: OWNER, entityType: "sequence", id: 56, deletedBy: OWNER });

    // Track only the writes that target THIS sequence's live pair (the index
    // writeJson to `_trash/_index.json` is noise here). The `.gb` source must
    // land before the `.meta.json` sidecar so a torn restore never surfaces a
    // sidecar without its bases.
    const pairWrites: string[] = [];
    const writeTextMock = fileService.writeText as unknown as ReturnType<
      typeof vi.fn
    >;
    const writeJsonMock = fileService.writeJson as unknown as ReturnType<
      typeof vi.fn
    >;
    const origWriteText = writeTextMock.getMockImplementation() as (
      p: string,
      t: string,
    ) => Promise<void>;
    const origWriteJson = writeJsonMock.getMockImplementation() as (
      p: string,
      d: unknown,
    ) => Promise<void>;
    writeTextMock.mockImplementation(async (p: string, t: string) => {
      if (p === gbPath(56)) pairWrites.push(`text:${p}`);
      return origWriteText(p, t);
    });
    writeJsonMock.mockImplementation(async (p: string, d: unknown) => {
      if (p === metaPath(56)) pairWrites.push(`json:${p}`);
      return origWriteJson(p, d);
    });

    await restoreSequenceFromTrash(OWNER, 56);
    writeTextMock.mockImplementation(origWriteText);
    writeJsonMock.mockImplementation(origWriteJson);
    expect(pairWrites).toEqual([`text:${gbPath(56)}`, `json:${metaPath(56)}`]);
  });
});

describe("seq trash: index consistency", () => {
  it("entry added on trash, removed on restore", async () => {
    seedSequence(200);
    expect(await listTrash(OWNER, "sequence")).toHaveLength(0);
    await trashEntity({ owner: OWNER, entityType: "sequence", id: 200, deletedBy: OWNER });
    expect(await listTrash(OWNER, "sequence")).toHaveLength(1);
    await restoreEntity(OWNER, "sequence", 200);
    expect(await listTrash(OWNER, "sequence")).toHaveLength(0);
  });
});

describe("seq trash: missing record is a no-op", () => {
  it("trashing a non-existent sequence returns null (nothing to undo)", async () => {
    const t = await trashEntity({
      owner: OWNER,
      entityType: "sequence",
      id: 999,
      deletedBy: OWNER,
    });
    expect(t).toBeNull();
  });

  it("restoring a sequence not in trash returns null", async () => {
    const r = await restoreSequenceFromTrash(OWNER, 999);
    expect(r).toBeNull();
  });
});

describe("seq trash: regression — single-`.json` entity still round-trips", () => {
  it("a method (single JSON record) trashes + restores unchanged", async () => {
    const live = {
      id: 5,
      name: "Site-directed mutagenesis",
      owner: OWNER,
      parent_method_id: null,
    };
    memFs.set(`users/${OWNER}/methods/5.json`, JSON.parse(JSON.stringify(live)));

    const trashed = await trashEntity({
      owner: OWNER,
      entityType: "method",
      id: 5,
      deletedBy: OWNER,
    });
    expect(trashed).not.toBeNull();
    // Live JSON gone, no stray `.gb` / sidecar created.
    expect(memFs.has(`users/${OWNER}/methods/5.json`)).toBe(false);
    expect(memFs.has(`users/${OWNER}/methods/5.gb`)).toBe(false);

    const restored = await restoreEntity(OWNER, "method", 5);
    expect(restored).toEqual(live);
    expect(memFs.has(`users/${OWNER}/methods/5.json`)).toBe(true);
  });
});
