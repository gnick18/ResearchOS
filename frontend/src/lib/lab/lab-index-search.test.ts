import { describe, it, expect, vi } from "vitest";
import {
  searchLabIndex,
  scoreEntry,
  type LabIndexSearchDeps,
} from "./lab-index-search";
import type { LabIndexEntry } from "./lab-index";

function entry(over: Partial<LabIndexEntry>): LabIndexEntry {
  return {
    recordType: "task",
    recordId: "1",
    owner: "alice",
    title: "untitled",
    sizeBytes: 10,
    preview: "",
    eager: true,
    ...over,
  };
}

function makeDeps(
  entries: LabIndexEntry[],
  over: Partial<LabIndexSearchDeps> = {},
): LabIndexSearchDeps {
  return {
    getViewer: vi.fn(async () => ({
      username: "pi",
      account_type: "lab_head",
    })) as unknown as LabIndexSearchDeps["getViewer"],
    getLabId: vi.fn(async () => "lab-1"),
    getIdentity: vi.fn(() => ({
      keys: {
        signing: { privateKey: new Uint8Array([1]), publicKey: new Uint8Array([2]) },
        encryption: { privateKey: new Uint8Array([3]), publicKey: new Uint8Array([4]) },
      },
    })) as unknown as LabIndexSearchDeps["getIdentity"],
    fetchLab: vi.fn(async () => ({
      record: {
        members: [
          { username: "pi", role: "head" },
          { username: "alice", role: "member" },
          { username: "bob", role: "member" },
        ],
      },
      envelopes: [{ generation: 1 }, { generation: 2 }],
    })) as unknown as LabIndexSearchDeps["fetchLab"],
    openKey: vi.fn(() => new Uint8Array([9])),
    readIndex: vi.fn(async () => entries) as unknown as LabIndexSearchDeps["readIndex"],
    ...over,
  };
}

describe("scoreEntry", () => {
  it("ranks a title match above a tag match above a preview match", () => {
    expect(scoreEntry(entry({ title: "qPCR run" }), "qpcr")).toBe(10);
    expect(scoreEntry(entry({ title: "x", tags: ["qPCR"] }), "qpcr")).toBe(5);
    expect(scoreEntry(entry({ title: "x", preview: "did a qPCR" }), "qpcr")).toBe(2);
    expect(scoreEntry(entry({ title: "x" }), "qpcr")).toBe(0);
  });

  it("an empty query matches everything (browse)", () => {
    expect(scoreEntry(entry({ title: "anything" }), "")).toBe(1);
  });
});

describe("searchLabIndex", () => {
  it("refuses a non-lab-head viewer", async () => {
    const deps = makeDeps([], {
      getViewer: vi.fn(async () => ({
        username: "alice",
        account_type: "solo",
      })) as unknown as LabIndexSearchDeps["getViewer"],
    });
    const res = await searchLabIndex("x", {}, deps);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/lab-head role/);
  });

  it("refuses when not bound to a lab", async () => {
    const deps = makeDeps([], { getLabId: vi.fn(async () => undefined) });
    const res = await searchLabIndex("x", {}, deps);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not bound to a lab/);
  });

  it("returns ranked hits across members, title matches first", async () => {
    const deps = makeDeps([
      entry({ owner: "alice", recordId: "1", title: "qPCR setup" }),
      entry({ owner: "bob", recordId: "2", title: "gel", preview: "ran a qPCR" }),
      entry({ owner: "bob", recordId: "3", title: "unrelated" }),
    ]);
    const res = await searchLabIndex("qpcr", {}, deps);
    expect(res.ok).toBe(true);
    expect(res.hits.map((h) => h.recordId)).toEqual(["1", "2"]);
    expect(res.hits[0].score).toBeGreaterThan(res.hits[1].score);
    // The max-generation envelope opened the key.
    expect(deps.openKey).toHaveBeenCalledWith(
      { generation: 2 },
      "pi",
      expect.any(Uint8Array),
    );
  });

  it("reads the index across every roster member", async () => {
    const deps = makeDeps([entry({})]);
    await searchLabIndex("", {}, deps);
    expect(deps.readIndex).toHaveBeenCalledWith(
      expect.objectContaining({
        labId: "lab-1",
        members: ["pi", "alice", "bob"],
      }),
    );
  });

  it("narrows by recordTypes and owner, and applies a limit", async () => {
    const deps = makeDeps([
      entry({ owner: "alice", recordId: "1", recordType: "datahub", title: "t1" }),
      entry({ owner: "alice", recordId: "2", recordType: "note", title: "t2" }),
      entry({ owner: "bob", recordId: "3", recordType: "datahub", title: "t3" }),
    ]);
    const res = await searchLabIndex(
      "",
      { recordTypes: ["datahub"], owner: "alice" },
      deps,
    );
    expect(res.hits.map((h) => h.recordId)).toEqual(["1"]);

    const limited = await searchLabIndex("", { limit: 2 }, deps);
    expect(limited.hits).toHaveLength(2);
  });

  it("surfaces the eager flag so the UI can show open vs request", async () => {
    const deps = makeDeps([
      entry({ recordId: "1", title: "small note", eager: true }),
      entry({ recordId: "2", title: "huge table", eager: false }),
    ]);
    const res = await searchLabIndex("", {}, deps);
    const byId = Object.fromEntries(res.hits.map((h) => [h.recordId, h.eager]));
    expect(byId["1"]).toBe(true);
    expect(byId["2"]).toBe(false);
  });
});
