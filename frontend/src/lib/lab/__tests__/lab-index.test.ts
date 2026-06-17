import { describe, it, expect, vi } from "vitest";
import {
  buildLabIndex,
  splitBySize,
  summarizeRecord,
  encodeLabIndex,
  pushLabIndex,
  readLabIndex,
  readLabIndexAcrossMembers,
  LAB_INDEX_RECORD_TYPE,
  LAB_INDEX_RECORD_ID,
  LAB_INDEX_PREVIEW_LENGTH,
  type LabIndexFile,
} from "../lab-index";
import type { LabWorkRecord } from "../lab-sync";

function rec(
  recordType: string,
  recordId: string,
  obj: unknown,
): LabWorkRecord {
  return {
    recordType,
    recordId,
    plaintext: new TextEncoder().encode(JSON.stringify(obj)),
  };
}

describe("summarizeRecord", () => {
  it("titles a named record by its name field", () => {
    const s = summarizeRecord("task", "1", { name: "Run gel", updated_at: "2026-06-01" });
    expect(s.title).toBe("Run gel");
    expect(s.updatedAt).toBe("2026-06-01");
  });

  it("titles a datahub record from meta.name", () => {
    const s = summarizeRecord("datahub", "dh-1", {
      meta: { name: "qPCR results", last_edited_at: "2026-06-02" },
    });
    expect(s.title).toBe("qPCR results");
    expect(s.updatedAt).toBe("2026-06-02");
  });

  it("labels the markdown sheets by their task id", () => {
    expect(summarizeRecord("result_sheet", "7", { markdown: "bands" }).title).toBe(
      "Results (task 7)",
    );
    expect(summarizeRecord("notes_sheet", "7", { markdown: "ran it" }).title).toBe(
      "Lab notes (task 7)",
    );
  });

  it("falls back to a type label plus id when there is no name", () => {
    expect(summarizeRecord("method", "20", {}).title).toBe("Method 20");
  });

  it("builds a whitespace-collapsed, clipped preview from a text field", () => {
    const long = "x".repeat(LAB_INDEX_PREVIEW_LENGTH + 50);
    const s = summarizeRecord("note", "1", { description: `a\n\n  b   ${long}` });
    expect(s.preview.length).toBe(LAB_INDEX_PREVIEW_LENGTH);
    expect(s.preview.startsWith("a b ")).toBe(true);
  });

  it("derives a note preview from entries[].content", () => {
    const s = summarizeRecord("note", "1", {
      entries: [{ content: "first entry" }, { content: "second" }],
    });
    expect(s.preview).toContain("first entry");
  });

  it("carries string tags through", () => {
    const s = summarizeRecord("task", "1", { name: "t", tags: ["pcr", "urgent", 5] });
    expect(s.tags).toEqual(["pcr", "urgent"]);
  });
});

describe("buildLabIndex", () => {
  it("produces one entry per record with type, id, owner, and size", () => {
    const records = [
      rec("task", "1", { name: "Run gel" }),
      rec("datahub", "dh-1", { meta: { name: "Table" } }),
    ];
    const index = buildLabIndex("alex", records);
    expect(index.version).toBe(1);
    expect(index.owner).toBe("alex");
    expect(index.entries).toHaveLength(2);
    expect(index.entries[0]).toMatchObject({
      recordType: "task",
      recordId: "1",
      owner: "alex",
      title: "Run gel",
    });
    expect(index.entries[0].sizeBytes).toBeGreaterThan(0);
  });

  it("never indexes the reserved index record itself", () => {
    const records = [
      rec("task", "1", { name: "t" }),
      rec(LAB_INDEX_RECORD_TYPE, LAB_INDEX_RECORD_ID, { version: 1 }),
    ];
    const index = buildLabIndex("alex", records);
    expect(index.entries).toHaveLength(1);
    expect(index.entries[0].recordType).toBe("task");
  });

  it("marks entries eager or on-demand by the heavy threshold", () => {
    const records = [
      rec("note", "1", { name: "tiny" }),
      rec("datahub", "dh-1", { meta: { name: "big" }, blob: "y".repeat(500) }),
    ];
    // Threshold of 100 bytes: the note is under it, the padded table is over it.
    const index = buildLabIndex("alex", records, 100);
    const byId = Object.fromEntries(
      index.entries.map((e) => [e.recordId, e.eager]),
    );
    expect(byId["1"]).toBe(true);
    expect(byId["dh-1"]).toBe(false);
  });

  it("still indexes a non-JSON record with the fallback title", () => {
    const bad: LabWorkRecord = {
      recordType: "note",
      recordId: "9",
      plaintext: new TextEncoder().encode("not json {{{"),
    };
    const index = buildLabIndex("alex", [bad]);
    expect(index.entries).toHaveLength(1);
    expect(index.entries[0].title).toBe("Note 9");
  });
});

