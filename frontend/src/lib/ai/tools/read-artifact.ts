// BeakerBot Layer-2 read-by-id tools (ai artifact-index bot, 2026-06-11).
//
// One read-only tool per artifact type. Each accepts an id from an ArtifactBrief
// returned by search_my_work, fetches only THAT artifact via its type's existing
// get/load API, and returns a TRIMMED PROJECTION. The projection is model-friendly
// and compact on purpose. A large note or method full body would overflow the
// context window; the projection gives the model enough to answer the user's
// question, and it can navigate the user to the artifact's deep link if they want
// to read the rest.
//
// WHY trimmed projections: the design doc (decision 4) locks this. Only the
// fields the model needs to reason about and speak to are returned. Bodies are
// truncated at a character limit. The user's full data never crosses to the model
// except what they explicitly put in their message.
//
// read_datahub_analysis already exists in datahub-analysis.ts and is NOT
// duplicated here.
//
// All tools are READ-ONLY and carry no `action` flag. They never navigate.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import {
  notesApi,
  methodsApi,
  sequencesApi,
  projectsApi,
  purchasesApi,
  tasksApi,
  inventoryItemsApi,
  inventoryStocksApi,
  filesApi,
} from "@/lib/local-api";
import { taskResultsBase } from "@/lib/tasks/results-paths";
import { moleculesApi } from "@/lib/chemistry/api";
import { dataHubApi } from "@/lib/datahub/api";
import type { Note, Method, SequenceDetail, Project, PurchaseItem, Task, InventoryItem, InventoryStock } from "@/lib/types";
import type { MoleculeDetail } from "@/lib/chemistry/api";
import type { DataHubDocContent } from "@/lib/datahub/model/types";
import type { AiTool } from "./types";

// ---------------------------------------------------------------------------
// Trimmed-projection types: the model-facing shapes for each artifact type.
// ---------------------------------------------------------------------------

/** Trimmed note projection returned by read_note. */
export type NoteProjection =
  | {
      ok: true;
      id: string;
      title: string;
      description: string;
      entries: Array<{ title: string; date: string; content: string }>;
    }
  | { ok: false; error: string };

/** Trimmed method projection returned by read_method. */
export type MethodProjection =
  | {
      ok: true;
      id: string;
      name: string;
      method_type: string | null;
      summary: string;
      tags: string[];
    }
  | { ok: false; error: string };

/** Trimmed sequence projection returned by read_sequence. */
export type SequenceProjection =
  | {
      ok: true;
      id: string;
      name: string;
      seq_type: string;
      length: number;
      circular: boolean;
      featureSummary: string;
      organism: string | null;
    }
  | { ok: false; error: string };

/** Trimmed experiment projection returned by read_experiment. With deep: true it
 *  also carries the written content (the results.md writeup + the deviation log),
 *  the full-content read the user gets when they ask Beaker to read the experiment,
 *  not just its meta. */
export type ExperimentProjection =
  | {
      ok: true;
      id: string;
      name: string;
      status: "complete" | "active";
      startDate: string;
      dueDate: string;
      methodCount: number;
      tags: string[];
      /** The results.md writeup body (deep only). Trimmed at RESULTS_BODY_TRIM. */
      resultsBody?: string;
      /** The freeform deviation log (deep only), when present. */
      deviationLog?: string;
      /** True when the results body was longer than the trim and got cut. */
      bodyTruncated?: boolean;
    }
  | { ok: false; error: string };

/** Trimmed project projection returned by read_project. */
export type ProjectProjection =
  | {
      ok: true;
      id: string;
      name: string;
      archived: boolean;
      tags: string[];
      color: string | null;
    }
  | { ok: false; error: string };

/** Trimmed purchase projection returned by read_purchase. */
export type PurchaseProjection =
  | {
      ok: true;
      id: string;
      name: string;
      vendor: string | null;
      category: string | null;
      status: string;
      totalPrice: number;
      quantity: number;
      notes: string | null;
    }
  | { ok: false; error: string };

/** Trimmed molecule projection returned by read_molecule. */
export type MoleculeProjection =
  | {
      ok: true;
      id: string;
      name: string;
      formula: string | null;
      smiles: string | null;
      molecularWeight: number | null;
      source: string | null;
    }
  | { ok: false; error: string };

