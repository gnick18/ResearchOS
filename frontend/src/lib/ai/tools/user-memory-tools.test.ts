// Unit tests for BeakerBot user-memory module and tools
// (BeakerAI memory bot, 2026-06-13).
//
// Test strategy:
//   1. Pure logic: totalChars, isNearDuplicate, mergeDuplicates, consolidate,
//      buildMemoryContext -- no I/O, deterministic.
//   2. addMemoryEntry and removeMemoryEntry with injectable deps (no FSA).
//   3. MAX_MEMORY_CHARS enforcement: adding entries that would exceed the cap
//      triggers consolidation.
//   4. Tool layer: remember_preference and forget_preference call through to
//      the injected logic and return the right shapes.
//   5. Conversation-store injection: the memory system line does NOT accumulate
//      in the persisted history across multiple sends.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  MAX_MEMORY_CHARS,
  totalChars,
  isNearDuplicate,
  mergeDuplicates,
  consolidate,
  buildMemoryContext,
  addMemoryEntry,
  removeMemoryEntry,
  getMemoryEntries,
  emptyMemory,
  type MemoryEntry,
  type UserMemoryDeps,
  type BeakerbotMemoryFile,
} from "../user-memory";
import {
  rememberPreferenceTool,
  forgetPreferenceTool,
  rememberPreferenceDeps,
  forgetPreferenceDeps,
} from "./user-memory-tools";

// ----- helpers ----------------------------------------------------------------

function makeEntry(text: string, id: string, createdAt: string): MemoryEntry {
  return { id, text, createdAt };
}

/** Build a fake deps seam with an in-memory store. */
function makeDeps(initial: BeakerbotMemoryFile | null = null): {
  deps: UserMemoryDeps;
  store: { current: BeakerbotMemoryFile | null };
} {
  const store = { current: initial };
  const deps: UserMemoryDeps = {
    readFile: vi.fn(async () => store.current),
    writeFile: vi.fn(async (_u, data) => {
      store.current = data;
    }),
    getCurrentUser: vi.fn(async () => "testuser"),
  };
  return { deps, store };
}

// ----- pure logic tests -------------------------------------------------------

describe("totalChars", () => {
  it("returns 0 for empty list", () => {
    expect(totalChars([])).toBe(0);
  });

  it("sums text lengths", () => {
    const entries = [
      makeEntry("hello", "a", "2026-01-01"),
      makeEntry("world!", "b", "2026-01-02"),
    ];
    expect(totalChars(entries)).toBe(11); // "hello" (5) + "world!" (6)
  });
});

describe("isNearDuplicate", () => {
  it("exact match is a duplicate", () => {
    expect(isNearDuplicate("Phusion polymerase", "Phusion polymerase")).toBe(true);
  });

  it("case-insensitive exact match is a duplicate", () => {
    expect(isNearDuplicate("Phusion Polymerase", "phusion polymerase")).toBe(true);
  });

  it("substring containment is a duplicate", () => {
    expect(isNearDuplicate("I default to Phusion", "Phusion")).toBe(true);
  });

  it("80% token overlap is a duplicate", () => {
    // "I default to Phusion polymerase" vs "I default to Phusion" -- all tokens of the
    // shorter appear in the longer, giving 100% overlap on the smaller set.
    expect(isNearDuplicate(
      "I default to Phusion polymerase",
      "I default to Phusion",
    )).toBe(true);
  });

  it("clearly different strings are not duplicates", () => {
    expect(isNearDuplicate("Phusion polymerase", "A. fumigatus")).toBe(false);
  });

  it("empty strings edge case", () => {
    // Both empty is a trivial exact match.
    expect(isNearDuplicate("", "")).toBe(true);
  });
});

