// sequence editor master. BeakerSearch global object search, chunk 1, the PURE
// index builder.
//
// buildGlobalIndex maps the four canonical core record sets (Tasks, Projects,
// Methods, Sequences) into one flat GlobalIndexEntry[] the global source ranks
// and renders. It is pure data, no React, no rendering, so the index brain is
// unit-tested without a DOM (mirrors editor-commands.ts). The hook that feeds it
// the live React Query caches lives in useGlobalObjectIndex.ts.
//
// What this file deliberately does NOT do (chunk 2 and beyond), the ranking, the
// fuzzyScore pass, the per-type caps, the provider wiring, the on-page de-dup,
// the MRU. This is only the data shape plus the open handlers per the deep-links
// that already exist (decision 1, v1 adds no new deep-link param).
//
// Composite-key discipline, every owner-scoped type (Task, Project, Method) keys
// its entry by the "{owner}:{id}" identity the merged loaders dedup on, so a
// record shared into me and also owned by me never double-lists, and the jump
// opens in the right owner namespace. Sequences are page-scoped and ownerless
// (the documented exception), so their key is the bare numeric id as a string.
//
// Voice in comments and copy, no em-dashes, no en-dashes, no emojis, no
// mid-sentence colons.

import type { IconName } from "@/components/icons";
import { taskKey, type Task, type Method, type Project, type SequenceRecord, type InventoryItem, type Note } from "@/lib/types";
import { getMethodTypeMeta } from "@/lib/methods/method-type-registry";
import { INVENTORY_ENABLED } from "@/lib/inventory/config";
import { supplyKeyFor } from "@/lib/supplies/supply-model";
import type { DataHubDocument } from "@/lib/datahub/model/types";
import type { Molecule } from "@/lib/chemistry/api";
import type { PurchaseItem } from "@/lib/types";

/** The uniform record the global source ranks and renders. One per core record.
 *  Ranking and rendering branch only on `type`, `iconName`, and `open`, never on
 *  the source record shape, so chunk 2 stays type-agnostic. */
export interface GlobalIndexEntry {
  type: "task" | "project" | "method" | "sequence" | "inventory" | "note" | "datahub" | "molecule" | "purchase";
  /** Composite identity, taskKey() / `${owner}:${id}` / the sequence id as a
   *  string. The dedup key AND the carrier of the owner into the jump. */
  key: string;
  /** Display name shown as the row title. */
  label: string;
  /** The subline under the label (section 2 of the design doc). */
  meta: string;
  /** label + folded fuzzy fields, precomputed lowercased so the per-keystroke
   *  pass is one fuzzyScore over a string and not a re-concatenation. */
  haystack: string;
  /** last_edited_at / added_at epoch ms, 0 when the record carries no stamp. */
  recencyAt: number;
  iconName: IconName;
  /** The navigable target, a route path plus the deep-link param value, so a
   *  cold jump from any page lands on the record. Chunk 2 turns this into the
   *  NAVIGATE item's onRun (in-page open when already on the home page, else a
   *  router push). Kept as data here so the builder stays pure. */
  href: string;
  /** False greys the row and the keyboard cursor skips it (a record the loaders
   *  surfaced but that cannot be opened). Defensive, the merged loaders prune
   *  revoked/tombstoned shares before they reach the index. */
  enabled: boolean;
  /** Scanned-handwriting OCR text, present only on note entries that carry a
   *  scan. Indexed as its own MiniSearch field (so a page is findable by what it
   *  says) and also folded into `haystack` so an exact OCR-word match still ranks
   *  in the strict tier. Absent on the core record types. */
  ocr?: string;
}

/** The eight core record sets plus the active user, exactly the canonical
 *  React Query caches useGlobalObjectIndex subscribes to. */
export interface GlobalIndexInput {
  tasks: Task[];
  projects: Project[];
  methods: Method[];
  sequences: SequenceRecord[];
  inventoryItems: InventoryItem[];
  currentUser: string;
  /** Personal + shared notes, so a handwritten/scanned page is findable from any
   *  page (not just the workbench). Optional so existing callers / tests that do
   *  not pass notes keep building the same index. */
  notes?: Note[];
  /** Aggregated scanned-handwriting OCR text per note id (the
   *  ["note-ocr-text"] query), folded into the note entry's haystack + ocr
   *  field. A note with no scan simply has no entry here. */
  noteOcrText?: Map<number, string>;
  /** Data Hub documents (tables + analyses). Optional so existing callers and
   *  tests that do not pass datahub tables keep building the same index. */
  datahubDocs?: DataHubDocument[];
  /** Molecules from the chemistry workbench library. Optional for the same
   *  backward-compat reason as datahubDocs. */
  molecules?: Molecule[];
  /** Purchase items. Optional for backward compat. The items are decorated with
   *  an owner field by listAllIncludingShared; without it we fall back to the
   *  currentUser so own items always have a key. */
  purchaseItems?: Array<PurchaseItem & { owner?: string }>;
}