/** Trimmed task projection returned by read_task. Covers generic list-type
 *  tasks (task_type "list"), as opposed to read_experiment which covers the
 *  "experiment" type. */
export type TaskProjection =
  | {
      ok: true;
      id: string;
      title: string;
      status: "complete" | "active";
      dueDate: string;
      startDate: string;
      projectId: number | null;
      linkedMethodCount: number;
      tags: string[];
    }
  | { ok: false; error: string };

/** Trimmed inventory-item projection returned by read_inventory. */
export type InventoryProjection =
  | {
      ok: true;
      id: string;
      name: string;
      category: string | null;
      vendor: string | null;
      /** Number of physical stock records for this item. */
      stockCount: number;
      /** Summed container_count across this item's stocks. */
      totalContainers: number;
      /** The count-based reorder threshold (low_at_count), or null when none. */
      lowAtCount: number | null;
      /** The soonest expiration date among this item's stocks, YYYY-MM-DD, or null. */
      soonestExpiry: string | null;
    }
  | { ok: false; error: string };

/** Trimmed Data Hub DOCUMENT projection returned by read_datahub. Describes the
 *  table itself (name, columns, row count, the analyses present) WITHOUT dumping
 *  the cell data. read_datahub_analysis (datahub-analysis.ts) reads one analysis
 *  result; this reads the document. */
export type DataHubDocProjection =
  | {
      ok: true;
      id: string;
      name: string;
      tableType: string;
      rowCount: number;
      columns: Array<{ name: string; role: string; dataType: string }>;
      analyses: Array<{ id: string; name: string; type: string }>;
    }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Pure projectors: map a loaded record to its trimmed projection. These are
// exported so unit tests assert the shape directly without a real folder.
// ---------------------------------------------------------------------------

/** Maximum characters returned for a note entry body. */
const NOTE_ENTRY_TRIM = 600;
/** Maximum characters returned for a method summary. */
const METHOD_SUMMARY_TRIM = 400;

/** Trim a string to `max` characters, appending "..." when cut. */
export function trimBody(text: string | undefined | null, max: number): string {
  if (!text) return "";
  return text.length <= max ? text : text.slice(0, max) + "...";
}

/** Project a loaded Note to its model-facing trimmed shape. Pure, no I/O. */
export function projectNote(note: Note): Extract<NoteProjection, { ok: true }> {
  return {
    ok: true,
    id: String(note.id),
    title: note.title || "Untitled note",
    description: trimBody(note.description, METHOD_SUMMARY_TRIM),
    entries: (note.entries ?? []).map((e) => ({
      title: e.title,
      date: e.date,
      content: trimBody(e.content, NOTE_ENTRY_TRIM),
    })),
  };
}

/** Project a loaded Method to its model-facing trimmed shape. Pure, no I/O. */
export function projectMethod(method: Method): Extract<MethodProjection, { ok: true }> {
  // The method body lives on disk at method.source_path and requires a file
  // read through fileService. For the trimmed read_method projection the
  // excerpt field is the pre-computed < 140-char preview stamped at save time,
  // which is exactly what the model needs without a full file read. For methods
  // without an excerpt (older records or PDF methods) we fall back to the
  // method_type's human label so the model still has something useful.
  const summary = method.excerpt
    ? trimBody(method.excerpt, METHOD_SUMMARY_TRIM)
    : method.method_type
    ? `${method.method_type} protocol`
    : "No preview available. Open the method to read its steps.";
  return {
    ok: true,
    id: String(method.id),
    name: method.name || "Untitled method",
    method_type: method.method_type ?? null,
    summary,
    tags: method.tags ?? [],
  };
}

