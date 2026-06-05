// Phase 3c chunk 1: server-canonical collab doc persistence on Neon.
//
// The collab backend stores a shared note's Loro document as an append-only
// update log plus a periodic server-side compacted snapshot. This is
// OPTION B (server-readable, encrypted at rest); the server holds a plain
// copy of every SHARED document. Private, unshared notes are never sent here.
// See docs/proposals/UNIFIED_MODEL_PHASE3C_SHARED_COLLAB.md, section 3a.
//
// Pattern mirrors directory/db.ts exactly: lazy Neon singleton via getSql(),
// idempotent ensureCollabSchema() called at the start of each route, no
// separate migration tool, snake_case columns, timestamptz default now().
//
// Three tables:
//   collab_docs          - one row per shared doc (latest snapshot + version)
//   collab_doc_updates   - append-only update log since last compaction
//   collab_doc_members   - access control (populated from the share grant)

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { LoroDoc } from "loro-crdt";

// ---------------------------------------------------------------------------
// Lazy singleton
// ---------------------------------------------------------------------------

let sqlSingleton: NeonQueryFunction<false, false> | null = null;

/**
 * Lazily constructs the Neon query function from DATABASE_URL. Throws a clear
 * error if the connection string is missing so a misconfigured deployment fails
 * at request time rather than producing a confusing driver error.
 */
export function getSql(): NeonQueryFunction<false, false> {
  if (sqlSingleton) return sqlSingleton;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. The collab backend cannot reach Neon without it.",
    );
  }
  sqlSingleton = neon(url);
  return sqlSingleton;
}

/**
 * Replaces the singleton with a test double. Only called from test files.
 * Passing null restores the lazy-construct behavior.
 */
export function _testSetSql(
  fake: NeonQueryFunction<false, false> | null,
): void {
  sqlSingleton = fake;
}

// ---------------------------------------------------------------------------
// Schema (idempotent)
// ---------------------------------------------------------------------------

/**
 * Creates the three collab tables if they do not exist, plus indexes.
 * Idempotent, so every route can call it on entry without a migration step.
 *
 * collab_docs: one row per shared doc. doc_id is the opaque room id minted at
 *   share-grant time (not the local note id). latest_snapshot is the last
 *   compacted Loro snapshot (bytea). latest_version is the bigserial id of the
 *   last update row that was folded into that snapshot, so getCatchup can fetch
 *   only newer rows.
 *
 * collab_doc_updates: append-only since the last compaction. Each row holds
 *   the raw Loro update bytes from one client edit. Rows are pruned by
 *   compactDoc when they are merged into a fresh snapshot.
 *
 * collab_doc_members: access control. Populated from the share grant. A
 *   caller must appear here (or be the owner) to read or write the doc.
 */
