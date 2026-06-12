// Check-ins revamp Phase 1 (checkins-revamp bot, 2026-06-11). See
// docs/proposals/checkins-revamp.md.
//
// Coverage of the generalized check-in space data + API, against an in-memory
// file system (same harness as shared-notebooks.test.ts). Three users:
//   - pi      : lab_head (a mentor in some spaces)
//   - student : plain member (the counterpart)
//   - other   : plain member, not in any space (the privacy probe)
//
// The 1:1 is now an any-account member-array "space" with an optional mentor
// edge; any account can create one (the lab-head gate is retired), and reads
// run through `normalizeOneOnOne` so callers always see `members`/`mentor`/
// `kind`.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { canRead, type Viewer } from "../sharing/unified";
import {
  oneOnOneLabel,
  oneOnOneTabLabel,
  relationshipHint,
} from "./label";
import { normalizeOneOnOne } from "./normalize";
import type { OneOnOne } from "../types";

const memFs = new Map<string, unknown>();
let currentUserMock = "pi";
let discoverableUsersMock = ["pi", "student", "other"];

vi.mock("../file-system/file-service", () => ({
  fileService: {
    readJson: vi.fn(async (path: string) => {
      const v = memFs.get(path);
      return v === undefined ? null : v;
    }),
    writeJson: vi.fn(async (path: string, data: unknown) => {
      memFs.set(path, data);
    }),
    ensureDir: vi.fn(async () => null),
    listFiles: vi.fn(async (dir: string) => {
      const prefix = `${dir}/`;
      const names = new Set<string>();
      for (const key of memFs.keys()) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        if (rest.includes("/")) continue;
        names.add(rest);
      }
      return Array.from(names);
    }),
    listDirectories: vi.fn(async () => []),
    deleteFile: vi.fn(async (path: string) => memFs.delete(path)),
    isConnected: vi.fn(() => true),
  },
}));

vi.mock("../file-system/indexeddb-store", () => ({
  getCurrentUser: vi.fn(async () => currentUserMock),
}));

vi.mock("../file-system/user-discovery", () => ({
  discoverUsers: vi.fn(async () => discoverableUsersMock),
}));

// Imports must come after the mocks.
import { oneOnOnesApi, labApi } from "../local-api";
import { clearCurrentUserCache } from "../storage/json-store";

function setCurrentUser(name: string) {
  currentUserMock = name;
  clearCurrentUserCache();
}

function setSettings(username: string, accountType: "member" | "lab_head") {
  memFs.set(`users/${username}/settings.json`, { account_type: accountType });
}

const viewer = (username: string, lab_head = false): Viewer => ({
  username,
  account_type: lab_head ? "lab_head" : "lab",
});

beforeEach(() => {
  memFs.clear();
  discoverableUsersMock = ["pi", "student", "other"];
  setSettings("pi", "lab_head");
  setSettings("student", "member");
  setSettings("other", "member");
  setCurrentUser("pi");
});

describe("oneOnOnesApi.create", () => {
  it("creates a mentoring pair: forces creator into members[0], writes new + legacy fields", async () => {
    setCurrentUser("pi");
    const oo = await oneOnOnesApi.create({
      members: ["pi", "student"],
      mentor: "pi",
    });

    expect(oo.id).toBeTypeOf("string");
    expect(oo.id.length).toBeGreaterThan(0);
    expect(oo.members).toEqual(["pi", "student"]);
    expect(oo.mentor).toBe("pi");
    expect(oo.kind).toBe("pair");
    expect(oo.created_by).toBe("pi");
    expect(oo.owner).toBe("pi");
    expect(oo.shared_with).toEqual([
      { username: "pi", level: "edit" },
      { username: "student", level: "edit" },
    ]);

    // Legacy back-compat fields written for a 2-person mentoring space.
    expect(oo.labHead).toBe("pi");
    expect(oo.member).toBe("student");

    // Persisted in the creator's folder under the UUID filename.
    const onDisk = memFs.get(`users/pi/one_on_ones/${oo.id}.json`) as OneOnOne;
    expect(onDisk?.id).toBe(oo.id);

    // Both members can read it; a third member is locked out.
    expect(canRead(oo, viewer("pi", true))).toBe(true);
    expect(canRead(oo, viewer("student"))).toBe(true);
    expect(canRead(oo, viewer("other"))).toBe(false);
  });

  it("a non-lab-head member CAN now create a (peer) space", async () => {
    setCurrentUser("student");
    const oo = await oneOnOnesApi.create({ members: ["student", "other"] });

    expect(oo.members).toEqual(["student", "other"]);
    expect(oo.mentor).toBeNull();
    expect(oo.kind).toBe("pair");
    expect(oo.owner).toBe("student");
    // No mentor => legacy fields left undefined.
    expect(oo.labHead).toBeUndefined();
    expect(oo.member).toBeUndefined();
  });

  it("forces the creator into members[0] even when omitted, de-duped", async () => {
    setCurrentUser("pi");
    const oo = await oneOnOnesApi.create({ members: ["student", "pi"] });
    expect(oo.members).toEqual(["pi", "student"]);
  });

  it("rejects a mentor who is not a member", async () => {
    setCurrentUser("pi");
    await expect(
      oneOnOnesApi.create({ members: ["pi", "student"], mentor: "other" }),
    ).rejects.toThrow(/mentor/i);
  });
});