/** Project a loaded SequenceDetail to its model-facing trimmed shape. Pure, no I/O. */
export function projectSequence(seq: SequenceDetail): Extract<SequenceProjection, { ok: true }> {
  // Never return the full base string in the default projection. The base
  // string can be tens of thousands of characters and adds zero value for the
  // model's reasoning. A feature summary (count and types) is far more useful.
  const featureTypes = new Map<string, number>();
  for (const ann of seq.annotations ?? []) {
    const t = ann.type ?? "feature";
    featureTypes.set(t, (featureTypes.get(t) ?? 0) + 1);
  }
  const featureSummary =
    featureTypes.size === 0
      ? "no annotated features"
      : Array.from(featureTypes.entries())
          .map(([type, count]) => `${count} ${type}`)
          .join(", ");
  return {
    ok: true,
    id: String(seq.id),
    name: seq.display_name || "Untitled sequence",
    seq_type: seq.seq_type,
    length: seq.length,
    circular: seq.circular,
    featureSummary,
    organism: seq.organism ?? null,
  };
}

/** Project a loaded Task (experiment) to its model-facing trimmed shape. Pure, no I/O. */
export function projectExperiment(task: Task): Extract<ExperimentProjection, { ok: true }> {
  return {
    ok: true,
    id: String(task.id),
    name: task.name || "Untitled experiment",
    status: task.is_complete ? "complete" : "active",
    startDate: task.start_date,
    dueDate: task.end_date,
    methodCount: (task.method_ids ?? []).length,
    tags: task.tags ?? [],
  };
}

/** Project a loaded Project to its model-facing trimmed shape. Pure, no I/O. */
export function projectProject(project: Project): Extract<ProjectProjection, { ok: true }> {
  return {
    ok: true,
    id: String(project.id),
    name: project.name || "Untitled project",
    archived: project.is_archived,
    tags: project.tags ?? [],
    color: project.color ?? null,
  };
}

/** Project a loaded PurchaseItem to its model-facing trimmed shape. Pure, no I/O. */
export function projectPurchase(item: PurchaseItem): Extract<PurchaseProjection, { ok: true }> {
  return {
    ok: true,
    id: String(item.id),
    name: item.item_name || "Untitled purchase",
    vendor: item.vendor ?? null,
    category: item.category ?? null,
    status: item.order_status ?? "needs_ordering",
    totalPrice: item.total_price ?? 0,
    quantity: item.quantity,
    notes: item.notes ? trimBody(item.notes, 200) : null,
  };
}

/** Project a loaded MoleculeDetail to its model-facing trimmed shape. Pure, no I/O. */
export function projectMolecule(mol: MoleculeDetail): Extract<MoleculeProjection, { ok: true }> {
  return {
    ok: true,
    id: mol.meta.id,
    name: mol.meta.name || "Untitled molecule",
    formula: mol.meta.formula ?? null,
    smiles: mol.meta.smiles ?? null,
    molecularWeight: mol.meta.mol_weight ?? null,
    source: mol.meta.source ?? null,
  };
}

/** The YYYY-MM-DD day prefix of a date-ish string, or null when absent. Pure. */
function dayPrefix(value: string | null | undefined): string | null {
  if (!value || typeof value !== "string") return null;
  const m = value.match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : null;
}

/** Project a loaded list-type Task to its model-facing trimmed shape. Pure, no
 *  I/O. read_experiment covers task_type "experiment"; this covers "list". */
export function projectTask(task: Task): Extract<TaskProjection, { ok: true }> {
  return {
    ok: true,
    id: String(task.id),
    title: task.name || "Untitled task",
    status: task.is_complete ? "complete" : "active",
    dueDate: task.end_date,
    startDate: task.start_date,
    projectId: task.project_id ?? null,
    linkedMethodCount: (task.method_ids ?? []).length,
    tags: task.tags ?? [],
  };
}

/** Project a loaded InventoryItem plus its stocks to its model-facing trimmed
 *  shape. Pure, no I/O. The summed container_count and soonest expiry are derived
 *  from the passed stock list (the same fields summarize_inventory uses). */
export function projectInventory(
  item: InventoryItem,
  stocks: InventoryStock[],
): Extract<InventoryProjection, { ok: true }> {
  const totalContainers = stocks.reduce(
    (sum, s) => sum + (typeof s.container_count === "number" ? s.container_count : 0),
    0,
  );
  let soonestExpiry: string | null = null;
  for (const s of stocks) {
    const exp = dayPrefix(s.expiration_date);
    if (exp !== null && (soonestExpiry === null || exp < soonestExpiry)) {
      soonestExpiry = exp;
    }
  }
  return {
    ok: true,
    id: String(item.id),
    name: item.name || "Untitled item",
    category: item.category ?? null,
    vendor: item.vendor ?? null,
    stockCount: stocks.length,
    totalContainers,
    lowAtCount: typeof item.low_at_count === "number" ? item.low_at_count : null,
    soonestExpiry,
  };
}

