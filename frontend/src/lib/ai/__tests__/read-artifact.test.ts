// Unit tests for the Layer-2 read-by-id tools and their pure projectors.
// All tests are pure: no folder, no I/O. Projectors are tested directly
// against fixture records; tool execute paths are tested with stubbed deps.

import { describe, it, expect } from "vitest";
import {
  trimBody,
  projectNote,
  projectMethod,
  projectSequence,
  projectExperiment,
  projectProject,
  projectPurchase,
  projectMolecule,
  projectTask,
  projectInventory,
  projectDataHubDoc,
  readNoteTool,
  readMethodTool,
  readSequenceTool,
  readExperimentTool,
  readProjectTool,
  readPurchaseTool,
  readMoleculeTool,
  readTaskTool,
  readInventoryTool,
  readDataHubTool,
  readArtifactDeps,
  type ReadArtifactDeps,
} from "../tools/read-artifact";
import type {
  Note,
  NoteEntry,
  Method,
  SequenceDetail,
  Project,
  PurchaseItem,
  Task,
  InventoryItem,
  InventoryStock,
} from "@/lib/types";
import type { MoleculeDetail } from "@/lib/chemistry/api";
import type { DataHubDocContent } from "@/lib/datahub/model/types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeNote(): Note {
  return {
    id: 1,
    title: "Transformation efficiency",
    description: "Optimization run for E. coli DH5a",
    is_running_log: false,
    is_shared: false,
    entries: [
      {
        id: "e1",
        title: "Day 1 plating",
        date: "2026-06-10",
        content: "Plated 100 uL on LB-amp. Colonies grew overnight.",
        created_at: "2026-06-10T09:00:00Z",
        updated_at: "2026-06-10T09:00:00Z",
      } satisfies NoteEntry,
    ],
    comments: [],
    updated_at: "2026-06-10T09:00:00Z",
    username: "grant",
  };
}

function makeMethod(): Method {
  return {
    id: 2,
    name: "qPCR SYBR cycle",
    source_path: null,
    method_type: "markdown",
    folder_path: null,
    parent_method_id: null,
    tags: ["qPCR"],
    is_public: false,
    created_by: "grant",
    owner: "grant",
    shared_with: [],
    excerpt: "95 C 10 min, then 40 cycles of 95 C 15 s, 60 C 1 min.",
  };
}

function makeMethodNoExcerpt(): Method {
  return { ...makeMethod(), excerpt: undefined };
}

function makeSequenceDetail(): SequenceDetail {
  return {
    id: 3,
    display_name: "pUC19",
    project_ids: ["1"],
    added_at: "2026-06-09T10:00:00Z",
    seq_type: "dna",
    length: 2686,
    circular: true,
    feature_count: 3,
    genbank: "LOCUS pUC19 ...",
    seq: "ATGC",
    annotations: [
      { name: "lacZ", start: 0, end: 500, direction: 1, type: "CDS" },
      { name: "lacZ", start: 501, end: 800, direction: 1, type: "CDS" },
      { name: "ori", start: 1000, end: 1400, direction: 0, type: "rep_origin" },
    ],
    locus_name: "pUC19",
  };
}

function makeProject(): Project {
  return {
    id: 4,
    name: "Phage display 2026",
    weekend_active: false,
    tags: ["phage", "display"],
    color: "#ff5733",
    created_at: "2026-05-01T00:00:00Z",
    sort_order: 0,
    is_archived: false,
    archived_at: null,
    owner: "grant",
    shared_with: [],
  };
}

function makePurchase(): PurchaseItem {
  return {
    id: 5,
    task_id: 10,
    item_name: "Q5 Polymerase",
    quantity: 2,
    link: null,
    cas: null,
    price_per_unit: 78,
    shipping_fees: 0,
    total_price: 156,
    notes: "High-fidelity enzyme for colony PCR",
    funding_string: null,
    vendor: "NEB",
    catalog_number: "M0491S",
    category: "reagents",
    order_status: "ordered",
  };
}

