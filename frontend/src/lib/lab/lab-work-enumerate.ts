// Lab-tier Phase 3 chunk 2b-enumerate: pure folder-to-LabWorkRecord[] enumerator.
//
// DESIGN PRINCIPLE: this module is deliberately decoupled from local-api.ts (the
// 8500-line runtime API coupled to the FileSystem-Access folder handle). Instead,
// callers supply a LabWorkSource implementation that wraps whatever data layer
// they need. The real-Api adapter that connects this to the live folder is chunk
// 2b-bind, which also wires in the lab session.
//
// TWELVE LAB-WORK TYPES: tasks, experiments, notes, methods, purchases, inventory
// items, inventory stocks, sequences, phylo trees, molecules, datahub documents,
// and deposits.
// Tasks and experiments both originate from the same listTasks() source; they are
// split here by task_type === "experiment". The remaining ten types each have their
// own source method.
//
// DETERMINISTIC SERIALIZATION: canonicalRecordBytes() sorts all object keys
// recursively before JSON-encoding so the resulting bytes are identical regardless
// of the in-memory key insertion order. This guarantees stable sha256 for the
// chunk-2a manifest deduplication. The live adapter (2b-bind) MUST feed the raw
// persisted record object, with no additional runtime-derived fields (e.g.
// computed display strings, read-time timestamps). Volatile fields cause the sha256
// to change on every sync run, defeating the deduplication entirely.
//
// OUTPUT ORDER: enumerateLabWork() returns records grouped by type in
// LAB_WORK_TYPES order, then sorted ascending by recordId (string sort). Two runs
// over identical data produce an identical array, which makes diffs and unit tests
// deterministic.
//
// No emojis, no em-dashes, no mid-sentence colons.

import type { LabWorkRecord } from "./lab-sync";

// ---------------------------------------------------------------------------
// Re-export LabWorkRecord so callers can import the type from this module
// rather than reaching into lab-sync directly.
// ---------------------------------------------------------------------------

export type { LabWorkRecord };

// ---------------------------------------------------------------------------
// OwnedRecord: minimal shape the source layer must yield.
// ---------------------------------------------------------------------------

/**
 * A minimal record shape yielded by the source layer. The id must be present and
 * non-empty; any other fields are opaque to the enumerator and serialised verbatim.
 */
export interface OwnedRecord {
  id: string | number;
  [k: string]: unknown;
}

// ---------------------------------------------------------------------------
// LabWorkSource: injected interface (no local-api.ts import).
// ---------------------------------------------------------------------------

