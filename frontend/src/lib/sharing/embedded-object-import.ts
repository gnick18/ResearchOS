// Phase 6c (2026-06-12). Recipient-side embedded-object import.
//
// importEmbeddedObjects receives the BundleEmbeddedObject array that arrived
// with a shared note bundle and, for each item, either:
//   links   -- the recipient already has the same object by content identity
//              (resolveByPortableId found a match). No copy is created; D4.
//   imports -- the object is recreated locally from the serialized payload,
//              reversed from embedded-object-collect.ts, and filed into a
//              destination collection (default "Shared by <sender>"); D3.
//   skipped -- the object is a datahub snapshot, an unknown type, a file
//              type, or a create call failed. The embed renders as a Phase 6d
//              no-access placeholder on skips.
//
// The returned EmbeddedImportResult maps each original embed href to a
// resolution record so the caller (importNoteBundle) can rewrite the note's
// markdown embed links so they point at the recipient's local object ids.
//
// Never throws out of importEmbeddedObjects. A failing item becomes action
// "skipped" with a reason field.
//
// House voice: no em-dashes, no emojis, no mid-sentence colons.

import type { BundleEmbeddedObject } from "@/lib/sharing/bundle";
import type { ObjectRefType } from "@/lib/references";
import { resolveByPortableId } from "@/lib/sharing/portable-identity";
import { moleculesApi } from "@/lib/chemistry/api";
import { dataHubApi } from "@/lib/datahub/api";
import {
  sequencesApi,
  notesApi,
  methodsApi,
  projectsApi,
  tasksApi,
} from "@/lib/local-api";

// ── Result types ──────────────────────────────────────────────────────────────

/** One resolution entry, keyed by the original embed href. */
export interface EmbedResolution {
  /** The original embed href (the key into the note's markdown). */
  href: string;
  /** What happened to this embedded object on the recipient side. */
  action: "linked" | "imported" | "skipped";
  /** The type of the local object (same as the bundle type). */
  localType: ObjectRefType;
  /**
   * The recipient's local id for the object, as a string. Present when action
   * is "linked" or "imported". Null for "skipped".
   */
  localId: string | null;
  /** The cross-user portable id from the bundle, or null when unavailable. */
  portableId: string | null;
  /** Human label for this object (from the bundle entry). */
  name: string;
  /**
   * For "skipped" items: a brief reason string for diagnostic logging. Not
   * shown to the user in this phase; the embed renders as a placeholder.
   */
  skipReason?: string;
}

/** The full result of an importEmbeddedObjects call. */
export interface EmbeddedImportResult {
  /** One entry per BundleEmbeddedObject in the same order as the input. */
  resolutions: EmbedResolution[];
  /**
   * Convenience map from original href to its resolution, built from resolutions
   * above. href is the key the note-transfer rewrite step needs.
   */
  byHref: Map<string, EmbedResolution>;
}

// ── Options ───────────────────────────────────────────────────────────────────

/**
 * Destination override for a single embedded object. When a per-item UI picker
 * exists, this lets the UI supply a specific project id to file the object into.
 * When absent the default "Shared by <sender>" collection is used.
 */
export interface ImportDestination {
  /** The recipient's local project id to file the object into (as a string). */
  projectId: string;
}

export interface ImportEmbeddedObjectsOpts {
  /** The current (recipient) user's username. */
  currentUser: string;
  /**
   * A display label for the sender, used to name the default destination
   * collection ("Shared by <senderLabel>"). Typically the sender's email.
   */
  senderLabel: string;
  /**
   * Per-item destination overrides from the UI picker. Keyed by the original
   * embed href. When a href is absent from this map, the default collection is
   * used. When the map itself is absent, the default collection applies to all
   * items.
   */
  destinationByHref?: Map<string, ImportDestination>;
  /**
   * Hrefs the recipient explicitly chose to import as a fresh copy even though a
   * content-identity duplicate exists locally. For these, skip the D4 auto-link
   * and recreate a new copy (filed per destinationByHref or the default
   * collection). Absent or not-containing-a-href -> the default auto-link applies.
   */
  forceImportHrefs?: Set<string>;
}

