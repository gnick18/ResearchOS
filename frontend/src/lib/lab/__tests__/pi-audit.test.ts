import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  appendAuditEntries,
  buildFieldDiffEntries,
  readAuditEntries,
} from "../pi-audit";

// Mock the file-system service for hermetic tests.
const fakeFiles: Record<string, unknown> = {};
vi.mock("../../file-system/file-service", () => ({
  fileService: {
    readJson: vi.fn(async (path: string) => fakeFiles[path] ?? null),
    writeJson: vi.fn(async (path: string, data: unknown) => {
      fakeFiles[path] = data;
    }),
    fileExists: vi.fn(async (path: string) => path in fakeFiles),
    deleteFile: vi.fn(async (path: string) => {
      const had = path in fakeFiles;
      delete fakeFiles[path];
      return had;
    }),
  },
}));

describe("pi-audit", () => {
  beforeEach(() => {
    for (const k of Object.keys(fakeFiles)) delete fakeFiles[k];
  });

  it("readAuditEntries returns [] when file is missing", async () => {
    const got = await readAuditEntries("alex");
    expect(got).toEqual([]);
  });

  it("appendAuditEntries creates the file on first write", async () => {
    await appendAuditEntries("alex", [
      {
        session_id: "s1",
        actor: "mira",
        target_user: "alex",
        record_type: "task",
        record_id: 7,
        field_path: "name",
        old_value: "old",
        new_value: "new",
      },
    ]);
    const got = await readAuditEntries("alex");
    expect(got).toHaveLength(1);
    expect(got[0].actor).toBe("mira");
    expect(got[0].old_value).toBe("old");
    expect(got[0].new_value).toBe("new");
    expect(got[0].id).toBeTruthy();
    expect(got[0].timestamp).toBeTruthy();
  });

  it("appendAuditEntries is append-only across calls", async () => {
    await appendAuditEntries("alex", [
      {
        session_id: "s1",
        actor: "mira",
        target_user: "alex",
        record_type: "task",
        record_id: 1,
        field_path: "name",
        old_value: "a",
        new_value: "b",
      },
    ]);
    await appendAuditEntries("alex", [
      {
        session_id: "s1",
        actor: "mira",
        target_user: "alex",
        record_type: "task",
        record_id: 1,
        field_path: "start_date",
        old_value: "2026-01-01",
        new_value: "2026-02-01",
      },
    ]);
    const got = await readAuditEntries("alex");
    expect(got).toHaveLength(2);
    expect(got[0].field_path).toBe("name");
    expect(got[1].field_path).toBe("start_date");
  });

  it("buildFieldDiffEntries skips unchanged fields", () => {
    const entries = buildFieldDiffEntries({
      actor: "mira",
      session_id: "s1",
      target_user: "alex",
      record_type: "task",
      record_id: 1,
      oldRecord: { name: "old", duration_days: 5 },
      newRecord: { name: "new", duration_days: 5 },
      fieldPaths: ["name", "duration_days"],
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].field_path).toBe("name");
  });

  it("buildFieldDiffEntries produces one entry per changed field", () => {
    const entries = buildFieldDiffEntries({
      actor: "mira",
      session_id: "s1",
      target_user: "alex",
      record_type: "task",
      record_id: 1,
      oldRecord: { name: "old", duration_days: 5 },
      newRecord: { name: "new", duration_days: 7 },
      fieldPaths: ["name", "duration_days"],
    });
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.field_path).sort()).toEqual([
      "duration_days",
      "name",
    ]);
  });

  it("buildFieldDiffEntries detects structural inequality on objects", () => {
    const entries = buildFieldDiffEntries({
      actor: "mira",
      session_id: "s1",
      target_user: "alex",
      record_type: "task",
      record_id: 1,
      oldRecord: { sub_tasks: [{ id: 1, done: false }] },
      newRecord: { sub_tasks: [{ id: 1, done: true }] },
      fieldPaths: ["sub_tasks"],
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].field_path).toBe("sub_tasks");
  });

  it("concurrent appendAuditEntries calls don't truncate entries (P0 #3 race)", async () => {
    // Mira-Distracted P0 #3 regression guard (2026-05-23): simulate two
    // tabs racing to append. Before the per-user write queue, the second
    // writer would read the old file (pre-first-write), splice its own
    // entry onto the stale tail, and overwrite — silently dropping the
    // first writer's entry. With the queue both entries must land.
    const a = appendAuditEntries("alex", [
      {
        session_id: "s1",
        actor: "mira",
        target_user: "alex",
        record_type: "task",
        record_id: 1,
        field_path: "name",
        old_value: "a",
        new_value: "b",
      },
    ]);
    const b = appendAuditEntries("alex", [
      {
        session_id: "s2",
        actor: "mira",
        target_user: "alex",
        record_type: "task",
        record_id: 2,
        field_path: "name",
        old_value: "c",
        new_value: "d",
      },
    ]);
    await Promise.all([a, b]);
    const got = await readAuditEntries("alex");
    expect(got).toHaveLength(2);
    const ids = got.map((e) => e.record_id).sort();
    expect(ids).toEqual([1, 2]);
  });
});