/** Parse an ISO stamp to epoch ms, 0 when absent or unparseable, so a missing
 *  edit stamp is a clean "no recency boost" (chunk 2 reads recencyAt). */
function toEpoch(stamp: string | null | undefined): number {
  if (!stamp) return 0;
  const t = Date.parse(stamp);
  return Number.isNaN(t) ? 0 : t;
}

/** Fold a list of optional field parts into one lowercased haystack string,
 *  dropping empties so a null tag list or absent organism adds no noise. */
function buildHaystack(parts: Array<string | null | undefined>): string {
  return parts
    .filter((p): p is string => Boolean(p && p.trim()))
    .join(" ")
    .toLowerCase();
}

/** A short "shared by <owner>" / "lab-wide" tail for an owner-scoped record, so
 *  the subline tells the user a record is not their own. Empty for own records. */
function sharedTail(owner: string, currentUser: string, isShared: boolean | undefined): string {
  if (isShared && owner && owner !== currentUser) return `, shared by ${owner}`;
  return "";
}

function buildTaskEntry(t: Task, projectNameByKey: Map<string, string>, currentUser: string): GlobalIndexEntry {
  const key = taskKey(t);
  const projectName =
    t.project_id != null
      ? projectNameByKey.get(`${t.owner}:${t.project_id}`) ?? "Standalone"
      : "Standalone";
  const typeLabel =
    t.task_type === "experiment" ? "Experiment" : t.task_type === "purchase" ? "Purchase" : "List";
  const meta = `${typeLabel} in ${projectName}${sharedTail(t.owner, currentUser, t.is_shared_with_me)}`;
  // Every task type opens through the one canonical opener, the home-route
  // `/?openTask=<key>` handler, which loads TaskDetailPopup for any task (purchase,
  // experiment, or list). The value is the FULL composite taskKey so a task shared
  // into me resolves to the sharer's namespace, never the viewer's id-colliding own
  // task (the home handler matches by taskKey over the same merged loader, then
  // strips the param). There is no per-page task route, so /workbench and /purchases
  // do not read openTask. Decision 1 plus the v1 shared-task opener Grant approved.
  return {
    type: "task",
    key,
    label: t.name,
    meta,
    haystack: buildHaystack([t.name, projectName, (t.tags ?? []).join(" "), t.is_shared_with_me ? t.owner : null]),
    recencyAt: toEpoch(t.last_edited_at),
    iconName: "list",
    href: `/?openTask=${encodeURIComponent(key)}`,
    enabled: true,
  };
}

function buildProjectEntry(p: Project, currentUser: string): GlobalIndexEntry {
  const key = `${p.owner}:${p.id}`;
  const isShared = Boolean(p.is_shared_with_me) && p.owner !== currentUser;
  const meta = isShared ? `Project, shared by ${p.owner}` : "Project";
  // The [id] route reads ?owner= as the ownerHint; only a shared project needs
  // it (the openProject rule, identical in NewProjectButton.handleCreated).
  const href = isShared
    ? `/workbench/projects/${p.id}?owner=${encodeURIComponent(p.owner)}`
    : `/workbench/projects/${p.id}`;
  return {
    type: "project",
    key,
    label: p.name,
    meta,
    haystack: buildHaystack([p.name, (p.tags ?? []).join(" "), isShared ? p.owner : null]),
    recencyAt: toEpoch(p.last_edited_at),
    iconName: "folder",
    href,
    enabled: true,
  };
}

function buildMethodEntry(m: Method, currentUser: string): GlobalIndexEntry {
  // public/lab-wide methods carry owner "public"; the ?openMethod= resolver is
  // id-based and owner-priority, so the bare id lands the right record.
  const key = m.is_public ? `public:${m.id}` : `${m.owner}:${m.id}`;
  const typeLabel = getMethodTypeMeta(m.method_type).label;
  const folder = m.folder_path && m.folder_path.trim() ? m.folder_path : "Uncategorized";
  let tail = "";
  if (m.is_public) tail = ", lab-wide";
  else if (m.is_shared_with_me && m.owner !== currentUser) tail = `, shared by ${m.owner}, read-only`;
  const meta = `${typeLabel}, ${folder}${tail}`;
  return {
    type: "method",
    key,
    label: m.name,
    meta,
    haystack: buildHaystack([
      m.name,
      m.method_type,
      (m.tags ?? []).join(" "),
      m.folder_path,
      m.is_shared_with_me ? m.owner : null,
    ]),
    recencyAt: toEpoch(m.last_edited_at),
    iconName: "book",
    href: `/methods?openMethod=${m.id}`,
    enabled: true,
  };
}

