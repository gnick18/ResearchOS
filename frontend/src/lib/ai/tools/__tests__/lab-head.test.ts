// Tests for the lab-head Phase 1 PI copilot tools (mirror of dept-admin.test.ts).
//
// Each tool is constructed via its factory (makeLabPulseTool, etc.) with a mock
// dep object so the aggregation logic and error paths are exercised without
// touching the relay, crypto, or audit machinery.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect } from "vitest";

import {
  makeLabPulseTool,
  makeFindAcrossLabTool,
  makeLabThroughputTool,
  LAB_HEAD_TOOLS,
  type LabPulseDeps,
  type FindAcrossLabDeps,
  type LabThroughputDeps,
} from "../lab-head";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRecord(
  recordType: string,
  recordId: string,
  fields: Record<string, unknown> = {},
): { recordType: string; recordId: string; plaintext: Uint8Array } {
  return {
    recordType,
    recordId,
    plaintext: new TextEncoder().encode(JSON.stringify(fields)),
  };
}

function isoAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function makeReadResult(
  members: Array<{
    owner: string;
    records: Array<{ recordType: string; recordId: string; plaintext: Uint8Array }>;
    error?: string;
  }>,
) {
  return { ok: true as const, members };
}

// ---------------------------------------------------------------------------
// lab_pulse
// ---------------------------------------------------------------------------

