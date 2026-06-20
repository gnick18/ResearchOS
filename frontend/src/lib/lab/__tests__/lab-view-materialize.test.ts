// Multi-lab P2: materializeLabView unit tests.
//
// Covers the residency rule (own records skipped, never written back from R2),
// the shared-with-me write path (correct per-owner on-disk paths), the
// result_sheet / notes_sheet markdown special case, and unknown-type skipping.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect, vi } from "vitest";
import {
  materializeLabView,
  _RECORD_TYPE_TO_DIR_FOR_TEST,
  type MaterializeFileWriter,
} from "../lab-view-materialize";
import type { LabViewRecord } from "../lab-read";
import { LAB_WORK_TYPES } from "../lab-work-enumerate";

function enc(obj: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(obj));
}

function rec(over: Partial<LabViewRecord>): LabViewRecord {
  return {
    key: over.key ?? "lab1/morgan/note/10",
    owner: over.owner ?? "morgan",
    recordType: over.recordType ?? "note",
    recordId: over.recordId ?? "10",
    plaintext: over.plaintext ?? enc({ id: 10, body: "hi" }),
    isOwn: over.isOwn ?? false,
    sharedWithViewer: over.sharedWithViewer ?? true,
  };
}

function fakeWriter(): {
  writer: MaterializeFileWriter;
  writes: Array<{ path: string; text: string }>;
  dirs: string[];
} {
  const writes: Array<{ path: string; text: string }> = [];
  const dirs: string[] = [];
  const writer: MaterializeFileWriter = {
    ensureDir: vi.fn(async (path: string) => {
      dirs.push(path);
    }),
    writeText: vi.fn(async (path: string, text: string) => {
      writes.push({ path, text });
    }),
  };
  return { writer, writes, dirs };
}

describe("materializeLabView — residency", () => {
  it("SKIPS own records and never writes them back from R2", async () => {
    const { writer, writes } = fakeWriter();
    const records = [
      rec({ owner: "alex", isOwn: true, recordId: "1" }),
      rec({ owner: "alex", isOwn: true, recordId: "2" }),
    ];
    const result = await materializeLabView(records, writer);
    expect(result.skippedOwn).toBe(2);
    expect(result.written).toEqual([]);
    expect(writes).toEqual([]);
  });

  it("writes ONLY the shared-with-me half of an own-UNION-shared view", async () => {
    const { writer, writes } = fakeWriter();
    const records = [
      rec({ owner: "alex", isOwn: true, recordId: "1" }), // own: skip
      rec({ owner: "morgan", isOwn: false, recordId: "10" }), // shared: write
      rec({ owner: "sam", isOwn: false, recordId: "20" }), // shared: write
    ];
    const result = await materializeLabView(records, writer);
    expect(result.skippedOwn).toBe(1);
    expect(result.written).toEqual([
      "users/morgan/notes/10.json",
      "users/sam/notes/20.json",
    ]);
    expect(writes.map((w) => w.path)).toEqual([
      "users/morgan/notes/10.json",
      "users/sam/notes/20.json",
    ]);
  });
});

