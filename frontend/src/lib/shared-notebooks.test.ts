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
//   8. createNote rejects a non-member.
//   9. personal notes (no notebook_id) are unchanged and never surface in a
//      notebook query.
//
// 1:1 revamp (oneonone data+strip bot, 2026-06-07): the weekly-task coverage
// moved to one-on-one/one-on-one.test.ts; a notebook is a plain note container
// now and no longer holds weekly goals.

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Note, WeeklyGoal } from "./types";
import {
  canRead,
  canWrite,
  type Viewer,
} from "./sharing/unified";

const memFs = new Map<string, unknown>();
let currentUserMock = "student";
// The set of users `discoverUsers()` returns. Mutable so a test can simulate
// removing (tombstoning) a member: discoverUsers FILTERS OUT removed users, so
// dropping a name here models the creator being removed from the lab.
let discoverableUsersMock = ["pi", "student", "other"];

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
  discoverUsers: vi.fn(async () => discoverableUsersMock),
}));

// Imports must come after the mocks.
import {
  sharedNotebooksApi,
  notesApi,
  labApi,
} from "./local-api";
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

/** Simulate removing a member from the lab: discoverUsers() filters out
 *  tombstoned users, so a removed name no longer appears in discovery (its
 *  on-disk folder may still hold files, but they are unreachable). */
function setDiscoverableUsers(...names: string[]) {
  discoverableUsersMock = names;
}

/** Direct path to a member's mirror copy of a notebook (test introspection). */
function notebookCopyPath(member: string, id: string) {
  return `users/${member}/shared_notebooks/${id}.json`;
}