describe("lab_pulse", () => {
  it("returns per-member counts for experiments, notes, results, tasks", async () => {
    const deps: LabPulseDeps = {
      readWork: async () =>
        makeReadResult([
          {
            owner: "alice",
            records: [
              makeRecord("experiment", "e1", { updated_at: isoAgo(3) }),
              makeRecord("experiment", "e2", { updated_at: isoAgo(3) }),
              makeRecord("notes_sheet", "n1", { updated_at: isoAgo(3) }),
              makeRecord("result_sheet", "r1", { updated_at: isoAgo(3) }),
              makeRecord("task", "t1", {
                status: "done",
                updated_at: isoAgo(3),
              }),
              makeRecord("task", "t2", {
                due_date: isoAgo(1),
                status: "open",
                updated_at: isoAgo(5),
              }),
            ],
          },
        ]),
    };

    const tool = makeLabPulseTool(deps);
    const res = (await tool.execute({})) as Record<string, unknown>;
    expect(res.hasLab).toBe(true);
    const members = res.members as Array<Record<string, unknown>>;
    expect(members).toHaveLength(1);
    const alice = members[0];
    expect(alice.owner).toBe("alice");
    expect(alice.experiments).toBe(2);
    expect(alice.notesAdded).toBe(1);
    expect(alice.resultsAdded).toBe(1);
    expect(alice.tasksDone).toBe(1);
    expect(alice.tasksOverdue).toBe(1);
  });

  it("counts new-since (sinceDays boundary, deterministic)", async () => {
    const deps: LabPulseDeps = {
      readWork: async () =>
        makeReadResult([
          {
            owner: "bob",
            records: [
              // 3 days ago: within the default 7-day window.
              makeRecord("experiment", "e1", { updated_at: isoAgo(3) }),
              // 10 days ago: outside the window.
              makeRecord("experiment", "e2", { updated_at: isoAgo(10) }),
            ],
          },
        ]),
    };

    const tool = makeLabPulseTool(deps);
    const res = (await tool.execute({ sinceDays: 7 })) as Record<string, unknown>;
    const members = res.members as Array<Record<string, unknown>>;
    expect(members[0].newSince).toBe(1);
  });

  it("counts stalled records (stalledDays boundary, deterministic)", async () => {
    const deps: LabPulseDeps = {
      readWork: async () =>
        makeReadResult([
          {
            owner: "carol",
            records: [
              // 20 days ago: stalled relative to default 14-day threshold.
              makeRecord("experiment", "e1", { updated_at: isoAgo(20) }),
              // 5 days ago: NOT stalled.
              makeRecord("experiment", "e2", { updated_at: isoAgo(5) }),
            ],
          },
        ]),
    };

    const tool = makeLabPulseTool(deps);
    const res = (await tool.execute({ stalledDays: 14 })) as Record<string, unknown>;
    const members = res.members as Array<Record<string, unknown>>;
    expect(members[0].stalled).toBe(1);
  });

  it("stalled threshold is inclusive of exact boundary (N days + 1 minute = stalled)", async () => {
    // A record updated exactly 14 days + 1 minute ago should be stalled when stalledDays = 14.
    const stamp = new Date();
    stamp.setDate(stamp.getDate() - 14);
    stamp.setMinutes(stamp.getMinutes() - 1);

    const deps: LabPulseDeps = {
      readWork: async () =>
        makeReadResult([
          {
            owner: "dan",
            records: [
              makeRecord("experiment", "e1", {
                updated_at: stamp.toISOString(),
              }),
            ],
          },
        ]),
    };

    const tool = makeLabPulseTool(deps);
    const res = (await tool.execute({ stalledDays: 14 })) as Record<string, unknown>;
    const members = res.members as Array<Record<string, unknown>>;
    expect(members[0].stalled).toBe(1);
  });

  it("degrades to no-lab when readWork returns not ok", async () => {
    const deps: LabPulseDeps = {
      readWork: async () => ({
        ok: false as const,
        error: "lab-scoped read requires the lab-head role",
        members: [],
      }),
    };

    const tool = makeLabPulseTool(deps);
    const res = (await tool.execute({})) as Record<string, unknown>;
    expect(res.hasLab).toBe(false);
    expect(typeof res.note).toBe("string");
  });

  it("degrades cleanly when members array is empty", async () => {
    const deps: LabPulseDeps = {
      readWork: async () => ({ ok: true as const, members: [] }),
    };

    const tool = makeLabPulseTool(deps);
    const res = (await tool.execute({})) as Record<string, unknown>;
    expect(res.hasLab).toBe(false);
  });

  it("preserves per-member read errors without crashing", async () => {
    const deps: LabPulseDeps = {
      readWork: async () =>
        makeReadResult([
          {
            owner: "eve",
            records: [],
            error: "relay timeout",
          },
        ]),
    };

    const tool = makeLabPulseTool(deps);
    const res = (await tool.execute({})) as Record<string, unknown>;
    expect(res.hasLab).toBe(true);
    const members = res.members as Array<Record<string, unknown>>;
    expect(members[0].readError).toBe("relay timeout");
    expect(members[0].totalRecords).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// find_across_lab
// ---------------------------------------------------------------------------

describe("find_across_lab", () => {
  it("returns hits with the owning member shown", async () => {
    const deps: FindAcrossLabDeps = {
      searchIndex: async () => ({
        ok: true as const,
        hits: [
          {
            owner: "alice",
            recordType: "experiment",
            recordId: "e1",
            title: "Reagent X validation",
            updatedAt: isoAgo(2),
            tags: ["reagent-x"],
            preview: "Used reagent X at 10 mM concentration...",
            sizeBytes: 1024,
            eager: true,
            score: 10,
          },
          {
            owner: "bob",
            recordType: "notes_sheet",
            recordId: "n2",
            title: "Protocol notes for reagent X",
            updatedAt: isoAgo(5),
            tags: [],
            preview: "Notes from the reagent X stock preparation.",
            sizeBytes: 512,
            eager: true,
            score: 8,
          },
        ],
      }),
    };

    const tool = makeFindAcrossLabTool(deps);
    const res = (await tool.execute({ query: "reagent X" })) as Record<
      string,
      unknown
    >;

    expect(res.hasLab).toBe(true);
    expect(res.query).toBe("reagent X");
    expect(res.totalHits).toBe(2);
    const hits = res.hits as Array<Record<string, unknown>>;
    expect(hits[0].owner).toBe("alice");
    expect(hits[0].recordType).toBe("experiment");
    expect(hits[1].owner).toBe("bob");
  });

  it("degrades to no-lab when searchIndex returns not ok", async () => {
    const deps: FindAcrossLabDeps = {
      searchIndex: async () => ({
        ok: false as const,
        error: "lab-wide search requires the lab-head role",
        hits: [],
      }),
    };

    const tool = makeFindAcrossLabTool(deps);
    const res = (await tool.execute({ query: "anything" })) as Record<
      string,
      unknown
    >;

    expect(res.hasLab).toBe(false);
    expect(typeof res.note).toBe("string");
    expect((res.hits as unknown[]).length).toBe(0);
  });

  it("passes the limit argument through to the engine", async () => {
    let capturedLimit: number | undefined;
    const deps: FindAcrossLabDeps = {
      searchIndex: async (_q, opts) => {
        capturedLimit = opts?.limit;
        return { ok: true as const, hits: [] };
      },
    };

    const tool = makeFindAcrossLabTool(deps);
    await tool.execute({ query: "test", limit: 5 });
    expect(capturedLimit).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// lab_throughput
// ---------------------------------------------------------------------------

describe("lab_throughput", () => {
  it("aggregates experiments, results, methods, and tasks over the period", async () => {
    const deps: LabThroughputDeps = {
      readWork: async () =>
        makeReadResult([
          {
            owner: "alice",
            records: [
              makeRecord("experiment", "e1", { updated_at: isoAgo(5) }),
              makeRecord("result_sheet", "r1", { updated_at: isoAgo(3) }),
              makeRecord("method", "m1", { updated_at: isoAgo(10) }),
              makeRecord("task", "t1", {
                status: "done",
                updated_at: isoAgo(7),
              }),
              // Outside period: should not count.
              makeRecord("experiment", "e_old", { updated_at: isoAgo(60) }),
            ],
          },
          {
            owner: "bob",
            records: [
              makeRecord("experiment", "e2", { updated_at: isoAgo(2) }),
              makeRecord("deposit", "d1", { updated_at: isoAgo(1) }),
            ],
          },
        ]),
    };

    const tool = makeLabThroughputTool(deps);
    const res = (await tool.execute({ periodDays: 30 })) as Record<string, unknown>;

    expect(res.hasLab).toBe(true);
    expect(res.periodDays).toBe(30);
    const totals = res.totals as Record<string, number>;
    // alice e1 + bob e2 (alice e_old is outside period).
    expect(totals.experiments).toBe(2);
    expect(totals.results).toBe(1);
    expect(totals.methods).toBe(1);
    expect(totals.tasksDone).toBe(1);
    expect(totals.deposits).toBe(1);
  });

  it("includes per-member breakdown when perMember is true", async () => {
    const deps: LabThroughputDeps = {
      readWork: async () =>
        makeReadResult([
          {
            owner: "alice",
            records: [
              makeRecord("experiment", "e1", { updated_at: isoAgo(5) }),
            ],
          },
          {
            owner: "bob",
            records: [
              makeRecord("result_sheet", "r1", { updated_at: isoAgo(3) }),
            ],
          },
        ]),
    };

    const tool = makeLabThroughputTool(deps);
    const res = (await tool.execute({
      periodDays: 30,
      perMember: true,
    })) as Record<string, unknown>;

    expect(res.hasLab).toBe(true);
    const members = res.members as Array<Record<string, unknown>>;
    expect(members).toHaveLength(2);
    const alice = members.find((m) => m.owner === "alice");
    expect(alice?.experiments).toBe(1);
    const bob = members.find((m) => m.owner === "bob");
    expect(bob?.results).toBe(1);
  });

  it("omits per-member breakdown when perMember is false (default)", async () => {
    const deps: LabThroughputDeps = {
      readWork: async () =>
        makeReadResult([
          {
            owner: "alice",
            records: [makeRecord("experiment", "e1", { updated_at: isoAgo(5) })],
          },
        ]),
    };

    const tool = makeLabThroughputTool(deps);
    const res = (await tool.execute({ periodDays: 30 })) as Record<string, unknown>;

    expect(res.hasLab).toBe(true);
    expect("members" in res).toBe(false);
  });

  it("degrades to no-lab when readWork returns not ok", async () => {
    const deps: LabThroughputDeps = {
      readWork: async () => ({
        ok: false as const,
        error: "this account is not bound to a lab",
        members: [],
      }),
    };

    const tool = makeLabThroughputTool(deps);
    const res = (await tool.execute({})) as Record<string, unknown>;
    expect(res.hasLab).toBe(false);
    expect(typeof res.note).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// LAB_HEAD_TOOLS export shape
// ---------------------------------------------------------------------------

describe("LAB_HEAD_TOOLS", () => {
  it("exports exactly three tools in the expected order", () => {
    const names = LAB_HEAD_TOOLS.map((t) => t.name);
    expect(names).toEqual(["lab_pulse", "find_across_lab", "lab_throughput"]);
  });

  it("all three tools are read-only (none has action: true)", () => {
    const actionTools = LAB_HEAD_TOOLS.filter((t) => t.action === true);
    expect(actionTools).toHaveLength(0);
  });

  it("each tool has a name, description, parameters, and execute", () => {
    for (const tool of LAB_HEAD_TOOLS) {
      expect(typeof tool.name).toBe("string");
      expect(tool.name.length).toBeGreaterThan(0);
      expect(typeof tool.description).toBe("string");
      expect(tool.description.length).toBeGreaterThan(0);
      expect(typeof tool.parameters).toBe("object");
      expect(typeof tool.execute).toBe("function");
    }
  });
});
