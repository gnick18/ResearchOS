// Lab-tier Phase 3 chunk 2b-bind: local-api LabWorkSource adapter tests.
//
// Covers:
//   - Unit: createLocalApiLabWorkSource() routes each method to the correct
//     JsonStore collection (tasks/notes/methods/purchase_items/inventory_items/
//     inventory_stocks) and forwards listAllForUser(owner) results through unchanged.
//   - Unit: the six new adapter methods (listInventory, listInventoryStock,
//     listSequences, listPhylo, listMolecules, listDatahub) delegate to the correct
//     store/API and return the correct records.
//   - Integration: the source fed into the REAL enumerateLabWork() produces
//     LabWorkRecord[] with correct recordType and recordId values.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createLocalApiLabWorkSource } from "../lab-work-source-localapi";
import { enumerateLabWork } from "../lab-work-enumerate";

// ---------------------------------------------------------------------------
// Mock JsonStore
// ---------------------------------------------------------------------------

// Fixture data keyed by collection name.
const FIXTURES: Record<string, Array<{ id: number; [k: string]: unknown }>> = {
  tasks: [
    { id: 1, title: "Run gel", task_type: "task" },
    { id: 2, title: "CRISPR experiment", task_type: "experiment" },
  ],
  notes: [{ id: 10, body: "Observe colonies" }],
  methods: [{ id: 20, name: "PCR protocol" }],
  purchase_items: [{ id: 30, item: "Taq polymerase" }],
  inventory_items: [{ id: 40, name: "Agarose" }],
  inventory_stocks: [{ id: 50, item_id: 40, quantity: 3 }],
};

// Track which collection each JsonStore instance was created for, and capture
// listAllForUser calls so we can assert the right owner was used.
const mockListAllForUser = vi.fn((owner: string) => {
  // Returned below via instance-level closure.
  void owner;
  return Promise.resolve([]);
});

// Force the multi-lab flag ON so the P2 mentorship / check-in methods read their
// stores (with the flag off they return [] by design, the byte-identical-off
// guarantee, which is covered by its own test below).
vi.mock("@/lib/lab/lab-as-folder-config", () => ({
  LAB_AS_FOLDER_ENABLED: true,
}));

vi.mock("@/lib/storage/json-store", () => {
  // Each JsonStore instance receives the collection name in its constructor.
  // We use that to look up the correct fixture array.
  // Must be a regular function (not an arrow) so `new MockJsonStore(...)` works.
  function MockJsonStore(this: { listAllForUser: ReturnType<typeof vi.fn> }, collectionName: string) {
    this.listAllForUser = vi.fn((owner: string) => {
      void owner;
      return Promise.resolve(FIXTURES[collectionName] ?? []);
    });
  }
  const SpyableJsonStore = vi.fn(MockJsonStore as unknown as new (collectionName: string) => { listAllForUser: ReturnType<typeof vi.fn> });
  return { JsonStore: SpyableJsonStore };
});

// ---------------------------------------------------------------------------
// Mock sequencesApi, phyloApi, moleculeStore, and datahub sidecar store.
// ---------------------------------------------------------------------------

const SEQUENCE_FIXTURES = [{ id: 100, display_name: "pUC19", seq_type: "dna" }];
const PHYLO_FIXTURES = [{ id: "phylo-abc", name: "My tree" }];
const MOLECULE_FIXTURES = [{ id: "mol-xyz", name: "Caffeine" }];
const DATAHUB_FIXTURES = [
  { id: "dh-001", meta: { id: "dh-001", name: "Results" }, columns: [], rows: [] },
];

vi.mock("@/lib/local-api", () => ({
  sequencesApi: {
    getForUser: vi.fn((_owner: string) => Promise.resolve(SEQUENCE_FIXTURES)),
  },
}));

vi.mock("@/lib/phylo/api", () => ({
  phyloApi: {
    listForUser: vi.fn((_owner: string) => Promise.resolve(PHYLO_FIXTURES)),
  },
}));

vi.mock("@/lib/chemistry/molecule-store", () => ({
  moleculeStore: {
    listMetaForUser: vi.fn((_owner: string) => Promise.resolve(MOLECULE_FIXTURES)),
  },
}));

// Mock datahub-sidecar-store: dataHubDir returns a predictable path and
// readDataHubMirror returns the fixture mirror content.
vi.mock("@/lib/loro/datahub-sidecar-store", () => ({
  dataHubDir: vi.fn((owner: string) => `users/${owner}/datahub`),
  readDataHubMirror: vi.fn((_owner: string, id: string) => {
    const match = DATAHUB_FIXTURES.find((f) => f.id === id);
    return Promise.resolve(match ?? null);
  }),
}));