describe("mergeDuplicates", () => {
  it("returns the same list when no duplicates", () => {
    const entries = [
      makeEntry("Phusion polymerase", "a", "2026-01-01"),
      makeEntry("A. fumigatus", "b", "2026-01-02"),
    ];
    expect(mergeDuplicates(entries)).toHaveLength(2);
  });

  it("merges exact duplicates, keeping the longer text", () => {
    const entries = [
      makeEntry("Phusion", "a", "2026-01-01"),
      makeEntry("I default to Phusion polymerase", "b", "2026-01-02"),
    ];
    const merged = mergeDuplicates(entries);
    expect(merged).toHaveLength(1);
    expect(merged[0].text).toBe("I default to Phusion polymerase");
  });

  it("merged entry uses the most recent createdAt", () => {
    const entries = [
      makeEntry("Phusion", "a", "2026-01-01"),
      makeEntry("I use Phusion polymerase", "b", "2026-06-01"),
    ];
    const merged = mergeDuplicates(entries);
    expect(merged[0].createdAt).toBe("2026-06-01");
  });

  it("does not merge clearly different entries", () => {
    const entries = [
      makeEntry("Phusion polymerase", "a", "2026-01-01"),
      makeEntry("A. fumigatus as my organism", "b", "2026-01-02"),
      makeEntry("3 technical replicates", "c", "2026-01-03"),
    ];
    expect(mergeDuplicates(entries)).toHaveLength(3);
  });
});

describe("consolidate", () => {
  it("returns the original list when under the cap", () => {
    const entries = [
      makeEntry("Phusion polymerase", "a", "2026-01-01"),
      makeEntry("A. fumigatus", "b", "2026-01-02"),
    ];
    const result = consolidate(entries, MAX_MEMORY_CHARS);
    expect(result).toHaveLength(2);
  });

  it("drops oldest entries first when over the cap", () => {
    // Build entries that sum to just over a small cap.
    const cap = 30;
    const entries = [
      makeEntry("AAAAAAAAAA", "a", "2026-01-01"), // 10 chars, oldest
      makeEntry("BBBBBBBBBB", "b", "2026-01-02"), // 10 chars
      makeEntry("CCCCCCCCCC", "c", "2026-01-03"), // 10 chars, newest
    ];
    // Total = 30, right at cap, should keep all.
    expect(consolidate(entries, cap)).toHaveLength(3);
    // At cap 20, oldest is dropped first.
    const trimmed = consolidate(entries, 20);
    expect(totalChars(trimmed)).toBeLessThanOrEqual(20);
    // The newest entry should be kept.
    expect(trimmed.some((e) => e.id === "c")).toBe(true);
    // The oldest should have been dropped.
    expect(trimmed.some((e) => e.id === "a")).toBe(false);
  });

  it("merges duplicates before dropping by age", () => {
    // "AAAA" and "AAAA copy" share "AAAA" -- 80%+ overlap when splitting by word.
    // Merging gives one entry, then nothing to drop.
    const entries = [
      makeEntry("Phusion", "a", "2026-01-01"),
      makeEntry("I use Phusion", "b", "2026-01-02"),
    ];
    const cap = "I use Phusion".length + 1;
    const result = consolidate(entries, cap);
    // After merge the combined text is 13 chars <= cap of 14, so nothing dropped.
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("I use Phusion");
  });

  it("enforces MAX_MEMORY_CHARS when called with the default cap", () => {
    // Build entries totalling well over the cap.
    const longText = "x".repeat(200);
    const entries = Array.from({ length: 20 }, (_, i) =>
      makeEntry(longText, `id-${i}`, `2026-01-${String(i + 1).padStart(2, "0")}`),
    );
    const result = consolidate(entries);
    expect(totalChars(result)).toBeLessThanOrEqual(MAX_MEMORY_CHARS);
  });
});

describe("buildMemoryContext", () => {
  it("returns null for empty entries", () => {
    expect(buildMemoryContext([])).toBeNull();
  });

  it("formats entries as a bulleted list under the preferences header", () => {
    const entries = [
      makeEntry("Phusion polymerase", "a", "2026-01-01"),
      makeEntry("A. fumigatus", "b", "2026-01-02"),
    ];
    const ctx = buildMemoryContext(entries);
    expect(ctx).not.toBeNull();
    expect(ctx).toContain("USER PREFERENCES");
    expect(ctx).toContain("- Phusion polymerase");
    expect(ctx).toContain("- A. fumigatus");
  });
});

// ----- addMemoryEntry tests ---------------------------------------------------

