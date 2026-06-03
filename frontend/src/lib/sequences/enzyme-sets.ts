// enzyme sets bot — PERSISTENT, USER-NAMED restriction-enzyme sets
// (SnapGene's "Save…" / named "Chosen Enzymes" sets).
//
// The enzyme picker's active set is in-session only. This store gives the user
// a small, durable library of NAMED sets (a set = a name + the list of enzyme
// ids) that is USER-level and reusable across ALL sequences — not per-sequence.
//
// PERSISTENCE: one small per-user JSON sidecar at
//   users/<owner>/_enzyme_sets.json
// read/written through the same `fileService` JSON helpers and the same
// "merge-with-default, normalize on read, serialize writes per user" approach
// as `lib/settings/user-settings.ts`. The enzyme ids are the lowercase keys
// into the bundled SeqViz dataset (see `enzyme-filters.ts`); we do NOT
// reimplement or persist enzyme data, only the chosen key lists.
//
// SCOPE GUARD: this is its OWN user-level sidecar, separate from the on-disk
// sequence shape and from settings.json. It touches nothing in the map/editor
// render, cloning, primers, history, or the import/export flow.

import { fileService } from "../file-system/file-service";

/** One named, persisted enzyme set. */
export interface EnzymeSet {
  /** stable id (used for rename/delete addressing). */
  id: string;
  /** user-facing name. */
  name: string;
  /** lowercase enzyme keys into the bundled dataset (see enzyme-filters.ts). */
  enzymeKeys: string[];
  /** ISO timestamp the set was created. */
  createdAt: string;
  /** ISO timestamp of the last save (create or update). */
  updatedAt: string;
}

/** The on-disk sidecar shape. Versioned so a future migration can grow it
 *  without trashing a user's saved sets. */
export interface EnzymeSetsFile {
  schemaVersion: 1;
  sets: EnzymeSet[];
}

export const DEFAULT_ENZYME_SETS_FILE: EnzymeSetsFile = {
  schemaVersion: 1,
  sets: [],
};

function enzymeSetsPath(username: string): string {
  return `users/${username}/_enzyme_sets.json`;
}

