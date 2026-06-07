// 1:1 revamp (oneonone data+strip bot, 2026-06-07). See
// docs/proposals/NOTEBOOKS_AND_ONE_ON_ONE_REVAMP.md.
//
// Coverage of the OneOnOne data + API foundation, against an in-memory file
// system (same harness as shared-notebooks.test.ts). Three users:
//   - pi      : lab_head (creates the 1:1)
//   - student : plain member (the counterpart)
//   - other   : plain member, not in any 1:1 (the privacy probe)

import { describe, expect, it, vi, beforeEach } from "vitest";
import { canRead, type Viewer } from "../sharing/unified";
import { oneOnOneLabel, oneOnOneTabLabel } from "./label";
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
  it("a lab head creates a 1:1: stamps labHead/member/owner + both-at-edit", async () => {
    setCurrentUser("pi");
    const oo = await oneOnOnesApi.create({ member: "student" });

    expect(oo.id).toBeTypeOf("string");
    expect(oo.id.length).toBeGreaterThan(0);
    expect(oo.labHead).toBe("pi");
    expect(oo.member).toBe("student");
    expect(oo.created_by).toBe("pi");
    expect(oo.owner).toBe("pi");
    expect(oo.shared_with).toEqual([
      { username: "pi", level: "edit" },
      { username: "student", level: "edit" },
    ]);

    // Persisted in the lab head's folder under the UUID filename.
    const onDisk = memFs.get(`users/pi/one_on_ones/${oo.id}.json`) as OneOnOne;
    expect(onDisk?.id).toBe(oo.id);

    // Both members can read it; a third member is locked out.
    expect(canRead(oo, viewer("pi", true))).toBe(true);
    expect(canRead(oo, viewer("student"))).toBe(true);
    expect(canRead(oo, viewer("other"))).toBe(false);
  });

  it("a non-lab-head member CANNOT create a 1:1", async () => {
    setCurrentUser("student");
    await expect(
      oneOnOnesApi.create({ member: "pi" }),
    ).rejects.toThrow(/lab head/i);
  });
});

describe("discovery: both participants see the 1:1, outsiders do not", () => {
  it("getOneOnOnes returns the 1:1 for the lab head AND the member, not a third", async () => {
    setCurrentUser("pi");
    const oo = await oneOnOnesApi.create({ member: "student" });

    setCurrentUser("pi");
    expect((await labApi.getOneOnOnes()).map((o) => o.id)).toEqual([oo.id]);

    setCurrentUser("student");
    expect((await labApi.getOneOnOnes()).map((o) => o.id)).toEqual([oo.id]);

    setCurrentUser("other");
    expect(await labApi.getOneOnOnes()).toEqual([]);
  });
});

describe("item stamping: weekly goals / notes / action items", () => {
  it("addWeeklyGoal stamps one_on_one_id + both-at-edit and is readable by both", async () => {
    setCurrentUser("pi");
    const oo = await oneOnOnesApi.create({ member: "student" });

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

    // The member (the other person) reads it back via the aggregation.
    setCurrentUser("student");
    const seen = await labApi.getOneOnOneWeeklyGoals(oo.id);
    expect(seen.map((g) => g.text)).toEqual(["Run the gel by Friday"]);
  });

  it("addMeetingNote stamps note_kind: meeting + one_on_one_id", async () => {
    setCurrentUser("pi");
    const oo = await oneOnOnesApi.create({ member: "student" });

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
    const oo = await oneOnOnesApi.create({ member: "student" });

    // The member adds a freeform shared note (lands in their own folder).
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

  it("addActionItem lands in the lab head's folder, both-at-edit; toggle + delete work", async () => {
    setCurrentUser("pi");
    const oo = await oneOnOnesApi.create({ member: "student" });

    // The member adds an action item.
    setCurrentUser("student");
    const item = await oneOnOnesApi.addActionItem({
      oneOnOneId: oo.id,
      text: "Send the draft",
    });
    expect(item.one_on_one_id).toBe(oo.id);
    expect(item.is_done).toBe(false);
    expect(item.owner).toBe("pi"); // canonical home is the lab head's folder
    expect(memFs.get(`users/pi/one_on_one_action_items/${item.id}.json`)).toBeDefined();

    // The lab head toggles it done (routes to the lab head's folder).
    setCurrentUser("pi");
    const toggled = await oneOnOnesApi.toggleActionItem(item.id);
    expect(toggled?.is_done).toBe(true);

    // Both read it via the aggregation.
    const seen = await labApi.getOneOnOneActionItems(oo.id);
    expect(seen.map((i) => i.is_done)).toEqual([true]);

    // Delete removes it.
    const removed = await oneOnOnesApi.deleteActionItem(item.id);
    expect(removed).toBe(true);
    expect(await labApi.getOneOnOneActionItems(oo.id)).toEqual([]);
  });

  it("item creation rejects a non-member and a missing 1:1", async () => {
    setCurrentUser("pi");
    const oo = await oneOnOnesApi.create({ member: "student" });

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

describe("delete is lab-head-only", () => {
  it("the member cannot delete; the lab head can", async () => {
    setCurrentUser("pi");
    const oo = await oneOnOnesApi.create({ member: "student" });

    setCurrentUser("student");
    await expect(oneOnOnesApi.delete(oo.id)).rejects.toThrow(/lab head/i);

    setCurrentUser("pi");
    await oneOnOnesApi.delete(oo.id);
    expect(memFs.get(`users/pi/one_on_ones/${oo.id}.json`)).toBeUndefined();
  });
});

describe("oneOnOneLabel + oneOnOneTabLabel (pure helpers)", () => {
  const oo: OneOnOne = {
    id: "oo-1",
    labHead: "Dr. Lee",
    member: "Alex",
    created_by: "Dr. Lee",
    created_at: "2026-06-07T00:00:00.000Z",
    owner: "Dr. Lee",
    shared_with: [],
  };

  it("labels by the COUNTERPART, framed by who is looking", () => {
    // Lab head sees the Mentoring framing labeled by the member.
    expect(oneOnOneLabel("Dr. Lee", oo)).toBe("Alex - Mentoring");
    // Member sees the Check-ins framing labeled by the lab head.
    expect(oneOnOneLabel("Alex", oo)).toBe("Dr. Lee - Check-ins");
    // Anyone who is not the lab head gets the Check-ins framing.
    expect(oneOnOneLabel("other", oo)).toBe("Dr. Lee - Check-ins");
  });

  it("the tab label is the role word by account type", () => {
    expect(oneOnOneTabLabel("lab_head")).toBe("Mentoring");
    expect(oneOnOneTabLabel("lab")).toBe("Check-ins");
    expect(oneOnOneTabLabel("solo")).toBe("Check-ins");
  });
});
