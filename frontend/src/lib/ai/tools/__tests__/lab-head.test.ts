// Tests for the lab-head PI copilot tools (Phase 1 + Phase 2).
//
// Each tool is constructed via its factory with a mock dep object so the
// aggregation logic and error paths are exercised without touching the relay,
// crypto, or audit machinery.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect, vi } from "vitest";

// The tools are exercised through their factories with mock dep objects, so the
// real lab readers are never called here. Stub their modules so importing
// lab-head does not eagerly pull @/lib/local-api through lab-scoped-read /
// lab-index-search (that transitive load fails to resolve under vitest in this
// import graph, while the registry/read-my-work path resolves fine).
vi.mock("@/lib/lab/lab-scoped-read", () => ({ readLabMembersWork: vi.fn() }));
vi.mock("@/lib/lab/lab-index-search", () => ({ searchLabIndex: vi.fn() }));
// Phase 2: stub local-api so the default instance wiring does not pull the real
// API into the module graph during tests.
vi.mock("@/lib/local-api", () => ({
  oneOnOnesApi: { list: vi.fn(), create: vi.fn() },
  labApi: { getOneOnOneActionItems: vi.fn(), getOneOnOneNotes: vi.fn() },
  checkinRotationsApi: { getForSpace: vi.fn() },
  checkinOnboardingApi: { createForSpace: vi.fn() },
  idpsApi: { getStatusForMember: vi.fn() },
}));

