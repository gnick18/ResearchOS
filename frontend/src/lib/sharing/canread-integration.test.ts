// frontend/src/lib/sharing/canread-integration.test.ts
//
// Regression-test wave 1 (PRIVACY + DATA INTEGRITY at the logic layer).
//
// `unified.test.ts` already covers `canRead` as a PURE function over
// hand-built record literals. This file is the INTEGRATION sibling: it
// runs the REAL `canRead` over records that were actually persisted and
// read back through the REAL `JsonStore.listAllForUser` against an
// in-memory file service. The point is to catch the class of bug an
// over-mocked unit test misses: a record that round-trips through the
// store with a subtly different shape (e.g. legacy `permission` field,
// "*" sentinel, missing `shared_with`) and then leaks through a viewer
// filter built on `canRead`.
//
// It ALSO exercises the production cross-user reader
// `fetchAllTasksIncludingShared` (the real `_shared_with_me.json` join)
// to prove the leak guard end to end: a task user A privately owns and
// never shared is NEVER surfaced to an unrelated user B.
//
// Coverage:
//   canRead matrix (over store-loaded records):
//     - owner reads own
//     - explicit read-share AND edit-share are both readable by recipient
//     - "*" sentinel readable by every lab member
//     - lab_head implicit view-all
//     - LEAK GUARD: a record shared with X is NOT readable by unrelated Y
//   labApi.getNotes({ shared_only }): filters to is_shared notes only.
//   fetchAllTasksIncludingShared: a non-recipient never receives another
//     user's private task; a recipient with a _shared_with_me entry does.

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Task, Note, SharedUser } from "../types";

// ── Faithful in-memory file service (path -> JSON; listFiles by prefix) ──────
const memFs = new Map<string, unknown>();
let currentUserMock = "alex";

function listFilesImpl(dirPath: string): string[] {
  const prefix = `${dirPath}/`;
  const names: string[] = [];
  for (const key of memFs.keys()) {
    if (!key.startsWith(prefix)) continue;
    const rest = key.slice(prefix.length);
    if (rest.includes("/")) continue;
    names.push(rest);
  }
  return names;
}

function listDirectoriesImpl(dirPath: string): string[] {
  const prefix = `${dirPath}/`;
  const dirs = new Set<string>();
  for (const key of memFs.keys()) {
    if (!key.startsWith(prefix)) continue;
    const rest = key.slice(prefix.length);
    const slash = rest.indexOf("/");
    if (slash > 0) dirs.add(rest.slice(0, slash));
  }
  return Array.from(dirs);
}

vi.mock("../file-system/file-service", () => ({
  fileService: {
    readJson: vi.fn(async (path: string) => {
      const v = memFs.get(path);
      return v === undefined ? null : v;
    }),
    writeJson: vi.fn(async (path: string, data: unknown) => {
      memFs.set(path, JSON.parse(JSON.stringify(data)));
    }),
    readText: vi.fn(async () => null),
    writeText: vi.fn(async () => {}),
    ensureDir: vi.fn(async () => null),
    fileExists: vi.fn(async (path: string) => memFs.has(path)),
    listFiles: vi.fn(async (dirPath: string) => listFilesImpl(dirPath)),
    listDirectories: vi.fn(async (dirPath: string) =>
      listDirectoriesImpl(dirPath),
    ),
    deleteFile: vi.fn(async (path: string) => memFs.delete(path)),
    isConnected: vi.fn(() => true),
    getDirectoryHandle: vi.fn(() => ({})),
    getDirectory: vi.fn(async () => null),
  },
}));

vi.mock("../file-system/indexeddb-store", () => ({
  getCurrentUser: vi.fn(async () => currentUserMock),
  storeCurrentUser: vi.fn(async () => {}),
  clearCurrentUser: vi.fn(async () => {}),
}));

// Imports after mocks.
import { canRead, type Viewer, type ShareableRecord } from "./unified";
import { JsonStore, clearCurrentUserCache } from "../storage/json-store";
import { labApi, fetchAllTasksIncludingShared } from "../local-api";

const notesStore = new JsonStore<Note>("notes");
const tasksStore = new JsonStore<Task>("tasks");

function setCurrentUser(name: string): void {
  currentUserMock = name;
  clearCurrentUserCache();
}

