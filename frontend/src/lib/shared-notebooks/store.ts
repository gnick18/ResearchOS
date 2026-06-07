// Shared Notebooks Phase 1 (notebooks-data bot, 2026-06-02). See
// docs/proposals/SHARED_NOTEBOOKS_PROPOSAL.md.
//
// A thin per-user store for `SharedNotebook` records. It deliberately MIRRORS
// `JsonStore`'s on-disk layout (`users/<owner>/<entity>/<id>.json`) and its
// per-user / owner-routed read methods, so the cross-user aggregation in
// `labApi.getSharedNotebooks` walks notebooks exactly the way it walks notes
// and weekly goals.
//
// WHY NOT JsonStore: `JsonStore<T extends { id: number }>` keys records on a
// NUMERIC per-user counter. SharedNotebook ids must be GLOBALLY UNIQUE because
// `notebook_id` is a cross-user query key (a notebook's items live in each
// member's own folder). A per-user counter collides across owners (the PI's
// notebook #1 vs a student's notebook #1); a `crypto.randomUUID()` string does
// not. The approved data model already specified `id: string`. So we keep the
// JsonStore file layout and per-user semantics but key on a UUID string. This
// is the only store in the app with string ids; everything else stays on
// JsonStore unchanged.
//
// SURVIVE REMOVAL (notebook-survive-removal sub-bot, 2026-06-02): the record is
// MIRRORED into BOTH members' folders under the SAME `id`. A SharedNotebook is
// owned equally by two people, so a single-folder copy meant the surviving
// member lost the notebook the moment the creator was removed from the lab
// (discovery filters out tombstoned users). Each folder's copy carries the
// same `created_by`/`members`/`title`/`shared_with`; only the per-folder
// `owner` differs (each copy is owned by the folder it lives in, so per-user
// routing stays consistent). The notebook survives as long as EITHER member's
// folder still holds its copy. Cross-user aggregation DEDUPES by `id`.

import { fileService } from "../file-system/file-service";
import { getCurrentUserCached } from "../storage/json-store";
import type { Notebook, SharedNotebook } from "../types";

const ENTITY = "shared_notebooks";

/**
 * Lazy-normalize on read (notebooks-gen Phase 1, 2026-06-06; AGENTS.md
 * field-migration pattern). On-disk notebook records may carry the legacy
 * `members: [string, string]` tuple shape OR the generalized `string[]` shape.
 * Coerce `members` to a plain `string[]` so callers never see the legacy tuple.
 * Drops non-string / empty member entries and dedupes while preserving order.
 * No on-disk cutover; this runs at every read boundary.
 */
export function normalizeNotebookRecord(raw: Notebook): Notebook {
  const seen = new Set<string>();
  const members: string[] = [];
  const source = Array.isArray(raw?.members) ? raw.members : [];
  for (const m of source) {
    if (typeof m !== "string" || m.length === 0) continue;
    if (seen.has(m)) continue;
    seen.add(m);
    members.push(m);
  }
  return { ...raw, members };
}

export class SharedNotebookStore {
  private dirPath(username: string): string {
    return `users/${username}/${ENTITY}`;
  }

  private filePath(username: string, id: string): string {
    return `${this.dirPath(username)}/${id}.json`;
  }

  /**
   * Create a notebook and MIRROR the record into BOTH members' folders under a
   * freshly minted UUID (never supplied by the caller). Each copy carries the
   * same `created_by`/`members`/`title`/`shared_with`; the per-folder `owner`
   * is set to that folder's member. Returns the creator's copy (owner ===
   * created_by), matching the long-standing create() contract.
   */
  async create(data: Omit<SharedNotebook, "id">): Promise<SharedNotebook> {
    const id = crypto.randomUUID();
    const creator = data.created_by;
    let creatorRecord: SharedNotebook | null = null;
    for (const member of data.members) {
      const record = await this.writeMirror({ ...data, id, owner: member }, member);
      if (member === creator) creatorRecord = record;
    }
    // Defensive fallback if the creator is somehow not in members (never
    // expected; members[0] === created_by by construction).
    return creatorRecord ?? { ...data, id, owner: creator };
  }

