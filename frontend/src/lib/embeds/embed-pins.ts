// Markdown embed hybrid, Phase 7 (P7-1a). Core embed pinning.
//
// A user can PIN a block embed to FREEZE it as a record of a moment (a figure as
// it was on the day of an experiment). Storage strategy is UNIFORM SNAPSHOT,
// decided by Grant. Pinning writes a frozen BakedEmbed snapshot into a per-document
// sidecar, identically for every type, reusing the export bake machinery (bakeOne).
// A pinned embed renders the frozen snapshot (not live) with a quiet "pinned <date>"
// badge. Unpin removes the pin and restores the live embed.
//
// The sidecar shape carries `identity` (portableIdentityFor at pin time) so part 1b
// can add a "source changed since you pinned" staleness badge WITHOUT a format
// change. 1a never reads it, it just stores it.
//
// House voice: no em-dashes, no emojis, no mid-sentence colons.

import { fileService } from "@/lib/file-system/file-service";
import { bakeOne, type BakedEmbed, type BakeEmbedsDeps } from "@/lib/export/bake-embeds";
import { portableIdentityFor } from "@/lib/sharing/portable-identity";
import { moleculesApi } from "@/lib/chemistry/api";
import { sequencesApi, notesApi, methodsApi, projectsApi, tasksApi } from "@/lib/local-api";
import type { EmbedDescriptor, ObjectRefType } from "@/lib/references";

// ── On-disk format ─────────────────────────────────────────────────────────────

/** One frozen embed. Keyed by a short id in the sidecar's `pins` map; the short id
 *  is what the embed href carries as `&pin=s_xxx`. */
export interface EmbedPin {
  /** ISO timestamp of when the pin was taken (shown in the badge). */
  pinnedAt: string;
  /** The pinned object's type and id (so the badge / future tools can label it). */
  type: ObjectRefType;
  id: string;
  /** The view that was frozen (map / table / plot / card / ...). */
  view: string;
  /** portableIdentityFor at pin time. Reserved for the 1b staleness check; 1a
   *  stores it but never reads it. Null when the identity was not resolvable. */
  identity: string | null;
  /** The frozen representation, the same BakedEmbed shape the PDF export bakes. */
  snapshot: BakedEmbed;
}

/** The whole sidecar file, one per document. `version` lets the format grow. */
export interface EmbedPinsFile {
  version: 1;
  pins: Record<string, EmbedPin>;
}

/** The empty-but-valid default returned for a missing or malformed sidecar. */
function emptyPinsFile(): EmbedPinsFile {
  return { version: 1, pins: {} };
}

/** Defensive shape check, a hand-edited or partially-written sidecar must never
 *  throw at a render site. Anything that is not the expected shape collapses to
 *  the empty default. */
function isPinsFile(value: unknown): value is EmbedPinsFile {
  if (!value || typeof value !== "object") return false;
  const v = value as { version?: unknown; pins?: unknown };
  if (v.version !== 1) return false;
  if (!v.pins || typeof v.pins !== "object") return false;
  return true;
}

// ── Sidecar access layer ───────────────────────────────────────────────────────
//
// All best-effort, all via fileService. None throw on a missing or malformed file,
// a render path can call readPins / getPin and always get a usable value.

/** Read the pins sidecar at `sidecarPath`. Returns the empty default when the file
 *  is absent or malformed (fileService.readJson already returns null for both). */
export async function readPins(sidecarPath: string): Promise<EmbedPinsFile> {
  try {
    const raw = await fileService.readJson<unknown>(sidecarPath);
    return isPinsFile(raw) ? raw : emptyPinsFile();
  } catch {
    return emptyPinsFile();
  }
}

/** Look up one pin by its short id. Null when the sidecar is missing or the id is
 *  not present (the embed then falls back to the live renderer). */
export async function getPin(
  sidecarPath: string,
  shortId: string,
): Promise<EmbedPin | null> {
  if (!shortId) return null;
  const file = await readPins(sidecarPath);
  return file.pins[shortId] ?? null;
}

/** A url-safe short id alphabet (no look-alike +/= from base64), 6 chars give
 *  ~30 bits, plenty for the per-document handful of pins. */
