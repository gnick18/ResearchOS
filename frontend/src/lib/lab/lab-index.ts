// The lab index: the keystone of the hybrid lab mirror (Phase A, see
// docs/proposals/2026-06-17-hybrid-lab-mirror-index.md).
//
// Each member's sync run writes ONE compact, encrypted index file holding a
// lightweight entry per record (type, id, owner, title, updatedAt, tags, size,
// and a short text preview). A PI's lab-wide search reads only these per-member
// index files, so search is instant and COMPLETE across the lab without pulling
// a single content blob. Heavy content (big tables) can then stay out of the
// eager mirror and be fetched on demand, while still being fully searchable
// through its index entry.
//
// The index is stored under a reserved key (recordType "_index", recordId
// "manifest") in the same lab-key-encrypted R2 mirror, so it inherits the same
// server-blind encryption and member-signed write path as every record. Readers
// of member WORK records skip this reserved type.
//
// buildLabIndex + summarizeRecord are pure (no I/O), so the summary logic is
// unit-testable. pushLabIndex / readLabIndex are thin encrypted-I/O wrappers
// with injectable impls.
//
// No emojis, no em-dashes, no mid-sentence colons.

import type { LabWorkRecord } from "./lab-sync";
import { putLabRecord, getLabRecord } from "./lab-data-client";

/** The reserved record key the per-member index lives at. */
export const LAB_INDEX_RECORD_TYPE = "_index";
export const LAB_INDEX_RECORD_ID = "manifest";

/** How many characters of plain text a preview carries. */
export const LAB_INDEX_PREVIEW_LENGTH = 200;

/**
 * Size-gating threshold (Phase B). A record whose content is at or below this is
 * pushed eagerly (its full content is in the mirror). A record above it is
 * indexed but NOT pushed eagerly, so its content is fetched on demand. 256 KB
 * keeps every text record eager and gates only genuinely heavy blobs like big
 * Data Hub tables.
 */
export const HEAVY_CONTENT_THRESHOLD_BYTES = 256 * 1024;

/** One lightweight, searchable entry for a single record. */
export interface LabIndexEntry {
  recordType: string;
  recordId: string;
  owner: string;
  /** Human title (record name / table name / sheet label). */
  title: string;
  /** Last-updated ISO timestamp if the record carries one. */
  updatedAt?: string;
  /** Free-text tags if the record carries any. */
  tags?: string[];
  /** Byte size of the record's content, so a reader knows if it is heavy. */
  sizeBytes: number;
  /** First LAB_INDEX_PREVIEW_LENGTH chars of plain text, whitespace-collapsed. */
  preview: string;
  /**
   * True when the full content is in the eager mirror (open is instant), false
   * when it is heavy and must be fetched on demand (Phase C request/approval).
   * Set from sizeBytes against the heavy threshold at build time.
   */
  eager: boolean;
}

export interface LabIndexFile {
  version: 1;
  owner: string;
  entries: LabIndexEntry[];
}

// ---------------------------------------------------------------------------
// Pure summary logic.
// ---------------------------------------------------------------------------

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === "string" && x.length > 0);
  return out.length > 0 ? out : undefined;
}

function getField(obj: Record<string, unknown>, key: string): unknown {
  return obj[key];
}

/** Collapse whitespace and clip to the preview length. */
function makePreview(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.slice(0, LAB_INDEX_PREVIEW_LENGTH);
}

/** A human label for a record type, used when no name field is present. */
function typeLabel(recordType: string): string {
  switch (recordType) {
    case "task":
      return "Task";
    case "experiment":
      return "Experiment";
    case "note":
      return "Note";
    case "method":
      return "Method";
    case "purchase":
      return "Purchase";
    case "inventory":
      return "Inventory item";
    case "inventory_stock":
      return "Inventory stock";
    case "sequence":
      return "Sequence";
    case "phylo":
      return "Tree";
    case "molecule":
      return "Molecule";
    case "datahub":
      return "Data table";
    default:
      return recordType;
  }
}

