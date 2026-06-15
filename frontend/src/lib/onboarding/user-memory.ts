// Per-user BeakerBot memory (pure model + operations).
//
// The outward mirror of the orchestrator's own memory, turned toward the end
// user. A small private document BeakerBot keeps FOR each user and reads into
// context each chat, so it personalizes across sessions. Locked invariants
// (Grant 2026-06-14, docs/proposals/2026-06-14-llm-onboarding-tutor.md):
//   - Per-user, NEVER shared, even inside a shared lab folder.
//   - Follows the USER, not the folder (the persistence layer puts it in the
//     account vault, this module is storage-agnostic).
//   - Size-capped and prompt-cached so per-turn cost stays flat.
//   - Propose-then-confirm writes only (the caller gates), never silent.
//
// This module is PURE: the model + operations, no persistence and no clock. The
// caller supplies id + createdAt so it stays deterministic and testable. No
// emojis, no em-dashes, no mid-sentence colons.

export type MemorySource = "user" | "onboarding" | "beakerbot";

export interface MemoryEntry {
  id: string;
  text: string;
  createdAt: number;
  source: MemorySource;
}

export interface UserMemory {
  entries: MemoryEntry[];
}

export const emptyUserMemory: UserMemory = { entries: [] };

// Caps keep the memory bounded so the system-prompt cost stays flat. Newest
// entries win when a cap is hit.
export const MAX_ENTRIES = 100;
export const MAX_CHARS = 8000;

function trimToCaps(entries: MemoryEntry[]): MemoryEntry[] {
  // Keep newest first, then drop the oldest until under both caps.
  const sorted = [...entries].sort((a, b) => b.createdAt - a.createdAt);
  const capped = sorted.slice(0, MAX_ENTRIES);
  const kept: MemoryEntry[] = [];
  let chars = 0;
  for (const e of capped) {
    chars += e.text.length + 1;
    if (chars > MAX_CHARS) break;
    kept.push(e);
  }
  return kept;
}

/** Normalize for dedup (whitespace + case insensitive). */
function norm(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

export interface AddArgs {
  text: string;
  source: MemorySource;
  id: string;
  createdAt: number;
}

/** Add an entry. Ignores blank text and exact duplicates (by normalized text),
 *  then enforces the caps (newest kept). Returns a new UserMemory. */
export function addEntry(mem: UserMemory, args: AddArgs): UserMemory {
  const text = args.text.trim();
  if (!text) return mem;
  const key = norm(text);
  if (mem.entries.some((e) => norm(e.text) === key)) return mem;
  const entries = trimToCaps([
    ...mem.entries,
    { id: args.id, text, source: args.source, createdAt: args.createdAt },
  ]);
  return { entries };
}

export function removeEntry(mem: UserMemory, id: string): UserMemory {
  return { entries: mem.entries.filter((e) => e.id !== id) };
}

export function clearMemory(): UserMemory {
  return { entries: [] };
}

/** Render the memory as a bounded block for the system prompt, newest first.
 *  Returns "" when empty so the caller can omit the section entirely. */
export function formatForPrompt(mem: UserMemory): string {
  if (mem.entries.length === 0) return "";
  const lines = trimToCaps(mem.entries).map((e) => `- ${e.text}`);
  return [
    "What you remember about this user (private to them, never shared):",
    ...lines,
  ].join("\n");
}