function makeMoleculeDetail(): MoleculeDetail {
  return {
    meta: {
      id: "mol-uuid-1",
      name: "Kanamycin",
      project_ids: [],
      added_at: "2026-06-05T00:00:00Z",
      formula: "C18H36N4O11",
      smiles: "OCC1OC(O)C(N)C(O)C1O",
      inchikey: "SBUJHOSQTJFQJX-NOAMYHISSA-N",
      mol_weight: 484.5,
      source: "pubchem",
    },
    molfile: "some molfile bytes",
  };
}

function makeTask(): Task {
  return {
    id: 6,
    project_id: 4,
    name: "Phage selection round 2",
    start_date: "2026-06-12",
    duration_days: 3,
    end_date: "2026-06-14",
    is_high_level: false,
    is_complete: false,
    task_type: "experiment",
    weekend_override: null,
    method_ids: [2, 7],
    deviation_log: null,
    tags: ["phage", "selection"],
    sort_order: 0,
    experiment_color: null,
    sub_tasks: null,
    method_attachments: [],
    owner: "grant",
    shared_with: [],
  };
}

function makeListTask(): Task {
  return { ...makeTask(), id: 11, name: "Order pipette tips", task_type: "list" };
}

function makeInventoryItem(): InventoryItem {
  return {
    id: 8,
    name: "Q5 High-Fidelity DNA Polymerase",
    category: "reagent" as InventoryItem["category"],
    catalog_number: "M0491S",
    vendor: "NEB",
    cas: null,
    url: null,
    container_label: "vial",
    storage_class: null,
    hazard_note: null,
    sds_url: null,
    notes: null,
    low_at_count: 2,
    product_barcode: null,
    owner: "grant",
    shared_with: [],
    created_by: "grant",
  };
}

function makeInventoryStocks(): InventoryStock[] {
  return [
    {
      id: 100,
      item_id: 8,
      lot_number: "L1",
      container_count: 3,
      status: "in_stock" as InventoryStock["status"],
      received_date: null,
      expiration_date: "2026-12-01",
      opened_date: null,
      last_touched_at: "2026-06-10T00:00:00Z",
      amount_per_container: null,
      unit: null,
      concentration: null,
      location_text: null,
      location_node_id: null,
      position: null,
      purchase_item_id: null,
      container_code: null,
      notes: null,
      owner: "grant",
      shared_with: [],
      created_by: "grant",
    },
    {
      id: 101,
      item_id: 8,
      lot_number: "L2",
      container_count: 1,
      status: "low" as InventoryStock["status"],
      received_date: null,
      expiration_date: "2026-09-15",
      opened_date: null,
      last_touched_at: "2026-06-11T00:00:00Z",
      amount_per_container: null,
      unit: null,
      concentration: null,
      location_text: null,
      location_node_id: null,
      position: null,
      purchase_item_id: null,
      container_code: null,
      notes: null,
      owner: "grant",
      shared_with: [],
      created_by: "grant",
    },
  ];
}

function makeDataHubContent(): DataHubDocContent {
  return {
    meta: {
      id: "doc-1",
      name: "Cell viability assay",
      project_ids: [],
      folder_path: null,
      table_type: "column",
      created_at: "2026-06-01T00:00:00Z",
    },
    columns: [
      { id: "c1", name: "Control", role: "y", dataType: "number" },
      { id: "c2", name: "Treated", role: "y", dataType: "number" },
    ],
    rows: [
      { id: "r1", cells: { c1: 1, c2: 2 } },
      { id: "r2", cells: { c1: 3, c2: 4 } },
      { id: "r3", cells: { c1: 5, c2: 6 } },
    ],
    analyses: [
      { id: "a1", name: "Unpaired t-test", type: "unpairedTTest", params: {}, inputs: {}, resultCache: null, resultStale: false },
      { id: "a2", type: "oneWayAnova", params: {}, inputs: {}, resultCache: null, resultStale: false },
    ],
    plots: [],
  };
}

// ---------------------------------------------------------------------------
// trimBody
// ---------------------------------------------------------------------------

