// Chemistry-workbench Phase 1 — on-disk store for molecules.
//
// LOCKED on-disk format (proposal, Grant 2026-06-10): each molecule is a PAIR of
// files in the per-user store:
//   users/{username}/molecules/{id}.mol        ← MDL Molfile, the SOURCE OF TRUTH
//                                                 (keeps the 2D drawing coords so
//                                                 the editor reopens it faithfully)
//   users/{username}/molecules/{id}.meta.json  ← MoleculeMeta sidecar (name,
//                                                 project_ids, RDKit identity)
//
// This mirrors sequence-store.ts exactly: the truth is a non-JSON text file
// (Molfile here, GenBank there) so we drive fileService directly rather than
// JsonStore, and we REUSE the existing primitives:
//   - fileService.writeText / writeJson → the atomic `.tmp`+move write path
//   - fileService.readText / readJson / listFiles / deleteFile / ensureDir
//   - the per-user `_counters.json` id allocator (same file every other store
//     bumps), so molecule ids never collide with other per-user counters.
//
// Ids are stringified counter integers ("14"), so MoleculeMeta.id stays the
// locked `string` from api.ts while sharing the codebase-wide per-user counter
// space. The store is pure file I/O; RDKit identity is computed one layer up in
// moleculesApi (RDKit is browser-only), so the store stays SSR-safe and testable.
//
// DATA-SHAPE FLAGGED: new on-disk shape. Review before merge.

import { fileService } from "../file-system/file-service";
import { getCurrentUserCached } from "../storage/json-store";
import type { MoleculeMeta } from "./api";

const ENTITY = "molecules";

function dirPath(username: string): string {
  return `users/${username}/${ENTITY}`;
}
function molPath(username: string, id: string): string {
  return `${dirPath(username)}/${id}.mol`;
}
function metaPath(username: string, id: string): string {
  return `${dirPath(username)}/${id}.meta.json`;
}

// Allocate the next molecule id from the TARGET user's `_counters.json`. Mirrors
// sequence-store's `nextSequenceId` so molecule ids share the same per-user
// counter space as every other entity. Returns a stringified integer.
async function nextMoleculeId(username: string): Promise<string> {
  const path = `users/${username}/_counters.json`;
  const counters =
    (await fileService.readJson<Record<string, number>>(path)) ?? {};
  const current = (counters[ENTITY] || 0) + 1;
  counters[ENTITY] = current;
  await fileService.writeJson(path, counters);
  return String(current);
}

export interface RawMoleculeFiles {
  meta: MoleculeMeta;
  /** The MDL Molfile text (2D coordinates preserved). */
  molfile: string;
}

export const moleculeStore = {
  /** List all molecule sidecars for the current user (no Molfile loaded). */
  async listMeta(): Promise<MoleculeMeta[]> {
    const username = await getCurrentUserCached();
    return moleculeStore.listMetaForUser(username);
  },

  /** List all molecule sidecars for a specific user. */
  async listMetaForUser(username: string): Promise<MoleculeMeta[]> {
    const files = await fileService.listFiles(dirPath(username));
    const metas: MoleculeMeta[] = [];
    for (const name of files) {
      if (!name.endsWith(".meta.json")) continue;
      const meta = await fileService.readJson<MoleculeMeta>(
        `${dirPath(username)}/${name}`,
      );
      if (meta) metas.push(meta);
    }
    // Newest first (numeric id), so the library shows recent work at the top.
    return metas.sort((a, b) => Number(b.id) - Number(a.id));
  },

  /** Read one molecule's sidecar + Molfile text for a user. */
  async getRawForUser(
    id: string,
    username: string,
  ): Promise<RawMoleculeFiles | null> {
    const meta = await fileService.readJson<MoleculeMeta>(
      metaPath(username, id),
    );
    if (!meta) return null;
    const molfile = (await fileService.readText(molPath(username, id))) ?? "";
    return { meta, molfile };
  },

  /** Read one molecule for the current user. */
  async getRaw(id: string): Promise<RawMoleculeFiles | null> {
    const username = await getCurrentUserCached();
    return moleculeStore.getRawForUser(id, username);
  },

  /** Write a new molecule pair for the current user, allocating a fresh id. */
  async create(
    molfile: string,
    meta: Omit<MoleculeMeta, "id">,
  ): Promise<RawMoleculeFiles> {
    const username = await getCurrentUserCached();
    await fileService.ensureDir(dirPath(username));
    const id = await nextMoleculeId(username);
    const fullMeta: MoleculeMeta = { ...meta, id };
    // Write the Molfile source FIRST, then the sidecar. If a torn write leaves
    // only the .mol behind, listMeta skips it (no sidecar) rather than surfacing
    // a half-record, the same crash-safety order sequence-store uses.
    await fileService.writeText(molPath(username, id), molfile);
    await fileService.writeJson(metaPath(username, id), fullMeta);
    return { meta: fullMeta, molfile };
  },

  /** Patch the sidecar metadata for an existing molecule. */
  async updateMeta(
    id: string,
    patch: Partial<Omit<MoleculeMeta, "id">>,
    username: string,
  ): Promise<MoleculeMeta | null> {
    const existing = await fileService.readJson<MoleculeMeta>(
      metaPath(username, id),
    );
    if (!existing) return null;
    const updated: MoleculeMeta = { ...existing, ...patch, id };
    await fileService.writeJson(metaPath(username, id), updated);
    return updated;
  },

  /** Replace the Molfile source text for an existing molecule. */
  async writeMolfile(
    id: string,
    molfile: string,
    username: string,
  ): Promise<void> {
    await fileService.writeText(molPath(username, id), molfile);
  },

  /** Delete both files of a molecule pair. Returns true if the sidecar existed. */
  async delete(id: string, username: string): Promise<boolean> {
    const hadMeta = await fileService.deleteFile(metaPath(username, id));
    await fileService.deleteFile(molPath(username, id));
    return hadMeta;
  },
};
