// Cross-owner task → project sharing — drift normalize + share/unshare
// round-trips. The normalize function is pure (over an injected loadTask
// callback) so most of the coverage here doesn't need a fileService mock.
//
// The share/unshare flow IS tested against a fileService mock so we can
// assert the manifest sidecar lands on disk and the task carries the
// matching `external_project` ref.

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ProjectHostedManifest, Task } from "../types";

// ── Mock surface ─────────────────────────────────────────────────────────────

const memFs = new Map<string, unknown>();

vi.mock("../file-system/file-service", () => ({
  fileService: {
    readJson: vi.fn(async (path: string) => {
      const v = memFs.get(path);
      return v === undefined ? null : v;
    }),
    writeJson: vi.fn(async (path: string, data: unknown) => {
      memFs.set(path, data);
    }),
    deleteFile: vi.fn(async (path: string) => {
      memFs.delete(path);
      return true;
    }),
    isConnected: vi.fn(() => true),
  },
}));

import {
  normalizeProjectHostedManifest,
  readHostedManifestNormalized,
  shareIntoProject,
  unshareFromProject,
  reconcileHostedDrift,
  hostedManifestPath,
  __testing__,
} from "./project-hosting";

function makeTask(over: Partial<Task> = {}): Task {
  const base: Task = {
    id: 1,
    project_id: 0,
    name: "demo task",
    start_date: "2026-05-14",
    duration_days: 1,
    end_date: "2026-05-14",
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
    owner: "alex",
    shared_with: [],
    external_project: null,
  };
  return { ...base, ...over };
}

beforeEach(() => {
  memFs.clear();
});

// ─────────────────────────────────────────────────────────────────────────────
// normalize — drift detection
// ─────────────────────────────────────────────────────────────────────────────

