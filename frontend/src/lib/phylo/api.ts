// Phylo library API — the SEAM between the phylo arc (owner) and any consumer
// surface (the `/phylo` hub library grid, the project surface, embeds).
//
// Mirrors `lib/chemistry/api.ts`. The on-disk SHAPE is locked in types.ts + the
// store: a tree is a real `phylo/{id}.tree` text file plus a `phylo/{id}.meta.json`
// sidecar (PhyloMeta). This module is the orchestrator over the pure-IO store, it
// owns anything that is not pure file I/O (tip counting on import).
//
// Design: docs/proposals/2026-06-12-phylogenetics-page.md.

import { phyloStore, type RawPhyloFiles } from "./phylo-store";
import { getCurrentUserCached } from "../storage/json-store";
import { countNewickTips } from "./newick";
import type { PhyloMeta } from "./types";

export type { PhyloMeta } from "./types";

export const phyloApi = {
  /** List all trees for the current user (metadata only). */
  list(): Promise<PhyloMeta[]> {
    return phyloStore.listMeta();
  },

  /** List all trees for a specific user. */
  listForUser(username: string): Promise<PhyloMeta[]> {
    return phyloStore.listMetaForUser(username);
  },

  /** List the trees linked to a given project, for the project surface. */
  async listByProject(projectId: string): Promise<PhyloMeta[]> {
    const all = await phyloStore.listMeta();
    return all.filter((m) => m.project_ids.includes(projectId));
  },

  /** Read one tree (sidecar + tree text). */
  get(id: string): Promise<RawPhyloFiles | null> {
    return phyloStore.getRaw(id);
  },

  /**
   * Create a stored tree from raw tree text. Counts tips for the library list
   * (the only non-IO step, so it lives here, not in the SSR-safe store).
   */
  create(
    tree: string,
    meta: Omit<PhyloMeta, "id" | "added_at" | "tip_count"> &
      Partial<Pick<PhyloMeta, "tip_count">>,
  ): Promise<RawPhyloFiles> {
    const tip_count = meta.tip_count ?? countNewickTips(tree);
    return phyloStore.create(tree, {
      ...meta,
      tip_count,
      added_at: new Date().toISOString(),
    });
  },

  /**
   * Save IN PLACE over an existing stored tree: overwrite the tree text and patch
   * the sidecar (name / project_ids / figure / metadata / tip_count). This is what
   * lets re-saving an already-open tree update the record instead of creating a
   * duplicate. The tip_count is recounted from the (possibly edited) tree.
   */
  async update(
    id: string,
    tree: string,
    patch: Partial<Omit<PhyloMeta, "id" | "tip_count">>,
  ): Promise<PhyloMeta | null> {
    const username = await getCurrentUserCached();
    await phyloStore.writeTree(id, tree, username);
    return phyloStore.updateMeta(
      id,
      { ...patch, tip_count: countNewickTips(tree) },
      username,
    );
  },

  /** Patch a tree's sidecar metadata. */
  async updateMeta(
    id: string,
    patch: Partial<Omit<PhyloMeta, "id">>,
  ): Promise<PhyloMeta | null> {
    const username = await getCurrentUserCached();
    return phyloStore.updateMeta(id, patch, username);
  },

  /** Delete a tree (both files). */
  async remove(id: string): Promise<boolean> {
    const username = await getCurrentUserCached();
    return phyloStore.delete(id, username);
  },
};