// P2 mentorship / check-in store fixtures. Each store lists its own directory
// (users/<owner>/<entity>) via fileService.listFiles + readJson, so the mock is
// made DIR-AWARE below: the datahub dir returns datahub json names, the new
// entity dirs return their fixture ids, and everything else returns empty.
const ONE_ON_ONE_FIXTURES = [
  { id: "ooo-1", owner: "alex", members: ["alex", "morgan"], shared_with: [] },
];
const IDP_FIXTURES = [{ id: "idp-1", owner: "alex", shared_with: [] }];
const CHECKIN_COMPACT_FIXTURES = [
  { id: "cc-1", owner: "alex", space_id: "ooo-1", shared_with: [] },
];

// Map an entity directory suffix to its fixture records, so listFiles can return
// the right file names and readJson can return the right record per path.
const ENTITY_FIXTURES: Record<
  string,
  Array<{ id: string; [k: string]: unknown }>
> = {
  one_on_ones: ONE_ON_ONE_FIXTURES,
  one_on_one_action_items: [],
  idps: IDP_FIXTURES,
  checkin_compacts: CHECKIN_COMPACT_FIXTURES,
  checkin_onboarding: [],
  checkin_rotations: [],
};

function entitySuffix(dir: string): string | null {
  const parts = dir.split("/");
  return parts.length > 0 ? parts[parts.length - 1] : null;
}

// Mock fileService: listFiles feeds datahub + the new stores; listDirectories +
// readText feed the task result/notes sheet readers. listDirectories returns two
// task dirs (one of which has no results.md) plus a non-task dir that must be
// ignored.
vi.mock("@/lib/file-system/file-service", () => ({
  fileService: {
    listFiles: vi.fn((dir: string) => {
      const suffix = entitySuffix(dir);
      if (suffix === "datahub") {
        return Promise.resolve(DATAHUB_FIXTURES.map((f) => `${f.id}.json`));
      }
      if (suffix && suffix in ENTITY_FIXTURES) {
        return Promise.resolve(ENTITY_FIXTURES[suffix].map((f) => `${f.id}.json`));
      }
      return Promise.resolve([]);
    }),
    readJson: vi.fn((path: string) => {
      // The lab-root announcements file (sibling to users/). Two PI-authored
      // entries plus one authored by a different PI, so the author filter is
      // observable.
      if (path === "_announcements.json") {
        return Promise.resolve({
          version: 1,
          announcements: [
            { id: "ann-1", author: "alex", text: "Lab meeting Friday", created_at: "2026-06-18T00:00:00.000Z" },
            { id: "ann-2", author: "alex", text: "Freezer cleanout", created_at: "2026-06-18T01:00:00.000Z" },
            { id: "ann-3", author: "morgan", text: "Other lab note", created_at: "2026-06-18T02:00:00.000Z" },
          ],
        });
      }
      const parts = path.split("/");
      const fileName = parts[parts.length - 1];
      const id = fileName.endsWith(".json")
        ? fileName.slice(0, -".json".length)
        : fileName;
      const suffix = parts.length >= 2 ? parts[parts.length - 2] : null;
      if (suffix && suffix in ENTITY_FIXTURES) {
        const match = ENTITY_FIXTURES[suffix].find((f) => f.id === id);
        return Promise.resolve(match ?? null);
      }
      return Promise.resolve(null);
    }),
    listDirectories: vi.fn((_dir: string) =>
      Promise.resolve(["task-7", "task-9", "Files"]),
    ),
    readText: vi.fn((path: string) => {
      // task-7 has both sheets; task-9 has only notes.md (empty results.md).
      if (path === "users/alex/results/task-7/results.md")
        return Promise.resolve("# Results\nbands at 500bp");
      if (path === "users/alex/results/task-7/notes.md")
        return Promise.resolve("# Notes\nran the gel");
      if (path === "users/alex/results/task-9/results.md")
        return Promise.resolve("");
      if (path === "users/alex/results/task-9/notes.md")
        return Promise.resolve("# Notes\nprepped reagents");
      return Promise.resolve(null);
    }),
  },
}));

// ---------------------------------------------------------------------------
// Import the mock AFTER setting it up so we can inspect constructor calls.
// ---------------------------------------------------------------------------
import { JsonStore } from "@/lib/storage/json-store";
import { sequencesApi } from "@/lib/local-api";
import { phyloApi } from "@/lib/phylo/api";
import { moleculeStore } from "@/lib/chemistry/molecule-store";
import { readDataHubMirror } from "@/lib/loro/datahub-sidecar-store";
import { fileService } from "@/lib/file-system/file-service";

