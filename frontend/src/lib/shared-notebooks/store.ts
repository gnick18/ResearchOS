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

import { fileService } from "../file-system/file-service";
import { getCurrentUserCached } from "../storage/json-store";
import type { SharedNotebook } from "../types";

const ENTITY = "shared_notebooks";

export class SharedNotebookStore {
  private dirPath(username: string): string {
    return `users/${username}/${ENTITY}`;
  }

  private filePath(username: string, id: string): string {
    return `${this.dirPath(username)}/${id}.json`;
  }

  /**
   * Create a notebook in the CURRENT user's folder. The id is a freshly
   * minted UUID (never supplied by the caller). Returns the persisted record.
   */
  async create(data: Omit<SharedNotebook, "id">): Promise<SharedNotebook> {
    const owner = await getCurrentUserCached();
    const id = crypto.randomUUID();
    const record: SharedNotebook = { ...data, id };
    await fileService.ensureDir(this.dirPath(owner));
    await fileService.writeJson(this.filePath(owner, id), record);
    return record;
  }

  /** Read a notebook from the current user's folder. */
  async get(id: string): Promise<SharedNotebook | null> {
    const owner = await getCurrentUserCached();
    return this.getForUser(id, owner);
  }

  /** Read a notebook from a specific user's folder (cross-user aggregation). */
  async getForUser(id: string, username: string): Promise<SharedNotebook | null> {
    return fileService.readJson<SharedNotebook>(this.filePath(username, id));
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
      if (record) records.push(record);
    }
    return records;
  }

  /**
   * Partial-merge update against the CURRENT user's folder (the creator owns
   * the record). `undefined` patch values are skipped (matches JsonStore), and
   * the id is never reassigned. Returns null if the record does not exist.
   */
  async update(
    id: string,
    patch: Partial<SharedNotebook>,
  ): Promise<SharedNotebook | null> {
    const owner = await getCurrentUserCached();
    const existing = await this.getForUser(id, owner);
    if (!existing) return null;
    const updated: SharedNotebook = { ...existing };
    for (const key of Object.keys(patch) as (keyof SharedNotebook)[]) {
      const value = patch[key];
      if (value !== undefined) {
        (updated as unknown as Record<string, unknown>)[key as string] = value;
      }
    }
    updated.id = id;
    await fileService.writeJson(this.filePath(owner, id), updated);
    return updated;
  }

  /** Delete a notebook from the current user's folder. */
  async delete(id: string): Promise<boolean> {
    const owner = await getCurrentUserCached();
    return fileService.deleteFile(this.filePath(owner, id));
  }
}
