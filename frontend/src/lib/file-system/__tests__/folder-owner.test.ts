// Account-centric folder identity, the owner-record helper tests.
//
// The pure helpers (isOwnedBy, isForeignTakeover, adopt/takeover/revert) carry
// the locked decisions D1/D4/D2/D6, so they are tested directly with fixed
// inputs. The read/write wrappers run over an in-memory fileService mock, the
// same faithful pattern as sidecar.test.ts. gitignore is stubbed so writeFolderOwner
// does not touch a real .gitignore.

import { describe, expect, it, vi, beforeEach } from "vitest";

const memFs = new Map<string, unknown>();

vi.mock("../file-service", () => ({
  fileService: {
    readJson: vi.fn(async (path: string) => {
      const v = memFs.get(path);
      return v === undefined ? null : v;
    }),
    writeJson: vi.fn(async (path: string, data: unknown) => {
      memFs.set(path, JSON.parse(JSON.stringify(data)));
    }),
  },
}));

vi.mock("../gitignore", () => ({
  ensureGitignoreEntries: vi.fn(async () => {}),
}));

import {
  type FolderOwnerRecord,
  type TakeoverEvent,
  FOLDER_OWNER_PATH,
  readFolderOwner,
  writeFolderOwner,
  isOwnedBy,
  isForeignTakeover,
  adoptRecord,
  takeoverRecord,
  revertRecord,
  lastTakeover,
  makeTakeoverEventId,
} from "../folder-owner";

const FP_A = "AAAA AAAA AAAA AAAA";
const FP_B = "BBBB BBBB BBBB BBBB";
const FP_C = "CCCC CCCC CCCC CCCC";

function event(over: Partial<TakeoverEvent> = {}): TakeoverEvent {
  return {
    id: "takeover-1",
    at: "2026-06-20T00:00:00.000Z",
    from_fingerprint: FP_A,
    to_fingerprint: FP_B,
    swept_count: 0,
    ...over,
  };
}

describe("folder-owner read/write", () => {
  beforeEach(() => memFs.clear());

  it("round-trips an owner record at the sentinel path", async () => {
    expect(await readFolderOwner()).toBeNull();
    const rec = adoptRecord(FP_A, "a@example.edu");
    await writeFolderOwner(rec);
    expect(memFs.has(FOLDER_OWNER_PATH)).toBe(true);
    expect(await readFolderOwner()).toEqual(rec);
  });
});

describe("isOwnedBy / isForeignTakeover", () => {
  it("absent record is neither owned nor a foreign takeover (D4 adopt)", () => {
    expect(isOwnedBy(null, FP_A)).toBe(false);
    expect(isForeignTakeover(null, FP_A)).toBe(false);
  });

  it("matching fingerprint is owned, not a takeover", () => {
    const rec = adoptRecord(FP_A);
    expect(isOwnedBy(rec, FP_A)).toBe(true);
    expect(isForeignTakeover(rec, FP_A)).toBe(false);
  });

  it("different fingerprint is a foreign takeover, not owned", () => {
    const rec = adoptRecord(FP_A);
    expect(isOwnedBy(rec, FP_B)).toBe(false);
    expect(isForeignTakeover(rec, FP_B)).toBe(true);
  });
});

describe("adoptRecord (D4)", () => {
  it("mints a fresh sole-owner record, email optional", () => {
    expect(adoptRecord(FP_A)).toEqual({ version: 1, owner_fingerprint: FP_A });
    expect(adoptRecord(FP_A, "a@example.edu")).toEqual({
      version: 1,
      owner_fingerprint: FP_A,
      owner_email: "a@example.edu",
    });
  });
});

describe("takeoverRecord (D2)", () => {
  it("rebinds owner, records previous_owner, appends the event", () => {
    const prev = adoptRecord(FP_A, "a@example.edu");
    const ev = event({ from_fingerprint: FP_A, to_fingerprint: FP_B, swept_count: 3 });
    const next = takeoverRecord(prev, FP_B, "b@example.edu", ev);
    expect(next).toEqual({
      version: 1,
      owner_fingerprint: FP_B,
      owner_email: "b@example.edu",
      previous_owner: FP_A,
      takeover_events: [ev],
    });
  });

  it("appends to existing takeover history", () => {
    const first = takeoverRecord(
      adoptRecord(FP_A),
      FP_B,
      undefined,
      event({ from_fingerprint: FP_A, to_fingerprint: FP_B }),
    );
    const second = takeoverRecord(
      first,
      FP_C,
      undefined,
      event({ id: "takeover-2", from_fingerprint: FP_B, to_fingerprint: FP_C }),
    );
    expect(second.owner_fingerprint).toBe(FP_C);
    expect(second.previous_owner).toBe(FP_B);
    expect(second.takeover_events).toHaveLength(2);
  });
});

describe("revertRecord (D6)", () => {
  it("returns null when there is nothing to revert", () => {
    expect(revertRecord(adoptRecord(FP_A))).toBeNull();
  });

  it("hands ownership back to the last from_fingerprint and pops the event", () => {
    const taken = takeoverRecord(
      adoptRecord(FP_A, "a@example.edu"),
      FP_B,
      "b@example.edu",
      event({ from_fingerprint: FP_A, to_fingerprint: FP_B }),
    );
    const reverted = revertRecord(taken);
    expect(reverted).toEqual({ version: 1, owner_fingerprint: FP_A });
  });

  it("after a double takeover, revert restores the prior owner + prior history", () => {
    const first = takeoverRecord(
      adoptRecord(FP_A),
      FP_B,
      undefined,
      event({ id: "t1", from_fingerprint: FP_A, to_fingerprint: FP_B }),
    );
    const second = takeoverRecord(
      first,
      FP_C,
      undefined,
      event({ id: "t2", from_fingerprint: FP_B, to_fingerprint: FP_C }),
    );
    const reverted = revertRecord(second) as FolderOwnerRecord;
    expect(reverted.owner_fingerprint).toBe(FP_B);
    expect(reverted.previous_owner).toBe(FP_A);
    expect(reverted.takeover_events).toHaveLength(1);
    expect(reverted.takeover_events?.[0].id).toBe("t1");
  });
});

describe("lastTakeover", () => {
  it("null for no record / no events, the last event otherwise", () => {
    expect(lastTakeover(null)).toBeNull();
    expect(lastTakeover(adoptRecord(FP_A))).toBeNull();
    const taken = takeoverRecord(
      adoptRecord(FP_A),
      FP_B,
      undefined,
      event({ id: "t9", from_fingerprint: FP_A, to_fingerprint: FP_B }),
    );
    expect(lastTakeover(taken)?.id).toBe("t9");
  });
});

describe("makeTakeoverEventId", () => {
  it("is deterministic for fixed inputs and filesystem-safe", () => {
    const id = makeTakeoverEventId("2026-06-20T00:00:00.000Z", "ab/cd!");
    expect(id).toBe("takeover-20260620T000000000Z-abcd");
    expect(id).not.toMatch(/[^0-9A-Za-z-]/);
  });
});
