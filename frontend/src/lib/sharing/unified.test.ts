// Lab Mode retirement R1 (R1 unified sharing manager, 2026-05-23):
// truth-table tests for the unified sharing primitive. Covers:
//
//   - canRead under owner / lab_head / "*" sentinel / explicit entry
//   - canWrite under owner / lab_head role-based / shared edit
//   - expandSharedWith resolves "*" to current lab members
//   - normalizeSharedWith handles legacy `permission` → `level` mapping
//   - "*" + explicit entry: highest level wins on collision

import { describe, expect, it } from "vitest";
import {
  canRead,
  canWrite,
  expandSharedWith,
  normalizeSharedEntry,
  normalizeSharedWith,
  upsertSharedEntry,
  removeSharedEntry,
  isWholeLabShared,
  WHOLE_LAB_SENTINEL,
  type Viewer,
  type ShareableRecord,
} from "./unified";

const alex: Viewer = { username: "alex", account_type: "lab" };
const morgan: Viewer = { username: "morgan", account_type: "lab" };
const mira: Viewer = { username: "mira", account_type: "lab_head" };

function rec(
  owner: string,
  shared_with: ShareableRecord["shared_with"],
): ShareableRecord {
  return { owner, shared_with };
}

describe("canRead", () => {
  it("owner always reads", () => {
    expect(canRead(rec("alex", []), alex)).toBe(true);
  });
  it("lab_head always reads", () => {
    expect(canRead(rec("alex", []), mira)).toBe(true);
  });
  it("non-owner non-lab-head with empty shared_with cannot read", () => {
    expect(canRead(rec("alex", []), morgan)).toBe(false);
  });
  it("explicit entry grants read", () => {
    expect(
      canRead(rec("alex", [{ username: "morgan", level: "read" }]), morgan),
    ).toBe(true);
  });
  it('"*" sentinel grants read to everyone', () => {
    expect(
      canRead(rec("alex", [{ username: "*", level: "read" }]), morgan),
    ).toBe(true);
  });
  it("explicit edit entry grants read too", () => {
    expect(
      canRead(rec("alex", [{ username: "morgan", level: "edit" }]), morgan),
    ).toBe(true);
  });
  it("legacy permission field still works on read", () => {
    expect(
      canRead(
        rec("alex", [{ username: "morgan", permission: "view" }]),
        morgan,
      ),
    ).toBe(true);
  });
});

describe("canWrite", () => {
  it("owner always writes", () => {
    expect(canWrite(rec("alex", []), alex)).toBe(true);
  });
  it("lab_head writes any member's record (role-based PI edit, no session)", () => {
    expect(canWrite(rec("alex", []), mira)).toBe(true);
  });
  it("non-owner with level:read cannot write", () => {
    expect(
      canWrite(rec("alex", [{ username: "morgan", level: "read" }]), morgan),
    ).toBe(false);
  });
  it("non-owner with level:edit can write", () => {
    expect(
      canWrite(rec("alex", [{ username: "morgan", level: "edit" }]), morgan),
    ).toBe(true);
  });
  it('"*" with level:read does NOT grant write', () => {
    expect(
      canWrite(rec("alex", [{ username: "*", level: "read" }]), morgan),
    ).toBe(false);
  });
  it('"*" with level:edit grants write to everyone', () => {
    expect(
      canWrite(rec("alex", [{ username: "*", level: "edit" }]), morgan),
    ).toBe(true);
  });
});

describe("expandSharedWith", () => {
  it("expands * to all lab members minus the owner", () => {
    const out = expandSharedWith(
      [{ username: "*", level: "read" }],
      ["alex", "morgan", "mira", "sam"],
      "alex",
    );
    expect(out.sort((a, b) => a.username.localeCompare(b.username))).toEqual([
      { username: "mira", level: "read" },
      { username: "morgan", level: "read" },
      { username: "sam", level: "read" },
    ]);
  });

  it("explicit entry overrides * level when higher", () => {
    const out = expandSharedWith(
      [
        { username: "*", level: "read" },
        { username: "morgan", level: "edit" },
      ],
      ["alex", "morgan", "mira"],
      "alex",
    );
    const morganEntry = out.find((s) => s.username === "morgan");
    expect(morganEntry?.level).toBe("edit");
  });

  it("explicit lower level does NOT downgrade a * higher level", () => {
    const out = expandSharedWith(
      [
        { username: "*", level: "edit" },
        { username: "morgan", level: "read" },
      ],
      ["alex", "morgan"],
      "alex",
    );
    const morganEntry = out.find((s) => s.username === "morgan");
    expect(morganEntry?.level).toBe("edit");
  });
});

describe("normalizeSharedWith", () => {
  it("returns [] for non-array input", () => {
    expect(normalizeSharedWith(null)).toEqual([]);
    expect(normalizeSharedWith(undefined)).toEqual([]);
    expect(normalizeSharedWith("not array")).toEqual([]);
  });
  it("maps legacy permission view → level read", () => {
    expect(normalizeSharedEntry({ username: "x", permission: "view" })).toEqual({
      username: "x",
      level: "read",
    });
  });
  it("maps legacy permission edit → level edit", () => {
    expect(normalizeSharedEntry({ username: "x", permission: "edit" })).toEqual({
      username: "x",
      level: "edit",
    });
  });
  it("preserves already-unified entries", () => {
    expect(normalizeSharedEntry({ username: "x", level: "edit" })).toEqual({
      username: "x",
      level: "edit",
    });
  });
  it("filters entries without username", () => {
    expect(normalizeSharedWith([{ foo: 1 }, null, { username: "" }])).toEqual([]);
  });
});

describe("upsertSharedEntry / removeSharedEntry", () => {
  it("upserts a new entry", () => {
    const out = upsertSharedEntry([], "morgan", "edit");
    expect(out).toEqual([{ username: "morgan", level: "edit" }]);
  });
  it("upserts updates level on existing entry", () => {
    const out = upsertSharedEntry(
      [{ username: "morgan", level: "read" }],
      "morgan",
      "edit",
    );
    expect(out).toEqual([{ username: "morgan", level: "edit" }]);
  });
  it("removes an entry", () => {
    const out = removeSharedEntry(
      [
        { username: "morgan", level: "edit" },
        { username: "mira", level: "read" },
      ],
      "morgan",
    );
    expect(out).toEqual([{ username: "mira", level: "read" }]);
  });
  it("isWholeLabShared detects sentinel", () => {
    expect(isWholeLabShared([])).toBe(false);
    expect(isWholeLabShared([{ username: "x", level: "edit" }])).toBe(false);
    expect(isWholeLabShared([{ username: WHOLE_LAB_SENTINEL, level: "read" }])).toBe(
      true,
    );
  });
});