/** Project a loaded Data Hub document's full content to its model-facing trimmed
 *  shape. Pure, no I/O. Returns table metadata (name, column names/types/roles,
 *  row count, the analyses present by id/name/type) and NEVER the cell data, so a
 *  large table cannot overflow the context window. */
export function projectDataHubDoc(content: DataHubDocContent): Extract<DataHubDocProjection, { ok: true }> {
  const meta = content.meta;
  return {
    ok: true,
    id: meta.id,
    name: meta.name || "Untitled table",
    tableType: meta.table_type,
    rowCount: content.rows.length,
    columns: content.columns.map((c) => ({
      name: c.name || "Unnamed column",
      role: c.role,
      dataType: c.dataType,
    })),
    analyses: content.analyses.map((a) => ({
      id: a.id,
      name: a.name || a.type,
      type: a.type,
    })),
  };
}

// ---------------------------------------------------------------------------
// Injectable deps seam.
// ---------------------------------------------------------------------------

export type ReadArtifactDeps = {
  getNote: (id: number) => Promise<Note | null>;
  getMethod: (id: number) => Promise<Method | null>;
  getSequence: (id: number) => Promise<SequenceDetail | null>;
  getExperiment: (id: number) => Promise<Task | null>;
  getTask: (id: number) => Promise<Task | null>;
  getProject: (id: number) => Promise<Project | null>;
  listPurchases: () => Promise<PurchaseItem[]>;
  getMolecule: (id: string) => Promise<MoleculeDetail | null>;
  getInventoryItem: (id: number) => Promise<InventoryItem | null>;
  listStocksForItem: (id: number) => Promise<InventoryStock[]>;
  getDataHubContent: (id: string) => Promise<DataHubDocContent | null>;
  /** Read an experiment's results.md writeup body. Returns "" when missing or
   *  unreadable, so a single bad file never breaks the deep read. */
  readExperimentResults: (task: Pick<Task, "id" | "owner">) => Promise<string>;
};

export const readArtifactDeps: ReadArtifactDeps = {
  getNote: (id) => notesApi.get(id),
  getMethod: (id) => methodsApi.get(id),
  getSequence: (id) => sequencesApi.get(id),
  getExperiment: (id) => tasksApi.get(id),
  // read_task and read_experiment share the same tasks API; the tools branch on
  // task_type so each refuses a record of the wrong type.
  getTask: (id) => tasksApi.get(id),
  getProject: (id) => projectsApi.get(id),
  // purchasesApi has no get(id) method, so we list all and find by id.
  listPurchases: () => purchasesApi.listAll(),
  getMolecule: (id) => moleculesApi.get(id),
  getInventoryItem: (id) => inventoryItemsApi.get(id),
  listStocksForItem: (id) => inventoryStocksApi.listForItem(id),
  // getContent returns the full document (columns / rows / analyses); the tool
  // projects only metadata + the row COUNT, never the cell data.
  getDataHubContent: (id) => dataHubApi.getContent(id),
  readExperimentResults: async (task) => {
    try {
      return (await filesApi.readFile(`${taskResultsBase(task)}/results.md`)).content ?? "";
    } catch {
      return "";
    }
  },
};

/** Max characters of results body returned by read_experiment deep. Larger than
 *  the meta trims because this IS the full-content read the user asked for, but
 *  still bounded so one giant writeup cannot blow the context window. */
const RESULTS_BODY_TRIM = 4000;

// ---------------------------------------------------------------------------
// Tool implementations.
// ---------------------------------------------------------------------------

function parseIntId(raw: unknown, name: string): { id: number } | { error: string } {
  const str = typeof raw === "string" ? raw : typeof raw === "number" ? String(raw) : null;
  if (!str) return { error: `${name} is required.` };
  const n = parseInt(str, 10);
  if (isNaN(n)) return { error: `${name} must be a number (got ${JSON.stringify(raw)}).` };
  return { id: n };
}

