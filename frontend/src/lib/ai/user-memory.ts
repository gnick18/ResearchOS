// BeakerBot per-user persistent memory (BeakerAI memory bot, 2026-06-13).
//
// Stores a small set of standing user preferences across BeakerBot chats.
// Examples: "I default to Phusion polymerase", "A. fumigatus is my main organism",
// "I always use 3 technical replicates". These are injected into every chat turn
// as a brief system note so BeakerBot can apply them without the user repeating
// themselves.
//
// Storage format at users/<username>/_beakerbot_memory.json:
//   { version: 1, entries: [ { id, text, createdAt } ], updatedAt }
//
// The file is bounded to MAX_MEMORY_CHARS combined entry text. When a new entry
// would push the combined text over the cap, consolidation runs first: near-
// duplicate entries are merged, then the oldest least-useful are dropped until
// there is room. The injected context line is therefore always within the cap.
//
// An injectable file-deps seam keeps all I/O out of the pure logic so the add /
// remove / consolidate functions are unit-testable without a real folder.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { fileService } from "@/lib/file-system/file-service";
import { getCurrentUserCached } from "@/lib/storage/json-store";

// The combined entry-text cap. 3500 characters keeps the injected context well
// under one typical system-message budget while still holding several dozen
// medium-length preferences.
export const MAX_MEMORY_CHARS = 3500;

// One preference entry persisted in the memory file.
export type MemoryEntry = {
  id: string;
  text: string;
  createdAt: string;
};

// The full on-disk shape.
export type BeakerbotMemoryFile = {
  version: 1;
  entries: MemoryEntry[];
  updatedAt: string;
};

// The injectable seam so pure logic is testable without the real FSA.
export type UserMemoryDeps = {
  readFile: (username: string) => Promise<BeakerbotMemoryFile | null>;
  writeFile: (username: string, data: BeakerbotMemoryFile) => Promise<void>;
  getCurrentUser: () => Promise<string>;
};

function memoryPath(username: string): string {
  return `users/${username}/_beakerbot_memory.json`;
}

// Production deps wired to fileService.
export const userMemoryDeps: UserMemoryDeps = {
  readFile: async (username) => {
    const data = await fileService.readJson<Partial<BeakerbotMemoryFile>>(
      memoryPath(username),
    );
    if (!data || !Array.isArray(data.entries)) return null;
    return {
      version: 1,
      entries: data.entries,
      updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : new Date().toISOString(),
    };
  },
  writeFile: async (username, data) => {
    await fileService.writeJson(memoryPath(username), data);
  },
  getCurrentUser: getCurrentUserCached,
};

// ----- Pure logic (no I/O, fully unit-testable) --------------------------------

/** Total combined char count of all entry texts. */
export function totalChars(entries: MemoryEntry[]): number {
  return entries.reduce((sum, e) => sum + e.text.length, 0);
}

/** Return a fresh empty memory file. */
export function emptyMemory(): BeakerbotMemoryFile {
  return { version: 1, entries: [], updatedAt: new Date().toISOString() };
}

/**
 * Decide whether two entry texts are near-duplicates. The heuristic is simple
 * on purpose: if one entry is a substring of the other (ignoring case and
 * leading/trailing whitespace), the shorter one adds no new information. Two
 * entries that share at least 80% of tokens (split on whitespace) also merge.
 * This keeps the logic deterministic and avoids any LLM call.
 */
