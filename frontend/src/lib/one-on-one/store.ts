// 1:1 revamp (oneonone data+strip bot, 2026-06-07). See
// docs/proposals/NOTEBOOKS_AND_ONE_ON_ONE_REVAMP.md.
//
// Thin per-user stores for `OneOnOne` and `OneOnOneActionItem` records. They
// MIRROR the notebook store (lib/shared-notebooks/store.ts): JsonStore's
// on-disk layout (`users/<owner>/<entity>/<id>.json`) keyed on a GLOBALLY-
// UNIQUE crypto.randomUUID string instead of a per-user numeric counter, so the
// `one_on_one_id` cross-user query key never collides across owners.
//
// HOME FOLDER: a 1:1 is owned by the lab head (the creator), so the record
// lives in the LAB HEAD's folder only (`owner === labHead`). The member
// discovers it via the sharing-respecting aggregation in
// `labApi.getOneOnOnes`. This is the single-copy model (unlike notebooks, which
// mirror into both folders for survive-removal). A 1:1 has a clear owner — the
// lab head — so we keep one canonical copy.

import { fileService } from "../file-system/file-service";
import { getCurrentUserCached } from "../storage/json-store";
import type { OneOnOne, OneOnOneActionItem } from "../types";

class StringKeyedStore<T extends { id: string }> {
  constructor(private readonly entity: string) {}

  private dirPath(username: string): string {
    return `users/${username}/${this.entity}`;
  }

  private filePath(username: string, id: string): string {
    return `${this.dirPath(username)}/${id}.json`;
  }

  /** Create a record in `owner`'s folder under a freshly minted UUID. */
  async create(data: Omit<T, "id">): Promise<T> {
    const id = crypto.randomUUID();
    const record = { ...data, id } as T;
    const owner = (record as unknown as { owner: string }).owner;
    await this.writeForUser(record, owner);
    return record;
  }

  /** Write (or overwrite) a record into a specific user's folder. */
  async writeForUser(record: T, username: string): Promise<T> {
    await fileService.ensureDir(this.dirPath(username));
    await fileService.writeJson(this.filePath(username, record.id), record);
    return record;
  }

  /** Read a record from a specific user's folder (cross-user aggregation). */
  async getForUser(id: string, username: string): Promise<T | null> {
    return fileService.readJson<T>(this.filePath(username, id));
  }

  /** Read a record from the current user's folder. */
  async get(id: string): Promise<T | null> {
    const owner = await getCurrentUserCached();
    return this.getForUser(id, owner);
  }

  /** List every record a specific user owns (cross-user aggregation). */
  async listAllForUser(username: string): Promise<T[]> {
    const dir = this.dirPath(username);
    const fileNames = await fileService.listFiles(dir);
    const records: T[] = [];
    for (const fileName of fileNames) {
      if (!fileName.endsWith(".json")) continue;
      const record = await fileService.readJson<T>(`${dir}/${fileName}`);
      if (record) records.push(record);
    }
    return records;
  }

  /** Partial-merge update against a specific user's folder. `undefined` patch
   *  values are skipped (matches JsonStore); the id is never reassigned.
   *  Returns null if the record does not exist in that user's folder. */
  async updateForUser(
    id: string,
    patch: Partial<T>,
    username: string,
  ): Promise<T | null> {
    const existing = await this.getForUser(id, username);
    if (!existing) return null;
    const updated = { ...existing } as T;
    for (const key of Object.keys(patch) as (keyof T)[]) {
      const value = patch[key];
      if (value !== undefined) {
        (updated as Record<string, unknown>)[key as string] = value;
      }
    }
    updated.id = existing.id;
    return this.writeForUser(updated, username);
  }

  /** Delete a record from a specific user's folder. */
  async deleteForUser(id: string, username: string): Promise<boolean> {
    return fileService.deleteFile(this.filePath(username, id));
  }
}

export class OneOnOneStore extends StringKeyedStore<OneOnOne> {
  constructor() {
    super("one_on_ones");
  }
}

export class OneOnOneActionItemStore extends StringKeyedStore<OneOnOneActionItem> {
  constructor() {
    super("one_on_one_action_items");
  }
}
