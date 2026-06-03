// sequence Phase 1 bot — on-disk store for sequences.
//
// LOCKED on-disk format (proposal, Grant 2026-06-02): each sequence is a PAIR
// of files in the per-user store:
//   users/{username}/sequences/{id}.gb        ← raw GenBank, the SOURCE OF TRUTH
//   users/{username}/sequences/{id}.meta.json ← ResearchOS metadata sidecar
//
// Unlike the other entities (which use JsonStore over a single `{id}.json`
// record), the truth here is the GenBank text and JsonStore is JSON-only, so we
// drive fileService directly. We REUSE the existing primitives, though:
//   - fileService.writeText / writeJson → the atomic `.tmp`+move write path
//   - fileService.readText / readJson / listFiles / deleteFile
//   - the per-user `_counters.json` id allocator (same file other stores bump),
//     so sequence ids never collide with future per-user counters.
//
// DATA-SHAPE FLAGGED: new on-disk shape. Review before merge.

import { fileService } from "../file-system/file-service";
import { getCurrentUserCached } from "../storage/json-store";
import type { SequenceMeta } from "../types";

const ENTITY = "sequences";

function dirPath(username: string): string {
  return `users/${username}/${ENTITY}`;
}
function gbPath(username: string, id: number): string {
  return `${dirPath(username)}/${id}.gb`;
}
function metaPath(username: string, id: number): string {
  return `${dirPath(username)}/${id}.meta.json`;
}

// Allocate the next sequence id from the TARGET user's `_counters.json`. Mirrors
// json-store's `nextIdForUser` (which is module-private there) so sequence ids
// share the same per-user counter space as every other entity.
async function nextSequenceId(username: string): Promise<number> {
  const path = `users/${username}/_counters.json`;
  const counters =
    (await fileService.readJson<Record<string, number>>(path)) ?? {};
  const current = (counters[ENTITY] || 0) + 1;
  counters[ENTITY] = current;
  await fileService.writeJson(path, counters);
  return current;
}

export interface RawSequenceFiles {
  meta: SequenceMeta;
  genbank: string;
}

export const sequenceStore = {
  /** List all sequence sidecars for the current user (no GenBank text loaded). */
  async listMeta(): Promise<SequenceMeta[]> {
    const username = await getCurrentUserCached();
    return sequenceStore.listMetaForUser(username);
  },

  /** List all sequence sidecars for a specific user. */
  async listMetaForUser(username: string): Promise<SequenceMeta[]> {
    const files = await fileService.listFiles(dirPath(username));
    const metas: SequenceMeta[] = [];
    for (const name of files) {
      if (!name.endsWith(".meta.json")) continue;
      const meta = await fileService.readJson<SequenceMeta>(
        `${dirPath(username)}/${name}`,
      );
      if (meta) metas.push(meta);
    }
    return metas.sort((a, b) => a.id - b.id);
  },

  /** Read one sequence's sidecar + GenBank text for a user. */
  async getRawForUser(
    id: number,
    username: string,
  ): Promise<RawSequenceFiles | null> {
    const meta = await fileService.readJson<SequenceMeta>(
      metaPath(username, id),
    );
    if (!meta) return null;
    const genbank = (await fileService.readText(gbPath(username, id))) ?? "";
    return { meta, genbank };
  },

  /** Read one sequence for the current user. */
  async getRaw(id: number): Promise<RawSequenceFiles | null> {
    const username = await getCurrentUserCached();
    return sequenceStore.getRawForUser(id, username);
  },

  /** Write a new sequence pair for the current user, allocating a fresh id. */
  async create(
    genbank: string,
    meta: Omit<SequenceMeta, "id">,
  ): Promise<RawSequenceFiles> {
    const username = await getCurrentUserCached();
    await fileService.ensureDir(dirPath(username));
    const id = await nextSequenceId(username);
    const fullMeta: SequenceMeta = { ...meta, id };
    // Write the GenBank source FIRST, then the sidecar. If a torn write leaves
    // only the .gb behind, listMeta skips it (no sidecar) rather than surfacing
    // a half-record; the next write rotates the stale .gb out by id reuse only
    // after a counter bump, so this is safe.
    await fileService.writeText(gbPath(username, id), genbank);
    await fileService.writeJson(metaPath(username, id), fullMeta);
    return { meta: fullMeta, genbank };
  },

  /** Patch the sidecar metadata for an existing sequence. */
  async updateMeta(
    id: number,
    patch: Partial<Omit<SequenceMeta, "id">>,
    username: string,
  ): Promise<SequenceMeta | null> {
    const existing = await fileService.readJson<SequenceMeta>(
      metaPath(username, id),
    );
    if (!existing) return null;
    const updated: SequenceMeta = { ...existing, ...patch, id };
    await fileService.writeJson(metaPath(username, id), updated);
    return updated;
  },

  /** Replace the GenBank source text for an existing sequence. */
  async writeGenbank(
    id: number,
    genbank: string,
    username: string,
  ): Promise<void> {
    await fileService.writeText(gbPath(username, id), genbank);
  },

  /** Delete both files of a sequence pair. Returns true if the sidecar existed. */
  async delete(id: number, username: string): Promise<boolean> {
    const hadMeta = await fileService.deleteFile(metaPath(username, id));
    await fileService.deleteFile(gbPath(username, id));
    return hadMeta;
  },
};