import {
  makeLabPulseTool,
  makeFindAcrossLabTool,
  makeLabThroughputTool,
  makePrepOneOnOneTool,
  makeLabMeetingPrepTool,
  makeOnboardMemberTool,
  LAB_HEAD_TOOLS,
  type LabPulseDeps,
  type FindAcrossLabDeps,
  type LabThroughputDeps,
  type PrepOneOnOneDeps,
  type LabMeetingPrepDeps,
  type OnboardMemberDeps,
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
  it("exports exactly six tools in the expected order", () => {
    const names = LAB_HEAD_TOOLS.map((t) => t.name);
    expect(names).toEqual([
      "lab_pulse",
      "find_across_lab",
      "lab_throughput",
      "prep_one_on_one",
      "lab_meeting_prep",
      "onboard_member",
    ]);
  });

  it("only onboard_member has action: true; all others are read-only", () => {
    const actionTools = LAB_HEAD_TOOLS.filter((t) => t.action === true);
    expect(actionTools).toHaveLength(1);
    expect(actionTools[0].name).toBe("onboard_member");
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

// ===========================================================================
// Phase 2: Mentorship tools
// ===========================================================================

// ---------------------------------------------------------------------------
// Helpers for Phase 2 tests
// ---------------------------------------------------------------------------

function makeOneOnOne(
  id: string,
  members: string[],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    members,
    kind: members.length >= 3 ? "group" : "pair",
    mentor: null,
    title: null,
    next_meeting_date: null,
    created_by: members[0],
    created_at: new Date().toISOString(),
    owner: members[0],
    shared_with: [],
    ...overrides,
  };
}

function makeActionItem(
  id: string,
  oneOnOneId: string,
  text: string,
  isDone: boolean,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    one_on_one_id: oneOnOneId,
    text,
    is_done: isDone,
    created_by: "pi",
    created_at: new Date().toISOString(),
    owner: "pi",
    shared_with: [],
    assignee: null,
    due_date: null,
    ...overrides,
  };
}

function makeNote(
  id: string,
  oneOnOneId: string,
  noteKind: "meeting" | "note",
  updatedAt: string,
): Record<string, unknown> {
  return {
    id,
    one_on_one_id: oneOnOneId,
    note_kind: noteKind,
    updated_at: updatedAt,
    created_at: updatedAt,
    description: "",
    entries: [],
  };
}

function makeRotation(
  spaceId: string,
  tracks: Array<{ id: string; name: string; order: string[]; current_index: number }>,
): Record<string, unknown> {
  return {
    id: "rot-1",
    space_id: spaceId,
    tracks,
    shared_with: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    owner: "pi",
  };
}

// ---------------------------------------------------------------------------
// prep_one_on_one
// ---------------------------------------------------------------------------

describe("prep_one_on_one", () => {
  it("returns the trainee's recent work counts (date-windowed)", async () => {
    const deps: PrepOneOnOneDeps = {
      readWork: async () =>
        makeReadResult([
          {
            owner: "alice",
            records: [
              makeRecord("experiment", "e1", { updated_at: isoAgo(5), title: "Gel run 1" }),
              makeRecord("experiment", "e_old", { updated_at: isoAgo(60) }),
              makeRecord("notes_sheet", "n1", { updated_at: isoAgo(3) }),
              makeRecord("result_sheet", "r1", { updated_at: isoAgo(7) }),
            ],
          },
        ]),
      listOneOnOnes: async () => [],
      getActionItems: async () => [],
      getMeetingNotes: async () => [],
      getIdpStatus: async () => ({ exists: false, updated_at: null }),
    };
    const tool = makePrepOneOnOneTool(deps);
    const res = (await tool.execute({ trainee: "alice", sinceDays: 30 })) as Record<string, unknown>;
    expect(res.hasLab).toBe(true);
    expect(res.trainee).toBe("alice");
    const work = res.recentWork as Record<string, unknown>;
    // e_old is outside 30 days; e1 + n1 + r1 are within.
    expect(work.experiments).toBe(1);
    expect(work.notes).toBe(1);
    expect(work.results).toBe(1);
    // Title from e1 is captured.
    expect((work.recentTitles as string[]).includes("Gel run 1")).toBe(true);
  });

  it("returns only open (not done) action items", async () => {
    const SPACE_ID = "space-1";
    const deps: PrepOneOnOneDeps = {
      readWork: async () =>
        makeReadResult([{ owner: "alice", records: [] }]),
      listOneOnOnes: async () =>
        [makeOneOnOne(SPACE_ID, ["pi", "alice"], { kind: "pair" })] as never,
      getActionItems: async () =>
        [
          makeActionItem("ai1", SPACE_ID, "Write thesis intro", false),
          makeActionItem("ai2", SPACE_ID, "Submit abstract", true),
          makeActionItem("ai3", SPACE_ID, "Order reagents", false),
        ] as never,
      getMeetingNotes: async () => [],
      getIdpStatus: async () => ({ exists: true, updated_at: isoAgo(10) }),
    };
    const tool = makePrepOneOnOneTool(deps);
    const res = (await tool.execute({ trainee: "alice" })) as Record<string, unknown>;
    expect(res.hasLab).toBe(true);
    const items = res.openActionItems as Array<{ text: string }>;
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.text).includes("Submit abstract")).toBe(false);
    expect(items.map((i) => i.text).includes("Write thesis intro")).toBe(true);
  });

  it("last-meeting date is the most recent meeting note's updated_at", async () => {
    const SPACE_ID = "space-2";
    const older = isoAgo(20);
    const newer = isoAgo(8);
    const deps: PrepOneOnOneDeps = {
      readWork: async () =>
        makeReadResult([{ owner: "alice", records: [] }]),
      listOneOnOnes: async () =>
        [makeOneOnOne(SPACE_ID, ["pi", "alice"], { kind: "pair" })] as never,
      getActionItems: async () => [],
      getMeetingNotes: async () =>
        [
          makeNote("n1", SPACE_ID, "meeting", older),
          makeNote("n2", SPACE_ID, "meeting", newer),
          makeNote("n3", SPACE_ID, "note", isoAgo(2)), // kind "note", not "meeting"
        ] as never,
      getIdpStatus: async () => ({ exists: false, updated_at: null }),
    };
    const tool = makePrepOneOnOneTool(deps);
    const res = (await tool.execute({ trainee: "alice" })) as Record<string, unknown>;
    expect(res.lastMeetingDate).toBe(newer);
  });

  it("IDP status is existence-only (exists + updatedAt, not contents)", async () => {
    const idpUpdatedAt = isoAgo(5);
    const deps: PrepOneOnOneDeps = {
      readWork: async () =>
        makeReadResult([{ owner: "alice", records: [] }]),
      listOneOnOnes: async () => [],
      getActionItems: async () => [],
      getMeetingNotes: async () => [],
      getIdpStatus: async (_username) => ({
        exists: true,
        updated_at: idpUpdatedAt,
      }),
    };
    const tool = makePrepOneOnOneTool(deps);
    const res = (await tool.execute({ trainee: "alice" })) as Record<string, unknown>;
    const idp = res.idp as Record<string, unknown>;
    expect(idp.exists).toBe(true);
    expect(idp.updatedAt).toBe(idpUpdatedAt);
    // No "contents", "goals", "career_stage", etc. in the idp block.
    expect("contents" in idp).toBe(false);
    expect("goals" in idp).toBe(false);
  });

  it("degrades to hasLab:false when the trainee is not in the lab", async () => {
    const deps: PrepOneOnOneDeps = {
      readWork: async () =>
        makeReadResult([{ owner: "bob", records: [] }]),
      listOneOnOnes: async () => [],
      getActionItems: async () => [],
      getMeetingNotes: async () => [],
      getIdpStatus: async () => ({ exists: false, updated_at: null }),
    };
    const tool = makePrepOneOnOneTool(deps);
    const res = (await tool.execute({ trainee: "alice" })) as Record<string, unknown>;
    expect(res.hasLab).toBe(false);
    expect(typeof res.note).toBe("string");
  });

  it("degrades to hasLab:false when readWork fails", async () => {
    const deps: PrepOneOnOneDeps = {
      readWork: async () => ({
        ok: false as const,
        error: "not a lab head",
        members: [],
      }),
      listOneOnOnes: async () => [],
      getActionItems: async () => [],
      getMeetingNotes: async () => [],
      getIdpStatus: async () => ({ exists: false, updated_at: null }),
    };
    const tool = makePrepOneOnOneTool(deps);
    const res = (await tool.execute({ trainee: "alice" })) as Record<string, unknown>;
    expect(res.hasLab).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// lab_meeting_prep
// ---------------------------------------------------------------------------

describe("lab_meeting_prep", () => {
  it("resolves presenter from rotation current_index", async () => {
    const SPACE_ID = "group-1";
    const deps: LabMeetingPrepDeps = {
      readWork: async () =>
        makeReadResult([
          { owner: "alice", records: [makeRecord("experiment", "e1", { updated_at: isoAgo(5), title: "Flow cytometry" })] },
          { owner: "bob", records: [] },
          { owner: "carol", records: [] },
        ]),
      listOneOnOnes: async () =>
        [makeOneOnOne(SPACE_ID, ["pi", "alice", "bob", "carol"], { kind: "group" })] as never,
      getRotation: async () =>
        makeRotation(SPACE_ID, [
          { id: "t1", name: "Data presentation", order: ["alice", "bob", "carol"], current_index: 1 },
        ]) as never,
    };
    const tool = makeLabMeetingPrepTool(deps);
    const res = (await tool.execute({})) as Record<string, unknown>;
    expect(res.hasLab).toBe(true);
    // current_index=1 -> order[1] = "bob"
    expect(res.presenter).toBe("bob");
    const rotation = res.rotation as Record<string, unknown>;
    expect(rotation.track).toBe("Data presentation");
    expect(rotation.currentIndex).toBe(1);
  });

  it("uses an explicit presenter override when given", async () => {
    const SPACE_ID = "group-1";
    const deps: LabMeetingPrepDeps = {
      readWork: async () =>
        makeReadResult([
          { owner: "carol", records: [makeRecord("result_sheet", "r1", { updated_at: isoAgo(2) })] },
        ]),
      listOneOnOnes: async () =>
        [makeOneOnOne(SPACE_ID, ["pi", "alice", "bob", "carol"], { kind: "group" })] as never,
      getRotation: async () => null,
    };
    const tool = makeLabMeetingPrepTool(deps);
    const res = (await tool.execute({ presenter: "carol" })) as Record<string, unknown>;
    expect(res.hasLab).toBe(true);
    expect(res.presenter).toBe("carol");
    // rotation is null because we used an override.
    expect(res.rotation).toBeNull();
    const work = res.recentWork as Record<string, unknown>;
    expect(work.results).toBe(1);
  });

  it("includes presenter's recent work from the audited read", async () => {
    const SPACE_ID = "group-2";
    const deps: LabMeetingPrepDeps = {
      readWork: async () =>
        makeReadResult([
          {
            owner: "alice",
            records: [
              makeRecord("experiment", "e1", { updated_at: isoAgo(3), title: "RNA extraction" }),
              makeRecord("notes_sheet", "n1", { updated_at: isoAgo(10) }),
              // Outside 30-day window.
              makeRecord("experiment", "e_old", { updated_at: isoAgo(50) }),
            ],
          },
        ]),
      listOneOnOnes: async () =>
        [makeOneOnOne(SPACE_ID, ["pi", "alice", "bob", "carol"], { kind: "group" })] as never,
      getRotation: async () =>
        makeRotation(SPACE_ID, [
          { id: "t1", name: "Data presentation", order: ["alice", "bob"], current_index: 0 },
        ]) as never,
    };
    const tool = makeLabMeetingPrepTool(deps);
    const res = (await tool.execute({ sinceDays: 30 })) as Record<string, unknown>;
    expect(res.presenter).toBe("alice");
    const work = res.recentWork as Record<string, unknown>;
    expect(work.experiments).toBe(1); // e_old excluded
    expect(work.notes).toBe(1);
    expect((work.recentTitles as string[]).includes("RNA extraction")).toBe(true);
  });

  it("degrades when no group space is found", async () => {
    const deps: LabMeetingPrepDeps = {
      readWork: async () => makeReadResult([{ owner: "alice", records: [] }]),
      listOneOnOnes: async () =>
        // Only pair spaces, no group.
        [makeOneOnOne("pair-1", ["pi", "alice"], { kind: "pair" })] as never,
      getRotation: async () => null,
    };
    const tool = makeLabMeetingPrepTool(deps);
    const res = (await tool.execute({})) as Record<string, unknown>;
    expect(res.hasLab).toBe(true);
    expect(res.presenter).toBeNull();
    expect(typeof res.note).toBe("string");
  });

  it("degrades when readWork fails", async () => {
    const deps: LabMeetingPrepDeps = {
      readWork: async () => ({
        ok: false as const,
        error: "not a lab head",
        members: [],
      }),
      listOneOnOnes: async () => [],
      getRotation: async () => null,
    };
    const tool = makeLabMeetingPrepTool(deps);
    const res = (await tool.execute({})) as Record<string, unknown>;
    expect(res.hasLab).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// onboard_member
// ---------------------------------------------------------------------------

describe("onboard_member", () => {
  it("has action:true, isDestructive returns false", () => {
    const deps: OnboardMemberDeps = {
      createOneOnOne: vi.fn(),
      createOnboardingForSpace: vi.fn(),
    };
    const tool = makeOnboardMemberTool(deps);
    expect(tool.action).toBe(true);
    expect(tool.isDestructive?.({})).toBe(false);
  });

  it("describeAction summary contains the member username", () => {
    const deps: OnboardMemberDeps = {
      createOneOnOne: vi.fn(),
      createOnboardingForSpace: vi.fn(),
    };
    const tool = makeOnboardMemberTool(deps);
    const desc = tool.describeAction?.({ member: "alice" });
    expect(desc?.summary).toContain("alice");
  });

  it("execute creates the space and seeds the checklist", async () => {
    const fakeSpace = makeOneOnOne("new-space-1", ["pi", "alice"]);
    const deps: OnboardMemberDeps = {
      createOneOnOne: vi.fn().mockResolvedValue(fakeSpace),
      createOnboardingForSpace: vi.fn().mockResolvedValue({ id: "ob-1", space_id: "new-space-1", items: [] }),
    };
    const tool = makeOnboardMemberTool(deps);
    const res = (await tool.execute({ member: "alice" })) as Record<string, unknown>;
    expect(res.ok).toBe(true);
    expect(res.spaceId).toBe("new-space-1");
    expect(res.member).toBe("alice");
    expect(res.checklistSeeded).toBe(true);
    expect(deps.createOneOnOne).toHaveBeenCalledTimes(1);
    expect(deps.createOnboardingForSpace).toHaveBeenCalledWith("new-space-1");
  });

  it("returns ok:false when createOneOnOne throws", async () => {
    const deps: OnboardMemberDeps = {
      createOneOnOne: vi.fn().mockRejectedValue(new Error("relay error")),
      createOnboardingForSpace: vi.fn(),
    };
    const tool = makeOnboardMemberTool(deps);
    const res = (await tool.execute({ member: "alice" })) as Record<string, unknown>;
    expect(res.ok).toBe(false);
    expect(typeof res.error).toBe("string");
    expect(deps.createOnboardingForSpace).not.toHaveBeenCalled();
  });

  it("returns ok:false when member is empty", async () => {
    const deps: OnboardMemberDeps = {
      createOneOnOne: vi.fn(),
      createOnboardingForSpace: vi.fn(),
    };
    const tool = makeOnboardMemberTool(deps);
    const res = (await tool.execute({ member: "" })) as Record<string, unknown>;
    expect(res.ok).toBe(false);
    expect(deps.createOneOnOne).not.toHaveBeenCalled();
  });
});