/**
 * Data-source interface injected by the caller. The enumerator makes NO
 * filesystem or network calls directly.
 *
 * Adapter contract (2b-bind implementor notes):
 *
 * listTasks: return every task record for `owner`, including experiments (records
 *   where task_type === "experiment"). The enumerator splits them by that field.
 *   Each record MUST be the raw persisted object with no runtime-derived or
 *   volatile fields. Volatile fields (e.g. a freshly-computed "lastModifiedAt"
 *   read at call time) defeat the sha256-based deduplication in chunk 2a's sync
 *   engine, causing every record to appear changed on every run.
 *
 * listNotes: return every note record for `owner` (raw persisted form).
 *
 * listMethods: return every method record for `owner` (raw persisted form).
 *
 * listPurchases: return every purchase record for `owner` (raw persisted form).
 *
 * listInventory: return every InventoryItem record for `owner` (raw persisted form).
 *
 * listInventoryStock: return every InventoryStock record for `owner` (raw persisted
 *   form).
 *
 * listSequences: return every SequenceRecord for `owner` (raw persisted form).
 *
 * listPhylo: return every PhyloMeta record for `owner` (raw persisted form).
 *
 * listMolecules: return every MoleculeMeta record for `owner` (raw persisted form).
 *
 * listDatahub: return every DataHub mirror document for `owner`. Each returned
 *   record MUST have a non-empty id drawn from mirror.meta.id (not a
 *   runtime-derived field).
 *
 * listResultSheets: return every experiment Results sheet for `owner`, read from
 *   the persisted results.md markdown mirror. The id is the task id (one Results
 *   sheet per task), so the markdown content is the only volatile-free payload.
 *
 * listNotesSheets: return every Lab Notes sheet for `owner`, read from the
 *   persisted notes.md markdown mirror. Same id rule as listResultSheets.
 *
 * listDeposits: return every Deposit record for `owner` (raw persisted form).
 *   The id is a numeric counter; task_id / project_id / doi are the key payload
 *   fields. No volatile or runtime-derived fields may be added.
 *
 * MENTORSHIP / CHECK-IN TYPES (P2 multi-lab relay-pull). The member PULL path
 *   (pullLabView) can only return record types that the push side actually
 *   mirrored. The original push omitted the entire one-on-one / check-in domain,
 *   so a joined member could never see a shared 1:1, IDP, weekly goal, action
 *   item, compact, onboarding, or rotation. These methods add that coverage.
 *   Every record carries `owner` + `shared_with` already (the unified sharing
 *   shape), so pullLabView's per-record shared_with gate enforces visibility
 *   without any role-based read. RAW PERSISTED FORM, no volatile fields.
 *
 * listOneOnOnes: every OneOnOne (check-in space) record for `owner`.
 * listOneOnOneActionItems: every OneOnOneActionItem record for `owner`.
 * listIdps: every IDP record for `owner`. The trainee owns it; a mentor reads it
 *   only when shared_with names them (per-record share, never by role).
 * listWeeklyGoals: every WeeklyGoal record for `owner` (numeric id).
 * listCheckinCompacts: every CheckinCompact record for `owner`.
 * listCheckinOnboarding: every CheckinOnboarding record for `owner`.
 * listCheckinRotations: every CheckinRotation record for `owner`.
 *
 * ANNOUNCEMENTS (P2 multi-lab relay-pull, lab-wide-public exception). Unlike
 *   every other lab-work type, announcements are NOT per-user owner+shared_with
 *   records. They live in the lab-ROOT `_announcements.json` file (sibling to
 *   users/), are PI-WRITTEN, and are ALL-MEMBERS-READABLE by design (no owner,
 *   no shared_with on the on-disk shape {id, author, text, created_at, pinned}).
 *   To carry them through the per-owner mirror without re-architecting the key
 *   schema, the source attributes each announcement to its `author` (the PI is
 *   an owner in the roster) and yields it only for that author. The push key
 *   therefore becomes `labId/<pi-owner>/announcement/<id>`. The PULL side treats
 *   the `announcement` type as a lab-wide-public exception in pullLabView (every
 *   member sees it regardless of shared_with, matching the on-disk all-members
 *   semantics) and materializeLabView aggregates the pulled entries back into the
 *   member's root `_announcements.json`. This is the one type that does NOT pass
 *   the per-record shared_with gate, because by design it has no shared_with.
 *
 * listAnnouncements: every announcement authored BY `owner`. Returns [] for any
 *   owner who is not the announcement author, so only the PI's own sync pushes
 *   them (members author none). RAW persisted form, no volatile fields.
 * OWNERSHIP: each method is called once per sync run for a single owner string.
 *   The adapter is responsible for mapping `owner` to the correct data scope.
 */
export interface LabWorkSource {
  listTasks(owner: string): Promise<OwnedRecord[]>;
  listNotes(owner: string): Promise<OwnedRecord[]>;
  listMethods(owner: string): Promise<OwnedRecord[]>;
  listPurchases(owner: string): Promise<OwnedRecord[]>;
  listInventory(owner: string): Promise<OwnedRecord[]>;
  listInventoryStock(owner: string): Promise<OwnedRecord[]>;
  listSequences(owner: string): Promise<OwnedRecord[]>;
  listPhylo(owner: string): Promise<OwnedRecord[]>;
  listMolecules(owner: string): Promise<OwnedRecord[]>;
  listDatahub(owner: string): Promise<OwnedRecord[]>;
  listResultSheets(owner: string): Promise<OwnedRecord[]>;
  listNotesSheets(owner: string): Promise<OwnedRecord[]>;
  listDeposits(owner: string): Promise<OwnedRecord[]>;
  listOneOnOnes(owner: string): Promise<OwnedRecord[]>;
  listOneOnOneActionItems(owner: string): Promise<OwnedRecord[]>;
  listIdps(owner: string): Promise<OwnedRecord[]>;
  listWeeklyGoals(owner: string): Promise<OwnedRecord[]>;
  listCheckinCompacts(owner: string): Promise<OwnedRecord[]>;
  listCheckinOnboarding(owner: string): Promise<OwnedRecord[]>;
  listCheckinRotations(owner: string): Promise<OwnedRecord[]>;
  listAnnouncements(owner: string): Promise<OwnedRecord[]>;
}

