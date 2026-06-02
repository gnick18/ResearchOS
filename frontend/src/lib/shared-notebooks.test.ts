// Shared Notebooks Phase 1 (notebooks-data bot, 2026-06-02). See
// docs/proposals/SHARED_NOTEBOOKS_PROPOSAL.md.
//
// End-to-end coverage of the SharedNotebook data + API foundation, exercised
// against an in-memory file system (the same harness lab-links-share.test.ts
// uses). The three users:
//   - pi      : lab_head
//   - student : plain member
//   - other   : plain member, NOT in any notebook (the privacy probe)
//
// Coverage:
//   1. create stamps members / created_by / owner and shared_with = both at
//      "edit".
//   2. both members can READ + WRITE the notebook record (canRead/canWrite).
//   3. a note created inside a notebook carries notebook_id + both-at-edit
//      shared_with; both members read it, each sees the other's items.
//   4. a non-member plain user reads NOTHING (notebook + items).
//   5. a lab_head non-member still reads items via implicit view-all
//      (expected), but the notebook is NOT in their getSharedNotebooks (the
//      membership gate).
//   6. notebook_id filtering: items of one notebook never leak into another.
//   7. getSharedNotebooks returns the notebook from BOTH the creator's and the
//      other member's perspective.
//   8. weekly tasks reuse WeeklyGoal with notebook_id + both-at-edit sharing.
//   9. createNote / createWeeklyTask reject a non-member.
//  10. personal notes (no notebook_id) are unchanged and never surface in a
//      notebook query.

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Note, WeeklyGoal } from "./types";
import {
  canRead,
  canWrite,
  NEVER_UNLOCKED,
  type Viewer,
} from "./sharing/unified";

const memFs = new Map<string, unknown>();
let currentUserMock = "student";

vi.mock("./file-system/file-service", () => ({
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
        if (rest.includes("/")) continue; // immediate children only
        names.add(rest);
      }
      return Array.from(names);
    }),
    listDirectories: vi.fn(async () => []),
    deleteFile: vi.fn(async (path: string) => memFs.delete(path)),
    isConnected: vi.fn(() => true),
  },
}));

vi.mock("./file-system/indexeddb-store", () => ({
  getCurrentUser: vi.fn(async () => currentUserMock),
}));

vi.mock("./file-system/user-discovery", () => ({
  discoverUsers: vi.fn(async () => ["pi", "student", "other"]),
}));

// Imports must come after the mocks.
import { sharedNotebooksApi, notesApi, labApi } from "./local-api";
import { clearCurrentUserCache } from "./storage/json-store";

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
  setSettings("pi", "lab_head");
  setSettings("student", "member");
  setSettings("other", "member");
  setCurrentUser("student");
});

describe("sharedNotebooksApi.create", () => {
  it("stamps members / created_by / owner and shares with both at edit", async () => {
    setCurrentUser("student");
    const nb = await sharedNotebooksApi.create({
      otherMember: "pi",
      title: "Thesis 1:1",
    });

    expect(nb.id).toBeTypeOf("string");
    expect(nb.id.length).toBeGreaterThan(0);
    expect(nb.members).toEqual(["student", "pi"]);
    expect(nb.created_by).toBe("student");
    expect(nb.owner).toBe("student");
    expect(nb.title).toBe("Thesis 1:1");
    expect(nb.shared_with).toEqual([
      { username: "student", level: "edit" },
      { username: "pi", level: "edit" },
    ]);

    // Persisted in the creator's folder under the UUID filename.
    const onDisk = memFs.get(
      `users/student/shared_notebooks/${nb.id}.json`,
    ) as typeof nb;
    expect(onDisk?.id).toBe(nb.id);
  });

  it("creates without a title (title omitted, not null)", async () => {
    const nb = await sharedNotebooksApi.create({ otherMember: "pi" });
    expect(nb.title).toBeUndefined();
  });

  it("EITHER role can create (a PI creating with a student)", async () => {
    setCurrentUser("pi");
    const nb = await sharedNotebooksApi.create({ otherMember: "student" });
    expect(nb.members).toEqual(["pi", "student"]);
    expect(nb.owner).toBe("pi");
  });
});