beforeEach(() => {
  memFs.clear();
  discoverableUsersMock = ["pi", "student", "other"];
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
    expect(canWrite(nb, viewer("student"))).toBe(true);
    expect(canWrite(nb, viewer("pi"))).toBe(true);

    // A third plain member is locked out.
    expect(canRead(nb, viewer("other"))).toBe(false);
    expect(canWrite(nb, viewer("other"))).toBe(false);
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
    expect(canWrite(shareable, viewer("pi"))).toBe(true);
    expect(canWrite(shareable, viewer("student"))).toBe(true);
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

    expect((await labApi.getNotebookNotes(nbA.id)).map((n) => n.title)).toEqual([
      "a-note",
    ]);
    expect((await labApi.getNotebookNotes(nbB.id)).map((n) => n.title)).toEqual([
      "b-note",
    ]);
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

describe("membership guard on item creation", () => {
  it("createNote rejects a non-member", async () => {
    setCurrentUser("student");
    const nb = await sharedNotebooksApi.create({ otherMember: "pi" });

    setCurrentUser("other"); // not a member
    await expect(
      sharedNotebooksApi.createNote({ notebookId: nb.id, title: "sneaky" }),
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

// Survive-removal (notebook-survive-removal sub-bot, 2026-06-02): the record is
// MIRRORED into BOTH members' folders so the notebook outlives either member
// being removed from the lab. The notes / tasks already survive (each author's
// items live in their own folder); this closes the single-copy-RECORD gap.
describe("record is mirrored into BOTH members' folders", () => {
  it("create writes the same id/created_by/members/title/shared_with to each member, owner per folder", async () => {
    setCurrentUser("student");
    const nb = await sharedNotebooksApi.create({
      otherMember: "pi",
      title: "Thesis 1:1",
    });

    const studentCopy = memFs.get(
      notebookCopyPath("student", nb.id),
    ) as typeof nb;
    const piCopy = memFs.get(notebookCopyPath("pi", nb.id)) as typeof nb;

    // Both copies exist, share the same id / created_by / members / title /
    // shared_with, and each is owned by the folder it lives in.
    expect(studentCopy?.id).toBe(nb.id);
    expect(piCopy?.id).toBe(nb.id);
    expect(studentCopy.created_by).toBe("student");
    expect(piCopy.created_by).toBe("student");
    expect(studentCopy.members).toEqual(["student", "pi"]);
    expect(piCopy.members).toEqual(["student", "pi"]);
    expect(studentCopy.title).toBe("Thesis 1:1");
    expect(piCopy.title).toBe("Thesis 1:1");
    expect(studentCopy.shared_with).toEqual(piCopy.shared_with);
    expect(studentCopy.owner).toBe("student");
    expect(piCopy.owner).toBe("pi");
  });
});

describe("the notebook survives the creator being removed", () => {
  it("creator A is tombstoned -> the surviving member B still sees the record AND its items", async () => {
    // Student (A) creates the notebook with pi (B), and each adds an item.
    setCurrentUser("student");
    const nb = await sharedNotebooksApi.create({
      otherMember: "pi",
      title: "Thesis 1:1",
    });
    await sharedNotebooksApi.createNote({
      notebookId: nb.id,
      title: "student note",
    });

    setCurrentUser("pi");
    await sharedNotebooksApi.createNote({ notebookId: nb.id, title: "pi note" });

    // The creator (student) is removed from the lab: discoverUsers no longer
    // returns them. WITHOUT the mirror, the only record copy was in student's
    // folder and would now be undiscoverable, losing the notebook for pi.
    setDiscoverableUsers("pi", "other");

    setCurrentUser("pi");
    const survivors = await labApi.getSharedNotebooks();
    expect(survivors.map((n) => n.id)).toEqual([nb.id]);
    expect(survivors[0].title).toBe("Thesis 1:1");
    // The surviving member sees their own copy stamped owner = themselves.
    expect(survivors[0].owner).toBe("pi");

    // pi's own item still surfaces; the removed creator's items are no longer
    // discoverable (their folder is filtered out), which is expected. The
    // RECORD survival is the fix; item discovery follows discoverUsers as before.
    const piNotes = await labApi.getNotebookNotes(nb.id);
    expect(piNotes.map((n) => n.title)).toEqual(["pi note"]);
  });

  it("the surviving member can rename and delete the orphaned notebook", async () => {
    setCurrentUser("student");
    const nb = await sharedNotebooksApi.create({ otherMember: "pi" });

    // Creator removed; only pi's copy remains discoverable.
    setDiscoverableUsers("pi", "other");
    setCurrentUser("pi");

    const renamed = await sharedNotebooksApi.updateTitle(nb.id, "Renamed solo");
    expect(renamed?.title).toBe("Renamed solo");
    expect(
      (memFs.get(notebookCopyPath("pi", nb.id)) as typeof nb).title,
    ).toBe("Renamed solo");

    await sharedNotebooksApi.delete(nb.id);
    expect(memFs.get(notebookCopyPath("pi", nb.id))).toBeUndefined();
    expect(await labApi.getSharedNotebooks()).toEqual([]);
  });
});

describe("getSharedNotebooks dedupes the mirrored copies", () => {
  it("with a copy in BOTH folders, the notebook is listed ONCE per uuid", async () => {
    setCurrentUser("student");
    const nb = await sharedNotebooksApi.create({
      otherMember: "pi",
      title: "once only",
    });

    // Sanity: both copies are on disk.
    expect(memFs.get(notebookCopyPath("student", nb.id))).toBeDefined();
    expect(memFs.get(notebookCopyPath("pi", nb.id))).toBeDefined();

    // From either member's view the notebook appears exactly once.
    setCurrentUser("student");
    const fromStudent = await labApi.getSharedNotebooks();
    expect(fromStudent.map((n) => n.id)).toEqual([nb.id]);

    setCurrentUser("pi");
    const fromPi = await labApi.getSharedNotebooks();
    expect(fromPi.map((n) => n.id)).toEqual([nb.id]);
  });
});

describe("updateTitle / delete affect BOTH copies", () => {
  it("renaming updates the title in each member's folder", async () => {
    setCurrentUser("student");
    const nb = await sharedNotebooksApi.create({
      otherMember: "pi",
      title: "old",
    });

    const renamed = await sharedNotebooksApi.updateTitle(nb.id, "new title");
    expect(renamed?.title).toBe("new title");

    expect(
      (memFs.get(notebookCopyPath("student", nb.id)) as typeof nb).title,
    ).toBe("new title");
    expect(
      (memFs.get(notebookCopyPath("pi", nb.id)) as typeof nb).title,
    ).toBe("new title");
  });

  it("deleting removes the record from each member's folder", async () => {
    setCurrentUser("student");
    const nb = await sharedNotebooksApi.create({ otherMember: "pi" });
    expect(memFs.get(notebookCopyPath("student", nb.id))).toBeDefined();
    expect(memFs.get(notebookCopyPath("pi", nb.id))).toBeDefined();

    await sharedNotebooksApi.delete(nb.id);
    expect(memFs.get(notebookCopyPath("student", nb.id))).toBeUndefined();
    expect(memFs.get(notebookCopyPath("pi", nb.id))).toBeUndefined();
  });
});

describe("lazy backfill heals a single-copy notebook", () => {
  it("a notebook with a copy in only ONE member's folder gains the missing copy when the other member reads", async () => {
    setCurrentUser("student");
    const nb = await sharedNotebooksApi.create({ otherMember: "pi" });

    // Simulate a legacy single-copy record (pre-mirror data, or drift): remove
    // pi's copy so only the student's folder holds the record.
    memFs.delete(notebookCopyPath("pi", nb.id));
    expect(memFs.get(notebookCopyPath("pi", nb.id))).toBeUndefined();

    // pi (a member missing their copy, not tombstoned) reads their notebooks.
    setCurrentUser("pi");
    const piView = await labApi.getSharedNotebooks();
    expect(piView.map((n) => n.id)).toEqual([nb.id]);

    // The missing copy was lazily backfilled into pi's folder, owner = pi.
    const healed = memFs.get(notebookCopyPath("pi", nb.id)) as typeof nb;
    expect(healed?.id).toBe(nb.id);
    expect(healed.owner).toBe("pi");
    expect(healed.members).toEqual(["student", "pi"]);
    expect(healed.created_by).toBe("student");

    // Idempotent: still listed exactly once on a second read.
    const again = await labApi.getSharedNotebooks();
    expect(again.map((n) => n.id)).toEqual([nb.id]);
  });

  it("does NOT backfill a non-member who merely reads (membership gate holds)", async () => {
    setCurrentUser("student");
    const nb = await sharedNotebooksApi.create({ otherMember: "pi" });

    // `other` is not a member; reading surfaces nothing and writes no copy.
    setCurrentUser("other");
    expect(await labApi.getSharedNotebooks()).toEqual([]);
    expect(memFs.get(notebookCopyPath("other", nb.id))).toBeUndefined();
  });
});