// ---------------------------------------------------------------------------
// Unit tests: routing + per-collection delegation
// ---------------------------------------------------------------------------

describe("createLocalApiLabWorkSource — unit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("constructs six JsonStore instances with the correct collection names", () => {
    createLocalApiLabWorkSource();
    const ctorCalls = (JsonStore as unknown as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => c[0],
    );
    expect(ctorCalls).toContain("tasks");
    expect(ctorCalls).toContain("notes");
    expect(ctorCalls).toContain("methods");
    expect(ctorCalls).toContain("purchase_items");
    expect(ctorCalls).toContain("inventory_items");
    expect(ctorCalls).toContain("inventory_stocks");
  });

  it("listTasks delegates to the tasks store with the supplied owner", async () => {
    const source = createLocalApiLabWorkSource();
    const result = await source.listTasks("alex");
    expect(result).toEqual(FIXTURES.tasks);
  });

  it("listNotes delegates to the notes store with the supplied owner", async () => {
    const source = createLocalApiLabWorkSource();
    const result = await source.listNotes("alex");
    expect(result).toEqual(FIXTURES.notes);
  });

  it("listMethods delegates to the methods store with the supplied owner", async () => {
    const source = createLocalApiLabWorkSource();
    const result = await source.listMethods("alex");
    expect(result).toEqual(FIXTURES.methods);
  });

  it("listPurchases delegates to the purchase_items store with the supplied owner", async () => {
    const source = createLocalApiLabWorkSource();
    const result = await source.listPurchases("alex");
    expect(result).toEqual(FIXTURES.purchase_items);
  });

  it("listInventory delegates to the inventory_items store with the supplied owner", async () => {
    const source = createLocalApiLabWorkSource();
    const result = await source.listInventory("alex");
    expect(result).toEqual(FIXTURES.inventory_items);
  });

  it("listInventoryStock delegates to the inventory_stocks store with the supplied owner", async () => {
    const source = createLocalApiLabWorkSource();
    const result = await source.listInventoryStock("alex");
    expect(result).toEqual(FIXTURES.inventory_stocks);
  });

  it("listSequences delegates to sequencesApi.getForUser with the supplied owner", async () => {
    const source = createLocalApiLabWorkSource();
    const result = await source.listSequences("alex");
    expect(result).toEqual(SEQUENCE_FIXTURES);
    expect(
      (sequencesApi.getForUser as ReturnType<typeof vi.fn>),
    ).toHaveBeenCalledWith("alex");
  });

  it("listPhylo delegates to phyloApi.listForUser with the supplied owner", async () => {
    const source = createLocalApiLabWorkSource();
    const result = await source.listPhylo("alex");
    expect(result).toEqual(PHYLO_FIXTURES);
    expect(
      (phyloApi.listForUser as ReturnType<typeof vi.fn>),
    ).toHaveBeenCalledWith("alex");
  });

  it("listMolecules delegates to moleculeStore.listMetaForUser with the supplied owner", async () => {
    const source = createLocalApiLabWorkSource();
    const result = await source.listMolecules("alex");
    expect(result).toEqual(MOLECULE_FIXTURES);
    expect(
      (moleculeStore.listMetaForUser as ReturnType<typeof vi.fn>),
    ).toHaveBeenCalledWith("alex");
  });

  it("listDatahub returns one record per .json file with id from mirror.meta.id", async () => {
    const source = createLocalApiLabWorkSource();
    const result = await source.listDatahub("alex");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("dh-001");
  });

  it("listDatahub calls readDataHubMirror with the correct owner and id", async () => {
    const source = createLocalApiLabWorkSource();
    await source.listDatahub("alex");
    expect(
      (readDataHubMirror as ReturnType<typeof vi.fn>),
    ).toHaveBeenCalledWith("alex", "dh-001");
  });

  it("listDatahub calls fileService.listFiles with the datahub dir for the owner", async () => {
    const source = createLocalApiLabWorkSource();
    await source.listDatahub("alex");
    expect(
      (fileService.listFiles as ReturnType<typeof vi.fn>),
    ).toHaveBeenCalledWith("users/alex/datahub");
  });

  it("listResultSheets returns one record per task dir with a non-empty results.md", async () => {
    const source = createLocalApiLabWorkSource();
    const result = await source.listResultSheets("alex");
    // task-7 has results.md; task-9's is empty; "Files" is not a task dir.
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("7");
    expect(result[0].sheet).toBe("results");
    expect(result[0].markdown).toContain("bands at 500bp");
  });

  it("listNotesSheets returns a record per task dir with a non-empty notes.md", async () => {
    const source = createLocalApiLabWorkSource();
    const result = await source.listNotesSheets("alex");
    // both task-7 and task-9 have notes.md.
    expect(result.map((r) => r.id).sort()).toEqual(["7", "9"]);
    expect(result.every((r) => r.sheet === "notes")).toBe(true);
  });

  it("the sheet readers list the owner's results directory and ignore non-task dirs", async () => {
    const source = createLocalApiLabWorkSource();
    await source.listResultSheets("alex");
    expect(
      (fileService.listDirectories as ReturnType<typeof vi.fn>),
    ).toHaveBeenCalledWith("users/alex/results");
  });

  // P2 mentorship / check-in store coverage. These types were OMITTED by the
  // original mirror, so a joined member could never see a shared 1:1 / IDP.

  it("listOneOnOnes returns the owner's one_on_ones records", async () => {
    const source = createLocalApiLabWorkSource();
    const result = await source.listOneOnOnes("alex");
    expect(result).toEqual(ONE_ON_ONE_FIXTURES);
  });

  it("listIdps STRIPS the IDP before the mirror (P3 push-time privacy)", async () => {
    // P3: the raw IDP carries private content (values reflection + unshared
    // sections). listIdps must strip it at PUSH so that content never reaches R2.
    // The IDP_FIXTURES record is shared with no one, so EVERY section is blanked
    // and values_reflection is null; the id / owner / shared_with gate survive.
    const source = createLocalApiLabWorkSource();
    const result = (await source.listIdps("alex")) as unknown as Array<
      Record<string, unknown>
    >;
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("idp-1");
    expect(result[0].owner).toBe("alex");
    expect(result[0].shared_with).toEqual([]);
    // Private content never leaves the device.
    expect(result[0].values_reflection).toBeNull();
    expect(result[0].goals).toEqual([]);
    expect(result[0].action_plan).toEqual([]);
  });

  it("listCheckinCompacts returns the owner's checkin_compacts records", async () => {
    const source = createLocalApiLabWorkSource();
    const result = await source.listCheckinCompacts("alex");
    expect(result).toEqual(CHECKIN_COMPACT_FIXTURES);
  });

  // ANNOUNCEMENTS (lab-wide-public exception). The root _announcements.json holds
  // entries from multiple authors; listAnnouncements(owner) yields only the ones
  // authored by `owner`, so each entry is pushed exactly once under its author's
  // (the PI's) owner prefix, and a non-author owner pushes none.

  it("listAnnouncements returns only the entries authored by the owner", async () => {
    const source = createLocalApiLabWorkSource();
    const result = await source.listAnnouncements("alex");
    expect(result.map((a) => (a as { id: string }).id)).toEqual(["ann-1", "ann-2"]);
  });

  it("listAnnouncements returns [] for an owner who authored none", async () => {
    const source = createLocalApiLabWorkSource();
    const result = await source.listAnnouncements("sam");
    expect(result).toEqual([]);
  });

  it("the new mentorship readers list the correct per-owner entity directories", async () => {
    const source = createLocalApiLabWorkSource();
    await source.listOneOnOnes("morgan");
    await source.listIdps("morgan");
    await source.listCheckinOnboarding("morgan");
    const dirsListed = (fileService.listFiles as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => c[0],
    );
    expect(dirsListed).toContain("users/morgan/one_on_ones");
    expect(dirsListed).toContain("users/morgan/idps");
    expect(dirsListed).toContain("users/morgan/checkin_onboarding");
  });

  it("each store's listAllForUser is called with the correct owner string", async () => {
    const source = createLocalApiLabWorkSource();
    await source.listTasks("morgan");
    await source.listNotes("morgan");
    await source.listMethods("morgan");
    await source.listPurchases("morgan");
    await source.listInventory("morgan");
    await source.listInventoryStock("morgan");

    // The factory constructs additional JsonStores (deposits, weekly_goals) that
    // this test does not exercise, so assert only over the instances whose
    // listAllForUser was actually called: each of the six exercised collections
    // must have been called with "morgan".
    const instances = (JsonStore as unknown as ReturnType<typeof vi.fn>).mock.results.map(
      (r: { value: unknown }) => r.value as { listAllForUser: ReturnType<typeof vi.fn> },
    );
    const exercised = instances.filter(
      (inst) => inst.listAllForUser.mock.calls.length > 0,
    );
    expect(exercised).toHaveLength(6);
    for (const inst of exercised) {
      expect(inst.listAllForUser).toHaveBeenCalledWith("morgan");
    }
  });
});