// ---------------------------------------------------------------------------
// LabWorkType: the closed set of record types pushed to the R2 mirror.
// ---------------------------------------------------------------------------

/**
 * The record types that constitute "lab work" for PI-oversight and member
 * relay-pull purposes. These are the stable recordType strings written to the
 * R2 object key path. Changing them would break the key schema and invalidate
 * all pushed records. The original five types appear first; subsequent types are
 * appended in order to preserve the existing key-schema ordering. The
 * mentorship / check-in block (one_on_one .. checkin_rotation) is the P2
 * multi-lab addition; it is appended last so no existing record-type key moves.
 */
export type LabWorkType =
  | "task"
  | "experiment"
  | "note"
  | "method"
  | "purchase"
  | "inventory"
  | "inventory_stock"
  | "sequence"
  | "phylo"
  | "molecule"
  | "datahub"
  | "result_sheet"
  | "notes_sheet"
  | "deposit"
  | "one_on_one"
  | "one_on_one_action_item"
  | "idp"
  | "weekly_goal"
  | "checkin_compact"
  | "checkin_onboarding"
  | "checkin_rotation"
  | "announcement";

/**
 * Ordered array of all twelve lab-work types. Iteration order determines the
 * grouping in enumerateLabWork() output, so the sequence is intentionally fixed.
 * The original five types come first; subsequent types follow in append order.
 * "deposit" is appended last so existing record-type ordering is unchanged.
 */
export const LAB_WORK_TYPES: LabWorkType[] = [
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
  "deposit",
  "one_on_one",
  "one_on_one_action_item",
  "idp",
  "weekly_goal",
  "checkin_compact",
  "checkin_onboarding",
  "checkin_rotation",
  "announcement",
];

// ---------------------------------------------------------------------------
// canonicalRecordBytes: deterministic serialization.
// ---------------------------------------------------------------------------

/**
 * Returns a stable UTF-8 byte representation of any JSON-serialisable value.
 * Object keys are sorted recursively so that two objects with the same logical
 * content but different key-insertion orders produce identical bytes.
 *
 * The algorithm:
 *   1. Walk the value tree; for plain objects, sort the entry pairs by key and
 *      recurse into each value.
 *   2. Arrays are preserved in insertion order (array ordering IS semantic).
 *   3. Primitives (string, number, boolean, null) are returned as-is.
 *   4. JSON.stringify the reordered tree, then TextEncoder.encode to UTF-8.
 *
 * ADAPTER WARNING: this function makes serialisation deterministic, but it
 * cannot compensate for fields whose VALUE changes across reads (e.g. a
 * fresh Date.now() injected by the adapter). The adapter in 2b-bind MUST
 * pass the raw persisted record object. If the persisted shape is unstable
 * the sha256 will thrash and every record will be re-pushed on every sync run.
 */
export function canonicalRecordBytes(record: OwnedRecord): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(stableValue(record)));
}

/** Recursively reorder object keys; arrays and primitives pass through. */
function stableValue(v: unknown): unknown {
  if (Array.isArray(v)) {
    return v.map(stableValue);
  }
  if (v !== null && typeof v === "object") {
    const sorted = Object.keys(v as Record<string, unknown>)
      .slice()
      .sort();
    const result: Record<string, unknown> = {};
    for (const k of sorted) {
      result[k] = stableValue((v as Record<string, unknown>)[k]);
    }
    return result;
  }
  return v;
}

// ---------------------------------------------------------------------------
// enumerateLabWork: main entry point.
// ---------------------------------------------------------------------------

