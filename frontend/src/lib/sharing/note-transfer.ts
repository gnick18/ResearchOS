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
//     EXCEPTION: collab_doc_id IS carried (Phase 3c chunk 3a). It is the shared
//     secret that lets the recipient auto-join the same relay room; without it
//     the recipient's copy would derive a different room from a freshly minted
//     id and the two sides would never connect.
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
//     Phase 3c chunk 3a: collab_doc_id is also written to the JSON record so
//     NoteDetailPopup can seed the Loro meta map on first open (before a sidecar
//     exists) and call connectFromDocId with the correct id.
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
  type BundleEmbeddedObject,
  type BundleSender,
} from "@/lib/sharing/bundle";
import {
  importEmbeddedObjects,
  type ImportEmbeddedObjectsOpts,
} from "@/lib/sharing/embedded-object-import";
import { parseObjectEmbed, buildObjectEmbedHref } from "@/lib/references";
import { collectEmbeddedObjects } from "@/lib/sharing/embedded-object-collect";
import type { CollectEmbeddedObjectsOpts } from "@/lib/sharing/embedded-object-collect";
import { fileService, type FileService } from "@/lib/file-system/file-service";
import { listImagesInFolder } from "@/lib/attachments/image-folder";
import { readSharingIdentity } from "@/lib/sharing/identity/sidecar";
import { notesApi } from "@/lib/local-api";
import { getUserStore, type TargetContext } from "@/lib/storage/json-store";
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
 *   notebook_id, collab_doc_id.
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
  /**
   * Phase 3c chunk 3a (FLAG: travels in bundle). The collab doc id minted by
   * the sender when they first shared this note. Carried so the recipient's
   * copy derives the same relay room and auto-connects to the same session.
   * Absent for notes that were never part of a live collab session.
   */
  collab_doc_id?: string;
}