describe("notebook record is readable + writable by both members", () => {
  it("canRead and canWrite are true for both members (explicit edit, no PI bypass)", async () => {
    setCurrentUser("student");
    const nb = await sharedNotebooksApi.create({ otherMember: "pi" });

    expect(canRead(nb, viewer("student"))).toBe(true);
    expect(canRead(nb, viewer("pi", true))).toBe(true);
    expect(canWrite(nb, viewer("student"), NEVER_UNLOCKED)).toBe(true);
    expect(canWrite(nb, viewer("pi"), NEVER_UNLOCKED)).toBe(true);

    // A third plain member is locked out.
    expect(canRead(nb, viewer("other"))).toBe(false);
    expect(canWrite(nb, viewer("other"), NEVER_UNLOCKED)).toBe(false);
  });
});

describe("in-notebook notes: both add, both see, both can write", () => {
  it("a note created in a notebook is shared with both at edit and carries notebook_id", async () => {
    setCurrentUser("student");
    const nb = await sharedNotebooksApi.create({ otherMember: "pi" });

    const note = await sharedNotebooksApi.createNote({
      notebookId: nb.id,
      title: "Plasmid prep results",
    });
    expect(note.notebook_id).toBe(nb.id);
    expect(note.username).toBe("student");
    expect(note.shared_with).toEqual([
      { username: "student", level: "edit" },
      { username: "pi", level: "edit" },
    ]);

    // canWrite (owner = note.username creator) for the OTHER member.
    const shareable = {
      owner: note.username,
      shared_with: note.shared_with ?? [],
    };
    expect(canWrite(shareable, viewer("pi"), NEVER_UNLOCKED)).toBe(true);
    expect(canWrite(shareable, viewer("student"), NEVER_UNLOCKED)).toBe(true);
  });

  it("each member sees the OTHER member's notebook notes via getNotebookNotes", async () => {
    setCurrentUser("student");
    const nb = await sharedNotebooksApi.create({ otherMember: "pi" });
    await sharedNotebooksApi.createNote({
      notebookId: nb.id,
      title: "student note",
    });

    // PI (a member here) adds a note too — lands in the PI's own folder.
    setCurrentUser("pi");
    await sharedNotebooksApi.createNote({
      notebookId: nb.id,
      title: "pi note",
    });

    // Student sees BOTH notes.
    setCurrentUser("student");
    const studentView = await labApi.getNotebookNotes(nb.id);
    expect(studentView.map((n) => n.title).sort()).toEqual([
      "pi note",
      "student note",
    ]);

    // PI sees BOTH notes.
    setCurrentUser("pi");
    const piView = await labApi.getNotebookNotes(nb.id);
    expect(piView.map((n) => n.title).sort()).toEqual([
      "pi note",
      "student note",
    ]);
  });
});

describe("privacy: a non-member plain user sees nothing", () => {
  it("a third plain member reads neither the notebook nor its items", async () => {
    setCurrentUser("student");
    const nb = await sharedNotebooksApi.create({ otherMember: "pi" });
    await sharedNotebooksApi.createNote({
      notebookId: nb.id,
      title: "private to the pair",
    });

    setCurrentUser("other");
    expect(await labApi.getSharedNotebooks()).toEqual([]);
    expect(await labApi.getNotebookNotes(nb.id)).toEqual([]);
  });
});

describe("lab_head non-member: implicit read of items, but not 'my notebooks'", () => {
  it("a notebook between student and other: pi (lab_head) reads items but it is NOT in pi's getSharedNotebooks", async () => {
    // student creates a notebook with `other`; pi is NOT a member.
    setCurrentUser("student");
    const nb = await sharedNotebooksApi.create({ otherMember: "other" });
    await sharedNotebooksApi.createNote({
      notebookId: nb.id,
      title: "student+other note",
    });

    setCurrentUser("pi"); // lab_head, non-member
    // Implicit view-all lets the PI read the items (documented, expected).
    const piItems = await labApi.getNotebookNotes(nb.id);
    expect(piItems.map((n) => n.title)).toEqual(["student+other note"]);

    // But "my notebooks" is membership-gated: pi is not a member, so empty.
    expect(await labApi.getSharedNotebooks()).toEqual([]);
  });
});

