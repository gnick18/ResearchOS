/**
 * datahub/api.ts
 *
 * The project-scoped catalog API for Data Hub documents, mirroring the shape of
 * sequencesApi / the other `*Api` modules. Listing reads ONLY the readable `.json`
 * mirrors (a DataHubDocContent each), so the catalog never opens a Loro snapshot;
 * the cell-level CRDT doc is opened lazily by openDataHubDoc when a document is
 * actually edited.
 *
 * Documents are per-owner under users/<owner>/datahub/. The catalog spans every
 * user (so a shared / lab-wide list sees all documents), enumerated via
 * fileService.listDirectories("users") exactly like the lab-wide readers do.
 *
 * Ids are minted from the TARGET user's `_counters.json` under the "datahub"
 * entity (the same allocator sequences uses), stringified, so a Data Hub id is a
 * stable per-user string that never collides with other entities. The
 * DataHubDocument.id is typed `string` (Prism-style documents are referenced by
 * string id everywhere downstream), hence the stringify.
 *
 * Metadata (id / name / project_ids / folder_path / table_type / timestamps)
 * lives in the mirror's `.meta` block, so list / listByProject / listByFolder
 * filter without opening a single Loro doc.
 *
 * No em-dashes, no emojis, no mid-sentence colons.
 */

import { fileService } from "../file-system/file-service";
import { getCurrentUserCached } from "../storage/json-store";
import {
  dataHubDir,
  dataHubJsonPath,
  readDataHubMirror,
  persistDataHubContent,
  deleteDataHubFiles,
} from "../loro/datahub-sidecar-store";
import type {
  DataHubCreate,
  DataHubDocContent,
  DataHubDocument,
  DataHubUpdate,
} from "./model/types";

const ENTITY = "datahub";

/**
 * Allocate the next document id from the target user's `_counters.json`, mirroring
 * sequence-store's nextSequenceId so the id space is shared per user. Returns the
 * id as a string (DataHubDocument.id is a string).
 */
async function nextDataHubId(owner: string): Promise<string> {
  const path = `users/${owner}/_counters.json`;
  const counters =
    (await fileService.readJson<Record<string, number>>(path)) ?? {};
  const current = (counters[ENTITY] || 0) + 1;
  counters[ENTITY] = current;
  await fileService.writeJson(path, counters);
  return String(current);
}

/** Read every mirror under one owner's datahub dir (skips non-mirror files). */
async function listMirrorsForOwner(
  owner: string,
): Promise<DataHubDocContent[]> {
  const files = await fileService.listFiles(dataHubDir(owner));
  const out: DataHubDocContent[] = [];
  for (const name of files) {
    if (!name.endsWith(".json")) continue;
    const id = name.slice(0, -".json".length);
    const mirror = await readDataHubMirror(owner, id);
    if (mirror) out.push(mirror);
  }
  return out;
}

/** Read every mirror across all users. */
async function listAllMirrors(): Promise<DataHubDocContent[]> {
  const owners = await fileService.listDirectories("users");
  const out: DataHubDocContent[] = [];
  for (const owner of owners) {
    const mirrors = await listMirrorsForOwner(owner);
    out.push(...mirrors);
  }
  return out;
}

/** The metadata projection used by the list surfaces. */
function toDocument(content: DataHubDocContent): DataHubDocument {
  return content.meta;
}

function sortByName(a: DataHubDocument, b: DataHubDocument): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : 1;
}

/**
 * Find the owner + content for a document id by scanning the per-user mirrors.
 * Returns null when the id is not found anywhere.
 */
async function findById(
  id: string,
): Promise<{ owner: string; content: DataHubDocContent } | null> {
  const owners = await fileService.listDirectories("users");
  for (const owner of owners) {
    const mirror = await readDataHubMirror(owner, id);
    if (mirror && mirror.meta.id === id) return { owner, content: mirror };
  }
  return null;
}