/**
 * Derive a lightweight summary from a record's parsed content. Best-effort and
 * type-aware: it probes the common name / text fields each record type uses,
 * with a stable fallback so every record always yields a usable title.
 */
export function summarizeRecord(
  recordType: string,
  recordId: string,
  obj: Record<string, unknown>,
): { title: string; updatedAt?: string; tags?: string[]; preview: string } {
  // DataHub records nest their metadata under `meta`.
  const meta =
    (obj.meta && typeof obj.meta === "object"
      ? (obj.meta as Record<string, unknown>)
      : undefined) ?? undefined;

  // Title. The markdown sheets have no name field, so label them by their task.
  let title: string | undefined;
  if (recordType === "result_sheet") {
    title = `Results (task ${recordId})`;
  } else if (recordType === "notes_sheet") {
    title = `Lab notes (task ${recordId})`;
  } else {
    title =
      asString(getField(obj, "name")) ??
      asString(getField(obj, "title")) ??
      (meta ? asString(getField(meta, "name")) : undefined) ??
      (meta ? asString(getField(meta, "title")) : undefined);
  }
  if (!title) title = `${typeLabel(recordType)} ${recordId}`;

  // Updated timestamp, probing the common field names this app uses.
  const updatedAt =
    asString(getField(obj, "updated_at")) ??
    asString(getField(obj, "updatedAt")) ??
    asString(getField(obj, "last_edited_at")) ??
    (meta ? asString(getField(meta, "last_edited_at")) : undefined) ??
    asString(getField(obj, "created_at"));

  // Tags.
  const tags =
    asStringArray(getField(obj, "tags")) ??
    (meta ? asStringArray(getField(meta, "tags")) : undefined);

  // Preview text, from whichever text-bearing field the record has.
  const previewSource =
    asString(getField(obj, "markdown")) ??
    asString(getField(obj, "description")) ??
    asString(getField(obj, "body")) ??
    asString(getField(obj, "note")) ??
    previewFromNoteEntries(getField(obj, "entries")) ??
    "";

  return { title, updatedAt, tags, preview: makePreview(previewSource) };
}

/** A note stores its body across `entries[].content`. Join the first few. */
function previewFromNoteEntries(entries: unknown): string | undefined {
  if (!Array.isArray(entries)) return undefined;
  const parts: string[] = [];
  for (const e of entries) {
    if (e && typeof e === "object") {
      const content = asString((e as Record<string, unknown>).content);
      if (content) parts.push(content);
    }
    if (parts.join(" ").length >= LAB_INDEX_PREVIEW_LENGTH) break;
  }
  return parts.length > 0 ? parts.join(" ") : undefined;
}

/**
 * Build a member's index from their enumerated records. Pure: the only inputs
 * are the owner and the records (each carrying its canonical plaintext bytes),
 * so the byte size and preview are derived directly. The reserved index record
 * itself is never indexed.
 */
export function buildLabIndex(
  owner: string,
  records: LabWorkRecord[],
  heavyThresholdBytes: number = HEAVY_CONTENT_THRESHOLD_BYTES,
): LabIndexFile {
  const decoder = new TextDecoder();
  const entries: LabIndexEntry[] = [];
  for (const r of records) {
    if (r.recordType === LAB_INDEX_RECORD_TYPE) continue;
    let obj: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(decoder.decode(r.plaintext)) as unknown;
      if (parsed && typeof parsed === "object") {
        obj = parsed as Record<string, unknown>;
      }
    } catch {
      // A non-JSON record still gets an entry, just with the fallback title.
    }
    const { title, updatedAt, tags, preview } = summarizeRecord(
      r.recordType,
      r.recordId,
      obj,
    );
    const sizeBytes = r.plaintext.length;
    entries.push({
      recordType: r.recordType,
      recordId: r.recordId,
      owner,
      title,
      updatedAt,
      tags,
      sizeBytes,
      preview,
      eager: sizeBytes <= heavyThresholdBytes,
    });
  }
  return { version: 1, owner, entries };
}