describe("notebook_id filtering", () => {
  it("items of one notebook never leak into another", async () => {
    setCurrentUser("student");
    const nbA = await sharedNotebooksApi.create({
      otherMember: "pi",
      title: "A",
    });
    const nbB = await sharedNotebooksApi.create({
      otherMember: "pi",
      title: "B",
    });
    await sharedNotebooksApi.createNote({ notebookId: nbA.id, title: "a-note" });
    await sharedNotebooksApi.createNote({ notebookId: nbB.id, title: "b-note" });
    await sharedNotebooksApi.createWeeklyTask({
      notebookId: nbA.id,
      text: "a-task",
    });
    await sharedNotebooksApi.createWeeklyTask({
      notebookId: nbB.id,
      text: "b-task",
    });

    expect((await labApi.getNotebookNotes(nbA.id)).map((n) => n.title)).toEqual([
      "a-note",
    ]);
    expect((await labApi.getNotebookNotes(nbB.id)).map((n) => n.title)).toEqual([
      "b-note",
    ]);
    expect(
      (await labApi.getNotebookWeeklyTasks(nbA.id)).map((t) => t.text),
    ).toEqual(["a-task"]);
    expect(
      (await labApi.getNotebookWeeklyTasks(nbB.id)).map((t) => t.text),
    ).toEqual(["b-task"]);
  });
});

describe("getSharedNotebooks from both perspectives", () => {
  it("returns the notebook for the creator AND the other member", async () => {
    setCurrentUser("student");
    const nb = await sharedNotebooksApi.create({
      otherMember: "pi",
      title: "shared both ways",
    });

    setCurrentUser("student");
    const fromStudent = await labApi.getSharedNotebooks();
    expect(fromStudent.map((n) => n.id)).toEqual([nb.id]);

    setCurrentUser("pi");
    const fromPi = await labApi.getSharedNotebooks();
    expect(fromPi.map((n) => n.id)).toEqual([nb.id]);
  });
});

describe("weekly tasks reuse WeeklyGoal", () => {
  it("a weekly task carries notebook_id + both-at-edit sharing and is readable by both", async () => {
    setCurrentUser("student");
    const nb = await sharedNotebooksApi.create({ otherMember: "pi" });
    const task = await sharedNotebooksApi.createWeeklyTask({
      notebookId: nb.id,
      text: "Run the gel by Friday",
    });

    expect(task.notebook_id).toBe(nb.id);
    expect(task.owner).toBe("student");
    expect(task.is_complete).toBe(false);
    expect(task.shared_with).toEqual([
      { username: "student", level: "edit" },
      { username: "pi", level: "edit" },
    ]);

    setCurrentUser("pi");
    const piTasks = await labApi.getNotebookWeeklyTasks(nb.id);
    expect(piTasks.map((t) => t.text)).toEqual(["Run the gel by Friday"]);
  });
});

describe("membership guard on item creation", () => {
  it("createNote / createWeeklyTask reject a non-member", async () => {
    setCurrentUser("student");
    const nb = await sharedNotebooksApi.create({ otherMember: "pi" });

    setCurrentUser("other"); // not a member
    await expect(
      sharedNotebooksApi.createNote({ notebookId: nb.id, title: "sneaky" }),
    ).rejects.toThrow(/not a member/);
    await expect(
      sharedNotebooksApi.createWeeklyTask({ notebookId: nb.id, text: "sneaky" }),
    ).rejects.toThrow(/not a member/);
  });

  it("createNote rejects a missing notebook", async () => {
    setCurrentUser("student");
    await expect(
      sharedNotebooksApi.createNote({
        notebookId: "does-not-exist",
        title: "x",
      }),
    ).rejects.toThrow(/not found/);
  });
});

describe("personal notes are unchanged", () => {
  it("a personal note has no notebook_id and never appears in a notebook query", async () => {
    setCurrentUser("student");
    const nb = await sharedNotebooksApi.create({ otherMember: "pi" });

    const personal = await notesApi.create({ title: "my private note" });
    expect((personal as Note).notebook_id).toBeUndefined();

    // The personal note is invisible to the notebook item query.
    const inNotebook = await labApi.getNotebookNotes(nb.id);
    expect(inNotebook.map((n) => n.title)).not.toContain("my private note");
  });
});