describe("splitBySize", () => {
  it("splits records into light and heavy by the threshold and drops _index", () => {
    const records = [
      rec("note", "1", { name: "small" }),
      rec("datahub", "dh-1", { blob: "z".repeat(500) }),
      { recordType: "_index", recordId: "manifest", plaintext: new Uint8Array([1]) },
    ];
    const { light, heavy } = splitBySize(records, 100);
    expect(light.map((r) => r.recordId)).toEqual(["1"]);
    expect(heavy.map((r) => r.recordId)).toEqual(["dh-1"]);
  });
});

describe("pushLabIndex / readLabIndex round-trip", () => {
  it("pushes to the reserved key and reads back the same entries", async () => {
    const index: LabIndexFile = {
      version: 1,
      owner: "alex",
      entries: [
        { recordType: "task", recordId: "1", owner: "alex", title: "Run gel", sizeBytes: 12, preview: "x", eager: true },
      ],
    };

    // A tiny in-memory store keyed by the put params, so the read sees the write.
    let stored: Uint8Array | null = null;
    const putImpl = vi.fn(async (p: { recordType: string; recordId: string; plaintext: Uint8Array }) => {
      expect(p.recordType).toBe(LAB_INDEX_RECORD_TYPE);
      expect(p.recordId).toBe(LAB_INDEX_RECORD_ID);
      stored = p.plaintext;
    }) as unknown as typeof import("../lab-data-client").putLabRecord;
    const getImpl = vi.fn(async () => {
      if (!stored) throw new Error("missing");
      return stored;
    }) as unknown as typeof import("../lab-data-client").getLabRecord;

    await pushLabIndex({
      labId: "lab-1",
      owner: "alex",
      index,
      labKey: new Uint8Array([1]),
      signerEd25519Priv: new Uint8Array([2]),
      signerEd25519Pub: new Uint8Array([3]),
      putImpl,
    });
    expect(stored).not.toBeNull();
    expect(stored!).toEqual(encodeLabIndex(index));

    const back = await readLabIndex({
      labId: "lab-1",
      owner: "alex",
      labKey: new Uint8Array([1]),
      getImpl,
    });
    expect(back).toEqual(index);
  });

  it("readLabIndex returns null when the member has no index yet", async () => {
    const getImpl = vi.fn(async () => {
      throw new Error("not found");
    }) as unknown as typeof import("../lab-data-client").getLabRecord;
    const back = await readLabIndex({
      labId: "lab-1",
      owner: "newbie",
      labKey: new Uint8Array([1]),
      getImpl,
    });
    expect(back).toBeNull();
  });
});

describe("readLabIndexAcrossMembers", () => {
  it("flattens every member's entries and isolates a failed member", async () => {
    const idx = (owner: string): LabIndexFile => ({
      version: 1,
      owner,
      entries: [
        { recordType: "task", recordId: "1", owner, title: `${owner} task`, sizeBytes: 5, preview: "", eager: true },
      ],
    });
    const getImpl = vi.fn(async (p: { owner: string }) => {
      if (p.owner === "bob") throw new Error("relay down");
      return new TextEncoder().encode(JSON.stringify(idx(p.owner)));
    }) as unknown as typeof import("../lab-data-client").getLabRecord;

    const entries = await readLabIndexAcrossMembers({
      labId: "lab-1",
      members: ["alice", "bob", "carol"],
      labKey: new Uint8Array([1]),
      getImpl,
    });
    // bob failed; alice + carol contribute one entry each.
    expect(entries.map((e) => e.owner).sort()).toEqual(["alice", "carol"]);
  });
});