export const dataHubApi = {
  /** List every Data Hub document (all users), metadata only. */
  async list(): Promise<DataHubDocument[]> {
    const mirrors = await listAllMirrors();
    return mirrors.map(toDocument).sort(sortByName);
  },

  /** List documents linked to a project (collection membership via project_ids). */
  async listByProject(projectId: string): Promise<DataHubDocument[]> {
    const mirrors = await listAllMirrors();
    return mirrors
      .map(toDocument)
      .filter((d) => d.project_ids.includes(projectId))
      .sort(sortByName);
  },

  /**
   * List documents in a project's subfolder. folderPath null / "" means the
   * project root (documents with no folder_path). project membership is required
   * so the folder view is always scoped to one project.
   */
  async listByFolder(
    projectId: string,
    folderPath: string | null,
  ): Promise<DataHubDocument[]> {
    const target = folderPath === "" ? null : folderPath;
    const mirrors = await listAllMirrors();
    return mirrors
      .map(toDocument)
      .filter(
        (d) =>
          d.project_ids.includes(projectId) &&
          (d.folder_path ?? null) === target,
      )
      .sort(sortByName);
  },

  /** List documents that belong to NO project (the "Unfiled" collection). The
   *  unfiled counterpart of listByProject, so an unfiled tree can find unfiled
   *  tables to overlay (smart-binding scope). */
  async listUnfiled(): Promise<DataHubDocument[]> {
    const mirrors = await listAllMirrors();
    return mirrors
      .map(toDocument)
      .filter((d) => d.project_ids.length === 0)
      .sort(sortByName);
  },

  /**
   * List the tables in a tree's collection SCOPE, deduped by id. When projectIds
   * is non-empty the scope is the union across those projects; when it is empty
   * the scope is the Unfiled collection (so an unfiled tree joins unfiled tables).
   * This is the single "same collection" rule both smart-binding front doors use
   * (the /phylo scan effect and the BeakerBot suggest_tree_overlays tool).
   */
  async listForScope(projectIds: string[]): Promise<DataHubDocument[]> {
    if (projectIds.length === 0) return this.listUnfiled();
    const seen = new Map<string, DataHubDocument>();
    for (const pid of projectIds) {
      for (const d of await this.listByProject(pid))
        if (!seen.has(d.id)) seen.set(d.id, d);
    }
    return [...seen.values()].sort(sortByName);
  },

  /** Get one document's metadata by id (null when not found). */
  async get(id: string): Promise<DataHubDocument | null> {
    const found = await findById(id);
    return found ? toDocument(found.content) : null;
  },

  /**
   * Get one document's full content (columns / rows / analyses / plots) by id,
   * read from the readable mirror, or null when not found. Lets a caller act on a
   * table it has not opened in the editor (e.g. a rail right-click Duplicate /
   * Export on a non-open table) without scanning a Loro snapshot.
   */
  async getContent(id: string): Promise<DataHubDocContent | null> {
    const found = await findById(id);
    return found ? found.content : null;
  },

  /**
   * Create a new document for the current user, allocating a fresh id and writing
   * both the `.loro` sidecar and the `.json` mirror. Optional content (columns /
   * rows / analyses / plots) seeds the initial table; omitted means empty.
   */
  async create(data: DataHubCreate): Promise<DataHubDocument> {
    const owner = await getCurrentUserCached();
    await fileService.ensureDir(dataHubDir(owner));
    const id = await nextDataHubId(owner);
    const now = new Date().toISOString();
    const meta: DataHubDocument = {
      id,
      name: data.name,
      project_ids: data.project_ids ?? [],
      folder_path: data.folder_path ?? null,
      table_type: data.table_type,
      // Optional Column-table entry format; absent stays absent (replicates).
      ...(data.entryFormat ? { entryFormat: data.entryFormat } : {}),
      // Optional derived-table link; absent stays absent (a normal entered table).
      ...(data.derivedFrom ? { derivedFrom: data.derivedFrom } : {}),
      created_at: now,
    };
    const content: DataHubDocContent = {
      meta,
      columns: data.columns ?? [],
      rows: data.rows ?? [],
      analyses: data.analyses ?? [],
      plots: data.plots ?? [],
      // Info-sheet documentation; present only when creating an Info sheet, so a
      // grid table seeds without it and stays byte-identical on disk.
      ...(data.info ? { info: data.info } : {}),
    };
    await persistDataHubContent(owner, id, content);
    return meta;
  },

  /**
   * Update a document. Metadata-only fields (name / table_type / project_ids /
   * folder_path / last_edited_*) and the table arrays are all optional; only
   * present fields are written. The mirror is re-seeded into the sidecar so the
   * authoritative CRDT stays in sync. Returns the updated metadata, or null when
   * the id is not found.
   */
  async update(id: string, data: DataHubUpdate): Promise<DataHubDocument | null> {
    const found = await findById(id);
    if (!found) return null;
    const { owner, content } = found;

    const meta: DataHubDocument = {
      ...content.meta,
      id,
      name: data.name ?? content.meta.name,
      table_type: data.table_type ?? content.meta.table_type,
      entryFormat: data.entryFormat ?? content.meta.entryFormat,
      derivedFrom: data.derivedFrom ?? content.meta.derivedFrom,
      project_ids: data.project_ids ?? content.meta.project_ids,
      folder_path:
        data.folder_path !== undefined ? data.folder_path : content.meta.folder_path,
      last_edited_by: data.last_edited_by ?? content.meta.last_edited_by,
      last_edited_at: data.last_edited_at ?? content.meta.last_edited_at,
    };
    const nextInfo = data.info ?? content.info;
    const next: DataHubDocContent = {
      meta,
      columns: data.columns ?? content.columns,
      rows: data.rows ?? content.rows,
      analyses: data.analyses ?? content.analyses,
      plots: data.plots ?? content.plots,
      // Info-sheet documentation; absent on a grid table leaves it off, so the
      // metadata-only update path stays byte-identical for every other type.
      ...(nextInfo ? { info: nextInfo } : {}),
    };
    await persistDataHubContent(owner, id, next);
    return meta;
  },

  /** Delete a document (both files). Returns true when it existed. */
  async delete(id: string): Promise<boolean> {
    const found = await findById(id);
    if (!found) return false;
    return deleteDataHubFiles(found.owner, id);
  },
};

export { dataHubJsonPath };