describe("normalizeProjectHostedManifest", () => {
  it("keeps an entry whose task agrees on both sides", async () => {
    const task = makeTask({
      id: 5,
      owner: "alex",
      external_project: { owner: "morgan", id: 1, sharedAt: "2026-05-14T00:00:00Z" },
    });
    const manifest: ProjectHostedManifest = {
      version: 1,
      hostedTasks: [
        { owner: "alex", taskId: 5, sharedAt: "2026-05-14T00:00:00Z", sharedBy: "alex" },
      ],
    };
    const report = await normalizeProjectHostedManifest("morgan", 1, manifest, async (owner, id) => {
      if (owner === "alex" && id === 5) return task;
      return null;
    });
    expect(report.kept).toHaveLength(1);
    expect(report.dropped).toHaveLength(0);
    expect(report.changed).toBe(false);
  });

  it("drops an entry pointing at a missing task", async () => {
    const manifest: ProjectHostedManifest = {
      version: 1,
      hostedTasks: [
        { owner: "alex", taskId: 99, sharedAt: "2026-05-14T00:00:00Z", sharedBy: "alex" },
      ],
    };
    const report = await normalizeProjectHostedManifest("morgan", 1, manifest, async () => null);
    expect(report.kept).toHaveLength(0);
    expect(report.dropped).toHaveLength(1);
    expect(report.dropped[0].reason).toBe("task file not found");
    expect(report.changed).toBe(true);
  });

  it("drops an entry whose task has no external_project (the unshare-drift case)", async () => {
    const task = makeTask({ id: 5, external_project: null });
    const manifest: ProjectHostedManifest = {
      version: 1,
      hostedTasks: [
        { owner: "alex", taskId: 5, sharedAt: "2026-05-14T00:00:00Z", sharedBy: "alex" },
      ],
    };
    const report = await normalizeProjectHostedManifest("morgan", 1, manifest, async () => task);
    expect(report.dropped).toHaveLength(1);
    expect(report.dropped[0].reason).toContain("no external_project");
    expect(report.changed).toBe(true);
  });

  it("drops an entry whose task points at a different project", async () => {
    const task = makeTask({
      id: 5,
      external_project: { owner: "kritika", id: 7, sharedAt: "2026-05-14T00:00:00Z" },
    });
    const manifest: ProjectHostedManifest = {
      version: 1,
      hostedTasks: [
        { owner: "alex", taskId: 5, sharedAt: "2026-05-14T00:00:00Z", sharedBy: "alex" },
      ],
    };
    const report = await normalizeProjectHostedManifest("morgan", 1, manifest, async () => task);
    expect(report.dropped).toHaveLength(1);
    expect(report.dropped[0].reason).toContain("points elsewhere");
  });

  it("drops duplicate entries on the same (owner, taskId)", async () => {
    const task = makeTask({
      id: 5,
      external_project: { owner: "morgan", id: 1, sharedAt: "2026-05-14T00:00:00Z" },
    });
    const manifest: ProjectHostedManifest = {
      version: 1,
      hostedTasks: [
        { owner: "alex", taskId: 5, sharedAt: "2026-05-14T00:00:00Z", sharedBy: "alex" },
        { owner: "alex", taskId: 5, sharedAt: "2026-05-15T00:00:00Z", sharedBy: "alex" },
      ],
    };
    const report = await normalizeProjectHostedManifest("morgan", 1, manifest, async () => task);
    expect(report.kept).toHaveLength(1);
    expect(report.dropped).toHaveLength(1);
    expect(report.dropped[0].reason).toContain("duplicate");
  });

  it("drops malformed entries (missing fields, wrong types)", async () => {
    const manifest: ProjectHostedManifest = {
      version: 1,
      hostedTasks: [
        // @ts-expect-error — testing runtime malformation tolerance
        { owner: "alex" },
        // @ts-expect-error — testing runtime malformation tolerance
        { taskId: 5, sharedAt: "x", sharedBy: "alex" },
        // @ts-expect-error — testing runtime malformation tolerance
        null,
      ],
    };
    const report = await normalizeProjectHostedManifest("morgan", 1, manifest, async () => null);
    expect(report.kept).toHaveLength(0);
    expect(report.dropped).toHaveLength(3);
    expect(report.dropped.every((d) => d.reason === "malformed entry")).toBe(true);
  });

  it("keeps entries when loadTask throws (transient IO not treated as drift)", async () => {
    const manifest: ProjectHostedManifest = {
      version: 1,
      hostedTasks: [
        { owner: "alex", taskId: 5, sharedAt: "2026-05-14T00:00:00Z", sharedBy: "alex" },
      ],
    };
    const report = await normalizeProjectHostedManifest("morgan", 1, manifest, async () => {
      throw new Error("disk hiccup");
    });
    expect(report.kept).toHaveLength(1);
    expect(report.dropped).toHaveLength(0);
  });

  it("is idempotent — running the kept set back through yields the same kept set", async () => {
    const task = makeTask({
      id: 5,
      external_project: { owner: "morgan", id: 1, sharedAt: "2026-05-14T00:00:00Z" },
    });
    const m1: ProjectHostedManifest = {
      version: 1,
      hostedTasks: [
        { owner: "alex", taskId: 5, sharedAt: "2026-05-14T00:00:00Z", sharedBy: "alex" },
        { owner: "alex", taskId: 99, sharedAt: "x", sharedBy: "alex" }, // drift
      ],
    };
    const r1 = await normalizeProjectHostedManifest("morgan", 1, m1, async (owner, id) => {
      if (owner === "alex" && id === 5) return task;
      return null;
    });
    const m2: ProjectHostedManifest = { version: 1, hostedTasks: r1.kept };
    const r2 = await normalizeProjectHostedManifest("morgan", 1, m2, async (owner, id) => {
      if (owner === "alex" && id === 5) return task;
      return null;
    });
    expect(r2.kept).toEqual(r1.kept);
    expect(r2.changed).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// share / unshare round-trip
// ─────────────────────────────────────────────────────────────────────────────

describe("shareIntoProject / unshareFromProject", () => {
  it("writes both sides (task.external_project + manifest entry) atomically", async () => {
    const task = makeTask({ id: 5, owner: "alex" });
    const fakeTasks = new Map<string, Task>([["alex:5", task]]);
    const result = await shareIntoProject(
      { taskOwner: "alex", taskId: 5, projectOwner: "morgan", projectId: 1 },
      {
        loadTask: async (owner, id) => fakeTasks.get(`${owner}:${id}`) ?? null,
        saveTask: async (owner, t) => {
          fakeTasks.set(`${owner}:${t.id}`, t);
        },
        sharedBy: "alex",
      }
    );

    expect(result.alreadyShared).toBe(false);
    expect(result.task.external_project).toEqual(
      expect.objectContaining({ owner: "morgan", id: 1 })
    );

    const manifest = memFs.get(hostedManifestPath("morgan", 1)) as ProjectHostedManifest;
    expect(manifest).toBeDefined();
    expect(manifest.hostedTasks).toHaveLength(1);
    expect(manifest.hostedTasks[0]).toMatchObject({
      owner: "alex",
      taskId: 5,
      sharedBy: "alex",
    });
  });

  it("refuses to share into the task owner's own project", async () => {
    const task = makeTask({ id: 5, owner: "alex" });
    const fakeTasks = new Map<string, Task>([["alex:5", task]]);
    await expect(
      shareIntoProject(
        { taskOwner: "alex", taskId: 5, projectOwner: "alex", projectId: 2 },
        {
          loadTask: async (owner, id) => fakeTasks.get(`${owner}:${id}`) ?? null,
          saveTask: async (owner, t) => {
            fakeTasks.set(`${owner}:${t.id}`, t);
          },
          sharedBy: "alex",
        }
      )
    ).rejects.toThrow(/use tasksApi.update/);
  });

  it("refuses to re-host a task already hosted in a DIFFERENT project", async () => {
    const task = makeTask({
      id: 5,
      owner: "alex",
      external_project: { owner: "kritika", id: 9, sharedAt: "2026-05-13T00:00:00Z" },
    });
    const fakeTasks = new Map<string, Task>([["alex:5", task]]);
    await expect(
      shareIntoProject(
        { taskOwner: "alex", taskId: 5, projectOwner: "morgan", projectId: 1 },
        {
          loadTask: async (owner, id) => fakeTasks.get(`${owner}:${id}`) ?? null,
          saveTask: async (owner, t) => {
            fakeTasks.set(`${owner}:${t.id}`, t);
          },
          sharedBy: "alex",
        }
      )
    ).rejects.toThrow(/unshare first/);
  });

  it("is idempotent on a redundant share into the same project", async () => {
    const task = makeTask({
      id: 5,
      owner: "alex",
      external_project: { owner: "morgan", id: 1, sharedAt: "2026-05-13T00:00:00Z" },
    });
    const fakeTasks = new Map<string, Task>([["alex:5", task]]);
    // Pre-seed the manifest so the second call's "already shared" branch
    // doesn't have to create the entry from scratch.
    memFs.set(hostedManifestPath("morgan", 1), {
      version: 1,
      hostedTasks: [
        { owner: "alex", taskId: 5, sharedAt: "2026-05-13T00:00:00Z", sharedBy: "alex" },
      ],
    });
    const result = await shareIntoProject(
      { taskOwner: "alex", taskId: 5, projectOwner: "morgan", projectId: 1 },
      {
        loadTask: async (owner, id) => fakeTasks.get(`${owner}:${id}`) ?? null,
        saveTask: async (owner, t) => {
          fakeTasks.set(`${owner}:${t.id}`, t);
        },
        sharedBy: "alex",
      }
    );
    expect(result.alreadyShared).toBe(true);
    // Manifest still has exactly one entry — no duplication.
    const manifest = memFs.get(hostedManifestPath("morgan", 1)) as ProjectHostedManifest;
    expect(manifest.hostedTasks).toHaveLength(1);
  });

  it("unshare clears both sides", async () => {
    const task = makeTask({
      id: 5,
      owner: "alex",
      external_project: { owner: "morgan", id: 1, sharedAt: "2026-05-13T00:00:00Z" },
    });
    const fakeTasks = new Map<string, Task>([["alex:5", task]]);
    memFs.set(hostedManifestPath("morgan", 1), {
      version: 1,
      hostedTasks: [
        { owner: "alex", taskId: 5, sharedAt: "2026-05-13T00:00:00Z", sharedBy: "alex" },
      ],
    });

    const result = await unshareFromProject(
      { taskOwner: "alex", taskId: 5, projectOwner: "morgan", projectId: 1 },
      {
        loadTask: async (owner, id) => fakeTasks.get(`${owner}:${id}`) ?? null,
        saveTask: async (owner, t) => {
          fakeTasks.set(`${owner}:${t.id}`, t);
        },
      }
    );
    expect(result.task?.external_project).toBeNull();

    const manifest = memFs.get(hostedManifestPath("morgan", 1)) as ProjectHostedManifest;
    expect(manifest.hostedTasks).toHaveLength(0);
  });

  it("unshare is a no-op when both sides already cleared", async () => {
    const task = makeTask({ id: 5, owner: "alex", external_project: null });
    const fakeTasks = new Map<string, Task>([["alex:5", task]]);
    const result = await unshareFromProject(
      { taskOwner: "alex", taskId: 5, projectOwner: "morgan", projectId: 1 },
      {
        loadTask: async (owner, id) => fakeTasks.get(`${owner}:${id}`) ?? null,
        saveTask: async (owner, t) => {
          fakeTasks.set(`${owner}:${t.id}`, t);
        },
      }
    );
    expect(result.task?.external_project).toBeFalsy();
  });

  it("unshare doesn't clobber a task whose external_project was redirected to a different project", async () => {
    // Stale UI: morgan clicks "remove from project" but in the meantime the
    // task owner reshared to kritika's project. We should still drop the
    // manifest entry on morgan's side but leave the task's external_project
    // pointing at kritika.
    const task = makeTask({
      id: 5,
      owner: "alex",
      external_project: { owner: "kritika", id: 9, sharedAt: "2026-05-15T00:00:00Z" },
    });
    const fakeTasks = new Map<string, Task>([["alex:5", task]]);
    memFs.set(hostedManifestPath("morgan", 1), {
      version: 1,
      hostedTasks: [
        { owner: "alex", taskId: 5, sharedAt: "2026-05-13T00:00:00Z", sharedBy: "alex" },
      ],
    });
    const result = await unshareFromProject(
      { taskOwner: "alex", taskId: 5, projectOwner: "morgan", projectId: 1 },
      {
        loadTask: async (owner, id) => fakeTasks.get(`${owner}:${id}`) ?? null,
        saveTask: async (owner, t) => {
          fakeTasks.set(`${owner}:${t.id}`, t);
        },
      }
    );
    expect(result.task?.external_project).toEqual(
      expect.objectContaining({ owner: "kritika", id: 9 })
    );
    const manifest = memFs.get(hostedManifestPath("morgan", 1)) as ProjectHostedManifest;
    expect(manifest.hostedTasks).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// readHostedManifestNormalized — write-back of repaired manifest on read
// ─────────────────────────────────────────────────────────────────────────────

describe("readHostedManifestNormalized", () => {
  it("persists the repaired manifest back to disk on a drift read", async () => {
    // Seed a drifted manifest (task missing).
    memFs.set(hostedManifestPath("morgan", 1), {
      version: 1,
      hostedTasks: [
        { owner: "alex", taskId: 5, sharedAt: "2026-05-13T00:00:00Z", sharedBy: "alex" },
        { owner: "alex", taskId: 99, sharedAt: "x", sharedBy: "alex" }, // missing task
      ],
    });
    const task = makeTask({
      id: 5,
      owner: "alex",
      external_project: { owner: "morgan", id: 1, sharedAt: "2026-05-13T00:00:00Z" },
    });
    const kept = await readHostedManifestNormalized("morgan", 1, async (owner, id) => {
      if (owner === "alex" && id === 5) return task;
      return null;
    });
    expect(kept).toHaveLength(1);
    // Allow microtask flush for the async write-back.
    await new Promise((r) => setTimeout(r, 0));
    const writtenBack = memFs.get(hostedManifestPath("morgan", 1)) as ProjectHostedManifest;
    expect(writtenBack.hostedTasks).toHaveLength(1);
    expect(writtenBack.hostedTasks[0].taskId).toBe(5);
  });

  it("does NOT write back if no drift was found", async () => {
    memFs.set(hostedManifestPath("morgan", 1), {
      version: 1,
      hostedTasks: [
        { owner: "alex", taskId: 5, sharedAt: "2026-05-13T00:00:00Z", sharedBy: "alex" },
      ],
    });
    const task = makeTask({
      id: 5,
      external_project: { owner: "morgan", id: 1, sharedAt: "2026-05-13T00:00:00Z" },
    });
    const fileService = (await import("../file-system/file-service")).fileService;
    const writeSpy = vi.mocked(fileService.writeJson);
    writeSpy.mockClear();
    await readHostedManifestNormalized("morgan", 1, async () => task);
    await new Promise((r) => setTimeout(r, 0));
    expect(writeSpy).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// reconcileHostedDrift — Phase-5 background sweep
// ─────────────────────────────────────────────────────────────────────────────

describe("reconcileHostedDrift", () => {
  it("detects mirror drift (task has external_project but manifest is missing the entry)", async () => {
    const task = makeTask({
      id: 5,
      owner: "alex",
      external_project: { owner: "morgan", id: 1, sharedAt: "2026-05-13T00:00:00Z" },
    });
    // Manifest exists but is empty — classic mirror drift.
    memFs.set(hostedManifestPath("morgan", 1), { version: 1, hostedTasks: [] });

    const appended: Array<{ projectOwner: string; projectId: number; taskOwner: string; taskId: number }> = [];
    const report = await reconcileHostedDrift({
      hostedManifests: [{ projectOwner: "morgan", projectId: 1 }],
      tasks: [task],
      loadTask: async (owner, id) =>
        owner === "alex" && id === 5 ? task : null,
      appendEntry: async (projectOwner, projectId, entry) => {
        appended.push({
          projectOwner,
          projectId,
          taskOwner: entry.owner,
          taskId: entry.taskId,
        });
      },
      saveTask: async () => {},
      apply: true,
    });
    expect(report.mirrorDriftAppended).toHaveLength(1);
    expect(appended).toHaveLength(1);
    expect(appended[0]).toEqual({
      projectOwner: "morgan",
      projectId: 1,
      taskOwner: "alex",
      taskId: 5,
    });
  });

  it("reports unknown destinations (project not in caller's enumeration)", async () => {
    const task = makeTask({
      id: 5,
      external_project: { owner: "kritika", id: 9, sharedAt: "2026-05-13T00:00:00Z" },
    });
    const report = await reconcileHostedDrift({
      hostedManifests: [{ projectOwner: "morgan", projectId: 1 }],
      tasks: [task],
      loadTask: async () => task,
      appendEntry: async () => {
        throw new Error("should not append for unknown destination");
      },
      saveTask: async () => {},
      apply: true,
    });
    expect(report.unknownDestinations).toHaveLength(1);
    expect(report.unknownDestinations[0].ref).toEqual(
      expect.objectContaining({ owner: "kritika", id: 9 })
    );
    expect(report.mirrorDriftAppended).toHaveLength(0);
  });

  it("dry-run (apply=false) reports drift but doesn't mutate", async () => {
    const task = makeTask({
      id: 5,
      external_project: { owner: "morgan", id: 1, sharedAt: "2026-05-13T00:00:00Z" },
    });
    memFs.set(hostedManifestPath("morgan", 1), { version: 1, hostedTasks: [] });

    let appendCalled = false;
    const report = await reconcileHostedDrift({
      hostedManifests: [{ projectOwner: "morgan", projectId: 1 }],
      tasks: [task],
      loadTask: async () => task,
      appendEntry: async () => {
        appendCalled = true;
      },
      saveTask: async () => {},
      apply: false,
    });
    expect(report.mirrorDriftAppended).toHaveLength(1);
    expect(appendCalled).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// internal helpers (exposed via __testing__)
// ─────────────────────────────────────────────────────────────────────────────

describe("appendManifestEntry / removeManifestEntry", () => {
  it("appendManifestEntry adds + dedups", async () => {
    const task = makeTask({
      id: 5,
      external_project: { owner: "morgan", id: 1, sharedAt: "2026-05-13T00:00:00Z" },
    });
    await __testing__.appendManifestEntry(
      "morgan",
      1,
      { owner: "alex", taskId: 5, sharedAt: "x", sharedBy: "alex" },
      async () => task
    );
    await __testing__.appendManifestEntry(
      "morgan",
      1,
      { owner: "alex", taskId: 5, sharedAt: "y", sharedBy: "alex" },
      async () => task
    );
    const m = memFs.get(hostedManifestPath("morgan", 1)) as ProjectHostedManifest;
    expect(m.hostedTasks).toHaveLength(1);
  });

  it("removeManifestEntry is idempotent on absent entries", async () => {
    memFs.set(hostedManifestPath("morgan", 1), { version: 1, hostedTasks: [] });
    await __testing__.removeManifestEntry("morgan", 1, "alex", 99, async () => null);
    const m = memFs.get(hostedManifestPath("morgan", 1)) as ProjectHostedManifest;
    expect(m.hostedTasks).toHaveLength(0);
  });
});