function buildSequenceEntry(s: SequenceRecord): GlobalIndexEntry {
  // Sequences are page-scoped and ownerless (the documented composite-key
  // exception), so the key is the bare numeric id as a string.
  const topology = s.circular ? "Circular" : "Linear";
  const lengthLabel = `${s.length.toLocaleString()} bp`;
  const parts = [`${s.seq_type}`, topology, lengthLabel];
  if (s.organism) parts.push(s.organism);
  return {
    type: "sequence",
    key: String(s.id),
    label: s.display_name,
    meta: parts.join(", "),
    haystack: buildHaystack([s.display_name, s.organism, s.seq_type]),
    recencyAt: toEpoch(s.added_at),
    iconName: s.circular ? "moleculeCircular" : "moleculeLinear",
    href: `/sequences?seq=${s.id}`,
    enabled: true,
  };
}

/** Map a single InventoryItem to a GlobalIndexEntry. Exported for unit tests.
 *  The index gate (INVENTORY_ENABLED) lives in buildGlobalIndex, not here, so
 *  the entry shape can be tested independently of the flag. */
export function buildInventoryEntry(item: InventoryItem): GlobalIndexEntry {
  const key = `${item.owner}:${item.id}`;
  const metaParts = [item.category, item.vendor, item.catalog_number].filter(
    (p): p is string => Boolean(p && p.trim()),
  );
  const meta = metaParts.join(" · ") || item.category;
  // Deep-link into the Supplies v2 unified page (chunk 6 + decision 9.1):
  // /inventory now redirects into /supplies, and the `supply` param opens that
  // item's Supply row. The param is the identity key (supplyKeyFor), which may
  // contain ":" / "|", so it is URL-encoded. Same key the supplies page reads.
  const supplyKey = supplyKeyFor({
    name: item.name,
    vendor: item.vendor,
    catalogNumber: item.catalog_number,
  });
  return {
    type: "inventory",
    key,
    label: item.name,
    meta,
    haystack: buildHaystack([item.name, item.vendor, item.catalog_number, item.cas, item.notes]),
    recencyAt: toEpoch(item.last_edited_at),
    iconName: "vial" as IconName,
    href: `/supplies?supply=${encodeURIComponent(supplyKey)}`,
    enabled: true,
  };
}

/** Map one note to a GlobalIndexEntry. The OCR text (scanned handwriting) is
 *  folded into the haystack AND carried in the `ocr` field, so an exact OCR-word
 *  match ranks in the strict tier and the fuzzy pass can boost it separately.
 *  The href deep-links the workbench Notes tab to this note (consumed into the
 *  panel's open seam), so a found note opens from any page. Exported for tests. */
export function buildNoteEntry(
  note: Note,
  ocrText: string,
  currentUser: string,
): GlobalIndexEntry {
  // The note's composite, collision-safe key (mirrors workbench noteKey),
  // `note-<owner>:<id>`; owner falls back to the current user for a personal note.
  const owner = note.username || currentUser;
  const key = `note-${owner}:${note.id}`;
  const sharedIn = owner !== currentUser;
  const base = note.is_running_log ? "Running log" : "Note";
  const meta = sharedIn ? `${base}, shared by ${owner}` : base;
  return {
    type: "note",
    key,
    label: note.title || "Untitled note",
    meta,
    haystack: buildHaystack([note.title, note.description, ocrText || null]),
    ocr: ocrText || undefined,
    recencyAt: toEpoch(note.last_edited_at ?? note.updated_at),
    iconName: "file",
    href: `/workbench?tab=notes&note=${encodeURIComponent(key)}`,
    enabled: true,
  };
}

/** Map a Data Hub document to a GlobalIndexEntry. Exported for unit tests.
 *  Uses the "chart" icon (the same glyph the Data Hub page tab uses for data
 *  visualizations). Deep-links via /datahub?doc=<id> which the page reads to
 *  auto-select the table on load. */
export function buildDataHubEntry(
  doc: DataHubDocument,
  currentUser: string,
): GlobalIndexEntry {
  // Owner is available via the last_edited_by field when present, or via the
  // caller. For a simpler key use the doc id alone (it is already globally
  // unique within a user's space). Prefix with "datahub:" for namespace safety.
  const key = `datahub:${currentUser}:${doc.id}`;
  const tableTypeLabel =
    doc.table_type === "xy" ? "XY table"
    : doc.table_type === "column" ? "Column table"
    : doc.table_type === "grouped" ? "Grouped table"
    : doc.table_type === "survival" ? "Survival table"
    : doc.table_type === "contingency" ? "Contingency table"
    : doc.table_type === "nested" ? "Nested table"
    : doc.table_type === "partsOfWhole" ? "Parts-of-whole table"
    : "Data table";
  const meta = tableTypeLabel;
  return {
    type: "datahub",
    key,
    label: doc.name,
    meta,
    haystack: buildHaystack([doc.name, doc.table_type, doc.folder_path]),
    recencyAt: toEpoch(doc.last_edited_at),
    iconName: "chart" as IconName,
    href: `/datahub?doc=${encodeURIComponent(doc.id)}`,
    enabled: true,
  };
}

