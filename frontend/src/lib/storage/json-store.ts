import { fileService } from "../file-system/file-service";
import { getCurrentUser } from "../file-system/indexeddb-store";

const PUBLIC_ENTITIES = new Set([
  "methods",
  "pcr_protocols",
  "lc_gradients",
  "plate_layouts",
  "cell_culture_schedules",
  "mass_spec_methods",
  "coding_workflows",
  "qpcr_analyses",
]);

interface Counters {
  [entity: string]: number;
}

let currentUserCache: string | null = null;

export async function getCurrentUserCached(): Promise<string> {
  if (currentUserCache) {
    return currentUserCache;
  }
  const user = await getCurrentUser();
  currentUserCache = user;
  return user || "_no_user_";
}

export function clearCurrentUserCache(): void {
  currentUserCache = null;
}

async function getCountersPath(username: string): Promise<string> {
  return `users/${username}/_counters.json`;
}

async function getPublicCountersPath(): Promise<string> {
  return "users/public/_counters.json";
}

async function getGlobalCountersPath(): Promise<string> {
  return "users/_global_counters.json";
}

async function readCounters(publicStore: boolean = false): Promise<Counters> {
  const username = await getCurrentUserCached();
  const path = publicStore ? await getPublicCountersPath() : await getCountersPath(username);
  const counters = await fileService.readJson<Counters>(path);
  return counters || {};
}

async function writeCounters(counters: Counters, publicStore: boolean = false): Promise<void> {
  const username = await getCurrentUserCached();
  const path = publicStore ? await getPublicCountersPath() : await getCountersPath(username);
  await fileService.writeJson(path, counters);
}

async function readGlobalCounters(): Promise<Counters> {
  const path = await getGlobalCountersPath();
  const counters = await fileService.readJson<Counters>(path);
  return counters || {};
}

async function writeGlobalCounters(counters: Counters): Promise<void> {
  const path = await getGlobalCountersPath();
  await fileService.writeJson(path, counters);
}

async function nextId(entity: string, publicStore: boolean = false): Promise<number> {
  const counters = await readCounters(publicStore);
  const current = (counters[entity] || 0) + 1;
  counters[entity] = current;
  await writeCounters(counters, publicStore);
  return current;
}

// Like `nextId`, but reads/writes counters from a specific user's directory
// instead of the current user's. Used by Lab Head Phase 5 R1 owner-routed
// creates so a PI editing another member's notes/purchases bumps that
// member's counter (not the PI's). Bypasses the current-user cache entirely.
async function nextIdForUser(entity: string, username: string): Promise<number> {
  const path = `users/${username}/_counters.json`;
  const counters = (await fileService.readJson<Counters>(path)) ?? {};
  const current = (counters[entity] || 0) + 1;
  counters[entity] = current;
  await fileService.writeJson(path, counters);
  return current;
}

async function nextGlobalId(entity: string): Promise<number> {
  const counters = await readGlobalCounters();
  const current = (counters[entity] || 0) + 1;
  counters[entity] = current;
  await writeGlobalCounters(counters);
  return current;
}

export type StoreType = "user" | "public" | "lab";

export class JsonStore<T extends { id: number }> {
  private entityName: string;
  private storeType: StoreType;

  constructor(entityName: string, storeType: StoreType = "user") {
    this.entityName = entityName;
    this.storeType = storeType;
  }

  private async getBasePath(): Promise<string> {
    if (this.storeType === "public") {
      return "users/public";
    } else if (this.storeType === "lab") {
      return "users/lab";
    } else {
      const username = await getCurrentUserCached();
      const path = `users/${username}`;
      return path;
    }
  }

  private async getDirPath(): Promise<string> {
    const base = await this.getBasePath();
    return `${base}/${this.entityName}`;
  }

  private async ensureDir(): Promise<void> {
    const dirPath = await this.getDirPath();
    await fileService.ensureDir(dirPath);
  }

  private getFilePath(id: number, basePath: string): string {
    return `${basePath}/${this.entityName}/${id}.json`;
  }

  /**
   * Skip per-entity sidecar files that share the entity directory but
   * aren't records of the entity type. Currently only projects have a
   * sidecar (`<id>-hosted.json`, the cross-owner hosted-task manifest),
   * but this guard is centralized so future sidecars (e.g. notes-image
   * migration manifests) land in one place.
   *
   * Root cause (tour orphan project R1, 2026-05-26): without this skip,
   * `listAll()` reads `<id>-hosted.json` as a `Project` record. The
   * hosted-manifest shape is `{ version, hostedTasks }` — no `id`, no
   * `name`. The result is a project record with both fields `undefined`,
   * which renders on Home as a red-bannered "(unnamed project)" orphan
   * card. `purgeMalformed()` already skipped these via the same pattern;
   * the read path didn't, so the orphan kept resurfacing on every
   * re-mount even after the sweep ran.
   */
  private shouldSkipSidecarFile(fileName: string): boolean {
    if (this.entityName === "projects" && fileName.endsWith("-hosted.json")) {
      return true;
    }
    return false;
  }