// ── UTF-8 decode helper ───────────────────────────────────────────────────────

function utf8Decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

// ── Default destination collection ("Shared by <sender>") ────────────────────

/**
 * Find the existing "Shared by <senderLabel>" collection or create it. Returns
 * the collection's local id as a string. Creating is best-effort; a failure
 * returns null and the caller files without a collection assignment.
 *
 * "Collection" in this project's data model is a Project record used as a
 * grouping / filter. projectsApi.create handles the persistence.
 */
async function findOrCreateSharedByCollection(
  senderLabel: string,
): Promise<string | null> {
  const collectionName = `Shared by ${senderLabel}`;
  try {
    const existing = await projectsApi.list();
    const match = existing.find((p) => p.name === collectionName);
    if (match) return String(match.id);
    const created = await projectsApi.create({ name: collectionName });
    return String(created.id);
  } catch (err) {
    console.warn("[embedded-object-import] Could not find/create shared-by collection:", err);
    return null;
  }
}

// ── Per-type create helpers ───────────────────────────────────────────────────

/**
 * Recreate a molecule from molfile bytes. Returns the local id on success, or
 * null on failure. The name comes from the bundle entry.
 */
async function importMolecule(
  obj: BundleEmbeddedObject,
  projectIds: string[],
): Promise<string | null> {
  if (!(obj.inline instanceof Uint8Array)) return null;
  const molfile = utf8Decode(obj.inline);
  if (!molfile.trim()) return null;
  const detail = await moleculesApi.create(molfile, {
    name: obj.name,
    project_ids: projectIds,
    source: "imported",
  });
  return String(detail.meta.id);
}

/**
 * Recreate a sequence from GenBank text bytes. Returns the local id on
 * success, or null on failure.
 */
async function importSequence(
  obj: BundleEmbeddedObject,
  projectIds: string[],
): Promise<string | null> {
  if (!(obj.inline instanceof Uint8Array)) return null;
  const genbank = utf8Decode(obj.inline);
  if (!genbank.trim()) return null;
  const record = await sequencesApi.create({
    display_name: obj.name,
    genbank,
    project_ids: projectIds,
  });
  if (!record) return null;
  return String(record.id);
}

/**
 * Recreate a note from markdown bytes. Returns the local id on success, or
 * null on failure.
 *
 * The markdown serialized by embedded-object-collect.ts is:
 *   "# <title>\n\n[description]\n\n## <entry title>\n\n<entry content>"
 * We create a single-entry note carrying the full text as the content, since
 * we cannot reliably reverse the section structure without the original entry
 * boundaries. The title is the bundle entry name.
 */
async function importNote(
  obj: BundleEmbeddedObject,
): Promise<string | null> {
  if (!(obj.inline instanceof Uint8Array)) return null;
  const markdown = utf8Decode(obj.inline);
  const today = new Date().toISOString().slice(0, 10);
  const created = await notesApi.create({
    title: obj.name,
    description: "",
    is_running_log: false,
    entries: [
      {
        title: "Received content",
        date: today,
        content: markdown,
      },
    ],
  });
  return String(created.id);
}

/**
 * Create a method stub from the bundle metadata. The bundle carries metadata
 * only (name / method_type / tags / source_uuid / excerpt), NOT the full body.
 * The created stub has no markdown body, it is a "card" record the recipient
 * can open to see the method name and type. Provenance: the import path
 * creates a private method (no shared_with) under the recipient.
 *
 * Note: method_type from the bundle is typed broadly; if it does not match
 * the allowed MethodCreate values it is omitted (the store defaults to null).
 */
