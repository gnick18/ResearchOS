// sequence editor master. BeakerSearch global object search, chunk 1, tests for
// the PURE index builder. These cover the data shape the global source ranks and
// renders without a DOM (mirrors editor-commands.test.ts), the composite keys,
// the deep-link hrefs, the sublines, the haystack folding, and the recency
// stamp, so the index brain is verified before any provider wiring.

import { describe, it, expect } from "vitest";
import {
  buildGlobalIndex,
  buildInventoryEntry,
  buildNoteEntry,
  buildDataHubEntry,
  buildMoleculeEntry,
  buildPurchaseEntry,
  buildPhyloEntry,
  GUI_TYPE_COVERAGE,
  briefTypeToGuiType,
  type GlobalIndexInput,
} from "./global-index";
import { INDEXED_TYPES, aiTypeToGuiType } from "@/lib/index/indexed-types";
import type { Task, Method, Project, SequenceRecord, InventoryItem, Note, PurchaseItem } from "@/lib/types";
import type { DataHubDocument } from "@/lib/datahub/model/types";
import type { Molecule } from "@/lib/chemistry/api";
import type { PhyloMeta } from "@/lib/phylo/api";

const CURRENT_USER = "morgan";

function makeTask(over: Partial<Task> = {}): Task {
  return {
    id: 1,
    project_id: 7,
    name: "PCR optimization",
    start_date: "2026-06-01",
    duration_days: 1,
    task_type: "experiment",
    tags: ["pcr", "qpcr"],
    owner: CURRENT_USER,
    last_edited_at: "2026-06-05T10:00:00Z",
    ...over,
  } as Task;
}

function makeProject(over: Partial<Project> = {}): Project {
  return {
    id: 7,
    name: "Mitochondria QC",
    tags: ["mito"],
    owner: CURRENT_USER,
    last_edited_at: "2026-06-04T10:00:00Z",
    ...over,
  } as Project;
}

function makeMethod(over: Partial<Method> = {}): Method {
  return {
    id: 3,
    name: "qPCR master mix",
    method_type: "pcr",
    folder_path: "Molecular Biology",
    parent_method_id: null,
    tags: ["mix"],
    is_public: false,
    owner: CURRENT_USER,
    last_edited_at: "2026-06-03T10:00:00Z",
    ...over,
  } as Method;
}

function makeSequence(over: Partial<SequenceRecord> = {}): SequenceRecord {
  return {
    id: 12,
    display_name: "pGEX-3X",
    project_ids: [],
    added_at: "2026-06-02T10:00:00Z",
    seq_type: "DNA",
    length: 4952,
    circular: true,
    feature_count: 5,
    organism: "Schistosoma japonicum",
    ...over,
  } as SequenceRecord;
}

function build(over: Partial<GlobalIndexInput> = {}) {
  return buildGlobalIndex({
    tasks: [],
    projects: [],
    methods: [],
    sequences: [],
    inventoryItems: [],
    currentUser: CURRENT_USER,
    ...over,
  });
}

describe("buildGlobalIndex (shape and counts)", () => {
  it("emits one entry per core record across all four types", () => {
    const entries = build({
      tasks: [makeTask()],
      projects: [makeProject()],
      methods: [makeMethod()],
      sequences: [makeSequence()],
    });
    expect(entries).toHaveLength(4);
    expect(entries.map((e) => e.type).sort()).toEqual(["method", "project", "sequence", "task"]);
  });

  it("returns an empty index when every set is empty", () => {
    expect(build()).toEqual([]);
  });

  it("precomputes a lowercased haystack and marks entries enabled", () => {
    const [entry] = build({ tasks: [makeTask()] });
    expect(entry.haystack).toBe(entry.haystack.toLowerCase());
    expect(entry.haystack).toContain("pcr optimization");
    expect(entry.enabled).toBe(true);
  });
});