const labViewer = (username: string): Viewer => ({
  username,
  account_type: "lab",
});
const labHeadViewer = (username: string): Viewer => ({
  username,
  account_type: "lab_head",
});

function seedNote(owner: string, overrides: Partial<Note> & { id: number }): Note {
  const note: Note = {
    title: "lab note",
    description: "",
    is_running_log: false,
    is_shared: false,
    entries: [],
    updated_at: "2026-05-21T00:00:00.000Z",
    username: owner,
    owner,
    shared_with: [],
    ...overrides,
  } as Note;
  memFs.set(`users/${owner}/notes/${note.id}.json`, note);
  return note;
}

function seedTask(owner: string, overrides: Partial<Task> & { id: number }): Task {
  const task: Task = {
    project_id: 1,
    name: "private experiment",
    start_date: "2026-05-21",
    duration_days: 1,
    end_date: "2026-05-21",
    is_high_level: false,
    is_complete: false,
    task_type: "experiment",
    weekend_override: null,
    method_ids: [],
    deviation_log: null,
    tags: null,
    sort_order: 0,
    experiment_color: null,
    sub_tasks: null,
    method_attachments: [],
    owner,
    shared_with: [],
    ...overrides,
  } as Task;
  memFs.set(`users/${owner}/tasks/${task.id}.json`, task);
  return task;
}

beforeEach(() => {
  memFs.clear();
  setCurrentUser("alex");
});

describe("canRead over store-loaded records — matrix", () => {
  it("owner reads their own record (loaded from disk)", async () => {
    seedNote("alex", { id: 1 });
    const [note] = await notesStore.listAllForUser("alex");
    expect(canRead(note as unknown as ShareableRecord, labViewer("alex"))).toBe(
      true,
    );
  });

  it("explicit read-share is readable by the recipient", async () => {
    seedNote("alex", {
      id: 1,
      shared_with: [{ username: "morgan", level: "read" }] as SharedUser[],
    });
    const [note] = await notesStore.listAllForUser("alex");
    expect(
      canRead(note as unknown as ShareableRecord, labViewer("morgan")),
    ).toBe(true);
  });

  it("explicit edit-share is also readable by the recipient", async () => {
    seedNote("alex", {
      id: 1,
      shared_with: [{ username: "morgan", level: "edit" }] as SharedUser[],
    });
    const [note] = await notesStore.listAllForUser("alex");
    expect(
      canRead(note as unknown as ShareableRecord, labViewer("morgan")),
    ).toBe(true);
  });

  it("legacy permission field (view) round-trips through the store and still reads", async () => {
    seedNote("alex", {
      id: 1,
      shared_with: [
        { username: "morgan", permission: "view" } as unknown as SharedUser,
      ],
    });
    const [note] = await notesStore.listAllForUser("alex");
    expect(
      canRead(note as unknown as ShareableRecord, labViewer("morgan")),
    ).toBe(true);
  });

  it('"*" sentinel is readable by every lab member', async () => {
    seedNote("alex", {
      id: 1,
      shared_with: [{ username: "*", level: "read" }] as SharedUser[],
    });
    const [note] = await notesStore.listAllForUser("alex");
    expect(canRead(note as unknown as ShareableRecord, labViewer("morgan"))).toBe(
      true,
    );
    expect(canRead(note as unknown as ShareableRecord, labViewer("sam"))).toBe(
      true,
    );
  });

  it("lab_head has implicit view-all on a record never shared with them", async () => {
    seedNote("alex", { id: 1, shared_with: [] });
    const [note] = await notesStore.listAllForUser("alex");
    expect(
      canRead(note as unknown as ShareableRecord, labHeadViewer("mira")),
    ).toBe(true);
  });

  it("LEAK GUARD: a record shared with X is NOT readable by unrelated Y", async () => {
    seedNote("alex", {
      id: 1,
      shared_with: [{ username: "morgan", level: "edit" }] as SharedUser[],
    });
    const [note] = await notesStore.listAllForUser("alex");
    // morgan (the recipient) reads.
    expect(canRead(note as unknown as ShareableRecord, labViewer("morgan"))).toBe(
      true,
    );
    // sam (unrelated, non-lab-head) does NOT.
    expect(canRead(note as unknown as ShareableRecord, labViewer("sam"))).toBe(
      false,
    );
  });

  it("LEAK GUARD: an owner-only record is private to everyone but the owner + lab_head", async () => {
    seedNote("alex", { id: 1, shared_with: [] });
    const [note] = await notesStore.listAllForUser("alex");
    expect(canRead(note as unknown as ShareableRecord, labViewer("morgan"))).toBe(
      false,
    );
    expect(canRead(note as unknown as ShareableRecord, labViewer("sam"))).toBe(
      false,
    );
  });
});