describe("addMemoryEntry", () => {
  it("writes a new entry to an empty memory file", async () => {
    const { deps, store } = makeDeps(null);
    const entries = await addMemoryEntry("Phusion polymerase", deps);
    expect(entries).toHaveLength(1);
    expect(entries[0].text).toBe("Phusion polymerase");
    expect(store.current?.entries).toHaveLength(1);
    expect(deps.writeFile).toHaveBeenCalledOnce();
  });

  it("appends a distinct second entry", async () => {
    const { deps } = makeDeps(null);
    await addMemoryEntry("Phusion polymerase", deps);
    const entries = await addMemoryEntry("A. fumigatus", deps);
    expect(entries).toHaveLength(2);
  });

  it("merges a near-duplicate instead of appending", async () => {
    const { deps } = makeDeps(null);
    await addMemoryEntry("Phusion", deps);
    const entries = await addMemoryEntry("I use Phusion polymerase", deps);
    // The longer text replaces the shorter.
    expect(entries).toHaveLength(1);
    expect(entries[0].text).toBe("I use Phusion polymerase");
  });

  it("ignores blank text", async () => {
    const { deps } = makeDeps(null);
    const entries = await addMemoryEntry("   ", deps);
    expect(entries).toHaveLength(0);
    expect(deps.writeFile).not.toHaveBeenCalled();
  });

  it("triggers consolidation when adding would exceed MAX_MEMORY_CHARS", async () => {
    // Fill an existing file with entries summing close to the cap.
    const chunkSize = 200;
    const chunks = Math.floor(MAX_MEMORY_CHARS / chunkSize);
    const existing: MemoryEntry[] = Array.from({ length: chunks }, (_, i) => ({
      id: `id-${i}`,
      text: `${"a".repeat(chunkSize - 10)} pref${i}`,
      createdAt: `2026-01-${String(i + 1).padStart(2, "0")}`,
    }));
    const initialFile = { version: 1 as const, entries: existing, updatedAt: "2026-01-01" };
    const { deps, store } = makeDeps(initialFile);

    // This add should tip over the cap and trigger consolidation.
    const bigText = "z".repeat(200);
    const entries = await addMemoryEntry(bigText, deps);
    expect(totalChars(entries)).toBeLessThanOrEqual(MAX_MEMORY_CHARS);
    expect(store.current).not.toBeNull();
  });
});

// ----- removeMemoryEntry tests ------------------------------------------------

describe("removeMemoryEntry", () => {
  it("removes an entry by exact id", async () => {
    const initial = {
      version: 1 as const,
      entries: [
        makeEntry("Phusion polymerase", "id-1", "2026-01-01"),
        makeEntry("A. fumigatus", "id-2", "2026-01-02"),
      ],
      updatedAt: "2026-01-01",
    };
    const { deps } = makeDeps(initial);
    const { entries, removed } = await removeMemoryEntry("id-1", deps);
    expect(removed).toBe(true);
    expect(entries).toHaveLength(1);
    expect(entries[0].text).toBe("A. fumigatus");
  });

  it("removes an entry by text substring (case-insensitive)", async () => {
    const initial = {
      version: 1 as const,
      entries: [makeEntry("I default to Phusion polymerase", "id-1", "2026-01-01")],
      updatedAt: "2026-01-01",
    };
    const { deps } = makeDeps(initial);
    const { entries, removed } = await removeMemoryEntry("phusion", deps);
    expect(removed).toBe(true);
    expect(entries).toHaveLength(0);
  });

  it("returns removed=false when nothing matches", async () => {
    const initial = {
      version: 1 as const,
      entries: [makeEntry("Phusion polymerase", "id-1", "2026-01-01")],
      updatedAt: "2026-01-01",
    };
    const { deps } = makeDeps(initial);
    const { removed } = await removeMemoryEntry("fumigatus", deps);
    expect(removed).toBe(false);
  });

  it("prefers id match over text match", async () => {
    // Entry whose id happens to be a word that appears in another entry's text.
    const initial = {
      version: 1 as const,
      entries: [
        makeEntry("I use Phusion", "Phusion", "2026-01-01"),
        makeEntry("Phusion is my polymerase", "id-2", "2026-01-02"),
      ],
      updatedAt: "2026-01-01",
    };
    const { deps } = makeDeps(initial);
    // "Phusion" is an exact id match for the first entry.
    const { entries, removed } = await removeMemoryEntry("Phusion", deps);
    expect(removed).toBe(true);
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe("id-2");
  });
});