export function isNearDuplicate(a: string, b: string): boolean {
  const na = a.trim().toLowerCase();
  const nb = b.trim().toLowerCase();
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  // Token-overlap heuristic.
  const ta = new Set(na.split(/\s+/).filter(Boolean));
  const tb = new Set(nb.split(/\s+/).filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return false;
  let shared = 0;
  for (const tok of ta) {
    if (tb.has(tok)) shared++;
  }
  const overlap = shared / Math.min(ta.size, tb.size);
  return overlap >= 0.8;
}

/**
 * Merge near-duplicate entries, keeping the longer (more specific) text and
 * the most recent createdAt. Runs pairwise over the list, so the result is
 * stable and deterministic. Pure, no I/O.
 */
export function mergeDuplicates(entries: MemoryEntry[]): MemoryEntry[] {
  const kept: MemoryEntry[] = [];
  for (const entry of entries) {
    let merged = false;
    for (let i = 0; i < kept.length; i++) {
      if (isNearDuplicate(entry.text, kept[i].text)) {
        // Keep the longer text and the most recent createdAt.
        const longer =
          entry.text.length >= kept[i].text.length ? entry : kept[i];
        const newer =
          entry.createdAt >= kept[i].createdAt ? entry.createdAt : kept[i].createdAt;
        kept[i] = { ...longer, createdAt: newer };
        merged = true;
        break;
      }
    }
    if (!merged) kept.push(entry);
  }
  return kept;
}

/**
 * Consolidate entries so their combined text fits within `cap` chars. Runs
 * mergeDuplicates first, then drops the oldest entries (smallest createdAt)
 * until the total fits. Returns the trimmed list. Pure, no I/O.
 */
export function consolidate(entries: MemoryEntry[], cap: number = MAX_MEMORY_CHARS): MemoryEntry[] {
  let list = mergeDuplicates(entries);
  if (totalChars(list) <= cap) return list;
  // Sort oldest-first for dropping.
  list = [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  while (list.length > 0 && totalChars(list) > cap) {
    list.shift();
  }
  return list;
}

/**
 * Build the context string injected into each BeakerBot turn. Returns null when
 * there are no entries (nothing to inject). Capped to MAX_MEMORY_CHARS by the
 * consolidation that happens at write time, so this is always within budget.
 */
export function buildMemoryContext(entries: MemoryEntry[]): string | null {
  if (entries.length === 0) return null;
  const lines = entries.map((e) => `- ${e.text}`).join("\n");
  return `USER PREFERENCES (apply these by default, do not repeat them back unless asked):\n${lines}`;
}

// ----- I/O helpers (use the injectable deps) ----------------------------------

async function readMemory(
  deps: UserMemoryDeps,
): Promise<BeakerbotMemoryFile> {
  const username = await deps.getCurrentUser();
  const stored = await deps.readFile(username);
  return stored ?? emptyMemory();
}

async function writeMemory(
  deps: UserMemoryDeps,
  data: BeakerbotMemoryFile,
): Promise<void> {
  const username = await deps.getCurrentUser();
  const now = new Date().toISOString();
  await deps.writeFile(username, { ...data, updatedAt: now });
}

// ----- Public API ------------------------------------------------------------

/**
 * Add a preference entry to the user's memory file. If the combined text would
 * exceed MAX_MEMORY_CHARS after the add, consolidation runs first to make room.
 * If the new text is a near-duplicate of an existing entry, it replaces that
 * entry. Returns the updated entry list.
 */
export async function addMemoryEntry(
  text: string,
  deps: UserMemoryDeps = userMemoryDeps,
): Promise<MemoryEntry[]> {
  const trimmed = text.trim();
  if (!trimmed) return (await readMemory(deps)).entries;

  const memory = await readMemory(deps);
  const id = `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const newEntry: MemoryEntry = {
    id,
    text: trimmed,
    createdAt: new Date().toISOString(),
  };

  // Merge with the new entry, then consolidate if needed.
  let entries = mergeDuplicates([...memory.entries, newEntry]);
  if (totalChars(entries) > MAX_MEMORY_CHARS) {
    entries = consolidate(entries);
  }

  await writeMemory(deps, { ...memory, entries });
  return entries;
}

/**
 * Remove a preference entry by its id or by matching its text (case-insensitive
 * substring). If idOrText matches an id exactly, that entry is removed. If no id
 * matches, the first entry whose text contains idOrText (case-insensitive) is
 * removed. Returns the updated entry list.
 */
export async function removeMemoryEntry(
  idOrText: string,
  deps: UserMemoryDeps = userMemoryDeps,
): Promise<{ entries: MemoryEntry[]; removed: boolean }> {
  const memory = await readMemory(deps);
  const needle = idOrText.trim();

  // Try exact id match first.
  let idx = memory.entries.findIndex((e) => e.id === needle);
  if (idx === -1) {
    // Fall back to case-insensitive text substring.
    const lower = needle.toLowerCase();
    idx = memory.entries.findIndex((e) => e.text.toLowerCase().includes(lower));
  }

  if (idx === -1) {
    return { entries: memory.entries, removed: false };
  }

  const entries = [...memory.entries.slice(0, idx), ...memory.entries.slice(idx + 1)];
  await writeMemory(deps, { ...memory, entries });
  return { entries, removed: true };
}

/**
 * Read all current memory entries. Used by the context injector on each turn.
 * Returns an empty array when no memory file exists or the folder is not
 * connected.
 */
export async function getMemoryEntries(
  deps: UserMemoryDeps = userMemoryDeps,
): Promise<MemoryEntry[]> {
  try {
    const memory = await readMemory(deps);
    return memory.entries;
  } catch {
    return [];
  }
}