export const readNoteTool: AiTool = {
  name: "read_note",
  description:
    "Read one of the user's notes by id, returning its title, description, and entry bodies (each trimmed to protect the context window). " +
    "Use this after search_my_work returns a brief with type \"note\" and you need to read its content. " +
    "Returns { ok: true, id, title, description, entries: [{title, date, content}] } or { ok: false, error } when not found. " +
    "Read-only, never navigates.",
  parameters: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "The note id from a search_my_work brief (the id field).",
      },
    },
    required: ["id"],
    additionalProperties: false,
  },
  execute: async (args) => {
    const parsed = parseIntId(args.id, "id");
    if ("error" in parsed) return { ok: false, error: parsed.error } satisfies NoteProjection;
    const note = await readArtifactDeps.getNote(parsed.id);
    if (!note) return { ok: false, error: `Note ${args.id} was not found.` } satisfies NoteProjection;
    return projectNote(note) satisfies NoteProjection;
  },
};

export const readMethodTool: AiTool = {
  name: "read_method",
  description:
    "Read one of the user's methods by id, returning its name, type, a short summary (the excerpt), and tags. " +
    "Use this after search_my_work returns a brief with type \"method\". " +
    "Returns { ok: true, id, name, method_type, summary, tags } or { ok: false, error } when not found. " +
    "The summary is a pre-computed excerpt (up to 140 characters) for markdown methods; for PDF and structured types it describes the type. " +
    "Read-only, never navigates.",
  parameters: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "The method id from a search_my_work brief.",
      },
    },
    required: ["id"],
    additionalProperties: false,
  },
  execute: async (args) => {
    const parsed = parseIntId(args.id, "id");
    if ("error" in parsed) return { ok: false, error: parsed.error } satisfies MethodProjection;
    const method = await readArtifactDeps.getMethod(parsed.id);
    if (!method) return { ok: false, error: `Method ${args.id} was not found.` } satisfies MethodProjection;
    return projectMethod(method) satisfies MethodProjection;
  },
};

export const readSequenceTool: AiTool = {
  name: "read_sequence",
  description:
    "Read one of the user's sequences by id, returning its name, type (dna/rna/protein), length, whether it is circular, a feature summary (count by type), and organism if known. " +
    "The full base string is NOT returned by default because it is too large for the context window. " +
    "Use this after search_my_work returns a brief with type \"sequence\". " +
    "Returns { ok: true, id, name, seq_type, length, circular, featureSummary, organism } or { ok: false, error }. " +
    "Read-only, never navigates.",
  parameters: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "The sequence id from a search_my_work brief.",
      },
    },
    required: ["id"],
    additionalProperties: false,
  },
  execute: async (args) => {
    const parsed = parseIntId(args.id, "id");
    if ("error" in parsed) return { ok: false, error: parsed.error } satisfies SequenceProjection;
    const seq = await readArtifactDeps.getSequence(parsed.id);
    if (!seq) return { ok: false, error: `Sequence ${args.id} was not found.` } satisfies SequenceProjection;
    return projectSequence(seq) satisfies SequenceProjection;
  },
};

