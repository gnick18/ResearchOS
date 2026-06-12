// Check-ins Phase 3 (checkins-phase3 bot, 2026-06-12). See
// docs/proposals/checkins-revamp.md "IDP structure".
//
// A thin per-user store for `IDP` records, MIRRORING the one-on-one store
// (lib/one-on-one/store.ts): JsonStore's on-disk layout
// (`users/<owner>/idps/<id>.json`) keyed on a globally-unique
// crypto.randomUUID string instead of a per-user numeric counter, so the IDP id
// never collides across owners.
//
// HOME FOLDER: an IDP is owned by the TRAINEE, so the record lives in the
// trainee's folder only (`owner === trainee`). The single-copy model: an IDP has
// a clear owner (the trainee), so there is one canonical copy. The mentor
// discovers it via a sharing-respecting aggregation and reads it through
// `normalizeIdpForViewer`.

import { fileService } from "../file-system/file-service";
import { getCurrentUserCached } from "../storage/json-store";
import type { IDP } from "../types";

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

export class IdpStore extends StringKeyedStore<IDP> {
  constructor() {
    super("idps");
  }
}
