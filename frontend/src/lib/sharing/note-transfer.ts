// Cross-boundary sharing, NOTE transfer adapter.
//
// This is the data-shape seam between a local Note (plus its on-disk image
// attachments) and the portable bundle format from bundle.ts. Two directions:
//
//   COLLECT (send)  -> buildNoteBundleInput
//     Reads a Note and every image under
//     users/<owner>/notes/<id>/Images/ off disk, and produces the
//     BuildBundleInput the bundle engine serializes. The entity is a
//     SANITIZED copy that carries only the content a recipient should get;
//     account-scoped and lab-local fields (ids, ownership, sharing, comments,
//     review flags, edit stamps, the undo window, and any inbound provenance)
//     are dropped so a re-shared note never leaks the sender's local state.
//
//   MATERIALIZE (import) -> importNoteBundle
//     Takes a verified ReadBundleResult and writes a brand-new Note into the
//     recipient's folder (users/<currentUser>/notes/<newId>.json), re-sanitizes
//     the foreign entity (never trust ids/username/shared_with off the wire),
//     stamps the provenance marker (received_from / _fingerprint / _at), and
//     writes each attachment back under the NEW note's Images/ folder using the
//     EXACT same filename it had on the sender. The markdown image links in the
//     entry bodies reference Images/<name>, so same-name placement keeps every
//     link valid with zero rewriting.
//
// ACK-AFTER-WRITE. importNoteBundle is called by the inbox import flow only
// AFTER the user confirms, and the caller acks the relay (which then deletes
// its copy) only after this promise RESOLVES. So this function must have fully
// written the note record and every attachment before it returns. Any failure
// rejects, the caller skips the ack, and the bundle stays on the relay for a
// retry. We deliberately do NOT swallow disk errors here.
//
// VERSIONING (v1). buildNoteBundleInput mints a FRESH shareUuid per send and
// always uses version 1. Re-sending the same note therefore creates a NEW
// share with a new identity rather than a higher version of an existing one.
// The stable-uuid + version-dedupe story (so an update supersedes a prior send
// on import) is a later enhancement, see the isBasedOn TODO in bundle.ts.

import {
  type BuildBundleInput,
  type ReadBundleResult,
  type BundleAttachment,
  type BundleSender,
} from "@/lib/sharing/bundle";
import { fileService } from "@/lib/file-system/file-service";
import { listImagesInFolder } from "@/lib/attachments/image-folder";
import { readSharingIdentity } from "@/lib/sharing/identity/sidecar";
import { notesApi } from "@/lib/local-api";
import type { Note, NoteEntry } from "@/lib/types";

/**
 * Thrown when importNoteBundle is handed a bundle that did not verify, or that
 * is not a note. Typed so the inbox caller can distinguish a bad/tampered
 * bundle from a transient disk failure and surface the right message (and, for
 * an invalid bundle, NEVER ack the relay).
 */
export class InvalidBundleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidBundleError";
  }
}

/**
 * The shape of a note entry as it travels inside the bundle. Only the
 * recipient-facing content survives the sanitize; created_at / updated_at are
 * regenerated locally on import (notesApi.create stamps fresh timestamps), so
 * they are intentionally NOT carried.
 */
interface SharedNoteEntry {
  title: string;
  date: string;
  content: string;
}

/**
 * The sanitized note entity carried in the bundle.
 *
 * KEPT (recipient-facing content):
 *   title, description, is_running_log, entries (title / date / content only),
 *   notebook_id.
 *
 * DROPPED (account-scoped or lab-local, never shared):
 *   id, username, shared_with, comments, flagged, last_edited_by,
 *   last_edited_at, revert_undo_window, is_shared, created_at, updated_at, and
 *   the three provenance fields (received_from / received_from_fingerprint /
 *   received_at). Timestamps are dropped because the bundle's modifiedAt
 *   carries the note's updated_at, and the import regenerates local ones.
 */
interface SharedNoteEntity {
  title: string;
  description: string;
  is_running_log: boolean;
  entries: SharedNoteEntry[];
  /** Present only when the source note belonged to a shared notebook. */
  notebook_id?: string;
}

/** Project a Note (or a foreign entity) down to the shared, recipient-facing set. */
function sanitizeNoteEntity(source: {
  title?: unknown;
  description?: unknown;
  is_running_log?: unknown;
  entries?: unknown;
  notebook_id?: unknown;
}): SharedNoteEntity {
  const rawEntries = Array.isArray(source.entries) ? source.entries : [];
  const entries: SharedNoteEntry[] = rawEntries.map((e) => {
    const entry = (e ?? {}) as Partial<NoteEntry>;
    return {
      title: typeof entry.title === "string" ? entry.title : "",
      date: typeof entry.date === "string" ? entry.date : "",
      content: typeof entry.content === "string" ? entry.content : "",
    };
  });

  const sanitized: SharedNoteEntity = {
    title: typeof source.title === "string" ? source.title : "",
    description: typeof source.description === "string" ? source.description : "",
    is_running_log: source.is_running_log === true,
    entries,
  };
  // notebook_id is optional, carry it only when the source actually had one.
  if (typeof source.notebook_id === "string" && source.notebook_id) {
    sanitized.notebook_id = source.notebook_id;
  }
  return sanitized;
}

/**
 * COLLECT. Build the BuildBundleInput for a single note plus its image
 * attachments. Reads the note's Images/ folder off disk; if that folder is
 * absent or empty, attachments is [].
 */