/**
 * Enumerates all lab work for `owner` from the supplied source and returns a
 * flat array of LabWorkRecord values ready for chunk 2a's syncLabWorkToMirror.
 *
 * Behaviour:
 *   - Calls all four source methods in parallel (Promise.all).
 *   - Tasks with task_type === "experiment" become recordType "experiment";
 *     all other tasks become recordType "task".
 *   - Notes, methods, and purchases map directly to their respective types.
 *   - Any record with a null, undefined, or empty-string id is silently skipped
 *     (the id would produce a malformed R2 object key; logging is left to the
 *     caller's monitoring layer).
 *   - Output is grouped by type in LAB_WORK_TYPES order then sorted by recordId
 *     ascending (string comparison). This makes two runs over identical data
 *     produce an identical array, which simplifies diffing and unit testing.
 *
 * @param params.owner   the username whose records to enumerate.
 * @param params.source  the injected data source (implemented by 2b-bind).
 * @returns a flat LabWorkRecord[] covering all twelve lab-work types.
 */
export async function enumerateLabWork(params: {
  owner: string;
  source: LabWorkSource;
}): Promise<LabWorkRecord[]> {
  const { owner, source } = params;

  // Fetch every record list in parallel.
  const [
    tasks,
    notes,
    methods,
    purchases,
    inventory,
    inventoryStock,
    sequences,
    phylo,
    molecules,
    datahub,
    resultSheets,
    notesSheets,
    deposits,
    oneOnOnes,
    oneOnOneActionItems,
    idps,
    weeklyGoals,
    checkinCompacts,
    checkinOnboarding,
    checkinRotations,
    announcements,
  ] = await Promise.all([
    source.listTasks(owner),
    source.listNotes(owner),
    source.listMethods(owner),
    source.listPurchases(owner),
    source.listInventory(owner),
    source.listInventoryStock(owner),
    source.listSequences(owner),
    source.listPhylo(owner),
    source.listMolecules(owner),
    source.listDatahub(owner),
    source.listResultSheets(owner),
    source.listNotesSheets(owner),
    source.listDeposits(owner),
    source.listOneOnOnes(owner),
    source.listOneOnOneActionItems(owner),
    source.listIdps(owner),
    source.listWeeklyGoals(owner),
    source.listCheckinCompacts(owner),
    source.listCheckinOnboarding(owner),
    source.listCheckinRotations(owner),
    source.listAnnouncements(owner),
  ]);

  // Separate tasks from experiments by task_type.
  const taskRecords: OwnedRecord[] = [];
  const experimentRecords: OwnedRecord[] = [];
  for (const t of tasks) {
    if ((t as { task_type?: unknown }).task_type === "experiment") {
      experimentRecords.push(t);
    } else {
      taskRecords.push(t);
    }
  }

  // Build per-type groups in LAB_WORK_TYPES order.
  const groups: Array<{ type: LabWorkType; records: OwnedRecord[] }> = [
    { type: "task", records: taskRecords },
    { type: "experiment", records: experimentRecords },
    { type: "note", records: notes },
    { type: "method", records: methods },
    { type: "purchase", records: purchases },
    { type: "inventory", records: inventory },
    { type: "inventory_stock", records: inventoryStock },
    { type: "sequence", records: sequences },
    { type: "phylo", records: phylo },
    { type: "molecule", records: molecules },
    { type: "datahub", records: datahub },
    { type: "result_sheet", records: resultSheets },
    { type: "notes_sheet", records: notesSheets },
    { type: "deposit", records: deposits },
    { type: "one_on_one", records: oneOnOnes },
    { type: "one_on_one_action_item", records: oneOnOneActionItems },
    { type: "idp", records: idps },
    { type: "weekly_goal", records: weeklyGoals },
    { type: "checkin_compact", records: checkinCompacts },
    { type: "checkin_onboarding", records: checkinOnboarding },
    { type: "checkin_rotation", records: checkinRotations },
    { type: "announcement", records: announcements },
  ];

  const result: LabWorkRecord[] = [];

  for (const { type, records } of groups) {
    // Skip records with empty/missing ids silently.
    const valid = records.filter(
      (r) => r.id !== null && r.id !== undefined && r.id !== "",
    );

    // Sort ascending by the stringified recordId for stable output order.
    const sorted = valid
      .map((r) => ({ record: r, id: String(r.id) }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

    for (const { record, id } of sorted) {
      result.push({
        recordType: type,
        recordId: id,
        plaintext: canonicalRecordBytes(record),
      });
    }
  }

  return result;
}