async function importMethod(
  obj: BundleEmbeddedObject,
): Promise<string | null> {
  const meta = obj.inline as Record<string, unknown> | null | undefined;
  if (!meta || typeof meta !== "object" || obj.serialization !== "file") {
    // file-serialized methods carry their JSON in obj.inline as Uint8Array
    // after readBundle rehydrates them.
    if (!(obj.inline instanceof Uint8Array)) return null;
  }

  let parsed: Record<string, unknown>;
  if (obj.inline instanceof Uint8Array) {
    try {
      parsed = JSON.parse(utf8Decode(obj.inline)) as Record<string, unknown>;
    } catch {
      return null;
    }
  } else {
    parsed = meta as Record<string, unknown>;
  }

  const name = typeof parsed.name === "string" ? parsed.name : obj.name;
  const rawMethodType = typeof parsed.method_type === "string" ? parsed.method_type : null;
  const allowedMethodTypes = [
    "markdown", "pdf", "pcr", "lc_gradient", "plate",
    "cell_culture", "mass_spec", "compound", "coding_workflow", "qpcr_analysis",
  ] as const;
  type MethodTypeAllowed = typeof allowedMethodTypes[number];
  const methodType: MethodTypeAllowed | undefined = allowedMethodTypes.includes(
    rawMethodType as MethodTypeAllowed,
  )
    ? (rawMethodType as MethodTypeAllowed)
    : undefined;

  const created = await methodsApi.create({
    name,
    ...(methodType ? { method_type: methodType } : {}),
    ...(Array.isArray(parsed.tags) ? { tags: parsed.tags as string[] } : {}),
  });
  return String(created.id);
}

/**
 * Recreate a project or collection from its inline metadata. Returns the
 * local id on success, or null on failure.
 */
async function importProject(
  obj: BundleEmbeddedObject,
): Promise<string | null> {
  const meta = obj.inline as Record<string, unknown> | null | undefined;
  if (!meta || typeof meta !== "object") return null;
  const name = typeof meta.name === "string" ? meta.name : obj.name;
  if (!name.trim()) return null;
  const color = typeof meta.color === "string" ? meta.color : undefined;
  const created = await projectsApi.create({
    name,
    ...(color ? { color } : {}),
  });
  return String(created.id);
}

/**
 * Recreate a task or experiment from its inline metadata. The bundle carries
 * compact metadata only (name / status / dates / task_type). We create a task
 * stub with today as the start_date (the original date is carried in the
 * inline meta but may be in the past; we use it when it parses cleanly, else
 * today). project_id is left as 0 (unfiled) since we do not know the
 * recipient's equivalent project.
 */
async function importTask(
  obj: BundleEmbeddedObject,
  taskType: "task" | "experiment",
): Promise<string | null> {
  const meta = obj.inline as Record<string, unknown> | null | undefined;
  if (!meta || typeof meta !== "object") return null;
  const name = typeof meta.name === "string" ? meta.name : obj.name;
  if (!name.trim()) return null;

  const today = new Date().toISOString().slice(0, 10);
  let startDate = today;
  if (typeof meta.start_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(meta.start_date)) {
    startDate = meta.start_date;
  }

  const apiTaskType = taskType === "experiment" ? "experiment" : "list";
  const created = await tasksApi.create({
    name,
    start_date: startDate,
    task_type: apiTaskType,
  });
  return String(created.id);
}

/**
 * Recreate a Data Hub document from its full JSON payload. The bundle carries
 * the serialized DataHubDocContent as JSON bytes when dataKind === "full".
 * We extract columns / rows / analyses / plots and pass them to dataHubApi.create.
 */
