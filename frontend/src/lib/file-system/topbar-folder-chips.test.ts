import { describe, it, expect } from "vitest";
import {
  selectTopBarChips,
  MAX_CHIPS,
  type ChipFolder,
} from "./topbar-folder-chips";

function f(id: string, pinned = false): ChipFolder {
  return { id, name: id, pinned };
}

describe("selectTopBarChips", () => {
  it("shows every folder and no overflow when at or under the cap", () => {
    const folders = [f("a"), f("b"), f("c")];
    const r = selectTopBarChips(folders, "a");
    expect(r.chips.map((c) => c.id)).toEqual(["a", "b", "c"]);
    expect(r.showOverflow).toBe(false);
  });

  it("shows a single folder with no overflow", () => {
    const r = selectTopBarChips([f("a")], "a");
    expect(r.chips.map((c) => c.id)).toEqual(["a"]);
    expect(r.showOverflow).toBe(false);
  });

  it("shows pinned chips and an overflow caret when over the cap", () => {
    const folders = [f("a", true), f("b", true), f("c"), f("d")];
    // active is a pinned one
    const r = selectTopBarChips(folders, "a");
    expect(r.chips.map((c) => c.id)).toEqual(["a", "b"]);
    expect(r.showOverflow).toBe(true);
  });

  it("force-includes the active folder when it is not pinned (room to append)", () => {
    const folders = [f("a", true), f("b", true), f("c"), f("d")];
    const r = selectTopBarChips(folders, "c");
    // a + b pinned, c appended (3 slots), overflow for d
    expect(r.chips.map((c) => c.id)).toEqual(["a", "b", "c"]);
    expect(r.showOverflow).toBe(true);
    expect(r.chips.length).toBeLessThanOrEqual(MAX_CHIPS);
  });

  it("drops the last pinned chip to make room for an unpinned active folder", () => {
    const folders = [
      f("a", true),
      f("b", true),
      f("c", true),
      f("d"),
      f("e"),
    ];
    const r = selectTopBarChips(folders, "e");
    // three pinned would fill all slots; drop the last (c) so active e fits
    expect(r.chips.map((c) => c.id)).toEqual(["a", "b", "e"]);
    expect(r.chips.length).toBe(MAX_CHIPS);
    expect(r.showOverflow).toBe(true);
  });

  it("shows only the active chip when nothing is pinned and over the cap", () => {
    const folders = [f("a"), f("b"), f("c"), f("d")];
    const r = selectTopBarChips(folders, "b");
    expect(r.chips.map((c) => c.id)).toEqual(["b"]);
    expect(r.showOverflow).toBe(true);
  });

  it("shows no chips (just the caret) when nothing pinned and no active match", () => {
    const folders = [f("a"), f("b"), f("c"), f("d")];
    const r = selectTopBarChips(folders, null);
    expect(r.chips).toEqual([]);
    expect(r.showOverflow).toBe(true);
  });

  it("never exceeds MAX_CHIPS even with more pinned than the cap", () => {
    const folders = [
      f("a", true),
      f("b", true),
      f("c", true),
      f("d", true),
      f("e"),
    ];
    const r = selectTopBarChips(folders, "a");
    expect(r.chips.length).toBe(MAX_CHIPS);
    expect(r.chips.map((c) => c.id)).toEqual(["a", "b", "c"]);
    expect(r.showOverflow).toBe(true);
  });
});