describe("task entries", () => {
  it("keys an own task self:<id> and resolves its project name into the subline", () => {
    const [task] = build({ tasks: [makeTask()], projects: [makeProject()] }).filter(
      (e) => e.type === "task",
    );
    expect(task.key).toBe("self:1");
    expect(task.meta).toBe("Experiment in Mitochondria QC");
    expect(task.href).toBe("/?openTask=self%3A1");
  });

  it("reads Standalone when the task has no resolvable project", () => {
    const [task] = build({ tasks: [makeTask({ project_id: 999 })] }).filter(
      (e) => e.type === "task",
    );
    expect(task.meta).toBe("Experiment in Standalone");
  });

  it("keys a shared task by its owner namespace and notes the sharer", () => {
    const [task] = build({
      tasks: [makeTask({ owner: "alex", is_shared_with_me: true })],
    }).filter((e) => e.type === "task");
    expect(task.key).toBe("alex:1");
    expect(task.meta).toContain("shared by alex");
    expect(task.href).toContain("openTask=alex%3A1");
    expect(task.haystack).toContain("alex");
  });

  it("opens a purchase task through the same home-route opener as any task", () => {
    const [task] = build({ tasks: [makeTask({ task_type: "purchase" })] }).filter(
      (e) => e.type === "task",
    );
    expect(task.meta.startsWith("Purchase in")).toBe(true);
    expect(task.href).toBe("/?openTask=self%3A1");
  });
});

describe("project entries", () => {
  it("keys an own project ${owner}:${id} with a bare /workbench/projects route", () => {
    const [project] = build({ projects: [makeProject()] });
    expect(project.key).toBe("morgan:7");
    expect(project.href).toBe("/workbench/projects/7");
    expect(project.meta).toBe("Project");
  });

  it("appends ?owner= for a shared project", () => {
    const [project] = build({
      projects: [makeProject({ owner: "alex", is_shared_with_me: true })],
    });
    expect(project.key).toBe("alex:7");
    expect(project.href).toBe("/workbench/projects/7?owner=alex");
    expect(project.meta).toBe("Project, shared by alex");
  });
});

describe("method entries", () => {
  it("keys an owned method, labels its type and folder, and uses ?openMethod=", () => {
    const [method] = build({ methods: [makeMethod()] });
    expect(method.key).toBe("morgan:3");
    expect(method.href).toBe("/methods?openMethod=3");
    expect(method.meta).toContain("PCR");
    expect(method.meta).toContain("Molecular Biology");
  });

  it("keys a lab-wide method public:<id> and labels it lab-wide", () => {
    const [method] = build({ methods: [makeMethod({ is_public: true })] });
    expect(method.key).toBe("public:3");
    expect(method.meta).toContain("lab-wide");
  });

  it("notes read-only for a shared method", () => {
    const [method] = build({
      methods: [makeMethod({ owner: "alex", is_shared_with_me: true })],
    });
    expect(method.key).toBe("alex:3");
    expect(method.meta).toContain("read-only");
  });

  it("reads Uncategorized when the method has no folder", () => {
    const [method] = build({ methods: [makeMethod({ folder_path: null })] });
    expect(method.meta).toContain("Uncategorized");
  });
});

describe("sequence entries", () => {
  it("keys a sequence by its bare numeric id and uses ?seq=", () => {
    const [seq] = build({ sequences: [makeSequence()] });
    expect(seq.key).toBe("12");
    expect(seq.href).toBe("/sequences?seq=12");
    expect(seq.iconName).toBe("moleculeCircular");
    expect(seq.meta).toBe("DNA, Circular, 4,952 bp, Schistosoma japonicum");
    expect(seq.haystack).toContain("schistosoma");
  });

  it("uses the linear icon and omits the organism when absent", () => {
    const [seq] = build({
      sequences: [makeSequence({ circular: false, organism: undefined, length: 338 })],
    });
    expect(seq.iconName).toBe("moleculeLinear");
    expect(seq.meta).toBe("DNA, Linear, 338 bp");
  });
});

describe("recency", () => {
  it("parses an edit stamp to epoch ms and falls back to 0 when absent", () => {
    const [withStamp] = build({ tasks: [makeTask()] });
    expect(withStamp.recencyAt).toBe(Date.parse("2026-06-05T10:00:00Z"));
    const [noStamp] = build({ tasks: [makeTask({ last_edited_at: undefined })] });
    expect(noStamp.recencyAt).toBe(0);
  });
});

// ── Inventory entries (chunk-5 bot 2026-06-07) ───────────────────────────────
// buildInventoryEntry is tested directly (the pure per-item builder) so the
// entry shape is verified independently of INVENTORY_ENABLED (which is false
// by default and cannot be flipped in unit tests). The gating behavior (flag
// off => no entries in buildGlobalIndex) is covered by a separate assertion.