export async function ensureCollabSchema(): Promise<void> {
  const sql = getSql();

  await sql`
    CREATE TABLE IF NOT EXISTS collab_docs (
      doc_id              text primary key,
      owner_email_hash    text not null,
      title               text,
      latest_snapshot     bytea,
      latest_version      bigint not null default 0,
      created_at          timestamptz default now(),
      updated_at          timestamptz default now()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS collab_doc_updates (
      id                  bigserial primary key,
      doc_id              text not null,
      update_bytes        bytea not null,
      author_email_hash   text not null,
      created_at          timestamptz default now()
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS collab_doc_updates_doc_id_idx
      ON collab_doc_updates (doc_id, id)
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS collab_doc_members (
      doc_id              text not null,
      member_email_hash   text not null,
      role                text not null default 'editor',
      added_at            timestamptz default now(),
      PRIMARY KEY (doc_id, member_email_hash)
    )
  `;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A collab doc row as returned from the DB. */
export interface CollabDocRow {
  docId: string;
  ownerEmailHash: string;
  title: string | null;
  latestSnapshot: Buffer | Uint8Array | null;
  latestVersion: number;
  createdAt: string;
  updatedAt: string;
}

/** One update row. update_bytes is the raw Loro update. */
export interface CollabUpdateRow {
  id: number;
  docId: string;
  updateBytes: Buffer | Uint8Array;
  authorEmailHash: string;
  createdAt: string;
}

/** The payload getCatchup returns to a connecting client. */
export interface CollabCatchup {
  /** Latest compacted snapshot, or null if the doc has never been compacted. */
  snapshot: Buffer | Uint8Array | null;
  /** All updates appended after the snapshot. */
  updates: CollabUpdateRow[];
  /** latest_version from collab_docs (the max update id folded into snapshot). */
  version: number;
}

// ---------------------------------------------------------------------------
// Helper: createCollabDoc
// ---------------------------------------------------------------------------

/** Input to create a new collab doc row. */
export interface NewCollabDoc {
  docId: string;
  ownerEmailHash: string;
  title?: string | null;
}

/**
 * Inserts a new collab_docs row. The doc starts with no snapshot (null) and
 * version 0. The owner is also inserted into collab_doc_members as an editor
 * so membership checks work uniformly for everyone including the owner.
 *
 * Plain insert, no upsert: a duplicate doc_id surfaces as an error because
 * the room id is minted once at share-grant time and should never be reused.
 */
export async function createCollabDoc(doc: NewCollabDoc): Promise<void> {
  const sql = getSql();
  await sql`
    INSERT INTO collab_docs (doc_id, owner_email_hash, title)
    VALUES (${doc.docId}, ${doc.ownerEmailHash}, ${doc.title ?? null})
  `;
  // Add owner as a member so isMember() works uniformly.
  await addMember(doc.docId, doc.ownerEmailHash, "owner");
}

// ---------------------------------------------------------------------------
// Helper: getCatchup
// ---------------------------------------------------------------------------

/**
 * Returns the latest snapshot plus all updates appended after it, for a
 * connecting client to reconcile. The updates are returned in ascending id
 * order so the client can apply them in sequence on top of the snapshot.
 *
 * latest_version is the max update id that has been folded into the snapshot
 * (0 meaning no compaction has happened). Updates with id > latest_version
 * are the outstanding delta.
 */
export async function getCatchup(docId: string): Promise<CollabCatchup | null> {
  const sql = getSql();

  const docRows = (await sql`
    SELECT doc_id, owner_email_hash, title, latest_snapshot,
           latest_version, created_at, updated_at
    FROM collab_docs
    WHERE doc_id = ${docId}
    LIMIT 1
  `) as Array<{
    doc_id: string;
    owner_email_hash: string;
    title: string | null;
    latest_snapshot: Buffer | null;
    latest_version: string | number;
    created_at: string;
    updated_at: string;
  }>;

  if (docRows.length === 0) return null;
  const d = docRows[0];

  const version = Number(d.latest_version);

  const updateRows = (await sql`
    SELECT id, doc_id, update_bytes, author_email_hash, created_at
    FROM collab_doc_updates
    WHERE doc_id = ${docId}
      AND id > ${version}
    ORDER BY id ASC
  `) as Array<{
    id: string | number;
    doc_id: string;
    update_bytes: Buffer;
    author_email_hash: string;
    created_at: string;
  }>;

  return {
    snapshot: d.latest_snapshot,
    updates: updateRows.map((r) => ({
      id: Number(r.id),
      docId: r.doc_id,
      updateBytes: r.update_bytes,
      authorEmailHash: r.author_email_hash,
      createdAt: r.created_at,
    })),
    version,
  };
}

// ---------------------------------------------------------------------------
// Helper: appendUpdate
// ---------------------------------------------------------------------------

/**
 * Appends one Loro update to the log. Returns the new row's id so callers
 * (the push route) can report the latest version to the client.
 */
export async function appendUpdate(
  docId: string,
  updateBytes: Uint8Array,
  authorEmailHash: string,
): Promise<number> {
  const sql = getSql();

  // Convert Uint8Array to a Buffer so the Neon driver passes it as bytea.
  const buf = Buffer.from(updateBytes);

  const rows = (await sql`
    INSERT INTO collab_doc_updates (doc_id, update_bytes, author_email_hash)
    VALUES (${docId}, ${buf}, ${authorEmailHash})
    RETURNING id
  `) as Array<{ id: string | number }>;

  const newId = Number(rows[0].id);

  // Touch updated_at on the doc row.
  await sql`
    UPDATE collab_docs
       SET updated_at = now()
     WHERE doc_id = ${docId}
  `;

  return newId;
}

// ---------------------------------------------------------------------------
// Helper: membership
// ---------------------------------------------------------------------------

/**
 * Adds a member to a doc. On conflict (same doc_id + member_email_hash) the
 * role is updated, so a re-grant from owner to a new role lands cleanly.
 */
export async function addMember(
  docId: string,
  memberEmailHash: string,
  role: string = "editor",
): Promise<void> {
  const sql = getSql();
  await sql`
    INSERT INTO collab_doc_members (doc_id, member_email_hash, role)
    VALUES (${docId}, ${memberEmailHash}, ${role})
    ON CONFLICT (doc_id, member_email_hash) DO UPDATE SET role = EXCLUDED.role
  `;
}

/**
 * Removes a member from a doc. If removing the last non-owner member also
 * leaves only the owner, the caller (the revoke route) checks and may call
 * deleteCollabDoc.
 */
export async function removeMember(
  docId: string,
  memberEmailHash: string,
): Promise<void> {
  const sql = getSql();
  await sql`
    DELETE FROM collab_doc_members
     WHERE doc_id = ${docId}
       AND member_email_hash = ${memberEmailHash}
  `;
}

/**
 * Returns true if the given email hash has any membership row for the doc,
 * including the owner role. Returns false for any unrecognized hash or unknown
 * doc.
 */
export async function isMember(
  docId: string,
  emailHash: string,
): Promise<boolean> {
  const sql = getSql();
  const rows = (await sql`
    SELECT 1
    FROM collab_doc_members
    WHERE doc_id = ${docId}
      AND member_email_hash = ${emailHash}
    LIMIT 1
  `) as Array<Record<string, unknown>>;
  return rows.length > 0;
}

/**
 * Returns all member rows for a doc, so the revoke route can count remaining
 * members and decide whether to delete the doc.
 */
export async function listMembers(
  docId: string,
): Promise<Array<{ memberEmailHash: string; role: string }>> {
  const sql = getSql();
  const rows = (await sql`
    SELECT member_email_hash, role
    FROM collab_doc_members
    WHERE doc_id = ${docId}
  `) as Array<{ member_email_hash: string; role: string }>;
  return rows.map((r) => ({
    memberEmailHash: r.member_email_hash,
    role: r.role,
  }));
}

/**
 * Looks up the owner_email_hash for a doc, or null if the doc does not exist.
 */
export async function getOwner(docId: string): Promise<string | null> {
  const sql = getSql();
  const rows = (await sql`
    SELECT owner_email_hash
    FROM collab_docs
    WHERE doc_id = ${docId}
    LIMIT 1
  `) as Array<{ owner_email_hash: string }>;
  return rows.length > 0 ? rows[0].owner_email_hash : null;
}

// ---------------------------------------------------------------------------
// Helper: deleteCollabDoc
// ---------------------------------------------------------------------------

/**
 * Deletes a collab doc and all its update log rows and membership rows.
 * Called when the last member is removed (stop-sharing removes the server
 * copy per section 8, decision 3). The cascade order matters: delete updates
 * and members first, then the doc row itself, so no orphan rows survive a
 * partial failure.
 */
export async function deleteCollabDoc(docId: string): Promise<void> {
  const sql = getSql();
  await sql`DELETE FROM collab_doc_updates WHERE doc_id = ${docId}`;
  await sql`DELETE FROM collab_doc_members WHERE doc_id = ${docId}`;
  await sql`DELETE FROM collab_docs WHERE doc_id = ${docId}`;
}

// ---------------------------------------------------------------------------
// Helper: compactDoc
// ---------------------------------------------------------------------------

/**
 * Number of outstanding updates above which compactDoc is triggered by the
 * push route. Exported so the push route and tests share the same constant.
 */
export const COMPACT_THRESHOLD = 200;

/**
 * Merges the current snapshot plus all outstanding updates into a fresh
 * Loro snapshot, stores it, and prunes the merged update rows.
 *
 * Concurrent-append safety: the max update id is captured BEFORE the Loro
 * merge so any updates appended concurrently (id > maxId) are left in the log
 * and will be folded in the next compaction. Only rows with id <= maxId are
 * deleted.
 *
 * Steps:
 *   1. Load the current snapshot + all outstanding updates (id > latest_version).
 *   2. Record maxId = highest update id loaded.
 *   3. Import all into a fresh LoroDoc.
 *   4. Export a new snapshot.
 *   5. UPDATE collab_docs: new snapshot + latest_version = maxId.
 *   6. DELETE collab_doc_updates WHERE doc_id = docId AND id <= maxId.
 *
 * Returns the new latest_version (maxId), or null if there were no updates to
 * fold (nothing to compact).
 */
export async function compactDoc(docId: string): Promise<number | null> {
  const sql = getSql();

  const catchup = await getCatchup(docId);
  if (!catchup) return null;
  if (catchup.updates.length === 0) return null;

  const maxId = catchup.updates[catchup.updates.length - 1].id;

  // Build the merged Loro doc.
  const merged = new LoroDoc();

  if (catchup.snapshot) {
    merged.import(
      catchup.snapshot instanceof Uint8Array
        ? catchup.snapshot
        : new Uint8Array(catchup.snapshot),
    );
  }

  for (const u of catchup.updates) {
    merged.import(
      u.updateBytes instanceof Uint8Array
        ? u.updateBytes
        : new Uint8Array(u.updateBytes as Buffer),
    );
  }

  const newSnapshot = Buffer.from(merged.export({ mode: "snapshot" }));

  await sql`
    UPDATE collab_docs
       SET latest_snapshot = ${newSnapshot},
           latest_version  = ${maxId},
           updated_at      = now()
     WHERE doc_id = ${docId}
  `;

  await sql`
    DELETE FROM collab_doc_updates
     WHERE doc_id = ${docId}
       AND id <= ${maxId}
  `;

  return maxId;
}