const SHORT_ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** Mint a short pin id, `s_` + 6 url-safe chars. Prefixed so it reads as a pin id
 *  in the fragment and can never collide with a numeric object id. */
function mintShortId(existing: Record<string, EmbedPin>): string {
  for (let attempt = 0; attempt < 50; attempt++) {
    let body = "";
    for (let i = 0; i < 6; i++) {
      body += SHORT_ID_ALPHABET[Math.floor(Math.random() * SHORT_ID_ALPHABET.length)];
    }
    const id = `s_${body}`;
    if (!existing[id]) return id;
  }
  // Extremely unlikely fall-through, append a timestamp suffix to guarantee unique.
  return `s_${Date.now().toString(36)}`;
}

/** Write a pin into the sidecar under a fresh short id and return that id. Merges
 *  into the existing file (never clobbers other pins). Best-effort, a write failure
 *  surfaces to the caller (the Pin action) which can decide what to do. */
export async function putPin(sidecarPath: string, pin: EmbedPin): Promise<string> {
  const file = await readPins(sidecarPath);
  const id = mintShortId(file.pins);
  const next: EmbedPinsFile = {
    version: 1,
    pins: { ...file.pins, [id]: pin },
  };
  await fileService.writeJson(sidecarPath, next);
  return id;
}

/** Remove a pin by short id. A no-op when the sidecar is missing or the id is gone
 *  (Unpin must always succeed from the user's point of view). */
export async function removePin(sidecarPath: string, shortId: string): Promise<void> {
  const file = await readPins(sidecarPath);
  if (!file.pins[shortId]) return;
  const nextPins = { ...file.pins };
  delete nextPins[shortId];
  await fileService.writeJson(sidecarPath, { version: 1, pins: nextPins });
}

/** Replace a pin IN PLACE under an existing short id, keeping that id (P7-1b
 *  Re-pin). The fragment already carries `&pin=<shortId>`, so re-pinning must reuse
 *  the same id, only the frozen snapshot / identity / pinnedAt change. Writes the
 *  pin under `shortId` whether or not it was already present (a missing id is just
 *  added under that exact id, never minted fresh), so the on-disk record catches up
 *  to the live source without rewriting the source line. */
export async function updatePin(
  sidecarPath: string,
  shortId: string,
  pin: EmbedPin,
): Promise<void> {
  const file = await readPins(sidecarPath);
  const next: EmbedPinsFile = {
    version: 1,
    pins: { ...file.pins, [shortId]: pin },
  };
  await fileService.writeJson(sidecarPath, next);
}

// ── Snapshot + identity capture ────────────────────────────────────────────────

/** Load the source record for an embed and compute its LIVE portable identity.
 *  Reuses the SAME load paths the bakers use, so there is no second per-type loader
 *  to drift. Returns null when the record cannot be loaded or the type carries no
 *  identity (the snapshot still pins, identity is only for the 1b staleness check).
 *
 *  Exported because P7-1b's staleness check (ObjectEmbed) compares this live value
 *  against the stored `pin.identity`. Both the snapshot capture (snapshotEmbed) and
 *  the staleness check go through this one loader, so they can never disagree about
 *  how a type's identity is computed. */
export async function liveIdentityForEmbed(
  descriptor: EmbedDescriptor,
): Promise<string | null> {
  const { type, id } = descriptor;
  try {
    switch (type) {
      case "molecule": {
        const detail = await moleculesApi.get(id);
        // portableIdentityFor("molecule", ...) reads `inchikey` off the meta.
        return detail ? portableIdentityFor("molecule", detail.meta) : null;
      }
      case "sequence": {
        const num = Number(id);
        if (!Number.isFinite(num)) return null;
        const detail = await sequencesApi.get(num);
        return detail ? portableIdentityFor("sequence", detail) : null;
      }
      case "note": {
        const note = await notesApi.get(Number(id));
        return note ? portableIdentityFor("note", note) : null;
      }
      case "method": {
        const method = await methodsApi.get(Number(id));
        return method ? portableIdentityFor("method", method) : null;
      }
      case "project":
      case "collection": {
        const project = await projectsApi.get(Number(id));
        return project ? portableIdentityFor(type, project) : null;
      }
      case "task":
      case "experiment": {
        const parsed = splitTaskKey(id);
        if (!parsed) return null;
        const task = await tasksApi.get(parsed.id, parsed.owner);
        return task ? portableIdentityFor(type, task) : null;
      }
      case "datahub":
      case "file":
        // Not part of the portable-identity scope yet (mirrors portable-identity).
        return null;
      default:
        return null;
    }
  } catch {
    // Identity is best-effort. A load failure means "unknown identity", the
    // snapshot still pins.
    return null;
  }
}