function makeInventoryItem(over: Partial<InventoryItem> = {}): InventoryItem {
  return {
    id: 5,
    name: "Q5 Polymerase",
    category: "enzyme",
    catalog_number: "M0491S",
    vendor: "NEB",
    cas: null,
    url: null,
    container_label: null,
    notes: null,
    low_at_count: 2,
    product_barcode: null,
    owner: CURRENT_USER,
    shared_with: [],
    created_by: CURRENT_USER,
    last_edited_at: "2026-06-06T09:00:00Z",
    ...over,
  } as InventoryItem;
}

describe("buildInventoryEntry (pure entry builder)", () => {
  it("builds the composite key and the /supplies deep-link href", () => {
    const entry = buildInventoryEntry(makeInventoryItem({ id: 5, owner: CURRENT_USER }));
    expect(entry.type).toBe("inventory");
    expect(entry.key).toBe(`${CURRENT_USER}:5`);
    // chunk 6: /inventory redirects into /supplies, and the `supply` param opens
    // the item's Supply row. The param is the identity key (vendor+catalog when
    // both present), URL-encoded because it carries ":" / "|".
    expect(entry.href).toBe("/supplies?supply=vc%3Aneb%7Cm0491s");
    expect(entry.enabled).toBe(true);
  });

  it("falls back to a name-keyed deep-link when vendor / catalog are missing", () => {
    const entry = buildInventoryEntry(
      makeInventoryItem({ name: "Bench roll", vendor: null, catalog_number: null }),
    );
    expect(entry.href).toBe("/supplies?supply=n%3Abench%20roll");
  });

  it("uses the owner namespace for a shared item", () => {
    const entry = buildInventoryEntry(makeInventoryItem({ id: 9, owner: "alex" }));
    expect(entry.key).toBe("alex:9");
  });

  it("sets the label to the item name", () => {
    const entry = buildInventoryEntry(makeInventoryItem({ name: "Q5 Polymerase" }));
    expect(entry.label).toBe("Q5 Polymerase");
  });

  it("builds the meta subline from category, vendor, catalog_number", () => {
    const entry = buildInventoryEntry(
      makeInventoryItem({ category: "enzyme", vendor: "NEB", catalog_number: "M0491S" }),
    );
    expect(entry.meta).toContain("enzyme");
    expect(entry.meta).toContain("NEB");
    expect(entry.meta).toContain("M0491S");
  });

  it("falls back to category-only when vendor and catalog_number are null", () => {
    const entry = buildInventoryEntry(
      makeInventoryItem({ vendor: null, catalog_number: null }),
    );
    expect(entry.meta).toBe("enzyme");
  });

  it("folds name + vendor + catalog_number + cas + notes into a lowercased haystack", () => {
    const entry = buildInventoryEntry(
      makeInventoryItem({ name: "Q5", vendor: "NEB", cas: "9007-49-2", notes: "premium" }),
    );
    expect(entry.haystack).toContain("q5");
    expect(entry.haystack).toContain("neb");
    expect(entry.haystack).toContain("9007-49-2");
    expect(entry.haystack).toContain("premium");
    expect(entry.haystack).toBe(entry.haystack.toLowerCase());
  });

  it("parses last_edited_at to epoch ms for recency", () => {
    const entry = buildInventoryEntry(
      makeInventoryItem({ last_edited_at: "2026-06-06T09:00:00Z" }),
    );
    expect(entry.recencyAt).toBe(Date.parse("2026-06-06T09:00:00Z"));
  });

  it("falls back to 0 recency when the stamp is absent", () => {
    const entry = buildInventoryEntry(
      makeInventoryItem({ last_edited_at: undefined }),
    );
    expect(entry.recencyAt).toBe(0);
  });

  it("uses the vial icon name", () => {
    const entry = buildInventoryEntry(makeInventoryItem());
    expect(entry.iconName).toBe("vial");
  });
});

describe("buildGlobalIndex inventory gating", () => {
  it("suppresses inventory entries when INVENTORY_ENABLED is false (default)", () => {
    // The config default is false; the index builder skips the inventory loop.
    const entries = build({ inventoryItems: [makeInventoryItem()] });
    expect(entries.filter((e) => e.type === "inventory")).toHaveLength(0);
  });
});