async function importDataHub(
  obj: BundleEmbeddedObject,
  projectIds: string[],
): Promise<string | null> {
  if (!(obj.inline instanceof Uint8Array)) return null;
  let content: Record<string, unknown>;
  try {
    content = JSON.parse(utf8Decode(obj.inline)) as Record<string, unknown>;
  } catch {
    return null;
  }

  const metaBlock = (content.meta ?? {}) as Record<string, unknown>;
  const name = typeof metaBlock.name === "string" ? metaBlock.name : obj.name;
  // Default to "column" table type if the stored value is not recognized.
  const allowedTableTypes = ["column", "xy", "grouped", "survival", "contingency", "nested"] as const;
  type TableType = typeof allowedTableTypes[number];
  const rawTableType = typeof metaBlock.table_type === "string" ? metaBlock.table_type : "column";
  const tableType: TableType = allowedTableTypes.includes(rawTableType as TableType)
    ? (rawTableType as TableType)
    : "column";

  const created = await dataHubApi.create({
    name,
    table_type: tableType,
    project_ids: projectIds,
    columns: Array.isArray(content.columns) ? content.columns as never[] : [],
    rows: Array.isArray(content.rows) ? content.rows as never[] : [],
    analyses: Array.isArray(content.analyses) ? content.analyses as never[] : [],
    plots: Array.isArray(content.plots) ? content.plots as never[] : [],
  });
  return String(created.id);
}

// ── Main API ──────────────────────────────────────────────────────────────────

/**
 * Import or relink the embedded objects that arrived with a shared note bundle.
 *
 * For each BundleEmbeddedObject in the input:
 *   1. If portableId is set, call resolveByPortableId to check whether the
 *      recipient already has this object. On a match -> action "linked" (D4).
 *   2. Otherwise recreate the object locally from the serialized payload,
 *      reversing embedded-object-collect.ts. File it into the destination
 *      collection specified in opts.destinationByHref for this href, or into
 *      the default "Shared by <senderLabel>" collection -> action "imported" (D3).
 *   3. On datahub snapshot, file type, or any unrecoverable failure ->
 *      action "skipped".
 *
 * Never throws. A failing item becomes action "skipped" with skipReason.
 */