describe("materializeLabView — paths + types", () => {
  it("writes a shared record under the ORIGINAL owner's entity directory", async () => {
    const { writer, writes, dirs } = fakeWriter();
    const payload = { id: "ooo-1", owner: "morgan", members: ["morgan", "alex"] };
    const records = [
      rec({
        owner: "morgan",
        recordType: "one_on_one",
        recordId: "ooo-1",
        plaintext: enc(payload),
        isOwn: false,
      }),
    ];
    await materializeLabView(records, writer);
    expect(dirs).toContain("users/morgan/one_on_ones");
    expect(writes[0].path).toBe("users/morgan/one_on_ones/ooo-1.json");
    expect(JSON.parse(writes[0].text)).toEqual(payload);
  });

  it("maps task and experiment recordTypes to the shared tasks directory", async () => {
    const { writer, writes } = fakeWriter();
    const records = [
      rec({ owner: "morgan", recordType: "task", recordId: "5", isOwn: false }),
      rec({ owner: "morgan", recordType: "experiment", recordId: "6", isOwn: false }),
    ];
    await materializeLabView(records, writer);
    expect(writes.map((w) => w.path)).toEqual([
      "users/morgan/tasks/5.json",
      "users/morgan/tasks/6.json",
    ]);
  });

  it("writes result_sheet / notes_sheet as markdown under results/task-<id>", async () => {
    const { writer, writes, dirs } = fakeWriter();
    const records = [
      rec({
        owner: "morgan",
        recordType: "result_sheet",
        recordId: "7",
        plaintext: new TextEncoder().encode("# Results\nbands"),
        isOwn: false,
      }),
      rec({
        owner: "morgan",
        recordType: "notes_sheet",
        recordId: "7",
        plaintext: new TextEncoder().encode("# Notes\nran gel"),
        isOwn: false,
      }),
    ];
    await materializeLabView(records, writer);
    expect(dirs).toContain("users/morgan/results/task-7");
    expect(writes.map((w) => w.path)).toEqual([
      "users/morgan/results/task-7/results.md",
      "users/morgan/results/task-7/notes.md",
    ]);
    expect(writes[0].text).toContain("bands");
  });

  it("skips an unknown record type rather than guessing a path", async () => {
    const { writer, writes } = fakeWriter();
    const records = [
      rec({
        owner: "morgan",
        recordType: "mystery",
        recordId: "x",
        key: "lab1/morgan/mystery/x",
        isOwn: false,
      }),
    ];
    const result = await materializeLabView(records, writer);
    expect(result.skippedUnknownType).toEqual(["lab1/morgan/mystery/x"]);
    expect(writes).toEqual([]);
  });
});

describe("materializeLabView — announcements (lab-wide-public)", () => {
  it("aggregates announcement records into the root _announcements.json", async () => {
    const { writer, writes } = fakeWriter();
    const a1 = { id: "ann-1", author: "morgan", text: "Lab meeting Friday", created_at: "2026-06-18T00:00:00.000Z" };
    const a2 = { id: "ann-2", author: "morgan", text: "Freezer cleanout", created_at: "2026-06-18T01:00:00.000Z" };
    const records = [
      rec({ owner: "morgan", recordType: "announcement", recordId: "ann-1", plaintext: enc(a1), isOwn: false }),
      rec({ owner: "morgan", recordType: "announcement", recordId: "ann-2", plaintext: enc(a2), isOwn: false }),
    ];
    const result = await materializeLabView(records, writer);
    // Exactly one root-file write, no per-record files.
    expect(result.written).toEqual(["_announcements.json"]);
    expect(writes).toHaveLength(1);
    expect(writes[0].path).toBe("_announcements.json");
    expect(JSON.parse(writes[0].text)).toEqual({
      version: 1,
      announcements: [a1, a2],
    });
  });

  it("does NOT write _announcements.json when there are no announcement records", async () => {
    const { writer, writes } = fakeWriter();
    const records = [rec({ owner: "morgan", recordType: "note", recordId: "10", isOwn: false })];
    await materializeLabView(records, writer);
    expect(writes.map((w) => w.path)).not.toContain("_announcements.json");
  });

  it("skips an own announcement (residency) and never writes it back", async () => {
    const { writer, writes } = fakeWriter();
    const a1 = { id: "ann-1", author: "morgan", text: "x", created_at: "2026-06-18T00:00:00.000Z" };
    const records = [
      // morgan IS the viewer here, so their own announcement is the source of
      // truth in the local root file and must NOT be rewritten from R2.
      rec({ owner: "morgan", recordType: "announcement", recordId: "ann-1", plaintext: enc(a1), isOwn: true }),
    ];
    const result = await materializeLabView(records, writer);
    expect(result.skippedOwn).toBe(1);
    expect(writes).toEqual([]);
  });
});