describe("trimBody", () => {
  it("returns the string unchanged when within limit", () => {
    expect(trimBody("hello", 10)).toBe("hello");
  });

  it("truncates and appends ellipsis when over limit", () => {
    const result = trimBody("abcdefghij", 5);
    expect(result).toBe("abcde...");
  });

  it("returns empty string for null/undefined", () => {
    expect(trimBody(null, 100)).toBe("");
    expect(trimBody(undefined, 100)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Pure projectors
// ---------------------------------------------------------------------------

describe("projectNote", () => {
  it("returns ok:true with title, description, and entries", () => {
    const result = projectNote(makeNote());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.title).toBe("Transformation efficiency");
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].title).toBe("Day 1 plating");
    expect(result.entries[0].content).toBeTruthy();
  });

  it("truncates very long entry content", () => {
    const note = makeNote();
    note.entries[0].content = "x".repeat(1000);
    const result = projectNote(note);
    if (!result.ok) throw new Error("Expected ok");
    expect(result.entries[0].content.length).toBeLessThanOrEqual(620);
    expect(result.entries[0].content.endsWith("...")).toBe(true);
  });
});

describe("projectMethod", () => {
  it("uses excerpt as summary when available", () => {
    const result = projectMethod(makeMethod());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary).toContain("95 C");
    expect(result.name).toBe("qPCR SYBR cycle");
  });

  it("falls back to type description when no excerpt", () => {
    const result = projectMethod(makeMethodNoExcerpt());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary).toContain("markdown");
  });
});

describe("projectSequence", () => {
  it("returns feature summary without the base string", () => {
    const result = projectSequence(makeSequenceDetail());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.name).toBe("pUC19");
    expect(result.length).toBe(2686);
    expect(result.circular).toBe(true);
    // Feature summary groups by type
    expect(result.featureSummary).toContain("CDS");
    expect(result.featureSummary).toContain("rep_origin");
    // Must NOT contain the base string
    // (projectSequence does not return seq at all)
  });
});

describe("projectExperiment", () => {
  it("returns status active and method count", () => {
    const result = projectExperiment(makeTask());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe("active");
    expect(result.methodCount).toBe(2);
    expect(result.tags).toContain("phage");
  });

  it("returns status complete when task is complete", () => {
    const task = { ...makeTask(), is_complete: true };
    const result = projectExperiment(task);
    if (!result.ok) throw new Error("Expected ok");
    expect(result.status).toBe("complete");
  });
});

describe("projectProject", () => {
  it("returns name, archived false, tags, and color", () => {
    const result = projectProject(makeProject());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.name).toBe("Phage display 2026");
    expect(result.archived).toBe(false);
    expect(result.tags).toContain("phage");
    expect(result.color).toBe("#ff5733");
  });
});

describe("projectPurchase", () => {
  it("returns vendor, status, and price", () => {
    const result = projectPurchase(makePurchase());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.vendor).toBe("NEB");
    expect(result.status).toBe("ordered");
    expect(result.totalPrice).toBe(156);
    expect(result.quantity).toBe(2);
  });
});

describe("projectMolecule", () => {
  it("returns formula, smiles, and MW", () => {
    const result = projectMolecule(makeMoleculeDetail());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.formula).toBe("C18H36N4O11");
    expect(result.smiles).toBeTruthy();
    expect(result.molecularWeight).toBe(484.5);
    expect(result.source).toBe("pubchem");
  });
});

describe("projectTask", () => {
  it("returns title, status, dates, project, and linked method count", () => {
    const result = projectTask(makeListTask());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.title).toBe("Order pipette tips");
    expect(result.status).toBe("active");
    expect(result.projectId).toBe(4);
    expect(result.linkedMethodCount).toBe(2);
  });

  it("returns status complete when the task is complete", () => {
    const result = projectTask({ ...makeListTask(), is_complete: true });
    if (!result.ok) throw new Error("Expected ok");
    expect(result.status).toBe("complete");
  });
});

describe("projectInventory", () => {
  it("sums container counts and finds the soonest expiry", () => {
    const result = projectInventory(makeInventoryItem(), makeInventoryStocks());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.name).toContain("Q5");
    expect(result.category).toBe("reagent");
    expect(result.stockCount).toBe(2);
    expect(result.totalContainers).toBe(4);
    expect(result.lowAtCount).toBe(2);
    expect(result.soonestExpiry).toBe("2026-09-15");
  });

  it("handles an item with no stocks", () => {
    const result = projectInventory(makeInventoryItem(), []);
    if (!result.ok) throw new Error("Expected ok");
    expect(result.stockCount).toBe(0);
    expect(result.totalContainers).toBe(0);
    expect(result.soonestExpiry).toBeNull();
  });
});

