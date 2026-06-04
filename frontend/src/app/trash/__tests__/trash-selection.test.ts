import { describe, expect, it } from "vitest";
import type { TrashEntityType, TrashIndexEntry } from "@/lib/trash";
import {
  selectionKey,
  entryKey,
  toggleKey,
  addKeys,
  removeKeys,
  sectionSelectState,
  toggleSection,
  pruneSelection,
  selectedEntries,
} from "../trash-selection";

function entry(
  entity_type: TrashEntityType,
  id: string | number,
): TrashIndexEntry {
  return {
    id,
    entity_type,
    trash_path: `_trash/${entity_type}/${id}-x.json`,
    original_path: `${entity_type}/${id}.json`,
    deleted_at: "2026-06-01T00:00:00.000Z",
    deleted_by: "tester",
    auto_expires_at: "2026-07-01T00:00:00.000Z",
  };
}

describe("trash-selection composite keys", () => {
  it("namespaces ids by entity type so collisions stay distinct", () => {
    // Same numeric id, different type -> different keys.
    const noteKey = selectionKey("note", 7);
    const taskKey = selectionKey("task", 7);
    expect(noteKey).toBe("note:7");
    expect(taskKey).toBe("task:7");
    expect(noteKey).not.toBe(taskKey);
    expect(entryKey(entry("note", 7))).toBe(noteKey);
  });
});

describe("toggleKey", () => {
  it("adds when absent and removes when present, returning a new set", () => {
    const empty = new Set<string>();
    const added = toggleKey(empty, "note:1");
    expect(added.has("note:1")).toBe(true);
    expect(empty.has("note:1")).toBe(false); // original untouched

    const removed = toggleKey(added, "note:1");
    expect(removed.has("note:1")).toBe(false);
    expect(added.has("note:1")).toBe(true);
  });
});

describe("addKeys / removeKeys", () => {
  it("bulk-adds and bulk-removes without mutating the input", () => {
    const base = new Set<string>(["note:1"]);
    const added = addKeys(base, ["task:1", "note:1"]);
    expect([...added].sort()).toEqual(["note:1", "task:1"]);
    expect(base.size).toBe(1);

    const removed = removeKeys(added, ["note:1"]);
    expect([...removed]).toEqual(["task:1"]);
  });
});

describe("sectionSelectState + toggleSection (per-section select-all)", () => {
  const section = [entry("sequence", 1), entry("sequence", 2), entry("sequence", 3)];

  it("reads none / some / all from the selection", () => {
    expect(sectionSelectState(new Set(), section)).toBe("none");
    expect(sectionSelectState(new Set(["sequence:1"]), section)).toBe("some");
    expect(
      sectionSelectState(
        new Set(["sequence:1", "sequence:2", "sequence:3"]),
        section,
      ),
    ).toBe("all");
    expect(sectionSelectState(new Set(), [])).toBe("none");
  });

  it("selects every row when not fully selected", () => {
    const next = toggleSection(new Set(["sequence:1"]), section);
    expect(sectionSelectState(next, section)).toBe("all");
  });

  it("clears the section when already fully selected", () => {
    const full = new Set(["sequence:1", "sequence:2", "sequence:3"]);
    const next = toggleSection(full, section);
    expect(sectionSelectState(next, section)).toBe("none");
  });

  it("only touches keys in the given section, leaving others intact", () => {
    const mixed = new Set(["note:9", "sequence:1"]);
    const next = toggleSection(mixed, section);
    expect(next.has("note:9")).toBe(true); // unrelated key preserved
    expect(sectionSelectState(next, section)).toBe("all");
  });
});

describe("pruneSelection", () => {
  it("drops keys whose row no longer exists", () => {
    const live = [entry("note", 1), entry("note", 2)];
    const next = pruneSelection(new Set(["note:1", "note:99"]), live);
    expect([...next]).toEqual(["note:1"]);
  });

  it("returns the same set untouched when nothing is selected", () => {
    const empty = new Set<string>();
    expect(pruneSelection(empty, [entry("note", 1)])).toBe(empty);
  });
});

describe("selectedEntries", () => {
  it("resolves keys back to entries in list order", () => {
    const all = [entry("note", 1), entry("task", 1), entry("note", 2)];
    const picked = selectedEntries(new Set(["note:2", "task:1"]), all);
    expect(picked.map(entryKey)).toEqual(["task:1", "note:2"]);
  });

  it("drives a bulk loop that hits each selected entry exactly once", () => {
    const all = [entry("note", 1), entry("note", 2), entry("task", 5)];
    const selected = new Set(["note:1", "task:5"]);
    const calls: string[] = [];
    // Mirrors the page's bulk loop: iterate selectedEntries, act once each.
    for (const e of selectedEntries(selected, all)) {
      calls.push(entryKey(e));
    }
    expect(calls).toEqual(["note:1", "task:5"]);
    expect(calls).toHaveLength(selected.size);
  });
});