/** Split a composite taskKey ("self:5" or "alice:5") into id + optional owner.
 *  Mirrors the helper inside bake-embeds (kept local so this module does not depend
 *  on an internal export there). Null when the key is malformed. */
function splitTaskKey(key: string): { id: number; owner?: string } | null {
  const colon = key.indexOf(":");
  if (colon < 0) return null;
  const ns = key.slice(0, colon);
  const id = Number(key.slice(colon + 1));
  if (!Number.isFinite(id) || id <= 0) return null;
  return ns === "self" ? { id } : { id, owner: ns };
}

/** Freeze one embed into a BakedEmbed snapshot plus its portable identity. Reuses
 *  bakeOne (the export single-embed baker) for the snapshot so a pin freezes a
 *  molecule (RDKit PNG), a Data Hub plot / table / result, a note / method card,
 *  etc. exactly the way the PDF export does, with no second renderer to maintain.
 *  `caption` is the embed's link text. `deps` is accepted for parity with the bake
 *  API (bakeOne does not currently read it, but threading it keeps the pin path
 *  honest if bakeOne grows injectable deps). */
export async function snapshotEmbed(
  descriptor: EmbedDescriptor,
  caption: string,
  _deps?: BakeEmbedsDeps,
): Promise<{ snapshot: BakedEmbed; identity: string | null }> {
  const [snapshot, identity] = await Promise.all([
    bakeOne(descriptor, caption, null),
    liveIdentityForEmbed(descriptor),
  ]);
  return { snapshot, identity };
}

/** Build a complete EmbedPin from a descriptor (snapshot + identity + metadata).
 *  The Pin action calls this, then putPin. Kept separate from putPin so the
 *  capture (which loads + bakes) is testable without a sidecar write. */
export async function buildPin(
  descriptor: EmbedDescriptor,
  caption: string,
  deps?: BakeEmbedsDeps,
): Promise<EmbedPin> {
  const { snapshot, identity } = await snapshotEmbed(descriptor, caption, deps);
  return {
    pinnedAt: new Date().toISOString(),
    type: descriptor.type,
    id: descriptor.id,
    view: descriptor.view,
    identity,
    snapshot,
  };
}

// ── Sidecar path convention ────────────────────────────────────────────────────

/** The pins sidecar path for a document. A document is identified by the markdown
 *  file path it backs:
 *    a note at `users/<owner>/notes/<id>.json`
 *      -> `users/<owner>/notes/<id>.ros-embeds.json`
 *    a results / notes doc under a basePath (e.g. `users/<owner>/results/task-5/`)
 *      -> `<basePath>/<docName>.ros-embeds.json`   (docName = "results" or "notes")
 *  This helper covers the basePath + docName form, the note-json form is computed
 *  at the note host (it has the note path, not a basePath). */
export function pinsSidecarForBasePath(basePath: string, docName: string): string {
  const trimmed = basePath.replace(/\/+$/, "");
  return `${trimmed}/${docName}.ros-embeds.json`;
}

/** The pins sidecar path for a note backed by `users/<owner>/notes/<id>.json`.
 *  Swaps the `.json` extension for `.ros-embeds.json` so the sidecar sits next to
 *  the note. Falls back to appending the suffix when the path has no `.json`. */
export function pinsSidecarForNoteJson(noteJsonPath: string): string {
  if (noteJsonPath.endsWith(".json")) {
    return `${noteJsonPath.slice(0, -".json".length)}.ros-embeds.json`;
  }
  return `${noteJsonPath}.ros-embeds.json`;
}