describe("buildNoteEntry (pure note builder, with OCR)", () => {
  function makeNote(over: Partial<Note> = {}): Note {
    return {
      id: 7,
      title: "PCR optimization",
      description: "gradient screen",
      is_running_log: false,
      is_shared: false,
      entries: [],
      updated_at: "2026-06-01T00:00:00.000Z",
      username: CURRENT_USER,
      ...over,
    } as Note;
  }

  it("folds scanned OCR text into the haystack AND the ocr field", () => {
    const entry = buildNoteEntry(makeNote(), "30 cycles 72c extension", CURRENT_USER);
    expect(entry.type).toBe("note");
    expect(entry.haystack).toContain("pcr optimization");
    expect(entry.haystack).toContain("30 cycles 72c extension");
    expect(entry.ocr).toBe("30 cycles 72c extension");
  });

  it("deep-links the workbench Notes tab to this note's key", () => {
    const entry = buildNoteEntry(makeNote({ id: 12, username: "alex" }), "", CURRENT_USER);
    expect(entry.key).toBe("note-alex:12");
    expect(entry.href).toBe("/workbench?tab=notes&note=note-alex%3A12");
  });

  it("labels a note shared in from another owner", () => {
    const entry = buildNoteEntry(makeNote({ username: "alex" }), "", CURRENT_USER);
    expect(entry.meta).toContain("shared by alex");
  });

  it("buildGlobalIndex includes note entries with their OCR text", () => {
    const ocr = new Map<number, string>([[7, "blot transfer overnight"]]);
    const entries = buildGlobalIndex({
      tasks: [], projects: [], methods: [], sequences: [], inventoryItems: [],
      currentUser: CURRENT_USER, notes: [makeNote()], noteOcrText: ocr,
    });
    const noteEntry = entries.find((e) => e.type === "note");
    expect(noteEntry).toBeDefined();
    expect(noteEntry!.haystack).toContain("blot transfer overnight");
  });
});

// ── BeakerSearch v1 coverage-gap adapters ────────────────────────────────────
// Tests for the three new adapters (Data Hub, Molecule, Purchase). Each
// adapter is tested directly (pure builder, no DOM, no React), covering the
// key, href, type, icon, meta, haystack, and recency fields.

function makeDataHubDoc(over: Partial<DataHubDocument> = {}): DataHubDocument {
  return {
    id: "42",
    name: "Dose-response data",
    project_ids: ["proj-1"],
    folder_path: null,
    table_type: "xy",
    created_at: "2026-06-10T12:00:00Z",
    last_edited_at: "2026-06-11T08:00:00Z",
    ...over,
  };
}

describe("buildDataHubEntry (pure entry builder)", () => {
  it("sets type to datahub and uses the chart icon", () => {
    const entry = buildDataHubEntry(makeDataHubDoc(), CURRENT_USER);
    expect(entry.type).toBe("datahub");
    expect(entry.iconName).toBe("chart");
  });

  it("builds a composite key using the user and doc id", () => {
    const entry = buildDataHubEntry(makeDataHubDoc({ id: "99" }), CURRENT_USER);
    expect(entry.key).toBe(`datahub:${CURRENT_USER}:99`);
  });

  it("deep-links via /datahub?doc=<id>", () => {
    const entry = buildDataHubEntry(makeDataHubDoc({ id: "42" }), CURRENT_USER);
    expect(entry.href).toBe("/datahub?doc=42");
  });

  it("labels the table type in the meta subline", () => {
    expect(buildDataHubEntry(makeDataHubDoc({ table_type: "xy" }), CURRENT_USER).meta).toBe("XY table");
    expect(buildDataHubEntry(makeDataHubDoc({ table_type: "column" }), CURRENT_USER).meta).toBe("Column table");
    expect(buildDataHubEntry(makeDataHubDoc({ table_type: "grouped" }), CURRENT_USER).meta).toBe("Grouped table");
    expect(buildDataHubEntry(makeDataHubDoc({ table_type: "survival" }), CURRENT_USER).meta).toBe("Survival table");
  });

  it("folds the name and table_type into a lowercased haystack", () => {
    const entry = buildDataHubEntry(makeDataHubDoc({ name: "Dose-response" }), CURRENT_USER);
    expect(entry.haystack).toContain("dose-response");
    expect(entry.haystack).toBe(entry.haystack.toLowerCase());
  });

  it("parses last_edited_at to epoch ms for recency", () => {
    const entry = buildDataHubEntry(makeDataHubDoc(), CURRENT_USER);
    expect(entry.recencyAt).toBe(Date.parse("2026-06-11T08:00:00Z"));
  });

  it("falls back to 0 recency when the stamp is absent", () => {
    const entry = buildDataHubEntry(makeDataHubDoc({ last_edited_at: undefined }), CURRENT_USER);
    expect(entry.recencyAt).toBe(0);
  });

  it("marks the entry enabled", () => {
    expect(buildDataHubEntry(makeDataHubDoc(), CURRENT_USER).enabled).toBe(true);
  });

  it("buildGlobalIndex includes datahub entries when datahubDocs is passed", () => {
    const entries = build({ datahubDocs: [makeDataHubDoc()] });
    const found = entries.filter((e) => e.type === "datahub");
    expect(found).toHaveLength(1);
    expect(found[0].label).toBe("Dose-response data");
  });
});