export async function buildNoteBundleInput(
  note: Note,
  ownerUsername: string,
): Promise<BuildBundleInput> {
  const entity = sanitizeNoteEntity(note);

  // Image attachments live at users/<owner>/notes/<id>/Images/<filename>.
  // listImagesInFolder takes the note's base path and appends /Images itself.
  const noteBase = `users/${ownerUsername}/notes/${note.id}`;
  const images = await listImagesInFolder(noteBase);

  const attachments: BundleAttachment[] = [];
  for (const image of images) {
    const blob = await fileService.readFileAsBlob(`${noteBase}/Images/${image.name}`);
    if (!blob) continue; // listed but unreadable, skip rather than ship a half file
    const bytes = new Uint8Array(await blob.arrayBuffer());
    // Preserve the filename EXACTLY so the markdown Images/<name> links resolve
    // after the recipient writes the same-named file under the new note.
    attachments.push({ name: image.name, bytes });
  }

  // Embed the sender's verified identity from their sharing-identity sidecar, so
  // the recipient can attribute the note to a real person rather than the relay
  // key hash. Both fields are PUBLIC (the sidecar holds no private keys). This is
  // safe to ship because the bundle is sealed to the recipient and the send is
  // Ed25519-signed. If the owner has not claimed a sharing identity, sender stays
  // undefined and the bundle is a valid pre-sender bundle (recipient falls back
  // to the hash).
  const identity = await readSharingIdentity(ownerUsername);
  const sender: BundleSender | undefined = identity
    ? { email: identity.email, fingerprint: identity.fingerprint }
    : undefined;

  return {
    // v1: a fresh share identity per send. See the VERSIONING note in the
    // header for the dedupe-on-resend enhancement that supersedes this.
    shareUuid: crypto.randomUUID(),
    version: 1,
    modifiedAt: note.updated_at,
    entityType: "note",
    entity,
    attachments,
    sender,
  };
}

/**
 * MATERIALIZE. Write a received note bundle into the recipient's folder as a
 * brand-new note, then write its attachments. Returns the new local note id.
 *
 * Guards on validity and entity type up front (throws InvalidBundleError), then
 * re-sanitizes the foreign entity, creates the note (notesApi allocates the
 * id), and only after the record exists writes the attachment bytes under the
 * new note's Images/ folder with their original filenames. The promise resolves
 * only once everything is on disk, which is what lets the caller ack the relay.
 */
export async function importNoteBundle(
  result: ReadBundleResult,
  opts: {
    currentUser: string;
    senderEmail: string;
    senderFingerprint: string;
    notebookId?: string;
  },
): Promise<{ noteId: number }> {
  if (!result.valid) {
    throw new InvalidBundleError(
      "Refusing to import a bundle that failed integrity verification",
    );
  }
  if (result.entityType !== "note") {
    throw new InvalidBundleError(
      `Expected a note bundle, got entityType "${result.entityType}"`,
    );
  }

  // Never trust foreign fields (id / username / shared_with / provenance off the
  // wire). Re-project to the same kept-set the collect path produces.
  const incoming = sanitizeNoteEntity(result.entity as Record<string, unknown>);

  // notebook_id resolution, explicit caller choice wins, else carry whatever the
  // bundle declared, else undefined (a personal note).
  const notebookId = opts.notebookId ?? incoming.notebook_id;

  // Create the note in the current user's folder. notesApi.create allocates the
  // new per-user id and stamps username = the signed-in user (the importer ==
  // opts.currentUser), so the author / owner-folder routing matches the recipient.
  // is_shared is intentionally NOT passed, imported notes start unshared.
  const created = await notesApi.create({
    title: incoming.title,
    description: incoming.description,
    is_running_log: incoming.is_running_log,
    entries: incoming.entries.map((e) => ({
      title: e.title,
      date: e.date,
      content: e.content,
    })),
  });
  const noteId = created.id;

  // Stamp the fields notesApi.create does not carry, username (pinned to the
  // recipient), notebook_id, and the provenance marker, by writing the full
  // record back to its canonical path users/<currentUser>/notes/<id>.json. We
  // read the just-created record (it carries the freshly allocated entry ids /
  // timestamps) and overlay only the additive fields, so nothing create wrote
  // is lost.
  const notePath = `users/${opts.currentUser}/notes/${noteId}.json`;
  const baseRecord = (await fileService.readJson<Note>(notePath)) ?? created;
  const finalRecord: Note = {
    ...baseRecord,
    username: opts.currentUser,
    received_from: opts.senderEmail,
    received_from_fingerprint: opts.senderFingerprint,
    received_at: new Date().toISOString(),
  };
  if (notebookId) {
    finalRecord.notebook_id = notebookId;
  }
  await fileService.writeJson(notePath, finalRecord);

  // Write every attachment under the NEW note's Images/ folder, same filename,
  // so the markdown Images/<name> links in the entry bodies stay valid. This
  // happens AFTER the record write so a viewer that opens the note already sees
  // the entry text; the inbox flow acks the relay only after this all resolves.
  for (const attachment of result.attachments) {
    const imagePath = `users/${opts.currentUser}/notes/${noteId}/Images/${attachment.name}`;
    // Copy into a fresh ArrayBuffer-backed view so a SharedArrayBuffer-backed
    // input is never handed to Blob (and the type narrows to a plain Uint8Array,
    // which is a valid BlobPart). Same guard bundle.ts uses before subtle.digest.
    const copy = new Uint8Array(attachment.bytes.byteLength);
    copy.set(attachment.bytes);
    await fileService.writeFileFromBlob(imagePath, new Blob([copy]));
  }

  return { noteId };
}