  async listAll(): Promise<T[]> {
    const basePath = await this.getBasePath();
    const dirPath = `${basePath}/${this.entityName}`;

    const fileNames = await fileService.listFiles(dirPath);

    const records: T[] = [];

    for (const fileName of fileNames) {
      if (!fileName.endsWith(".json")) continue;
      if (this.shouldSkipSidecarFile(fileName)) continue;
      const filePath = `${dirPath}/${fileName}`;
      const record = await fileService.readJson<T>(filePath);
      if (record) {
        records.push(record);
      } else {
        console.warn(`[JsonStore.listAll] Failed to read: ${filePath}`);
      }
    }

    return records.sort((a, b) => a.id - b.id);
  }

  async listAllForUser(username: string): Promise<T[]> {
    const basePath = `users/${username}`;
    const dirPath = `${basePath}/${this.entityName}`;

    const fileNames = await fileService.listFiles(dirPath);

    const records: T[] = [];

    for (const fileName of fileNames) {
      if (!fileName.endsWith(".json")) continue;
      if (this.shouldSkipSidecarFile(fileName)) continue;
      const filePath = `${dirPath}/${fileName}`;
      const record = await fileService.readJson<T>(filePath);
      if (record) {
        records.push(record);
      }
    }

    return records.sort((a, b) => a.id - b.id);
  }

  async get(id: number): Promise<T | null> {
    const basePath = await this.getBasePath();
    const filePath = this.getFilePath(id, basePath);
    return await fileService.readJson<T>(filePath);
  }

  // ── Owner-routed variants ──────────────────────────────────────────────────
  // These read/write inside a specific user's directory instead of the current
  // user's. Used by shared-task edit flows where a receiver with permission
  // "edit" needs to mutate the owner's file in place.

  async getForUser(id: number, username: string): Promise<T | null> {
    const basePath = `users/${username}`;
    return await fileService.readJson<T>(this.getFilePath(id, basePath));
  }

  async saveForUser(id: number, data: T, username: string): Promise<T> {
    const basePath = `users/${username}`;
    await fileService.ensureDir(`${basePath}/${this.entityName}`);
    const record = { ...data, id };
    const filePath = this.getFilePath(id, basePath);
    await fileService.writeJson(filePath, record);
    return record;
  }

  async updateForUser(id: number, data: Partial<T>, username: string): Promise<T | null> {
    const existing = await this.getForUser(id, username);
    if (!existing) return null;
    const updated = { ...existing };
    for (const key of Object.keys(data) as (keyof T)[]) {
      const value = data[key];
      if (value !== undefined) {
        (updated as Record<string, unknown>)[key as string] = value;
      }
    }
    const basePath = `users/${username}`;
    const filePath = this.getFilePath(id, basePath);
    await fileService.writeJson(filePath, updated);
    return updated;
  }

  async deleteForUser(id: number, username: string): Promise<boolean> {
    const basePath = `users/${username}`;
    return await fileService.deleteFile(this.getFilePath(id, basePath));
  }

  // Owner-routed create. Bumps the TARGET user's counter (not the current
  // viewer's) so the new id doesn't collide with the viewer's own records.
  // Lab Head Phase 5 R1: PI editing a member's notes/purchases needs the
  // new file to land in `users/<member>/<entity>/<id>.json` with a member-
  // scoped id. `public` and `lab` store types reject this call — those use
  // global/lab counters, and a "create for user" semantic doesn't apply.
  async createForUser(data: Omit<T, "id">, username: string): Promise<T> {
    if (this.storeType !== "user") {
      throw new Error(
        `createForUser is only valid on user-scoped stores (got ${this.storeType} for ${this.entityName})`,
      );
    }
    if (PUBLIC_ENTITIES.has(this.entityName)) {
      throw new Error(
        `createForUser is not valid for entity '${this.entityName}' — it uses global counters`,
      );
    }
    const basePath = `users/${username}`;
    await fileService.ensureDir(`${basePath}/${this.entityName}`);
    const newId = await nextIdForUser(this.entityName, username);
    const record = { ...data, id: newId } as T;
    const filePath = this.getFilePath(newId, basePath);
    await fileService.writeJson(filePath, record);
    return record;
  }

