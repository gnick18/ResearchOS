// Account-centric folder identity, the foreign-share sweep tests.
//
// The pure predicate isForeignShare carries the exclusion guard (own content,
// absent stamp, is never swept). The sweep + restore round-trip runs the REAL
// trashFile / restoreTrashedFile over an in-memory fileService mock, so a
// takeover sweep is provably recoverable (D6) and restores exactly the swept set.

import { describe, expect, it, vi, beforeEach } from "vitest";

// In-memory file store. Values are stored as parsed objects (json) or strings
// (text); the mock mirrors fileService read/write/list semantics closely enough
// for trashFile/restoreTrashedFile to work end to end.
const memFs = new Map<string, unknown>();

vi.mock("../../file-system/file-service", () => ({
  fileService: {
    readJson: vi.fn(async (path: string) => {
      const v = memFs.get(path);
      return v === undefined ? null : v;
    }),
    writeJson: vi.fn(async (path: string, data: unknown) => {
      memFs.set(path, JSON.parse(JSON.stringify(data)));
    }),
    readText: vi.fn(async (path: string) => {
      const v = memFs.get(path);
      if (v === undefined) return null;
      return typeof v === "string" ? v : JSON.stringify(v);
    }),
    writeText: vi.fn(async (path: string, content: string) => {
      memFs.set(path, content);
    }),
    deleteFile: vi.fn(async (path: string) => memFs.delete(path)),
    listFiles: vi.fn(async (dirPath: string) => {
      const prefix = `${dirPath}/`;
      const names: string[] = [];
      for (const key of memFs.keys()) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        if (rest.includes("/")) continue; // only direct children
        names.push(rest);
      }
      return names.sort();
    }),
  },
}));

import {
  isForeignShare,
  detectForeignShares,
  countForeignShares,
  sweepForeignShares,
  restoreSweptShares,
} from "../foreign-share-sweep";

const ME = "MINE MINE MINE MINE";
const OTHER = "THEM THEM THEM THEM";
const USER = "alex";

describe("isForeignShare (pure predicate)", () => {
  it("own authored content (no stamp) is never foreign", () => {
    expect(isForeignShare({}, ME)).toBe(false);
    expect(isForeignShare(null, ME)).toBe(false);
    expect(isForeignShare(undefined, ME)).toBe(false);
    expect(isForeignShare({ received_from_fingerprint: "" }, ME)).toBe(false);
  });

  it("a record I received from myself is not foreign", () => {
    expect(isForeignShare({ received_from_fingerprint: ME }, ME)).toBe(false);
  });

  it("a record shared in by someone else is foreign", () => {
    expect(isForeignShare({ received_from_fingerprint: OTHER }, ME)).toBe(true);
  });
});

describe("detectForeignShares / countForeignShares", () => {
  beforeEach(() => memFs.clear());

  it("flags only foreign-stamped records across the record dirs", async () => {
    memFs.set(`users/${USER}/notes/1.json`, { received_from_fingerprint: OTHER });
    memFs.set(`users/${USER}/notes/2.json`, { title: "mine, no stamp" });
    memFs.set(`users/${USER}/projects/3.json`, { received_from_fingerprint: ME });
    memFs.set(`users/${USER}/tasks/4.json`, { received_from_fingerprint: OTHER });
    memFs.set(`users/${USER}/sequences/5.meta.json`, { received_from_fingerprint: OTHER });
    // A non-json sibling must be ignored.
    memFs.set(`users/${USER}/sequences/5.gb`, "RAW");

    const refs = await detectForeignShares(USER, ME);
    const paths = refs.map((r) => r.path).sort();
    expect(paths).toEqual([
      `users/${USER}/notes/1.json`,
      `users/${USER}/sequences/5.meta.json`,
      `users/${USER}/tasks/4.json`,
    ]);
    expect(await countForeignShares(USER, ME)).toBe(3);
  });
});

describe("sweep + restore round-trip (D6)", () => {
  beforeEach(() => memFs.clear());

  it("sweeps foreign shares to trash and restores exactly that set", async () => {
    const foreignNote = `users/${USER}/notes/1.json`;
    const foreignTask = `users/${USER}/tasks/4.json`;
    const myNote = `users/${USER}/notes/2.json`;

    memFs.set(foreignNote, { received_from_fingerprint: OTHER, body: "theirs" });
    memFs.set(foreignTask, { received_from_fingerprint: OTHER });
    memFs.set(myNote, { body: "mine" });

    const eventId = "takeover-fixed-1";
    const swept = await sweepForeignShares(USER, ME, eventId);

    expect(swept.sort()).toEqual([foreignNote, foreignTask].sort());
    // Foreign records are gone from their original paths, my note untouched.
    expect(memFs.has(foreignNote)).toBe(false);
    expect(memFs.has(foreignTask)).toBe(false);
    expect(memFs.has(myNote)).toBe(true);
    // They moved to trash under the event id.
    expect(memFs.has(`_trash/migrations/${eventId}/${foreignNote}`)).toBe(true);

    const restored = await restoreSweptShares(eventId);
    expect(restored.sort()).toEqual([foreignNote, foreignTask].sort());
    // Back at their original paths, content preserved. trashFile/restoreTrashedFile
    // move the raw bytes via readText/writeText, so the restored value is the JSON
    // text (which a later readJson re-parses, exactly as the real fileService does).
    expect(memFs.has(foreignNote)).toBe(true);
    const restoredVal = memFs.get(foreignNote);
    const restoredObj =
      typeof restoredVal === "string"
        ? (JSON.parse(restoredVal) as { body: string })
        : (restoredVal as { body: string });
    expect(restoredObj.body).toBe("theirs");
    // Trash copies cleaned up.
    expect(memFs.has(`_trash/migrations/${eventId}/${foreignNote}`)).toBe(false);
  });

  it("a second restore of the same event is a no-op", async () => {
    memFs.set(`users/${USER}/notes/1.json`, { received_from_fingerprint: OTHER });
    const eventId = "takeover-fixed-2";
    await sweepForeignShares(USER, ME, eventId);
    expect((await restoreSweptShares(eventId)).length).toBe(1);
    expect(await restoreSweptShares(eventId)).toEqual([]);
  });

  it("prunes dangling _shared_with_me entries that point at swept records", async () => {
    const foreignNote = `users/${USER}/notes/1.json`;
    memFs.set(foreignNote, { received_from_fingerprint: OTHER });
    memFs.set(`users/${USER}/_shared_with_me.json`, [
      { ref: foreignNote, from: "them" },
      { ref: `users/${USER}/notes/99.json`, from: "kept" },
    ]);

    await sweepForeignShares(USER, ME, "takeover-fixed-3");

    const inbox = memFs.get(`users/${USER}/_shared_with_me.json`) as Array<{ from: string }>;
    expect(inbox).toHaveLength(1);
    expect(inbox[0].from).toBe("kept");
  });
});