function makeMolecule(over: Partial<Molecule> = {}): Molecule {
  return {
    id: "mol-7",
    name: "Caffeine",
    project_ids: [],
    added_at: "2026-06-09T10:00:00Z",
    smiles: "Cn1cnc2c1c(=O)n(C)c(=O)n2C",
    inchikey: "RYYVLZVUVIJVGH-UHFFFAOYSA-N",
    formula: "C8H10N4O2",
    mol_weight: 194.19,
    source: "pubchem",
    ...over,
  };
}

describe("buildMoleculeEntry (pure entry builder)", () => {
  it("sets type to molecule and uses the vial icon", () => {
    const entry = buildMoleculeEntry(makeMolecule());
    expect(entry.type).toBe("molecule");
    expect(entry.iconName).toBe("vial");
  });

  it("builds a prefixed key from the molecule id", () => {
    const entry = buildMoleculeEntry(makeMolecule({ id: "mol-7" }));
    expect(entry.key).toBe("molecule:mol-7");
  });

  it("deep-links via /chemistry?molecule=<id>", () => {
    const entry = buildMoleculeEntry(makeMolecule({ id: "mol-7" }));
    expect(entry.href).toBe("/chemistry?molecule=mol-7");
  });

  it("includes formula, MW, and pubchem source in the meta subline", () => {
    const entry = buildMoleculeEntry(makeMolecule());
    expect(entry.meta).toContain("C8H10N4O2");
    expect(entry.meta).toContain("MW");
    expect(entry.meta).toContain("PubChem");
  });

  it("folds name, formula, smiles, and inchikey into the haystack", () => {
    const entry = buildMoleculeEntry(makeMolecule());
    expect(entry.haystack).toContain("caffeine");
    expect(entry.haystack).toContain("c8h10n4o2");
    expect(entry.haystack).toBe(entry.haystack.toLowerCase());
  });

  it("parses added_at to epoch ms for recency", () => {
    const entry = buildMoleculeEntry(makeMolecule({ added_at: "2026-06-09T10:00:00Z" }));
    expect(entry.recencyAt).toBe(Date.parse("2026-06-09T10:00:00Z"));
  });

  it("falls back to 0 recency when added_at is absent", () => {
    const entry = buildMoleculeEntry(makeMolecule({ added_at: undefined }));
    expect(entry.recencyAt).toBe(0);
  });

  it("buildGlobalIndex includes molecule entries when molecules is passed", () => {
    const entries = build({ molecules: [makeMolecule()] });
    const found = entries.filter((e) => e.type === "molecule");
    expect(found).toHaveLength(1);
    expect(found[0].label).toBe("Caffeine");
  });
});

function makePurchaseItem(
  over: Partial<PurchaseItem & { owner?: string }> = {},
): PurchaseItem & { owner?: string } {
  return {
    id: 15,
    task_id: 3,
    item_name: "Trypsin MSDS grade",
    quantity: 2,
    price_per_unit: 49.99,
    shipping_fees: 0,
    total_price: 99.98,
    link: null,
    cas: null,
    notes: null,
    funding_string: null,
    vendor: "Sigma-Aldrich",
    catalog_number: "T1426",
    category: "enzyme",
    ...over,
  } as PurchaseItem & { owner?: string };
}