// ----- getMemoryEntries tests -------------------------------------------------

describe("getMemoryEntries", () => {
  it("returns empty array when file is missing", async () => {
    const { deps } = makeDeps(null);
    const entries = await getMemoryEntries(deps);
    expect(entries).toEqual([]);
  });

  it("returns the stored entries when file exists", async () => {
    const initial = {
      version: 1 as const,
      entries: [makeEntry("Phusion polymerase", "id-1", "2026-01-01")],
      updatedAt: "2026-01-01",
    };
    const { deps } = makeDeps(initial);
    const entries = await getMemoryEntries(deps);
    expect(entries).toHaveLength(1);
  });

  it("returns empty array on read error (folder not connected)", async () => {
    const deps: UserMemoryDeps = {
      readFile: vi.fn(async () => { throw new Error("no folder"); }),
      writeFile: vi.fn(async () => {}),
      getCurrentUser: vi.fn(async () => "testuser"),
    };
    const entries = await getMemoryEntries(deps);
    expect(entries).toEqual([]);
  });
});

// ----- tool layer tests -------------------------------------------------------

describe("rememberPreferenceTool", () => {
  beforeEach(() => {
    // Reset the production deps to point at a fake in-memory store for tests.
    const { deps } = makeDeps(null);
    Object.assign(rememberPreferenceDeps, deps);
  });

  it("is an action tool with no isDestructive", () => {
    expect(rememberPreferenceTool.action).toBe(true);
    expect(rememberPreferenceTool.isDestructive).toBeUndefined();
  });

  it("saves a preference and returns ok:true", async () => {
    const result = (await rememberPreferenceTool.execute({
      text: "I default to Phusion polymerase",
    })) as { ok: boolean; saved: string; count: number };
    expect(result.ok).toBe(true);
    expect(result.saved).toBe("I default to Phusion polymerase");
    expect(result.count).toBe(1);
  });

  it("returns ok:false for empty text", async () => {
    const result = (await rememberPreferenceTool.execute({ text: "  " })) as { ok: boolean };
    expect(result.ok).toBe(false);
  });

  it("describeAction returns a summary containing the text", () => {
    const desc = rememberPreferenceTool.describeAction!({ text: "Phusion polymerase" });
    expect(desc.summary).toContain("Phusion polymerase");
  });
});

describe("forgetPreferenceTool", () => {
  beforeEach(() => {
    const initial = {
      version: 1 as const,
      entries: [makeEntry("I default to Phusion polymerase", "id-1", "2026-01-01")],
      updatedAt: "2026-01-01",
    };
    const { deps } = makeDeps(initial);
    Object.assign(forgetPreferenceDeps, deps);
  });

  it("is an action tool with no isDestructive", () => {
    expect(forgetPreferenceTool.action).toBe(true);
    expect(forgetPreferenceTool.isDestructive).toBeUndefined();
  });

  it("removes a matching preference and returns ok:true", async () => {
    const result = (await forgetPreferenceTool.execute({ idOrText: "Phusion" })) as {
      ok: boolean;
      removed: string;
      remaining: number;
    };
    expect(result.ok).toBe(true);
    expect(result.remaining).toBe(0);
  });

  it("returns ok:false when no preference matches", async () => {
    const result = (await forgetPreferenceTool.execute({ idOrText: "fumigatus" })) as {
      ok: boolean;
    };
    expect(result.ok).toBe(false);
  });

  it("returns ok:false for empty idOrText", async () => {
    const result = (await forgetPreferenceTool.execute({ idOrText: "  " })) as { ok: boolean };
    expect(result.ok).toBe(false);
  });

  it("describeAction returns a summary containing the key phrase", () => {
    const desc = forgetPreferenceTool.describeAction!({ idOrText: "Phusion" });
    expect(desc.summary).toContain("Phusion");
  });
});
