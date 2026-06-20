// REFINEMENT 3 unit tests: the folder-switcher visual key (per-kind color +
// badge), the nickname display-name resolution, and the nickname writer.
//
// folderKindBadge + folderDisplayName are pure, so they are tested directly.
// setRememberedFolderNickname touches the idb-keyval store and a derived account
// scope, so both are mocked here. The scope is forced to null (an unauthenticated
// context), which keys the metas list under the plain FOLDERS_KEY, and idb-keyval
// is backed by an in-memory Map. We assert the writer sets a trimmed nickname,
// clears it on a blank value, and never touches the real folder name.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { folderKindBadge, folderDisplayName } from "./folder-lab-label";

// ── Mocks for the writer test ───────────────────────────────────────────────
const store = new Map<string, unknown>();

vi.mock("idb-keyval", () => ({
  get: vi.fn(async (key: string) => store.get(key)),
  set: vi.fn(async (key: string, value: unknown) => {
    store.set(key, value);
  }),
  del: vi.fn(async (key: string) => {
    store.delete(key);
  }),
  update: vi.fn(),
  createStore: vi.fn(() => ({})),
}));

// Force a null account scope so the metas list is keyed under the plain base key.
vi.mock("./folder-account-scope", () => ({
  getFolderRegistryScope: vi.fn(async () => null),
}));

// The base key the store uses for a null scope (mirrors FOLDERS_KEY in the store).
const FOLDERS_KEY = "research-os-folders";

describe("folderKindBadge (per-kind color + badge)", () => {
  it("maps head to the gold brand-lead 'Lab head'", () => {
    expect(folderKindBadge({ labRole: "head" })).toEqual({
      token: "brand-lead",
      label: "Lab head",
    });
  });

  it("maps member to brand-purple 'Lab member'", () => {
    expect(folderKindBadge({ labRole: "member" })).toEqual({
      token: "brand-purple",
      label: "Lab member",
    });
  });

  it("maps class to the teaching teal 'Instructor'", () => {
    expect(folderKindBadge({ labRole: "class" })).toEqual({
      token: "brand-teach",
      label: "Instructor",
    });
  });

  it("maps student to the rose brand-learn 'Student'", () => {
    expect(folderKindBadge({ labRole: "student" })).toEqual({
      token: "brand-learn",
      label: "Student",
    });
  });

  it("maps solo to neutral ink 'Solo'", () => {
    expect(folderKindBadge({ labRole: "solo" })).toEqual({
      token: "brand-ink",
      label: "Solo",
    });
  });

  it("falls back to neutral ink 'Solo' when the role is absent (legacy row)", () => {
    expect(folderKindBadge({})).toEqual({ token: "brand-ink", label: "Solo" });
  });

  it("assigns five DISTINCT tokens across the five kinds (a real visual key)", () => {
    const tokens = [
      folderKindBadge({ labRole: "solo" }).token,
      folderKindBadge({ labRole: "head" }).token,
      folderKindBadge({ labRole: "member" }).token,
      folderKindBadge({ labRole: "class" }).token,
      folderKindBadge({ labRole: "student" }).token,
    ];
    expect(new Set(tokens).size).toBe(5);
  });
});

describe("folderDisplayName (nickname resolution)", () => {
  it("uses the nickname when one is set", () => {
    expect(
      folderDisplayName({ name: "Lab Data 2026", nickname: "Main lab" }),
    ).toBe("Main lab");
  });

  it("falls back to the real name when no nickname is set", () => {
    expect(folderDisplayName({ name: "Lab Data 2026" })).toBe("Lab Data 2026");
  });

  it("falls back to the real name when the nickname is blank/whitespace", () => {
    expect(folderDisplayName({ name: "Lab Data 2026", nickname: "   " })).toBe(
      "Lab Data 2026",
    );
  });

  it("trims a set nickname", () => {
    expect(
      folderDisplayName({ name: "Lab Data 2026", nickname: "  Teaching  " }),
    ).toBe("Teaching");
  });
});

describe("setRememberedFolderNickname (writer)", () => {
  beforeEach(() => {
    store.clear();
  });

  it("sets a trimmed nickname without touching the real name", async () => {
    const { setRememberedFolderNickname } = await import("./indexeddb-store");
    store.set(FOLDERS_KEY, [
      { id: "a", name: "Real Folder Name", lastOpenedAt: 1 },
      { id: "b", name: "Other", lastOpenedAt: 2 },
    ]);

    await setRememberedFolderNickname("a", "  Main lab  ");

    const metas = store.get(FOLDERS_KEY) as Array<{
      id: string;
      name: string;
      nickname?: string;
    }>;
    const row = metas.find((m) => m.id === "a")!;
    expect(row.name).toBe("Real Folder Name"); // real name preserved
    expect(row.nickname).toBe("Main lab"); // trimmed
    // The untouched row is unchanged.
    expect(metas.find((m) => m.id === "b")!.nickname).toBeUndefined();
  });

  it("clears the nickname (drops the key) on a blank value", async () => {
    const { setRememberedFolderNickname } = await import("./indexeddb-store");
    store.set(FOLDERS_KEY, [
      { id: "a", name: "Real Folder Name", lastOpenedAt: 1, nickname: "Old" },
    ]);

    await setRememberedFolderNickname("a", "   ");

    const metas = store.get(FOLDERS_KEY) as Array<{
      id: string;
      name: string;
      nickname?: string;
    }>;
    const row = metas.find((m) => m.id === "a")!;
    expect(row.name).toBe("Real Folder Name"); // real name preserved
    expect("nickname" in row).toBe(false); // key dropped, not a blank string
  });

  it("is a no-op when the id is unknown", async () => {
    const { setRememberedFolderNickname } = await import("./indexeddb-store");
    const seed = [{ id: "a", name: "Real Folder Name", lastOpenedAt: 1 }];
    store.set(FOLDERS_KEY, seed);

    await setRememberedFolderNickname("missing", "Nope");

    const metas = store.get(FOLDERS_KEY) as Array<{ nickname?: string }>;
    expect(metas[0].nickname).toBeUndefined();
  });
});