/** Crypto-free, collision-resistant-enough id for a local-first sidecar. */
function makeId(): string {
  return `es_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Normalize an enzyme key list: lowercase, trimmed, de-duplicated, dropping
 *  blanks. Keeps the caller's order otherwise (first-seen wins). */
function normalizeKeys(keys: unknown): string[] {
  if (!Array.isArray(keys)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of keys) {
    if (typeof raw !== "string") continue;
    const k = raw.trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

/** Coerce a single (possibly hand-edited / partial) entry into a valid set, or
 *  null if it has no usable id/name. */
function normalizeSet(raw: Partial<EnzymeSet> | null | undefined): EnzymeSet | null {
  if (!raw || typeof raw !== "object") return null;
  const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : makeId();
  const name =
    typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : "";
  if (!name) return null;
  const now = new Date().toISOString();
  const createdAt =
    typeof raw.createdAt === "string" && raw.createdAt ? raw.createdAt : now;
  const updatedAt =
    typeof raw.updatedAt === "string" && raw.updatedAt ? raw.updatedAt : createdAt;
  return {
    id,
    name,
    enzymeKeys: normalizeKeys(raw.enzymeKeys),
    createdAt,
    updatedAt,
  };
}

/** Merge a (possibly partial / older-schema) payload with the default, drop
 *  malformed entries, and de-duplicate ids (last-write-wins on a dup id). */
function normalizeFile(raw: Partial<EnzymeSetsFile> | null | undefined): EnzymeSetsFile {
  const rawSets = Array.isArray(raw?.sets) ? raw!.sets : [];
  const byId = new Map<string, EnzymeSet>();
  for (const entry of rawSets) {
    const set = normalizeSet(entry);
    if (set) byId.set(set.id, set);
  }
  return { schemaVersion: 1, sets: [...byId.values()] };
}

/** Sets sorted for display: most-recently-updated first. */
function sortForDisplay(sets: EnzymeSet[]): EnzymeSet[] {
  return [...sets].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function readFile(username: string): Promise<EnzymeSetsFile> {
  if (!fileService.isConnected()) return { ...DEFAULT_ENZYME_SETS_FILE, sets: [] };
  const raw = await fileService.readJson<Partial<EnzymeSetsFile>>(
    enzymeSetsPath(username),
  );
  return normalizeFile(raw);
}

async function writeFile(username: string, file: EnzymeSetsFile): Promise<void> {
  if (!fileService.isConnected()) return;
  await fileService.writeJson(enzymeSetsPath(username), normalizeFile(file));
}

// ---------------------------------------------------------------------------
// Per-user write serialization (mirrors user-settings.ts): a read-modify-write
// store needs each mutation to observe the prior one's result, or two writes in
// the same tick clobber each other (a lost update). Reads are NOT queued.
// ---------------------------------------------------------------------------

const writeQueues = new Map<string, Promise<unknown>>();

function enqueue<T>(username: string, task: () => Promise<T>): Promise<T> {
  const prior = writeQueues.get(username) ?? Promise.resolve();
  const run = prior.then(task, task);
  writeQueues.set(username, run);
  void run.then(
    () => {
      if (writeQueues.get(username) === run) writeQueues.delete(username);
    },
    () => {
      if (writeQueues.get(username) === run) writeQueues.delete(username);
    },
  );
  return run;
}

// ── public api (mirrors the local-api list/save/rename/delete style) ─────────

/** List the user's saved enzyme sets, most-recently-updated first. */
export async function listEnzymeSets(username: string): Promise<EnzymeSet[]> {
  const file = await readFile(username);
  return sortForDisplay(file.sets);
}

/**
 * Save the CURRENT active selection under a name. When `id` is provided AND
 * matches an existing set, that set is UPDATED in place (name + keys,
 * preserving createdAt). Otherwise a brand-new set is created. Returns the
 * saved set.
 *
 * Routed through the per-user write queue so a rapid save-then-save composes.
 */
export async function saveEnzymeSet(
  username: string,
  input: { id?: string; name: string; enzymeKeys: string[] },
): Promise<EnzymeSet> {
  const name = input.name.trim();
  if (!name) throw new Error("Enzyme set name is required");
  return enqueue(username, async () => {
    const file = await readFile(username);
    const now = new Date().toISOString();
    const keys = normalizeKeys(input.enzymeKeys);
    const existingIdx =
      input.id != null ? file.sets.findIndex((s) => s.id === input.id) : -1;
    let saved: EnzymeSet;
    if (existingIdx >= 0) {
      const prev = file.sets[existingIdx];
      saved = { ...prev, name, enzymeKeys: keys, updatedAt: now };
      file.sets[existingIdx] = saved;
    } else {
      saved = {
        id: makeId(),
        name,
        enzymeKeys: keys,
        createdAt: now,
        updatedAt: now,
      };
      file.sets.push(saved);
    }
    await writeFile(username, file);
    return saved;
  });
}

/** Rename a saved set. No-op-safe: returns null if the id is unknown. */
export async function renameEnzymeSet(
  username: string,
  id: string,
  name: string,
): Promise<EnzymeSet | null> {
  const nextName = name.trim();
  if (!nextName) throw new Error("Enzyme set name is required");
  return enqueue(username, async () => {
    const file = await readFile(username);
    const idx = file.sets.findIndex((s) => s.id === id);
    if (idx < 0) return null;
    const saved: EnzymeSet = {
      ...file.sets[idx],
      name: nextName,
      updatedAt: new Date().toISOString(),
    };
    file.sets[idx] = saved;
    await writeFile(username, file);
    return saved;
  });
}

/** Delete a saved set. Returns true if a set was removed. */
export async function deleteEnzymeSet(
  username: string,
  id: string,
): Promise<boolean> {
  return enqueue(username, async () => {
    const file = await readFile(username);
    const next = file.sets.filter((s) => s.id !== id);
    const removed = next.length !== file.sets.length;
    if (removed) await writeFile(username, { ...file, sets: next });
    return removed;
  });
}

/** Convenience object mirroring the local-api `*.list/save/...` call style. */
export const enzymeSetsApi = {
  list: listEnzymeSets,
  save: saveEnzymeSet,
  rename: renameEnzymeSet,
  delete: deleteEnzymeSet,
};