/** Map a Molecule to a GlobalIndexEntry. Exported for unit tests.
 *  Uses the "vial" icon to match the chemistry hub's molecule glyph.
 *  Deep-links via /chemistry?molecule=<id> which ChemistryHub reads on mount
 *  to auto-select the molecule and open its detail. */
export function buildMoleculeEntry(mol: Molecule): GlobalIndexEntry {
  // Molecule ids are per-user strings (no global dedup needed for own library).
  const key = `molecule:${mol.id}`;
  const metaParts: string[] = [];
  if (mol.formula) metaParts.push(mol.formula);
  if (mol.mol_weight != null) metaParts.push(`MW ${mol.mol_weight.toFixed(0)}`);
  if (mol.source === "pubchem") metaParts.push("from PubChem");
  else if (mol.source === "imported") metaParts.push("imported");
  const meta = metaParts.join(", ") || "Molecule";
  return {
    type: "molecule",
    key,
    label: mol.name,
    meta,
    haystack: buildHaystack([mol.name, mol.formula, mol.smiles, mol.inchikey]),
    recencyAt: toEpoch(mol.added_at),
    iconName: "vial" as IconName,
    href: `/chemistry?molecule=${encodeURIComponent(mol.id)}`,
    enabled: true,
  };
}

/** Map a PurchaseItem to a GlobalIndexEntry. Exported for unit tests.
 *  The purchases page has no per-item deep link, so the href points to the
 *  purchases page root. A future pass can add a per-item opener if one is built.
 *  Uses the "receipt" icon. */
export function buildPurchaseEntry(
  item: PurchaseItem & { owner?: string },
  currentUser: string,
): GlobalIndexEntry {
  const owner = item.owner ?? currentUser;
  // Composite key: owner + item id. Item ids are per-owner incrementing ints.
  const key = `purchase:${owner}:${item.id}`;
  const metaParts: string[] = [];
  if (item.vendor) metaParts.push(item.vendor);
  if (item.category) metaParts.push(item.category);
  if (item.total_price != null && item.total_price > 0) {
    metaParts.push(`$${item.total_price.toFixed(2)}`);
  }
  const meta = metaParts.join(" · ") || "Purchase";
  return {
    type: "purchase",
    key,
    label: item.item_name,
    meta,
    haystack: buildHaystack([item.item_name, item.vendor, item.category, item.catalog_number, item.cas, item.notes]),
    recencyAt: 0, // PurchaseItem has no edit timestamp; recency boost is not applicable.
    iconName: "receipt" as IconName,
    href: "/purchases",
    enabled: true,
  };
}

/** Map the core record sets into one flat index. Pure and O(n) over the
 *  arrays, the project-name lookup is built once so the task subline does
 *  not re-scan. The merged loaders already dedup own vs shared by composite key,
 *  so this trusts their output and does not re-dedup. */
export function buildGlobalIndex(input: GlobalIndexInput): GlobalIndexEntry[] {
  const {
    tasks,
    projects,
    methods,
    sequences,
    inventoryItems,
    currentUser,
    notes = [],
    noteOcrText,
    datahubDocs = [],
    molecules = [],
    purchaseItems = [],
  } = input;

  const projectNameByKey = new Map<string, string>();
  for (const p of projects) projectNameByKey.set(`${p.owner}:${p.id}`, p.name);

  const entries: GlobalIndexEntry[] = [];
  for (const t of tasks) entries.push(buildTaskEntry(t, projectNameByKey, currentUser));
  for (const p of projects) entries.push(buildProjectEntry(p, currentUser));
  for (const m of methods) entries.push(buildMethodEntry(m, currentUser));
  for (const s of sequences) entries.push(buildSequenceEntry(s));
  if (INVENTORY_ENABLED) {
    for (const item of inventoryItems) entries.push(buildInventoryEntry(item));
  }
  for (const note of notes) {
    entries.push(buildNoteEntry(note, noteOcrText?.get(note.id) ?? "", currentUser));
  }
  for (const doc of datahubDocs) entries.push(buildDataHubEntry(doc, currentUser));
  for (const mol of molecules) entries.push(buildMoleculeEntry(mol));
  for (const item of purchaseItems) entries.push(buildPurchaseEntry(item, currentUser));
  return entries;
}