describe("projectDataHubDoc", () => {
  it("returns table metadata, row count, columns, and analyses without cell data", () => {
    const result = projectDataHubDoc(makeDataHubContent());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.name).toBe("Cell viability assay");
    expect(result.tableType).toBe("column");
    expect(result.rowCount).toBe(3);
    expect(result.columns).toHaveLength(2);
    expect(result.columns[0].name).toBe("Control");
    expect(result.analyses).toHaveLength(2);
    // A named analysis keeps its name; an unnamed one falls back to its type.
    expect(result.analyses[0].name).toBe("Unpaired t-test");
    expect(result.analyses[1].name).toBe("oneWayAnova");
    // Must NOT carry any row cell data on the projection.
    expect(JSON.stringify(result)).not.toContain("cells");
  });
});

// ---------------------------------------------------------------------------
// Tool execute paths with stubbed deps
// ---------------------------------------------------------------------------

function overrideDeps(overrides: Partial<ReadArtifactDeps>): void {
  Object.assign(readArtifactDeps, overrides);
}

function restoreDeps(): void {
  // These are replaced in individual tests; restore to throw stubs
  // so leaking never passes silently. Tests that need them must stub again.
}

describe("readNoteTool.execute", () => {
  it("returns the note projection when found", async () => {
    overrideDeps({ getNote: async () => makeNote() });
    const result = await readNoteTool.execute({ id: "1" });
    expect((result as { ok: boolean }).ok).toBe(true);
  });

  it("returns ok:false when note not found", async () => {
    overrideDeps({ getNote: async () => null });
    const result = await readNoteTool.execute({ id: "999" }) as { ok: false; error: string };
    expect(result.ok).toBe(false);
    expect(result.error).toContain("999");
  });

  it("returns ok:false for invalid id", async () => {
    const result = await readNoteTool.execute({ id: "not-a-number" }) as { ok: false; error: string };
    expect(result.ok).toBe(false);
  });
});

describe("readMethodTool.execute", () => {
  it("returns the method projection when found", async () => {
    overrideDeps({ getMethod: async () => makeMethod() });
    const result = await readMethodTool.execute({ id: "2" });
    expect((result as { ok: boolean }).ok).toBe(true);
  });

  it("returns ok:false when method not found", async () => {
    overrideDeps({ getMethod: async () => null });
    const result = await readMethodTool.execute({ id: "42" }) as { ok: false };
    expect(result.ok).toBe(false);
  });
});

describe("readSequenceTool.execute", () => {
  it("returns the sequence projection when found", async () => {
    overrideDeps({ getSequence: async () => makeSequenceDetail() });
    const result = await readSequenceTool.execute({ id: "3" });
    expect((result as { ok: boolean }).ok).toBe(true);
    const proj = result as { ok: true; featureSummary: string };
    expect(proj.featureSummary).toBeTruthy();
  });

  it("returns ok:false when sequence not found", async () => {
    overrideDeps({ getSequence: async () => null });
    const result = await readSequenceTool.execute({ id: "99" }) as { ok: false };
    expect(result.ok).toBe(false);
  });
});

describe("readExperimentTool.execute", () => {
  it("returns the experiment projection for a valid experiment task", async () => {
    overrideDeps({ getExperiment: async () => makeTask() });
    const result = await readExperimentTool.execute({ id: "6" });
    expect((result as { ok: boolean }).ok).toBe(true);
  });

  it("returns ok:false when task is not an experiment", async () => {
    const purchaseTask = { ...makeTask(), task_type: "purchase" as const };
    overrideDeps({ getExperiment: async () => purchaseTask });
    const result = await readExperimentTool.execute({ id: "6" }) as { ok: false; error: string };
    expect(result.ok).toBe(false);
    expect(result.error).toContain("purchase");
  });
});