describe("materializeLabView — class_dashboard (lab-wide-public, CT-5)", () => {
  it("caches the singleton class_dashboard to the root _class_dashboard.json", async () => {
    const { writer, writes } = fakeWriter();
    const tpl = { tabs: ["notes"], landingTab: "notes", rev: 2 };
    const records = [
      rec({ owner: "morgan", recordType: "class_dashboard", recordId: "class", plaintext: enc(tpl), isOwn: false }),
    ];
    const result = await materializeLabView(records, writer);
    expect(result.written).toEqual(["_class_dashboard.json"]);
    expect(writes).toHaveLength(1);
    expect(writes[0].path).toBe("_class_dashboard.json");
    expect(JSON.parse(writes[0].text)).toEqual(tpl);
  });

  it("does NOT write _class_dashboard.json when there is no class_dashboard record", async () => {
    const { writer, writes } = fakeWriter();
    const records = [rec({ owner: "morgan", recordType: "note", recordId: "10", isOwn: false })];
    await materializeLabView(records, writer);
    expect(writes.map((w) => w.path)).not.toContain("_class_dashboard.json");
  });
});

describe("materializeLabView — class_assignment (CT-2 student-open)", () => {
  it("aggregates pulled class_assignment payloads into root _class_assignments.json", async () => {
    const { writer, writes } = fakeWriter();
    const a1 = { assignmentId: "asg-1", title: "First", instructor: "prof", checklist: [] };
    const a2 = { assignmentId: "asg-2", title: "Second", instructor: "prof", checklist: [] };
    const records = [
      rec({ owner: "prof", recordType: "class_assignment", recordId: "asg-1", plaintext: enc(a1), isOwn: false }),
      rec({ owner: "prof", recordType: "class_assignment", recordId: "asg-2", plaintext: enc(a2), isOwn: false }),
    ];
    const result = await materializeLabView(records, writer);
    expect(result.written).toEqual(["_class_assignments.json"]);
    const body = JSON.parse(writes.find((w) => w.path === "_class_assignments.json")!.text);
    expect(body.version).toBe(1);
    expect(body.assignments.map((a: { assignmentId: string }) => a.assignmentId).sort()).toEqual([
      "asg-1",
      "asg-2",
    ]);
  });

  it("does NOT write _class_assignments.json when no assignment was pulled", async () => {
    const { writer, writes } = fakeWriter();
    const records = [rec({ owner: "morgan", recordType: "note", recordId: "10", isOwn: false })];
    await materializeLabView(records, writer);
    expect(writes.map((w) => w.path)).not.toContain("_class_assignments.json");
  });

  it("skips a malformed assignment payload rather than poisoning the file", async () => {
    const { writer, writes } = fakeWriter();
    const good = { assignmentId: "asg-1", title: "First", instructor: "prof", checklist: [] };
    const records = [
      rec({ owner: "prof", recordType: "class_assignment", recordId: "asg-1", plaintext: enc(good), isOwn: false }),
      rec({ owner: "prof", recordType: "class_assignment", recordId: "asg-bad", plaintext: new TextEncoder().encode("{not json"), isOwn: false }),
    ];
    await materializeLabView(records, writer);
    const body = JSON.parse(writes.find((w) => w.path === "_class_assignments.json")!.text);
    expect(body.assignments).toHaveLength(1);
  });
});

describe("materializeLabView — exhaustive type coverage (drift guard)", () => {
  // Every LAB_WORK_TYPES entry must have a materialization path so no pulled
  // record type silently falls through to skippedUnknownType. Three types are
  // handled by dedicated code paths rather than the RECORD_TYPE_TO_DIR map:
  //   - result_sheet / notes_sheet: markdown mirrors under results/task-<id>/.
  //   - announcement: lab-wide-public, aggregated into the root _announcements.json.
  // All other types MUST appear in RECORD_TYPE_TO_DIR.
  const SPECIAL_CASED = new Set(["result_sheet", "notes_sheet", "announcement"]);

  it("maps every LAB_WORK_TYPES entry to a directory or a known special case", () => {
    const unmapped = LAB_WORK_TYPES.filter(
      (t) => !SPECIAL_CASED.has(t) && !(t in _RECORD_TYPE_TO_DIR_FOR_TEST),
    );
    expect(unmapped).toEqual([]);
  });
});