export async function importEmbeddedObjects(
  objects: BundleEmbeddedObject[],
  opts: ImportEmbeddedObjectsOpts,
): Promise<EmbeddedImportResult> {
  const resolutions: EmbedResolution[] = [];

  // Lazily resolve the default destination collection once for this import.
  let defaultCollectionIdPromise: Promise<string | null> | null = null;
  function getDefaultCollectionId(): Promise<string | null> {
    if (!defaultCollectionIdPromise) {
      defaultCollectionIdPromise = findOrCreateSharedByCollection(opts.senderLabel);
    }
    return defaultCollectionIdPromise;
  }

  for (const obj of objects) {
    let resolution: EmbedResolution;
    try {
      resolution = await importOneObject(obj, opts, getDefaultCollectionId);
    } catch (err) {
      // Belt-and-suspenders: per-type helpers should not throw, but catch here
      // so a bug in any helper never propagates out of importEmbeddedObjects.
      console.warn("[embedded-object-import] Unexpected error importing", obj.href, err);
      resolution = {
        href: obj.href,
        action: "skipped",
        localType: obj.type,
        localId: null,
        portableId: obj.portableId,
        name: obj.name,
        skipReason: `unexpected error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    resolutions.push(resolution);
  }

  const byHref = new Map<string, EmbedResolution>();
  for (const r of resolutions) {
    byHref.set(r.href, r);
  }

  return { resolutions, byHref };
}

/**
 * Process one BundleEmbeddedObject. Called only from importEmbeddedObjects.
 * Throws on unexpected errors, but never on a predictable skip (those return
 * a "skipped" resolution directly).
 */
async function importOneObject(
  obj: BundleEmbeddedObject,
  opts: ImportEmbeddedObjectsOpts,
  getDefaultCollectionId: () => Promise<string | null>,
): Promise<EmbedResolution> {
  // D4: dedup by portable identity. If the recipient already has this object,
  // link to their existing copy without importing. The forceImportHrefs opt-out
  // bypasses this check so the recipient can import a fresh copy instead.
  if (obj.portableId && !opts.forceImportHrefs?.has(obj.href)) {
    try {
      const local = await resolveByPortableId(obj.type, obj.portableId, opts.currentUser);
      if (local) {
        return {
          href: obj.href,
          action: "linked",
          localType: obj.type,
          localId: local.id,
          portableId: obj.portableId,
          name: obj.name,
        };
      }
    } catch (err) {
      // resolveByPortableId failed; fall through to import a new copy rather
      // than skipping entirely (the dedup is best-effort).
      console.warn("[embedded-object-import] resolveByPortableId failed for", obj.href, err);
    }
  }

  // datahub snapshot: always skip (Phase 6d renders it as a frozen card).
  if (obj.type === "datahub" && obj.dataKind === "snapshot") {
    return {
      href: obj.href,
      action: "skipped",
      localType: obj.type,
      localId: null,
      portableId: obj.portableId,
      name: obj.name,
      skipReason: "datahub snapshot (frozen, not recreated; rendered as frozen card in Phase 6d)",
    };
  }

  // "file" type: deferred (FSA byte reader not available here).
  if (obj.type === "file") {
    return {
      href: obj.href,
      action: "skipped",
      localType: obj.type,
      localId: null,
      portableId: obj.portableId,
      name: obj.name,
      skipReason: "file type deferred (FSA byte reader not available in import layer)",
    };
  }

  // Resolve the destination project ids. Check the per-href override first,
  // then fall back to the default collection.
  const destinationOverride = opts.destinationByHref?.get(obj.href);
  let projectIds: string[] = [];
  if (destinationOverride) {
    projectIds = [destinationOverride.projectId];
  } else {
    // Only types that support project_ids get filed. Types without a collection
    // concept (notes, methods, tasks, experiments) use an empty array.
    const supportsCollection = (
      obj.type === "molecule" ||
      obj.type === "sequence" ||
      obj.type === "datahub"
    );
    if (supportsCollection) {
      const colId = await getDefaultCollectionId();
      if (colId) projectIds = [colId];
    }
  }

  // Recreate the object from its payload, reversing embedded-object-collect.ts.
  let localId: string | null = null;

  switch (obj.type) {
    case "molecule":
      localId = await importMolecule(obj, projectIds);
      break;

    case "sequence":
      localId = await importSequence(obj, projectIds);
      break;

    case "note":
      localId = await importNote(obj);
      break;

    case "method":
      localId = await importMethod(obj);
      break;

    case "project":
    case "collection":
      localId = await importProject(obj);
      break;

    case "task":
    case "experiment":
      localId = await importTask(obj, obj.type);
      break;

    case "datahub":
      // Only "full" dataKind reaches here (snapshot was already handled above).
      localId = await importDataHub(obj, projectIds);
      break;

    case "phylo":
      // Phylo trees are not collected into a share bundle yet (see the collect
      // side), so this branch is unreachable today; it exists for exhaustiveness
      // and skips defensively rather than failing the import.
      return {
        href: obj.href,
        action: "skipped",
        localType: "phylo",
        localId: null,
        portableId: obj.portableId,
        name: obj.name,
        skipReason: "phylo trees are not shared in a bundle yet",
      };

    default: {
      // TypeScript exhaustiveness guard. Unknown types are skipped.
      const exhaustive: never = obj.type;
      void exhaustive;
      return {
        href: obj.href,
        action: "skipped",
        localType: obj.type as ObjectRefType,
        localId: null,
        portableId: obj.portableId,
        name: obj.name,
        skipReason: `unknown type: ${obj.type}`,
      };
    }
  }

  if (localId === null) {
    return {
      href: obj.href,
      action: "skipped",
      localType: obj.type,
      localId: null,
      portableId: obj.portableId,
      name: obj.name,
      skipReason: `create returned null (payload may be empty or unparseable)`,
    };
  }

  return {
    href: obj.href,
    action: "imported",
    localType: obj.type,
    localId,
    portableId: obj.portableId,
    name: obj.name,
  };
}