/**
 * Split enumerated records into the light set (pushed eagerly) and the heavy set
 * (indexed but not pushed, fetched on demand) by the same threshold the index
 * uses. The reserved index record is never in either set.
 */
export function splitBySize(
  records: LabWorkRecord[],
  heavyThresholdBytes: number = HEAVY_CONTENT_THRESHOLD_BYTES,
): { light: LabWorkRecord[]; heavy: LabWorkRecord[] } {
  const light: LabWorkRecord[] = [];
  const heavy: LabWorkRecord[] = [];
  for (const r of records) {
    if (r.recordType === LAB_INDEX_RECORD_TYPE) continue;
    if (r.plaintext.length <= heavyThresholdBytes) light.push(r);
    else heavy.push(r);
  }
  return { light, heavy };
}

/** Serialize an index file to canonical UTF-8 bytes. */
export function encodeLabIndex(index: LabIndexFile): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(index));
}

// ---------------------------------------------------------------------------
// Encrypted I/O (thin wrappers, injectable for tests).
// ---------------------------------------------------------------------------

/**
 * Push a member's index to the reserved key, encrypted under the lab key and
 * member-signed, exactly like any lab record.
 */
export async function pushLabIndex(params: {
  labId: string;
  owner: string;
  index: LabIndexFile;
  labKey: Uint8Array;
  signerEd25519Priv: Uint8Array;
  signerEd25519Pub: Uint8Array;
  putImpl?: typeof putLabRecord;
}): Promise<void> {
  const put = params.putImpl ?? putLabRecord;
  await put({
    labId: params.labId,
    owner: params.owner,
    recordType: LAB_INDEX_RECORD_TYPE,
    recordId: LAB_INDEX_RECORD_ID,
    plaintext: encodeLabIndex(params.index),
    labKey: params.labKey,
    signerEd25519Priv: params.signerEd25519Priv,
    signerEd25519Pub: params.signerEd25519Pub,
  });
}

/**
 * Read and decrypt one member's index. Returns null when the member has no
 * index yet (never synced), so a caller can treat that as an empty set rather
 * than an error.
 */
export async function readLabIndex(params: {
  labId: string;
  owner: string;
  labKey: Uint8Array;
  getImpl?: typeof getLabRecord;
}): Promise<LabIndexFile | null> {
  const get = params.getImpl ?? getLabRecord;
  let bytes: Uint8Array;
  try {
    bytes = await get({
      labId: params.labId,
      owner: params.owner,
      recordType: LAB_INDEX_RECORD_TYPE,
      recordId: LAB_INDEX_RECORD_ID,
      labKey: params.labKey,
    });
  } catch {
    // A missing index (member never synced) reads as an empty index, not an error.
    return null;
  }
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as LabIndexFile;
    if (parsed && parsed.version === 1 && Array.isArray(parsed.entries)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Read every supplied member's index and flatten to one entry list, the
 * lab-wide searchable set. A member with no index contributes nothing. One
 * member's read failure isolates to that member (the rest still load).
 */
export async function readLabIndexAcrossMembers(params: {
  labId: string;
  members: string[];
  labKey: Uint8Array;
  getImpl?: typeof getLabRecord;
}): Promise<LabIndexEntry[]> {
  const out: LabIndexEntry[] = [];
  for (const owner of params.members) {
    try {
      const index = await readLabIndex({
        labId: params.labId,
        owner,
        labKey: params.labKey,
        getImpl: params.getImpl,
      });
      if (index) out.push(...index.entries);
    } catch {
      // Isolate one member's failure; the rest of the lab still loads.
    }
  }
  return out;
}