export const readExperimentTool: AiTool = {
  name: "read_experiment",
  description:
    "Read one of the user's experiments by id. By default returns its meta (name, status active or complete, start and due dates, attached method count, tags). " +
    "Pass deep: true to ALSO read the experiment's written content, the results.md writeup body and the deviation log, which is what you call when the user asks you to read what an experiment actually says (\"read my colony PCR experiment\", \"what did I write in the cyp51A run\", \"pull out the results of these experiments\"). The body is the user's own text, trimmed if very long with a flag, and you relay or condense it, you never interpret a finding. " +
    "Use this after search_my_work or search_full_text returns a brief with type \"experiment\". " +
    "Returns { ok: true, id, name, status, startDate, dueDate, methodCount, tags, resultsBody?, deviationLog?, bodyTruncated? } or { ok: false, error }. " +
    "Read-only, never navigates.",
  parameters: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "The experiment id from a search brief.",
      },
      deep: {
        type: "boolean",
        description:
          "When true, also read and return the experiment's full written content (the results.md writeup body and the deviation log). Default false (meta only). Use it whenever the user wants to know what the experiment SAYS, not just its status.",
      },
    },
    required: ["id"],
    additionalProperties: false,
  },
  execute: async (args) => {
    const parsed = parseIntId(args.id, "id");
    if ("error" in parsed) return { ok: false, error: parsed.error } satisfies ExperimentProjection;
    const task = await readArtifactDeps.getExperiment(parsed.id);
    if (!task) return { ok: false, error: `Experiment ${args.id} was not found.` } satisfies ExperimentProjection;
    if (task.task_type !== "experiment") {
      return {
        ok: false,
        error: `Item ${args.id} is a ${task.task_type}, not an experiment.`,
      } satisfies ExperimentProjection;
    }
    const base = projectExperiment(task);
    if (args.deep !== true) return base satisfies ExperimentProjection;

    // Deep: read the results.md writeup body + the deviation log (the user's own
    // written content). Best-effort file read; meta still returns if it fails.
    const rawBody = await readArtifactDeps.readExperimentResults(task);
    const trimmedBody = trimBody(rawBody, RESULTS_BODY_TRIM);
    const deviation = task.deviation_log?.trim();
    return {
      ...base,
      ...(trimmedBody ? { resultsBody: trimmedBody } : {}),
      ...(deviation ? { deviationLog: trimBody(deviation, RESULTS_BODY_TRIM) } : {}),
      ...(rawBody.length > RESULTS_BODY_TRIM ? { bodyTruncated: true } : {}),
    } satisfies ExperimentProjection;
  },
};

export const readProjectTool: AiTool = {
  name: "read_project",
  description:
    "Read one of the user's projects by id, returning its name, archived status, tags, and color. " +
    "Use this after search_my_work returns a brief with type \"project\". " +
    "Returns { ok: true, id, name, archived, tags, color } or { ok: false, error }. " +
    "Read-only, never navigates.",
  parameters: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "The project id from a search_my_work brief.",
      },
    },
    required: ["id"],
    additionalProperties: false,
  },
  execute: async (args) => {
    const parsed = parseIntId(args.id, "id");
    if ("error" in parsed) return { ok: false, error: parsed.error } satisfies ProjectProjection;
    const project = await readArtifactDeps.getProject(parsed.id);
    if (!project) return { ok: false, error: `Project ${args.id} was not found.` } satisfies ProjectProjection;
    return projectProject(project) satisfies ProjectProjection;
  },
};

export const readPurchaseTool: AiTool = {
  name: "read_purchase",
  description:
    "Read one of the user's purchase items by id, returning its name, vendor, category, order status, total price, quantity, and notes. " +
    "Use this after search_my_work returns a brief with type \"purchase\". " +
    "Returns { ok: true, id, name, vendor, category, status, totalPrice, quantity, notes } or { ok: false, error }. " +
    "Read-only, never navigates.",
  parameters: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "The purchase item id from a search_my_work brief.",
      },
    },
    required: ["id"],
    additionalProperties: false,
  },
  execute: async (args) => {
    const parsed = parseIntId(args.id, "id");
    if ("error" in parsed) return { ok: false, error: parsed.error } satisfies PurchaseProjection;
    const items = await readArtifactDeps.listPurchases();
    const item = items.find((p) => p.id === parsed.id);
    if (!item) return { ok: false, error: `Purchase item ${args.id} was not found.` } satisfies PurchaseProjection;
    return projectPurchase(item) satisfies PurchaseProjection;
  },
};

export const readMoleculeTool: AiTool = {
  name: "read_molecule",
  description:
    "Read one of the user's molecules by id, returning its name, molecular formula, SMILES, molecular weight, and source (drawn, imported, or pubchem). " +
    "Use this after search_my_work returns a brief with type \"molecule\". " +
    "Returns { ok: true, id, name, formula, smiles, molecularWeight, source } or { ok: false, error }. " +
    "Read-only, never navigates. The Molfile (2D drawing coordinates) is not returned because it is too large for the context window.",
  parameters: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "The molecule id from a search_my_work brief (a UUID string).",
      },
    },
    required: ["id"],
    additionalProperties: false,
  },
  execute: async (args) => {
    const id = typeof args.id === "string" ? args.id : null;
    if (!id) return { ok: false, error: "id is required." } satisfies MoleculeProjection;
    const mol = await readArtifactDeps.getMolecule(id);
    if (!mol) return { ok: false, error: `Molecule ${args.id} was not found.` } satisfies MoleculeProjection;
    return projectMolecule(mol) satisfies MoleculeProjection;
  },
};