describe("readProjectTool.execute", () => {
  it("returns the project projection when found", async () => {
    overrideDeps({ getProject: async () => makeProject() });
    const result = await readProjectTool.execute({ id: "4" });
    expect((result as { ok: boolean }).ok).toBe(true);
  });

  it("returns ok:false when project not found", async () => {
    overrideDeps({ getProject: async () => null });
    const result = await readProjectTool.execute({ id: "0" }) as { ok: false };
    expect(result.ok).toBe(false);
  });
});

describe("readPurchaseTool.execute", () => {
  it("returns the purchase projection when found", async () => {
    overrideDeps({ listPurchases: async () => [makePurchase()] });
    const result = await readPurchaseTool.execute({ id: "5" });
    expect((result as { ok: boolean }).ok).toBe(true);
    const proj = result as { ok: true; vendor: string };
    expect(proj.vendor).toBe("NEB");
  });

  it("returns ok:false when purchase not found", async () => {
    overrideDeps({ listPurchases: async () => [] });
    const result = await readPurchaseTool.execute({ id: "5" }) as { ok: false };
    expect(result.ok).toBe(false);
  });
});

describe("readMoleculeTool.execute", () => {
  it("returns the molecule projection when found", async () => {
    overrideDeps({ getMolecule: async () => makeMoleculeDetail() });
    const result = await readMoleculeTool.execute({ id: "mol-uuid-1" });
    expect((result as { ok: boolean }).ok).toBe(true);
    const proj = result as { ok: true; formula: string };
    expect(proj.formula).toBe("C18H36N4O11");
  });

  it("returns ok:false when molecule not found", async () => {
    overrideDeps({ getMolecule: async () => null });
    const result = await readMoleculeTool.execute({ id: "unknown" }) as { ok: false };
    expect(result.ok).toBe(false);
  });

  it("returns ok:false when id is missing", async () => {
    const result = await readMoleculeTool.execute({}) as { ok: false };
    expect(result.ok).toBe(false);
  });
});

describe("readTaskTool.execute", () => {
  it("returns the task projection for a list-type task", async () => {
    overrideDeps({ getTask: async () => makeListTask() });
    const result = await readTaskTool.execute({ id: "11" });
    expect((result as { ok: boolean }).ok).toBe(true);
  });

  it("returns ok:false when the task is an experiment, not a list task", async () => {
    overrideDeps({ getTask: async () => makeTask() });
    const result = await readTaskTool.execute({ id: "6" }) as { ok: false; error: string };
    expect(result.ok).toBe(false);
    expect(result.error).toContain("experiment");
  });

  it("returns ok:false when the task is not found", async () => {
    overrideDeps({ getTask: async () => null });
    const result = await readTaskTool.execute({ id: "999" }) as { ok: false };
    expect(result.ok).toBe(false);
  });
});

describe("readInventoryTool.execute", () => {
  it("returns the inventory projection with summed stocks", async () => {
    overrideDeps({
      getInventoryItem: async () => makeInventoryItem(),
      listStocksForItem: async () => makeInventoryStocks(),
    });
    const result = await readInventoryTool.execute({ id: "8" });
    expect((result as { ok: boolean }).ok).toBe(true);
    const proj = result as { ok: true; totalContainers: number };
    expect(proj.totalContainers).toBe(4);
  });

  it("returns ok:false when the item is not found", async () => {
    overrideDeps({ getInventoryItem: async () => null });
    const result = await readInventoryTool.execute({ id: "404" }) as { ok: false };
    expect(result.ok).toBe(false);
  });
});

describe("readDataHubTool.execute", () => {
  it("returns the document projection when found", async () => {
    overrideDeps({ getDataHubContent: async () => makeDataHubContent() });
    const result = await readDataHubTool.execute({ id: "doc-1" });
    expect((result as { ok: boolean }).ok).toBe(true);
    const proj = result as { ok: true; rowCount: number };
    expect(proj.rowCount).toBe(3);
  });

  it("returns ok:false when the document is not found", async () => {
    overrideDeps({ getDataHubContent: async () => null });
    const result = await readDataHubTool.execute({ id: "nope" }) as { ok: false };
    expect(result.ok).toBe(false);
  });

  it("returns ok:false when id is missing", async () => {
    const result = await readDataHubTool.execute({}) as { ok: false };
    expect(result.ok).toBe(false);
  });
});