// ---------------------------------------------------------------------------
// Integration test: feed source into the REAL enumerateLabWork
// ---------------------------------------------------------------------------

describe("createLocalApiLabWorkSource + enumerateLabWork — integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("produces LabWorkRecord[] with correct recordTypes and recordIds", async () => {
    // The mock JsonStore already returns FIXTURES per collection; the source
    // wraps those stores. enumerateLabWork is the REAL function (not mocked).
    const source = createLocalApiLabWorkSource();

    const records = await enumerateLabWork({ owner: "alex", source });

    // Collect the actual (recordType, recordId) pairs for easy assertion.
    const pairs = records.map((r) => ({ type: r.recordType, id: r.recordId }));

    // task: id 1 (task_type "task")
    expect(pairs).toContainEqual({ type: "task", id: "1" });

    // experiment: id 2 (task_type "experiment")
    expect(pairs).toContainEqual({ type: "experiment", id: "2" });

    // note: id 10
    expect(pairs).toContainEqual({ type: "note", id: "10" });

    // method: id 20
    expect(pairs).toContainEqual({ type: "method", id: "20" });

    // purchase: id 30
    expect(pairs).toContainEqual({ type: "purchase", id: "30" });

    // inventory: id 40
    expect(pairs).toContainEqual({ type: "inventory", id: "40" });

    // inventory_stock: id 50
    expect(pairs).toContainEqual({ type: "inventory_stock", id: "50" });

    // sequence: id 100
    expect(pairs).toContainEqual({ type: "sequence", id: "100" });

    // phylo: id "phylo-abc"
    expect(pairs).toContainEqual({ type: "phylo", id: "phylo-abc" });

    // molecule: id "mol-xyz"
    expect(pairs).toContainEqual({ type: "molecule", id: "mol-xyz" });

    // datahub: id "dh-001"
    expect(pairs).toContainEqual({ type: "datahub", id: "dh-001" });

    // result_sheet: task-7 has a non-empty results.md (task-9's is empty).
    expect(pairs).toContainEqual({ type: "result_sheet", id: "7" });

    // notes_sheet: both task-7 and task-9 have a non-empty notes.md.
    expect(pairs).toContainEqual({ type: "notes_sheet", id: "7" });
    expect(pairs).toContainEqual({ type: "notes_sheet", id: "9" });

    // P2 mentorship / check-in coverage.
    expect(pairs).toContainEqual({ type: "one_on_one", id: "ooo-1" });
    expect(pairs).toContainEqual({ type: "idp", id: "idp-1" });
    expect(pairs).toContainEqual({ type: "checkin_compact", id: "cc-1" });

    // announcement: two alex-authored entries (ann-3 is morgan's, filtered out).
    expect(pairs).toContainEqual({ type: "announcement", id: "ann-1" });
    expect(pairs).toContainEqual({ type: "announcement", id: "ann-2" });

    // Total count: 11 record stores + 1 result_sheet + 2 notes_sheet
    // + 1 one_on_one + 1 idp + 1 checkin_compact + 2 announcement = 19.
    expect(records).toHaveLength(19);
  });

  it("records have a non-empty plaintext Uint8Array (canonical bytes)", async () => {
    const source = createLocalApiLabWorkSource();
    const records = await enumerateLabWork({ owner: "alex", source });
    for (const r of records) {
      expect(r.plaintext).toBeInstanceOf(Uint8Array);
      expect(r.plaintext.length).toBeGreaterThan(0);
    }
  });

  it("output is grouped by type in LAB_WORK_TYPES order (record stores then sheets)", async () => {
    const source = createLocalApiLabWorkSource();
    const records = await enumerateLabWork({ owner: "alex", source });
    const types = records.map((r) => r.recordType);
    // The two notes_sheet records (task-7, task-9) appear consecutively, after
    // the single result_sheet, in LAB_WORK_TYPES order. The P2 mentorship /
    // check-in records (one_on_one, idp, checkin_compact) follow last, in the
    // appended LAB_WORK_TYPES order; the empty new types contribute nothing.
    expect(types).toEqual([
      "task",
      "experiment",
      "note",
      "method",
      "purchase",
      "inventory",
      "inventory_stock",
      "sequence",
      "phylo",
      "molecule",
      "datahub",
      "result_sheet",
      "notes_sheet",
      "notes_sheet",
      "one_on_one",
      "idp",
      "checkin_compact",
      "announcement",
      "announcement",
    ]);
  });
});