export const readTaskTool: AiTool = {
  name: "read_task",
  description:
    "Read one of the user's generic to-do tasks (task_type \"list\") by id, returning its title, status (active or complete), due and start dates, the project it lives in, the number of linked methods, and tags. " +
    "Use this after search_my_work returns a brief with type \"task\". For an experiment (a scheduled bench run) use read_experiment instead. " +
    "Returns { ok: true, id, title, status, dueDate, startDate, projectId, linkedMethodCount, tags } or { ok: false, error } when not found or when the id is an experiment / purchase, not a list task. " +
    "Read-only, never navigates.",
  parameters: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "The task id from a search_my_work brief.",
      },
    },
    required: ["id"],
    additionalProperties: false,
  },
  execute: async (args) => {
    const parsed = parseIntId(args.id, "id");
    if ("error" in parsed) return { ok: false, error: parsed.error } satisfies TaskProjection;
    const task = await readArtifactDeps.getTask(parsed.id);
    if (!task) return { ok: false, error: `Task ${args.id} was not found.` } satisfies TaskProjection;
    if (task.task_type !== "list") {
      return {
        ok: false,
        error: `Item ${args.id} is a ${task.task_type}, not a list task. Use read_${task.task_type === "experiment" ? "experiment" : "purchase"} instead.`,
      } satisfies TaskProjection;
    }
    return projectTask(task) satisfies TaskProjection;
  },
};

export const readInventoryTool: AiTool = {
  name: "read_inventory",
  description:
    "Read one of the user's inventory items by id, returning its name, category, vendor, the number of physical stock records, the summed container count across those stocks, the count-based low-at threshold, and the soonest expiration date. " +
    "Use this after search_my_work returns a brief with type \"inventory\". " +
    "Returns { ok: true, id, name, category, vendor, stockCount, totalContainers, lowAtCount, soonestExpiry } or { ok: false, error } when not found. " +
    "Read-only, never navigates. For the whole-shelf low / out / expiring rollup use summarize_inventory instead.",
  parameters: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "The inventory item id from a search_my_work brief.",
      },
    },
    required: ["id"],
    additionalProperties: false,
  },
  execute: async (args) => {
    const parsed = parseIntId(args.id, "id");
    if ("error" in parsed) return { ok: false, error: parsed.error } satisfies InventoryProjection;
    const item = await readArtifactDeps.getInventoryItem(parsed.id);
    if (!item) return { ok: false, error: `Inventory item ${args.id} was not found.` } satisfies InventoryProjection;
    const stocks = await readArtifactDeps.listStocksForItem(parsed.id);
    return projectInventory(item, stocks) satisfies InventoryProjection;
  },
};

export const readDataHubTool: AiTool = {
  name: "read_datahub",
  description:
    "Read one of the user's Data Hub DOCUMENTS (tables) by id, returning the table metadata: its name, table type, row count, the columns (name, role, data type), and the analyses present on it (id, name, type). " +
    "Use this after search_my_work returns a brief with type \"datahub\" and you need to know what the table holds and which analyses are on it. " +
    "The cell DATA is never returned, only its shape, so a large table cannot overflow the context window. To read one analysis RESULT use read_datahub_analysis with an analysis id from this document. " +
    "Returns { ok: true, id, name, tableType, rowCount, columns, analyses } or { ok: false, error } when not found. " +
    "Read-only, never navigates.",
  parameters: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "The Data Hub document id from a search_my_work brief.",
      },
    },
    required: ["id"],
    additionalProperties: false,
  },
  execute: async (args) => {
    const id = typeof args.id === "string" ? args.id : typeof args.id === "number" ? String(args.id) : null;
    if (!id) return { ok: false, error: "id is required." } satisfies DataHubDocProjection;
    const content = await readArtifactDeps.getDataHubContent(id);
    if (!content) return { ok: false, error: `Data Hub table ${args.id} was not found.` } satisfies DataHubDocProjection;
    return projectDataHubDoc(content) satisfies DataHubDocProjection;
  },
};