describe("discovery: every member sees the space, outsiders do not", () => {
  it("getOneOnOnes returns the space for both members, not a third", async () => {
    setCurrentUser("pi");
    const oo = await oneOnOnesApi.create({
      members: ["pi", "student"],
      mentor: "pi",
    });

    setCurrentUser("pi");
    expect((await labApi.getOneOnOnes()).map((o) => o.id)).toEqual([oo.id]);

    setCurrentUser("student");
    expect((await labApi.getOneOnOnes()).map((o) => o.id)).toEqual([oo.id]);

    setCurrentUser("other");
    expect(await labApi.getOneOnOnes()).toEqual([]);
  });

  it("normalizes a legacy on-disk record (labHead/member only) on read", async () => {
    // Simulate a pre-revamp record with no members array.
    const legacy: OneOnOne = {
      id: "legacy-1",
      labHead: "pi",
      member: "student",
      created_by: "pi",
      created_at: "2026-06-01T00:00:00.000Z",
      owner: "pi",
      shared_with: [
        { username: "pi", level: "edit" },
        { username: "student", level: "edit" },
      ],
    };
    memFs.set(`users/pi/one_on_ones/legacy-1.json`, legacy);

    setCurrentUser("student");
    const seen = await labApi.getOneOnOnes();
    expect(seen.map((o) => o.id)).toEqual(["legacy-1"]);
    expect(seen[0].members).toEqual(["pi", "student"]);
    expect(seen[0].mentor).toBe("pi");
    expect(seen[0].kind).toBe("pair");
  });
});

describe("item stamping: weekly goals / notes / action items", () => {
  it("addWeeklyGoal stamps one_on_one_id + every-member-at-edit and is readable by both", async () => {
    setCurrentUser("pi");
    const oo = await oneOnOnesApi.create({
      members: ["pi", "student"],
      mentor: "pi",
    });

    const goal = await oneOnOnesApi.addWeeklyGoal({
      oneOnOneId: oo.id,
      text: "Run the gel by Friday",
    });
    expect(goal.one_on_one_id).toBe(oo.id);
    expect(goal.owner).toBe("pi");
    expect(goal.is_complete).toBe(false);
    expect(goal.shared_with).toEqual([
      { username: "pi", level: "edit" },
      { username: "student", level: "edit" },
    ]);

    setCurrentUser("student");
    const seen = await labApi.getOneOnOneWeeklyGoals(oo.id);
    expect(seen.map((g) => g.text)).toEqual(["Run the gel by Friday"]);
  });

  it("addMeetingNote stamps note_kind: meeting + one_on_one_id", async () => {
    setCurrentUser("pi");
    const oo = await oneOnOnesApi.create({
      members: ["pi", "student"],
      mentor: "pi",
    });

    const note = await oneOnOnesApi.addMeetingNote({
      oneOnOneId: oo.id,
      title: "Week 1 sync",
      date: "2026-06-01",
    });
    expect(note.one_on_one_id).toBe(oo.id);
    expect(note.note_kind).toBe("meeting");
    expect(note.entries.length).toBe(1);
    expect(note.shared_with).toEqual([
      { username: "pi", level: "edit" },
      { username: "student", level: "edit" },
    ]);

    setCurrentUser("student");
    const seen = await labApi.getOneOnOneNotes(oo.id);
    expect(seen.map((n) => n.note_kind)).toEqual(["meeting"]);
  });

  it("addSharedNote stamps note_kind: note", async () => {
    setCurrentUser("pi");
    const oo = await oneOnOnesApi.create({
      members: ["pi", "student"],
      mentor: "pi",
    });

    setCurrentUser("student");
    const note = await oneOnOnesApi.addSharedNote({
      oneOnOneId: oo.id,
      title: "Reading list",
      description: "papers to discuss",
    });
    expect(note.one_on_one_id).toBe(oo.id);
    expect(note.note_kind).toBe("note");
    expect(note.username).toBe("student");

    setCurrentUser("pi");
    const seen = await labApi.getOneOnOneNotes(oo.id);
    expect(seen.map((n) => n.title)).toEqual(["Reading list"]);
  });

  it("addActionItem lands in the owner's folder, every-member-at-edit; toggle + delete work", async () => {
    setCurrentUser("pi");
    const oo = await oneOnOnesApi.create({
      members: ["pi", "student"],
      mentor: "pi",
    });

    setCurrentUser("student");
    const item = await oneOnOnesApi.addActionItem({
      oneOnOneId: oo.id,
      text: "Send the draft",
    });
    expect(item.one_on_one_id).toBe(oo.id);
    expect(item.is_done).toBe(false);
    expect(item.owner).toBe("pi"); // canonical home is the creator's folder
    expect(
      memFs.get(`users/pi/one_on_one_action_items/${item.id}.json`),
    ).toBeDefined();

    setCurrentUser("pi");
    const toggled = await oneOnOnesApi.toggleActionItem(item.id);
    expect(toggled?.is_done).toBe(true);

    const seen = await labApi.getOneOnOneActionItems(oo.id);
    expect(seen.map((i) => i.is_done)).toEqual([true]);

    const removed = await oneOnOnesApi.deleteActionItem(item.id);
    expect(removed).toBe(true);
    expect(await labApi.getOneOnOneActionItems(oo.id)).toEqual([]);
  });

  it("item creation rejects a non-member and a missing space", async () => {
    setCurrentUser("pi");
    const oo = await oneOnOnesApi.create({
      members: ["pi", "student"],
      mentor: "pi",
    });

    setCurrentUser("other");
    await expect(
      oneOnOnesApi.addWeeklyGoal({ oneOnOneId: oo.id, text: "x" }),
    ).rejects.toThrow(/not a member/);

    setCurrentUser("pi");
    await expect(
      oneOnOnesApi.addSharedNote({ oneOnOneId: "nope", title: "x" }),
    ).rejects.toThrow(/not found/);
  });
});