  async create(data: Omit<T, "id">): Promise<T> {
    await this.ensureDir();

    let newId: number;
    if (this.storeType === "user" && PUBLIC_ENTITIES.has(this.entityName)) {
      newId = await nextGlobalId(this.entityName);
    } else if (this.storeType === "public") {
      newId = await nextGlobalId(this.entityName);
    } else if (this.storeType === "lab") {
      newId = await nextId(this.entityName, false);
    } else {
      newId = await nextId(this.entityName, false);
    }

    const record = { ...data, id: newId } as T;
    const basePath = await this.getBasePath();
    const filePath = this.getFilePath(newId, basePath);
    await fileService.writeJson(filePath, record);
    return record;
  }

  async update(id: number, data: Partial<T>): Promise<T | null> {
    const existing = await this.get(id);
    if (!existing) return null;

    const updated = { ...existing };
    for (const key of Object.keys(data) as (keyof T)[]) {
      const value = data[key];
      if (value !== undefined) {
        (updated as Record<string, unknown>)[key as string] = value;
      }
    }

    const basePath = await this.getBasePath();
    const filePath = this.getFilePath(id, basePath);
    await fileService.writeJson(filePath, updated);
    return updated;
  }

  async save(id: number, data: T): Promise<T> {
    await this.ensureDir();
    const record = { ...data, id };
    const basePath = await this.getBasePath();
    const filePath = this.getFilePath(id, basePath);
    await fileService.writeJson(filePath, record);
    return record;
  }

  async delete(id: number): Promise<boolean> {
    const basePath = await this.getBasePath();
    const filePath = this.getFilePath(id, basePath);
    return await fileService.deleteFile(filePath);
  }

  async query(filters: Partial<T>): Promise<T[]> {
    const all = await this.listAll();
    return all.filter((record) => {
      for (const key of Object.keys(filters) as (keyof T)[]) {
        if (record[key] !== filters[key]) {
          return false;
        }
      }
      return true;
    });
  }
}

export class AttachmentMetadataStore<T extends { id: number }> {
  private folderName: string;

  constructor(folderName: "Images" | "Files") {
    this.folderName = folderName;
  }

  private async getMetadataPath(): Promise<string> {
    const username = await getCurrentUserCached();
    return `users/${username}/${this.folderName}/_metadata.json`;
  }

  private async readMetadata(): Promise<{ version: number; entries: T[]; next_id: number }> {
    const path = await this.getMetadataPath();
    const data = await fileService.readJson<{ version: number; entries: T[]; next_id: number }>(path);
    return data || { version: 1, entries: [], next_id: 1 };
  }

  private async writeMetadata(data: { version: number; entries: T[]; next_id: number }): Promise<void> {
    const path = await this.getMetadataPath();
    await fileService.ensureDir(`users/${(await getCurrentUserCached())}/${this.folderName}`);
    await fileService.writeJson(path, data);
  }

  async addEntry(entry: Omit<T, "id">): Promise<T> {
    const metadata = await this.readMetadata();
    const newId = metadata.next_id;
    const newEntry = { ...entry, id: newId } as T;
    metadata.entries.push(newEntry);
    metadata.next_id = newId + 1;
    await this.writeMetadata(metadata);
    return newEntry;
  }

  async getEntry(id: number): Promise<T | null> {
    const metadata = await this.readMetadata();
    return metadata.entries.find((e) => e.id === id) || null;
  }

  async listAll(): Promise<T[]> {
    const metadata = await this.readMetadata();
    return metadata.entries;
  }

  async updateEntry(id: number, updates: Partial<T>): Promise<T | null> {
    const metadata = await this.readMetadata();
    const index = metadata.entries.findIndex((e) => e.id === id);
    if (index === -1) return null;

    metadata.entries[index] = { ...metadata.entries[index], ...updates } as T;
    await this.writeMetadata(metadata);
    return metadata.entries[index];
  }

  async deleteEntry(id: number): Promise<boolean> {
    const metadata = await this.readMetadata();
    const index = metadata.entries.findIndex((e) => e.id === id);
    if (index === -1) return false;

    metadata.entries.splice(index, 1);
    await this.writeMetadata(metadata);
    return true;
  }
}

export function getUserStore<T extends { id: number }>(entityName: string): JsonStore<T> {
  return new JsonStore<T>(entityName, "user");
}

export function getPublicStore<T extends { id: number }>(entityName: string): JsonStore<T> {
  return new JsonStore<T>(entityName, "public");
}

export function getLabStore<T extends { id: number }>(entityName: string): JsonStore<T> {
  return new JsonStore<T>(entityName, "lab");
}