describe("labApi.getNotes({ shared_only }) — shared filter", () => {
  it("returns only is_shared notes when shared_only is set", async () => {
    seedNote("alex", { id: 1, title: "private alex note", is_shared: false });
    seedNote("alex", { id: 2, title: "shared alex note", is_shared: true });
    seedNote("morgan", { id: 1, title: "private morgan note", is_shared: false });
    seedNote("morgan", { id: 2, title: "shared morgan note", is_shared: true });

    const shared = await labApi.getNotes({ shared_only: true });
    const titles = shared.map((n) => n.title).sort();
    expect(titles).toEqual(["shared alex note", "shared morgan note"]);
    // No private note slipped into the shared-only view.
    expect(shared.some((n) => n.is_shared === false)).toBe(false);
  });

  it("without shared_only, the lab-mode view returns all members' notes", async () => {
    seedNote("alex", { id: 1, title: "a", is_shared: false });
    seedNote("morgan", { id: 1, title: "m", is_shared: true });
    const all = await labApi.getNotes();
    expect(all.map((n) => n.title).sort()).toEqual(["a", "m"]);
  });
});

describe("fetchAllTasksIncludingShared — cross-user leak guard", () => {
  it("a viewer sees their OWN tasks", async () => {
    setCurrentUser("morgan");
    seedTask("morgan", { id: 1, name: "morgan own task" });

    const tasks = await fetchAllTasksIncludingShared();
    const names = tasks.map((t) => t.name);
    expect(names).toContain("morgan own task");
  });

  it("a non-recipient NEVER receives another user's private task", async () => {
    // alex privately owns task 1 and never shared it. morgan has an empty
    // (or absent) _shared_with_me manifest. morgan must not see it.
    seedTask("alex", { id: 1, name: "alex private task" });

    setCurrentUser("morgan");
    seedTask("morgan", { id: 1, name: "morgan own task" });
    // morgan's manifest is absent entirely (the common case).

    const tasks = await fetchAllTasksIncludingShared();
    const names = tasks.map((t) => t.name);
    expect(names).toContain("morgan own task");
    // The leak guard: alex's private task is absent from morgan's view.
    expect(names).not.toContain("alex private task");
    // And nothing in morgan's view is owned by alex.
    expect(tasks.some((t) => t.owner === "alex")).toBe(false);
  });

  it("a recipient with a _shared_with_me entry DOES receive the shared task", async () => {
    // alex shares task 1 with morgan via the receiver-side manifest.
    seedTask("alex", {
      id: 1,
      name: "alex shared task",
      shared_with: [{ username: "morgan", level: "edit" }] as SharedUser[],
    });

    setCurrentUser("morgan");
    memFs.set("users/morgan/_shared_with_me.json", {
      version: 1,
      projects: [],
      tasks: [
        {
          id: 1,
          owner: "alex",
          permission: "edit",
          shared_at: "2026-05-21T00:00:00.000Z",
        },
      ],
      methods: [],
    });

    const tasks = await fetchAllTasksIncludingShared();
    const shared = tasks.find((t) => t.owner === "alex" && t.id === 1);
    expect(shared).toBeDefined();
    expect(shared?.name).toBe("alex shared task");
    expect(shared?.is_shared_with_me).toBe(true);
    expect(shared?.shared_permission).toBe("edit");
  });

  it("a manifest entry that points at a deleted/absent task file does not crash or fabricate a record", async () => {
    // morgan's manifest references alex/tasks/9 but the file is gone.
    setCurrentUser("morgan");
    memFs.set("users/morgan/_shared_with_me.json", {
      version: 1,
      projects: [],
      tasks: [{ id: 9, owner: "alex", permission: "view" }],
      methods: [],
    });

    const tasks = await fetchAllTasksIncludingShared();
    // No phantom task synthesized for the missing file.
    expect(tasks.some((t) => t.owner === "alex" && t.id === 9)).toBe(false);
  });
});
