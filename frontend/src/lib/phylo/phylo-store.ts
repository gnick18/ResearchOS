// Phylo Phase 0 — on-disk store for trees.
//
// LOCKED on-disk format (design doc, 2026-06-12): each tree is a PAIR of files in
// the per-user store, exactly mirroring molecule-store.ts and sequence-store.ts:
//   users/{username}/phylo/{id}.tree       ← tree text (Newick / Nexus / PhyloXML)
//   users/{username}/phylo/{id}.meta.json  ← PhyloMeta sidecar
//
// The truth is a non-JSON text file (the tree string), so we drive fileService
// directly rather than JsonStore, and REUSE the same primitives + the per-user
// `_counters.json` id allocator (entity "phylo") so ids never collide with other
// per-user counters. The store is pure file I/O and SSR-safe (no DOM, no parser),
// so tip-count and parsing live one layer up in phyloApi.
//
// DATA-SHAPE FLAGGED: new on-disk shape. Review before merge.

import { fileService } from "../file-system/file-service";
import { getCurrentUserCached } from "../storage/json-store";
import type { PhyloMeta } from "./types";

const ENTITY = "phylo";

function dirPath(username: string): string {
  return `users/${username}/${ENTITY}`;
}
function treePath(username: string, id: string): string {
  return `${dirPath(username)}/${id}.tree`;
}
function metaPath(username: string, id: string): string {
  return `${dirPath(username)}/${id}.meta.json`;
}

// Allocate the next tree id from the TARGET user's `_counters.json`. Mirrors
// molecule-store's `nextMoleculeId` so tree ids share the same per-user counter
// space as every other entity. Returns a stringified integer.
async function nextPhyloId(username: string): Promise<string> {
  const path = `users/${username}/_counters.json`;
  const counters =
    (await fileService.readJson<Record<string, number>>(path)) ?? {};
  const current = (counters[ENTITY] || 0) + 1;
  counters[ENTITY] = current;
  await fileService.writeJson(path, counters);
  return String(current);
}

export interface RawPhyloFiles {
  meta: PhyloMeta;
  /** The tree text (Newick / Nexus / PhyloXML as imported). */
  tree: string;
}

export const phyloStore = {
  /** List all tree sidecars for the current user (no tree text loaded). */
  async listMeta(): Promise<PhyloMeta[]> {
    const username = await getCurrentUserCached();
    return phyloStore.listMetaForUser(username);
  },

  /** List all tree sidecars for a specific user. */
  async listMetaForUser(username: string): Promise<PhyloMeta[]> {
    const files = await fileService.listFiles(dirPath(username));
    const metas: PhyloMeta[] = [];
    for (const name of files) {
      if (!name.endsWith(".meta.json")) continue;
      const meta = await fileService.readJson<PhyloMeta>(
        `${dirPath(username)}/${name}`,
      );
      if (meta) metas.push(meta);
    }
    // Newest first (numeric id), so the library shows recent work at the top.
    return metas.sort((a, b) => Number(b.id) - Number(a.id));
  },

  /** Read one tree's sidecar + tree text for a user. */
  async getRawForUser(
    id: string,
    username: string,
  ): Promise<RawPhyloFiles | null> {
    const meta = await fileService.readJson<PhyloMeta>(metaPath(username, id));
    if (!meta) return null;
    const tree = (await fileService.readText(treePath(username, id))) ?? "";
    return { meta, tree };
  },

  /** Read one tree for the current user. */
  async getRaw(id: string): Promise<RawPhyloFiles | null> {
    const username = await getCurrentUserCached();
    return phyloStore.getRawForUser(id, username);
  },

  /** Write a new tree pair for the current user, allocating a fresh id. */
  async create(
    tree: string,
    meta: Omit<PhyloMeta, "id">,
  ): Promise<RawPhyloFiles> {
    const username = await getCurrentUserCached();
    await fileService.ensureDir(dirPath(username));
    const id = await nextPhyloId(username);
    const fullMeta: PhyloMeta = { ...meta, id };
    // Write the tree text FIRST, then the sidecar. If a torn write leaves only
    // the .tree behind, listMeta skips it (no sidecar) rather than surfacing a
    // half-record, the same crash-safety order molecule-store + sequence-store use.
    await fileService.writeText(treePath(username, id), tree);
    await fileService.writeJson(metaPath(username, id), fullMeta);
    return { meta: fullMeta, tree };
  },

  /** Patch the sidecar metadata for an existing tree. */
  async updateMeta(
    id: string,
    patch: Partial<Omit<PhyloMeta, "id">>,
    username: string,
  ): Promise<PhyloMeta | null> {
    const existing = await fileService.readJson<PhyloMeta>(
      metaPath(username, id),
    );
    if (!existing) return null;
    const updated: PhyloMeta = { ...existing, ...patch, id };
    await fileService.writeJson(metaPath(username, id), updated);
    return updated;
  },

  /** Replace the tree text for an existing tree. */
  async writeTree(id: string, tree: string, username: string): Promise<void> {
    await fileService.writeText(treePath(username, id), tree);
  },

  /** Delete both files of a tree pair. Returns true if the sidecar existed. */
  async delete(id: string, username: string): Promise<boolean> {
    const hadMeta = await fileService.deleteFile(metaPath(username, id));
    await fileService.deleteFile(treePath(username, id));
    return hadMeta;
  },
};