describe("buildPurchaseEntry (pure entry builder)", () => {
  it("sets type to purchase and uses the receipt icon", () => {
    const entry = buildPurchaseEntry(makePurchaseItem(), CURRENT_USER);
    expect(entry.type).toBe("purchase");
    expect(entry.iconName).toBe("receipt");
  });

  it("builds a composite key from owner and id", () => {
    const entry = buildPurchaseEntry(makePurchaseItem({ id: 15, owner: CURRENT_USER }), CURRENT_USER);
    expect(entry.key).toBe(`purchase:${CURRENT_USER}:15`);
  });

  it("falls back to currentUser when owner is absent on the item", () => {
    const entry = buildPurchaseEntry(makePurchaseItem({ id: 15 }), CURRENT_USER);
    expect(entry.key).toBe(`purchase:${CURRENT_USER}:15`);
  });

  it("links to the purchases page (no per-item deep link exists)", () => {
    const entry = buildPurchaseEntry(makePurchaseItem(), CURRENT_USER);
    expect(entry.href).toBe("/purchases");
  });

  it("includes vendor and category in the meta subline", () => {
    const entry = buildPurchaseEntry(makePurchaseItem(), CURRENT_USER);
    expect(entry.meta).toContain("Sigma-Aldrich");
    expect(entry.meta).toContain("enzyme");
  });

  it("folds item name, vendor, category, and catalog number into haystack", () => {
    const entry = buildPurchaseEntry(makePurchaseItem(), CURRENT_USER);
    expect(entry.haystack).toContain("trypsin msds grade");
    expect(entry.haystack).toContain("sigma-aldrich");
    expect(entry.haystack).toContain("t1426");
    expect(entry.haystack).toBe(entry.haystack.toLowerCase());
  });

  it("uses 0 for recency (PurchaseItem has no edit timestamp)", () => {
    const entry = buildPurchaseEntry(makePurchaseItem(), CURRENT_USER);
    expect(entry.recencyAt).toBe(0);
  });

  it("buildGlobalIndex includes purchase entries when purchaseItems is passed", () => {
    const entries = build({ purchaseItems: [makePurchaseItem()] });
    const found = entries.filter((e) => e.type === "purchase");
    expect(found).toHaveLength(1);
    expect(found[0].label).toBe("Trypsin MSDS grade");
  });
});

function makePhyloTree(over: Partial<PhyloMeta> = {}): PhyloMeta {
  return {
    id: "tree-3",
    name: "16S rRNA bacterial tree",
    project_ids: [],
    added_at: "2026-06-08T10:00:00Z",
    format: "newick",
    tip_count: 42,
    ...over,
  } as PhyloMeta;
}

describe("buildPhyloEntry (pure entry builder)", () => {
  it("sets type to phylo and uses the tree icon", () => {
    const entry = buildPhyloEntry(makePhyloTree());
    expect(entry.type).toBe("phylo");
    expect(entry.iconName).toBe("tree");
  });

  it("builds a prefixed key from the tree id", () => {
    const entry = buildPhyloEntry(makePhyloTree({ id: "tree-3" }));
    expect(entry.key).toBe("phylo:tree-3");
  });

  it("deep-links via /phylo?doc=<id>", () => {
    const entry = buildPhyloEntry(makePhyloTree({ id: "tree-3" }));
    expect(entry.href).toBe("/phylo?doc=tree-3");
  });

  it("includes the tip count and format in the meta subline", () => {
    const entry = buildPhyloEntry(makePhyloTree());
    expect(entry.meta).toContain("42 tips");
    expect(entry.meta).toContain("newick");
  });

  it("falls back to a generic label when tip_count is absent", () => {
    const entry = buildPhyloEntry(makePhyloTree({ tip_count: undefined }));
    expect(entry.meta).toContain("Phylogenetic tree");
  });

  it("folds the tree name into a lowercased haystack", () => {
    const entry = buildPhyloEntry(makePhyloTree());
    expect(entry.haystack).toContain("16s rrna bacterial tree");
    expect(entry.haystack).toBe(entry.haystack.toLowerCase());
  });

  it("parses added_at to epoch ms for recency", () => {
    const entry = buildPhyloEntry(makePhyloTree({ added_at: "2026-06-08T10:00:00Z" }));
    expect(entry.recencyAt).toBe(Date.parse("2026-06-08T10:00:00Z"));
  });

  it("buildGlobalIndex includes phylo entries when phyloTrees is passed", () => {
    const entries = build({ phyloTrees: [makePhyloTree()] });
    const found = entries.filter((e) => e.type === "phylo");
    expect(found).toHaveLength(1);
    expect(found[0].label).toBe("16S rRNA bacterial tree");
  });
});