describe("delete is owner/creator-only", () => {
  it("a non-owner member cannot delete; the owner can", async () => {
    setCurrentUser("pi");
    const oo = await oneOnOnesApi.create({
      members: ["pi", "student"],
      mentor: "pi",
    });

    setCurrentUser("student");
    await expect(oneOnOnesApi.delete(oo.id)).rejects.toThrow(/owner/i);

    setCurrentUser("pi");
    await oneOnOnesApi.delete(oo.id);
    expect(memFs.get(`users/pi/one_on_ones/${oo.id}.json`)).toBeUndefined();
  });

  it("a peer-space creator (non-lab-head) can delete their own space", async () => {
    setCurrentUser("student");
    const oo = await oneOnOnesApi.create({ members: ["student", "other"] });
    await oneOnOnesApi.delete(oo.id);
    expect(memFs.get(`users/student/one_on_ones/${oo.id}.json`)).toBeUndefined();
  });
});

describe("normalizeOneOnOne (pure)", () => {
  it("derives members/mentor/kind from a legacy record", () => {
    const n = normalizeOneOnOne({
      id: "x",
      labHead: "pi",
      member: "student",
      created_by: "pi",
      created_at: "",
      owner: "pi",
      shared_with: [],
    });
    expect(n.members).toEqual(["pi", "student"]);
    expect(n.mentor).toBe("pi");
    expect(n.kind).toBe("pair");
  });

  it("keeps an existing members array and derives kind from its length", () => {
    const n = normalizeOneOnOne({
      id: "x",
      members: ["a", "b", "c"],
      mentor: null,
      created_by: "a",
      created_at: "",
      owner: "a",
      shared_with: [],
    });
    expect(n.members).toEqual(["a", "b", "c"]);
    expect(n.mentor).toBeNull();
    expect(n.kind).toBe("group");
  });
});

describe("oneOnOneLabel + relationshipHint + oneOnOneTabLabel (pure helpers)", () => {
  const mentoring: OneOnOne = {
    id: "oo-1",
    members: ["Dr. Lee", "Alex"],
    mentor: "Dr. Lee",
    kind: "pair",
    created_by: "Dr. Lee",
    created_at: "2026-06-07T00:00:00.000Z",
    owner: "Dr. Lee",
    shared_with: [],
  };

  it("labels a pair space by the COUNTERPART, framed by who is looking", () => {
    expect(oneOnOneLabel("Dr. Lee", mentoring)).toBe("Alex");
    expect(oneOnOneLabel("Alex", mentoring)).toBe("Dr. Lee");
  });

  it("prefers an explicit title when set", () => {
    expect(oneOnOneLabel("Dr. Lee", { ...mentoring, title: "Aim 2" })).toBe(
      "Aim 2",
    );
  });

  it("does not crash on a legacy record with no members array", () => {
    const legacy: OneOnOne = {
      id: "oo-2",
      labHead: "Dr. Lee",
      member: "Alex",
      created_by: "Dr. Lee",
      created_at: "",
      owner: "Dr. Lee",
      shared_with: [],
    };
    expect(oneOnOneLabel("Alex", legacy)).toBe("Dr. Lee");
  });

  it("derives a soft relationship hint from the mentor edge", () => {
    expect(relationshipHint("Dr. Lee", mentoring)).toBe("you-mentor-them");
    expect(relationshipHint("Alex", mentoring)).toBe("they-mentor-you");
    const peer: OneOnOne = { ...mentoring, mentor: null };
    expect(relationshipHint("Dr. Lee", peer)).toBe("peer");
  });

  it("the tab label is Check-ins for everyone (D6)", () => {
    expect(oneOnOneTabLabel("lab_head")).toBe("Check-ins");
    expect(oneOnOneTabLabel("lab")).toBe("Check-ins");
    expect(oneOnOneTabLabel("solo")).toBe("Check-ins");
  });
});
