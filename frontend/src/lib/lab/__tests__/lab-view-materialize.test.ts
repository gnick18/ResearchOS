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
  type MaterializeFileWriter,
} from "../lab-view-materialize";
import type { LabViewRecord } from "../lab-read";

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