/** Project a Note (or a foreign entity) down to the shared, recipient-facing set. */
function sanitizeNoteEntity(source: {
  title?: unknown;
  description?: unknown;
  is_running_log?: unknown;
  entries?: unknown;
  notebook_id?: unknown;
  collab_doc_id?: unknown;
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
  // Phase 3c chunk 3a: carry collab_doc_id so the recipient can join the same
  // relay room. This is the one additive exception to "drop account-local fields":
  // the doc id is shared state, not sender-local state. Without it the recipient
  // would mint a fresh id and derive a different room.
  if (typeof source.collab_doc_id === "string" && source.collab_doc_id) {
    sanitized.collab_doc_id = source.collab_doc_id;
  }
  return sanitized;
}

/**
 * COLLECT. Build the BuildBundleInput for a single note plus its image
 * attachments. Reads the note's Images/ folder off disk; if that folder is
 * absent or empty, attachments is [].
 *
 * Phase 6b: also collects every object block-embedded in the note's entry
 * bodies and adds them as embeddedObjects in the bundle input. By default all
 * embeds are included (D1). Pass opts.embedOpts to restrict or customize:
 *   opts.embedOpts.excludeHrefs  -- hrefs to skip (share-dialog deselect list)
 *   opts.embedOpts.fullDataHrefs -- Data Hub hrefs to carry as full dataset (D8)
 *
 * @param opts.collabDocId - Phase 3c chunk 3a. When provided (read from the
 *   live Loro meta map by the caller), this id is written into the bundle
 *   entity so the recipient's copy carries the same id and can auto-join the
 *   shared relay room. When absent the note is treated as non-collab (the
 *   recipient mints their own id on first share, which is the correct behavior
 *   for a note that has never been through a live session).
 * @param opts.embedOpts - Phase 6b. Controls which embedded objects are
 *   collected and how they are serialized. Defaults to include-all.
 */
export async function buildNoteBundleInput(
  note: Note,
  ownerUsername: string,
  opts?: { collabDocId?: string; embedOpts?: CollectEmbeddedObjectsOpts },
): Promise<BuildBundleInput> {
  // Merge the collabDocId from the caller (Loro meta) into the note-like
  // source so sanitizeNoteEntity picks it up. We shallow-clone to avoid
  // mutating the caller's Note object.
  const noteWithCollab: Note & { collab_doc_id?: string } = opts?.collabDocId
    ? { ...note, collab_doc_id: opts.collabDocId }
    : note;
  const entity = sanitizeNoteEntity(noteWithCollab);

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
  // A LOCAL-ONLY identity (no published email) cannot attribute a verified
  // sender, so the bundle ships sender-free and the recipient falls back to the
  // relay key hash, the same path as an owner who never set up sharing.
  const identity = await readSharingIdentity(ownerUsername);
  const sender: BundleSender | undefined =
    identity && identity.email
      ? { email: identity.email, fingerprint: identity.fingerprint }
      : undefined;

  // Phase 6b: collect all objects embedded in the note's entry bodies. We scan
  // every entry's content for block-embed links and serialize each object. A
  // failing loader is silently skipped; the embed shows as a no-access
  // placeholder on the recipient side (Phase 6d).
  const allMarkdown = (entity.entries ?? [])
    .map((e: { content: string }) => e.content ?? "")
    .join("\n");
  const { objects: embeddedObjects } = await collectEmbeddedObjects(
    allMarkdown,
    opts?.embedOpts,
  );

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
    embeddedObjects: embeddedObjects.length > 0 ? embeddedObjects : undefined,
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
 *
 * Phase 6c: after the note is created, imports each embedded object (link or
 * recreate), then rewrites the note's embed hrefs to point at the recipient's
 * local object ids. "Skipped" embeds keep their original href (rendered as a
 * placeholder in Phase 6d). The rewritten note body is persisted.
 *
 * @param opts.embeddedObjectOpts - Phase 6c. Controls the embedded-object import.
 *   When absent, a default is built from currentUser and senderEmail. Pass this
 *   to supply a per-item destination picker map from the UI.
 */
export async function importNoteBundle(
  result: ReadBundleResult,
  opts: {
    currentUser: string;
    senderEmail: string;
    senderFingerprint: string;
    notebookId?: string;
    /**
     * Phase 6c. Options for importing the embedded objects that arrived with
     * the bundle. When absent, a default is built from currentUser + senderEmail.
     * The UI can populate destinationByHref and forceImportHrefs from the
     * EmbeddedImportPicker before calling importNoteBundle.
     *
     * destinationByHref: per-item destination collection overrides.
     * forceImportHrefs: hrefs the recipient explicitly chose to import fresh
     * instead of linking to an existing local duplicate.
     */
    embeddedObjectOpts?: Pick<ImportEmbeddedObjectsOpts, "destinationByHref" | "forceImportHrefs">;
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

  // Phase 6c: import embedded objects BEFORE the final record write so the
  // rewritten hrefs land in the persisted note in a single write call.
  // importEmbeddedObjects never throws; a failing item becomes "skipped".
  const embeddedObjects: BundleEmbeddedObject[] = result.embeddedObjects ?? [];
  let rewrittenEntries = incoming.entries;
  if (embeddedObjects.length > 0) {
    const importResult = await importEmbeddedObjects(embeddedObjects, {
      currentUser: opts.currentUser,
      senderLabel: opts.senderEmail,
      destinationByHref: opts.embeddedObjectOpts?.destinationByHref,
      forceImportHrefs: opts.embeddedObjectOpts?.forceImportHrefs,
    });

    // Rewrite embed hrefs in each entry's content so imported/linked objects
    // point at the recipient's local ids. "Skipped" embeds keep the original
    // href (Phase 6d renders them as placeholders). The ref= portable id is
    // preserved in the new href so future dedups still work.
    rewrittenEntries = incoming.entries.map((entry) => ({
      ...entry,
      content: rewriteEmbedHrefs(entry.content, importResult.byHref),
    }));
  }

  // Stamp the fields notesApi.create does not carry, username (pinned to the
  // recipient), notebook_id, and the provenance marker, by writing the full
  // record back to its canonical path users/<currentUser>/notes/<id>.json. We
  // read the just-created record (it carries the freshly allocated entry ids /
  // timestamps) and overlay only the additive fields, so nothing create wrote
  // is lost.
  const notePath = `users/${opts.currentUser}/notes/${noteId}.json`;
  const baseRecord = (await fileService.readJson<Note>(notePath)) ?? created;

  // Merge rewritten entry content into the base record. The base record carries
  // the freshly allocated per-entry ids and timestamps; we only replace content
  // (the field that holds embed hrefs). Title / date are carried from the
  // incoming entries as well, matching the original sanitized values.
  const rewrittenBaseEntries = baseRecord.entries?.map((e, idx) => ({
    ...e,
    ...(rewrittenEntries[idx]
      ? {
          title: rewrittenEntries[idx].title,
          date: rewrittenEntries[idx].date,
          content: rewrittenEntries[idx].content,
        }
      : {}),
  })) ?? baseRecord.entries;

  const finalRecord: Note = {
    ...baseRecord,
    entries: rewrittenBaseEntries,
    username: opts.currentUser,
    received_from: opts.senderEmail,
    received_from_fingerprint: opts.senderFingerprint,
    received_at: new Date().toISOString(),
  };
  if (notebookId) {
    finalRecord.notebook_id = notebookId;
  }
  // Phase 3c chunk 3a (FLAG: new Note JSON field): carry the collab_doc_id so
  // NoteDetailPopup can read it from the Note prop and seed the Loro meta map
  // before the sidecar is written for the first time. Without this the recipient
  // would have no doc id and could not join the shared relay room.
  if (incoming.collab_doc_id) {
    finalRecord.collab_doc_id = incoming.collab_doc_id;
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

// ── Destination-scoped materialize (cross-folder, Strategy A) ──────────────────

/**
 * MATERIALIZE INTO A DESTINATION FOLDER. Twin of importNoteBundle, but every
 * write lands in a SECOND folder via an injected FileService + an EXPLICIT
 * destination username, instead of the module singleton + the current user.
 *
 * This is the write half of a same-account cross-folder COPY. The collect half
 * (buildNoteBundleInput) runs UNCHANGED against the source folder on the
 * singleton; the resulting verified ReadBundleResult is handed here together
 * with a TargetContext { fileService, username } pointing at the destination.
 *
 * The note id is allocated from the DESTINATION folder's own _counters.json
 * (via createForUser(..., ctx)), so it never collides with a source-folder id.
 * Attachments are re-written under the new note's Images/ folder using the
 * SAME filename, exactly as importNoteBundle does, so the markdown Images/<name>
 * links keep resolving with zero rewriting.
 *
 * v1 scope (NOTES ONLY): embedded objects are NOT re-imported into the
 * destination. The entry bodies are carried VERBATIM, so any object embeds keep
 * the source folder's local hrefs. Cross-folder embed materialization is a later
 * phase; carrying the text verbatim is safe (a non-resolving embed renders as a
 * placeholder, never broken data) and keeps this lane note-only.
 *
 * ACK-AFTER-WRITE parity: like importNoteBundle, the returned promise resolves
 * only once the record and every attachment are on disk in the destination.
 */
export async function materializeNoteToDestination(
  result: ReadBundleResult,
  dest: TargetContext,
  opts?: { notebookId?: string },
): Promise<{ noteId: number }> {
  if (!result.valid) {
    throw new InvalidBundleError(
      "Refusing to materialize a bundle that failed integrity verification",
    );
  }
  if (result.entityType !== "note") {
    throw new InvalidBundleError(
      `Expected a note bundle, got entityType "${result.entityType}"`,
    );
  }

  // Never trust foreign fields; re-project to the kept-set the collect produces.
  const incoming = sanitizeNoteEntity(result.entity as Record<string, unknown>);
  const notebookId = opts?.notebookId ?? incoming.notebook_id;

  const now = new Date().toISOString();
  // Build the same NoteEntry shape notesApi.create stamps (fresh ids + times),
  // but route the create into the DESTINATION folder via the TargetContext.
  const entries: NoteEntry[] = incoming.entries.map((e) => ({
    id: crypto.randomUUID(),
    title: e.title,
    date: e.date,
    content: e.content,
    created_at: now,
    updated_at: now,
  }));

  const notesStore = getUserStore<Note>("notes");
  const record: Omit<Note, "id"> = {
    title: incoming.title,
    description: incoming.description,
    is_running_log: incoming.is_running_log,
    is_shared: false,
    entries,
    comments: [],
    created_at: now,
    updated_at: now,
    // The destination folder's own user owns the copy. This is a same-account
    // copy, so author == the destination user, not the source user.
    username: dest.username,
    source_uuid:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2),
  };
  if (notebookId) {
    record.notebook_id = notebookId;
  }
  // Carry collab_doc_id only when the source note had one (a live collab note);
  // it is shared state, mirroring the import path.
  if (incoming.collab_doc_id) {
    record.collab_doc_id = incoming.collab_doc_id;
  }

  const created = await notesStore.createForUser(record, dest.username, dest);
  const noteId = created.id;

  // Write attachments under the NEW note's Images/ folder in the DESTINATION
  // folder, same filename, AFTER the record exists. Mirrors importNoteBundle.
  for (const attachment of result.attachments) {
    const imagePath = `users/${dest.username}/notes/${noteId}/Images/${attachment.name}`;
    const copy = new Uint8Array(attachment.bytes.byteLength);
    copy.set(attachment.bytes);
    await dest.fileService.writeFileFromBlob(imagePath, new Blob([copy]));
  }

  return { noteId };
}

// ── Href rewrite (Phase 6c) ───────────────────────────────────────────────────

/**
 * Rewrite the embed hrefs in a markdown string so each resolved object points
 * at the recipient's local id. "Skipped" objects keep their original href.
 *
 * The approach: scan for markdown link patterns `[text](href)` or
 * `[text](href#fragment)`, check the href against the byHref map, and for
 * "linked" or "imported" items replace the href with a freshly built embed href
 * that carries the new local id but preserves the view and the `ref=` portable
 * identity (so future re-dedup on re-share still works).
 *
 * The `ref=` identity: we always set it to the bundle's portableId (when
 * present) so the rewritten href carries a stable cross-user identity marker.
 * The view is read from the original embed descriptor via parseObjectEmbed;
 * when the original was "chip" (no ros= fragment) the rewritten href is also
 * chiplike (no fragment), preserving the original display intent.
 */
function rewriteEmbedHrefs(
  markdown: string,
  byHref: Map<string, import("@/lib/sharing/embedded-object-import").EmbedResolution>,
): string {
  // Match markdown links: [any text](href) where href may contain a fragment.
  // The regex is non-greedy and handles nested parens in the href by stopping
  // at the first unbalanced closing paren that is not part of the fragment.
  // This is sufficient for our generated deep-link hrefs which never contain
  // literal parens.
  return markdown.replace(
    /\[([^\]]*)\]\(([^)]+)\)/g,
    (fullMatch, linkText, rawHref) => {
      // BundleEmbeddedObject.href is the plain base href WITHOUT a fragment
      // (the collector stores it as just the deep-link path). The markdown may
      // carry a fragment (e.g. #ros=card). Strip it off so the byHref lookup
      // matches the bundle's canonical base href.
      const hashIdx = rawHref.indexOf("#");
      const baseHref = hashIdx >= 0 ? rawHref.slice(0, hashIdx) : rawHref;
      const resolution = byHref.get(baseHref);
      if (!resolution || resolution.action === "skipped" || !resolution.localId) {
        // Leave unchanged; the embed renderer handles it as a no-access
        // placeholder (Phase 6d) or as a normal link.
        return fullMatch;
      }

      // Parse the original embed to recover the view and any opts (region,
      // analysis, etc.) so the rewritten href is semantically identical.
      const descriptor = parseObjectEmbed(rawHref);
      const view = descriptor?.view;
      const existingOpts = descriptor?.opts ?? {};

      // Carry the portable id in ref= so future re-shares can dedup. Use the
      // portableId from the resolution (which mirrors the bundle entry). When
      // the original href already carried a ref= we prefer the bundle's
      // portableId (it is more authoritative than what the sender put in the
      // fragment, since both should be identical, but the bundle value is what
      // the Phase 6a identity layer verified).
      const refId = resolution.portableId ?? existingOpts.ref;

      const newHref = buildObjectEmbedHref(
        resolution.localType,
        resolution.localId,
        {
          ...(view && view !== "chip" ? { view } : {}),
          ...existingOpts,
          ...(refId ? { ref: refId } : {}),
        },
      );

      return `[${linkText}](${newHref})`;
    },
  );
}