  /**
   * Write (or overwrite) the mirror copy of a notebook into a SINGLE member's
   * folder, stamping `owner` = that member. Idempotent. Used by `create`'s
   * per-member write, by `updateForMembers`, and by the lazy backfill that
   * heals a member whose own copy is missing.
   */
  async writeMirror(
    record: SharedNotebook,
    member: string,
  ): Promise<SharedNotebook> {
    const copy: SharedNotebook = { ...record, owner: member };
    await fileService.ensureDir(this.dirPath(member));
    await fileService.writeJson(this.filePath(member, record.id), copy);
    return copy;
  }

  /** Read a notebook from the current user's folder. */
  async get(id: string): Promise<SharedNotebook | null> {
    const owner = await getCurrentUserCached();
    return this.getForUser(id, owner);
  }

  /** Read a notebook from a specific user's folder (cross-user aggregation). */
  async getForUser(id: string, username: string): Promise<SharedNotebook | null> {
    const record = await fileService.readJson<SharedNotebook>(
      this.filePath(username, id),
    );
    return record ? normalizeNotebookRecord(record) : null;
  }

  /** List the current user's OWN notebooks (those they created). */
  async listAll(): Promise<SharedNotebook[]> {
    const owner = await getCurrentUserCached();
    return this.listAllForUser(owner);
  }

  /** List every notebook a specific user created (cross-user aggregation). */
  async listAllForUser(username: string): Promise<SharedNotebook[]> {
    const dir = this.dirPath(username);
    const fileNames = await fileService.listFiles(dir);
    const records: SharedNotebook[] = [];
    for (const fileName of fileNames) {
      if (!fileName.endsWith(".json")) continue;
      const record = await fileService.readJson<SharedNotebook>(
        `${dir}/${fileName}`,
      );
      if (record) records.push(normalizeNotebookRecord(record));
    }
    return records;
  }

  /** Partial-merge `patch` onto `existing`, skipping `undefined` values
   *  (matches JsonStore) and never reassigning the id. The `owner` is left for
   *  the caller / writeMirror to stamp per folder. */
  private applyPatch(
    existing: SharedNotebook,
    patch: Partial<SharedNotebook>,
  ): SharedNotebook {
    const updated: SharedNotebook = { ...existing };
    for (const key of Object.keys(patch) as (keyof SharedNotebook)[]) {
      const value = patch[key];
      if (value !== undefined) {
        (updated as unknown as Record<string, unknown>)[key as string] = value;
      }
    }
    updated.id = existing.id;
    return updated;
  }

  /**
   * Partial-merge update against the CURRENT user's folder (single copy).
   * Retained for callers that have not adopted the mirrored path. `undefined`
   * patch values are skipped, and the id is never reassigned. Returns null if
   * the record does not exist in the current user's folder.
   */
  async update(
    id: string,
    patch: Partial<SharedNotebook>,
  ): Promise<SharedNotebook | null> {
    const owner = await getCurrentUserCached();
    const existing = await this.getForUser(id, owner);
    if (!existing) return null;
    const updated = this.applyPatch(existing, patch);
    return this.writeMirror(updated, owner);
  }

  /**
   * Partial-merge update against BOTH members' mirror copies. We read whichever
   * member folder still holds the record (the notebook survives as long as one
   * does), apply the patch, and re-write a copy into EVERY member folder so the
   * mirrors stay in sync. Each copy keeps its folder-scoped `owner`. Returns
   * the merged record (owner stamped to the first member that had a copy), or
   * null if no member folder held the record at all.
   */
  async updateForMembers(
    id: string,
    members: readonly string[],
    patch: Partial<SharedNotebook>,
  ): Promise<SharedNotebook | null> {
    let existing: SharedNotebook | null = null;
    for (const member of members) {
      existing = await this.getForUser(id, member);
      if (existing) break;
    }
    if (!existing) return null;
    const merged = this.applyPatch(existing, patch);
    let result: SharedNotebook | null = null;
    for (const member of members) {
      const written = await this.writeMirror(merged, member);
      if (!result) result = written;
    }
    return result;
  }

  /** Delete a notebook from the current user's folder only (single copy). */
  async delete(id: string): Promise<boolean> {
    const owner = await getCurrentUserCached();
    return fileService.deleteFile(this.filePath(owner, id));
  }

  /** Delete the notebook's mirror copy from EVERY member's folder. Returns
   *  true if at least one copy was removed. Best-effort per folder. */
  async deleteForMembers(
    id: string,
    members: readonly string[],
  ): Promise<boolean> {
    let removedAny = false;
    for (const member of members) {
      const removed = await fileService.deleteFile(this.filePath(member, id));
      if (removed) removedAny = true;
    }
    return removedAny;
  }
}