// ── Shared-adapter unification (anti-drift) ──────────────────────────────────
// After unifying the two indices behind one shared adapter layer, the GUI note
// haystack MUST still carry the scanned OCR text (the AI brief intentionally
// never carries OCR, so the GUI folds it in itself). This is an explicit
// regression guard against the "shrunk the search field" failure mode.

describe("note GUI haystack OCR regression guard (post-unification)", () => {
  function makeNote(over: Partial<Note> = {}): Note {
    return {
      id: 7,
      title: "PCR optimization",
      description: "gradient screen",
      is_running_log: false,
      is_shared: false,
      entries: [],
      updated_at: "2026-06-01T00:00:00.000Z",
      username: CURRENT_USER,
      ...over,
    } as Note;
  }

  it("STILL folds the scanned OCR text into the note haystack and the ocr field", () => {
    const entry = buildNoteEntry(
      makeNote(),
      "colony pcr 30 cycles 72c extension handwritten",
      CURRENT_USER,
    );
    // The OCR words must remain searchable from the haystack.
    expect(entry.haystack).toContain("colony pcr 30 cycles 72c extension handwritten");
    // And carried on the dedicated ocr field MiniSearch boosts separately.
    expect(entry.ocr).toBe("colony pcr 30 cycles 72c extension handwritten");
  });

  it("keeps the note title and description in the haystack alongside OCR", () => {
    const entry = buildNoteEntry(makeNote(), "scanned words", CURRENT_USER);
    expect(entry.haystack).toContain("pcr optimization");
    expect(entry.haystack).toContain("gradient");
    expect(entry.haystack).toContain("scanned words");
  });

  it("ALSO now folds entry titles into the haystack (a superset, never a subset)", () => {
    const noteWithEntries = makeNote({
      entries: [
        {
          id: "e1",
          title: "Colony count tally",
          date: "2026-06-01",
          content: "",
          created_at: "2026-06-01T00:00:00.000Z",
          updated_at: "2026-06-01T00:00:00.000Z",
        },
      ],
    });
    const entry = buildNoteEntry(noteWithEntries, "ocr text", CURRENT_USER);
    // The entry title surfaces via the shared adapter's keywords, so the GUI
    // haystack is a strict superset of its prior title + description + OCR fold.
    expect(entry.haystack).toContain("colony");
    expect(entry.haystack).toContain("tally");
    expect(entry.haystack).toContain("ocr text");
  });
});

// ── Cross-index exhaustiveness (GUI side) ────────────────────────────────────
// GUI_TYPE_COVERAGE is a Record<GuiIndexType, ...>, so adding a kind to the
// shared INDEXED_TYPES registry fails to COMPILE here until the GUI handles it.
// This runtime test backstops that compile-time guard and proves the two
// indices stay in lockstep, with the task/experiment naming reconciled.

describe("indexed-type registry + exhaustiveness (GUI side)", () => {
  it("GUI_TYPE_COVERAGE covers exactly the registry kinds, in the GUI spelling", () => {
    const guiKeys = Object.keys(GUI_TYPE_COVERAGE).sort();
    const expected = INDEXED_TYPES.map((t) => aiTypeToGuiType(t)).sort();
    expect(guiKeys).toEqual(expected);
  });

  it("reconciles the AI 'experiment' kind to the GUI 'task' kind", () => {
    expect(briefTypeToGuiType("experiment")).toBe("task");
    // Every other kind shares one name across both indices.
    expect(briefTypeToGuiType("note")).toBe("note");
    expect(briefTypeToGuiType("inventory")).toBe("inventory");
    // The "task" GUI kind is present (and "experiment" is NOT a GUI spelling).
    expect(GUI_TYPE_COVERAGE).toHaveProperty("task");
    expect(GUI_TYPE_COVERAGE).not.toHaveProperty("experiment");
  });

  it("pairs every GUI kind with a defined entry builder and shared brief adapter", () => {
    for (const cov of Object.values(GUI_TYPE_COVERAGE)) {
      expect(typeof cov.entryBuilder).toBe("function");
      expect(typeof cov.briefAdapter).toBe("function");
    }
  });
});
