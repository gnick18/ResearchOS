// user-palettes round-trip (jsdom, so window.localStorage exists). Covers the
// new rename helper alongside add / remove so a saved palette can be named,
// renamed, and deleted without losing the rest of the set. No em-dashes, no
// emojis, no mid-sentence colons.

import { beforeEach, describe, expect, it } from "vitest";
import {
  addUserPalette,
  removeUserPalette,
  renameUserPalette,
  loadUserPalettes,
  newUserPaletteId,
} from "@/lib/datahub/user-palettes";
import type { Palette } from "@/lib/datahub/palettes";

function makePalette(name: string): Palette {
  return {
    id: newUserPaletteId(),
    name,
    category: "qualitative",
    cbSafe: false,
    printSafe: false,
    colors: ["#264653", "#2a9d8f", "#e9c46a"],
  };
}

describe("user-palettes rename", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("renames a saved palette in place and leaves the rest untouched", () => {
    const a = makePalette("My palette");
    const b = makePalette("Lab house");
    addUserPalette(a);
    addUserPalette(b);

    const after = renameUserPalette(a.id, "Figure 2 colors");

    expect(after.find((p) => p.id === a.id)?.name).toBe("Figure 2 colors");
    expect(after.find((p) => p.id === b.id)?.name).toBe("Lab house");
    // The colors and other fields survive the rename.
    expect(after.find((p) => p.id === a.id)?.colors).toEqual(a.colors);
    // The rename persisted to storage.
    expect(loadUserPalettes().find((p) => p.id === a.id)?.name).toBe(
      "Figure 2 colors",
    );
  });

  it("is a safe no-op when the id is not found", () => {
    const a = makePalette("My palette");
    addUserPalette(a);
    const after = renameUserPalette("does-not-exist", "Nope");
    expect(after).toHaveLength(1);
    expect(after[0].name).toBe("My palette");
  });

  it("still supports add then remove after a rename", () => {
    const a = makePalette("My palette");
    addUserPalette(a);
    renameUserPalette(a.id, "Renamed");
    const after = removeUserPalette(a.id);
    expect(after).toHaveLength(0);
  });
});
