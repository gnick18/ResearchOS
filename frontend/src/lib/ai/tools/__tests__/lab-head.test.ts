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
// Phase 2 + 3: stub local-api so the default instance wiring does not pull
// the real API into the module graph during tests.
vi.mock("@/lib/local-api", () => ({
  oneOnOnesApi: { list: vi.fn(), create: vi.fn() },
  labApi: { getOneOnOneActionItems: vi.fn(), getOneOnOneNotes: vi.fn() },
  checkinRotationsApi: { getForSpace: vi.fn() },
  checkinOnboardingApi: { createForSpace: vi.fn() },
  idpsApi: { getStatusForMember: vi.fn() },
  purchasesApi: { listFundingAccounts: vi.fn() },
}));

import {
  makeLabPulseTool,
  makeFindAcrossLabTool,
  makeLabThroughputTool,
  makePrepOneOnOneTool,
  makeLabMeetingPrepTool,
  makeOnboardMemberTool,
  makeGrantTaggedRollupTool,
  makeProgressReportScaffoldTool,
  makeReorderDigestTool,
  makeSpendSummaryTool,
  makeInventoryAuditTool,
  LAB_HEAD_TOOLS,
  type LabPulseDeps,
  type FindAcrossLabDeps,
  type LabThroughputDeps,
  type PrepOneOnOneDeps,
  type LabMeetingPrepDeps,
  type OnboardMemberDeps,
  type GrantTaggedRollupDeps,
  type ProgressReportScaffoldDeps,
  type ReorderDigestDeps,
  type SpendSummaryDeps,
  type InventoryAuditDeps,
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
  it("exports exactly eleven tools in the expected order", () => {
    const names = LAB_HEAD_TOOLS.map((t) => t.name);
    expect(names).toEqual([
      "lab_pulse",
      "find_across_lab",
      "lab_throughput",
      "prep_one_on_one",
      "lab_meeting_prep",
      "onboard_member",
      "grant_tagged_rollup",
      "progress_report_scaffold",
      "reorder_digest",
      "spend_summary",
      "inventory_audit",
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

// ===========================================================================
// Phase 3: Grants tools
// ===========================================================================

// ---------------------------------------------------------------------------
// Helpers for Phase 3 tests
// ---------------------------------------------------------------------------

function makeFundingAccount(
  id: number,
  name: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    name,
    description: null,
    total_budget: 100000,
    award_number: null,
    funder_name: null,
    award_title: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// grant_tagged_rollup
// ---------------------------------------------------------------------------

describe("grant_tagged_rollup", () => {
  it("counts direct-linked projects and purchases for a grant", async () => {
    const GRANT_ID = 42;
    const deps: GrantTaggedRollupDeps = {
      readWork: async () =>
        makeReadResult([
          {
            owner: "alice",
            records: [
              // Project directly linked to grant 42.
              makeRecord("project", "p1", {
                id: 1,
                name: "Sequencing Project",
                funding_account_id: GRANT_ID,
                updated_at: isoAgo(5),
              }),
              // Project NOT linked to this grant.
              makeRecord("project", "p2", {
                id: 2,
                name: "Other Project",
                funding_account_id: 99,
                updated_at: isoAgo(5),
              }),
              // Purchase directly linked to grant 42.
              makeRecord("purchase_item", "pu1", {
                item_name: "Reagent A",
                funding_account_id: GRANT_ID,
                updated_at: isoAgo(3),
              }),
              // Purchase linked to a different grant.
              makeRecord("purchase_item", "pu2", {
                item_name: "Reagent B",
                funding_account_id: 99,
                updated_at: isoAgo(3),
              }),
            ],
          },
        ]),
      listFundingAccounts: async () =>
        [makeFundingAccount(GRANT_ID, "NIH R01")] as never,
    };
    const tool = makeGrantTaggedRollupTool(deps);
    const res = (await tool.execute({ grantId: GRANT_ID })) as Record<string, unknown>;
    expect(res.hasGrant).toBe(true);
    expect(res.hasLab).toBe(true);
    const grant = res.grant as Record<string, unknown>;
    expect(grant.id).toBe(GRANT_ID);
    expect(grant.name).toBe("NIH R01");
    const totals = res.totals as Record<string, number>;
    expect(totals.projects).toBe(1);
    expect(totals.purchases).toBe(1);
    expect(totals.tasks).toBe(0);
  });

  it("reverse-maps tasks through their project_id to the grant", async () => {
    const GRANT_ID = 7;
    const deps: GrantTaggedRollupDeps = {
      readWork: async () =>
        makeReadResult([
          {
            owner: "bob",
            records: [
              // Project linked to grant 7 with numeric id=10.
              makeRecord("project", "p10", {
                id: 10,
                name: "Lab Infrastructure",
                funding_account_id: GRANT_ID,
                updated_at: isoAgo(2),
              }),
              // Task in project 10 -- should be counted via reverse-map.
              makeRecord("task", "t1", {
                name: "Order columns",
                project_id: 10,
                updated_at: isoAgo(1),
              }),
              // Task in a different project -- should NOT be counted.
              makeRecord("task", "t2", {
                name: "Unrelated task",
                project_id: 99,
                updated_at: isoAgo(1),
              }),
              // task_experiment in project 10 -- also reverse-mapped.
              makeRecord("task_experiment", "te1", {
                name: "Gel electrophoresis",
                project_id: 10,
                updated_at: isoAgo(1),
              }),
            ],
          },
        ]),
      listFundingAccounts: async () =>
        [makeFundingAccount(GRANT_ID, "NSF Grant")] as never,
    };
    const tool = makeGrantTaggedRollupTool(deps);
    const res = (await tool.execute({ grantId: GRANT_ID })) as Record<string, unknown>;
    expect(res.hasGrant).toBe(true);
    const totals = res.totals as Record<string, number>;
    expect(totals.projects).toBe(1);
    // task t1 + task_experiment te1 both reverse-map to grant 7.
    expect(totals.tasks).toBe(2);
  });

  it("provides a per-member breakdown", async () => {
    const GRANT_ID = 5;
    const deps: GrantTaggedRollupDeps = {
      readWork: async () =>
        makeReadResult([
          {
            owner: "alice",
            records: [
              makeRecord("project", "p1", {
                id: 1,
                name: "Alice Project",
                funding_account_id: GRANT_ID,
                updated_at: isoAgo(3),
              }),
            ],
          },
          {
            owner: "bob",
            records: [
              makeRecord("purchase_item", "pu1", {
                item_name: "Tubes",
                funding_account_id: GRANT_ID,
                updated_at: isoAgo(2),
              }),
            ],
          },
        ]),
      listFundingAccounts: async () =>
        [makeFundingAccount(GRANT_ID, "Lab Grant")] as never,
    };
    const tool = makeGrantTaggedRollupTool(deps);
    const res = (await tool.execute({ grantId: GRANT_ID })) as Record<string, unknown>;
    const members = res.members as Array<Record<string, number | string>>;
    const alice = members.find((m) => m.owner === "alice");
    const bob = members.find((m) => m.owner === "bob");
    expect(alice?.projects).toBe(1);
    expect(alice?.purchases).toBe(0);
    expect(bob?.projects).toBe(0);
    expect(bob?.purchases).toBe(1);
  });

  it("degrades to hasGrant:false when the grant id is not found", async () => {
    const deps: GrantTaggedRollupDeps = {
      readWork: async () => makeReadResult([{ owner: "alice", records: [] }]),
      listFundingAccounts: async () =>
        [makeFundingAccount(1, "Some Grant")] as never,
    };
    const tool = makeGrantTaggedRollupTool(deps);
    const res = (await tool.execute({ grantId: 999 })) as Record<string, unknown>;
    expect(res.hasGrant).toBe(false);
    expect(typeof res.note).toBe("string");
  });

  it("degrades to hasLab:false when readWork fails", async () => {
    const deps: GrantTaggedRollupDeps = {
      readWork: async () => ({
        ok: false as const,
        error: "not a lab head",
        members: [],
      }),
      listFundingAccounts: async () =>
        [makeFundingAccount(42, "NIH R01")] as never,
    };
    const tool = makeGrantTaggedRollupTool(deps);
    const res = (await tool.execute({ grantId: 42 })) as Record<string, unknown>;
    expect(res.hasLab).toBe(false);
    expect(typeof res.note).toBe("string");
  });

  it("tasks from a different owner do not cross-contaminate via project_id", async () => {
    // Alice has project id=1 linked to grant 7. Bob also has a task with
    // project_id=1, but Bob's project 1 is NOT linked to the grant. The
    // reverse-map must be per-owner so Bob's task is not counted.
    const GRANT_ID = 7;
    const deps: GrantTaggedRollupDeps = {
      readWork: async () =>
        makeReadResult([
          {
            owner: "alice",
            records: [
              makeRecord("project", "p1", {
                id: 1,
                name: "Grant Project",
                funding_account_id: GRANT_ID,
                updated_at: isoAgo(2),
              }),
            ],
          },
          {
            owner: "bob",
            records: [
              // Bob's project 1 is NOT linked to the grant.
              makeRecord("project", "p1b", {
                id: 1,
                name: "Bob's Other Project",
                funding_account_id: null,
                updated_at: isoAgo(2),
              }),
              // Bob's task in project 1 -- should NOT be counted because
              // Bob's project 1 has no grant link.
              makeRecord("task", "t1", {
                name: "Bob's task",
                project_id: 1,
                updated_at: isoAgo(1),
              }),
            ],
          },
        ]),
      listFundingAccounts: async () =>
        [makeFundingAccount(GRANT_ID, "NSF Grant")] as never,
    };
    const tool = makeGrantTaggedRollupTool(deps);
    const res = (await tool.execute({ grantId: GRANT_ID })) as Record<string, unknown>;
    const totals = res.totals as Record<string, number>;
    // Only Alice's project counts; Bob's task must not be reverse-mapped.
    expect(totals.projects).toBe(1);
    expect(totals.tasks).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// progress_report_scaffold
// ---------------------------------------------------------------------------

describe("progress_report_scaffold", () => {
  it("aggregates accomplishments (experiments + results) within the period", async () => {
    const deps: ProgressReportScaffoldDeps = {
      readWork: async () =>
        makeReadResult([
          {
            owner: "alice",
            records: [
              makeRecord("experiment", "e1", {
                title: "Western blot",
                updated_at: isoAgo(10),
              }),
              makeRecord("result_sheet", "r1", {
                updated_at: isoAgo(5),
              }),
              // Outside period: 400 days ago.
              makeRecord("experiment", "e_old", {
                title: "Old experiment",
                updated_at: isoAgo(400),
              }),
            ],
          },
        ]),
      listFundingAccounts: async () => [],
    };
    const tool = makeProgressReportScaffoldTool(deps);
    const res = (await tool.execute({})) as Record<string, unknown>;
    expect(res.hasLab).toBe(true);
    const sections = res.sections as Record<string, unknown>;
    const acc = sections.accomplishments as Record<string, unknown>;
    // e1 is in period; e_old (400 days ago) is outside the default 365-day window.
    expect(acc.experiments).toBe(1);
    expect(acc.results).toBe(1);
    // Title from e1 is captured.
    expect((acc.titles as string[]).includes("Western blot")).toBe(true);
  });

  it("aggregates products section for depositable output types", async () => {
    const deps: ProgressReportScaffoldDeps = {
      readWork: async () =>
        makeReadResult([
          {
            owner: "alice",
            records: [
              makeRecord("sequence", "s1", { name: "GFP sequence", updated_at: isoAgo(5) }),
              makeRecord("molecule", "m1", { name: "Ethanol", updated_at: isoAgo(3) }),
              makeRecord("method", "me1", { name: "RNA extraction", updated_at: isoAgo(2) }),
              // Not a depositable output type.
              makeRecord("task", "t1", { name: "Some task", updated_at: isoAgo(1) }),
            ],
          },
        ]),
      listFundingAccounts: async () => [],
    };
    const tool = makeProgressReportScaffoldTool(deps);
    const res = (await tool.execute({})) as Record<string, unknown>;
    const sections = res.sections as Record<string, unknown>;
    const products = sections.products as Record<string, unknown>;
    const counts = products.counts as Record<string, number>;
    expect(counts.sequence).toBe(1);
    expect(counts.molecule).toBe(1);
    expect(counts.method).toBe(1);
    // The products note about deposits is always present.
    expect(typeof products.note).toBe("string");
    expect((products.note as string).length).toBeGreaterThan(10);
  });

  it("participants section has a per-member breakdown", async () => {
    const deps: ProgressReportScaffoldDeps = {
      readWork: async () =>
        makeReadResult([
          {
            owner: "alice",
            records: [
              makeRecord("experiment", "e1", { updated_at: isoAgo(5) }),
              makeRecord("result_sheet", "r1", { updated_at: isoAgo(3) }),
            ],
          },
          {
            owner: "bob",
            records: [
              makeRecord("experiment", "e2", { updated_at: isoAgo(2) }),
            ],
          },
        ]),
      listFundingAccounts: async () => [],
    };
    const tool = makeProgressReportScaffoldTool(deps);
    const res = (await tool.execute({})) as Record<string, unknown>;
    const sections = res.sections as Record<string, unknown>;
    const participants = sections.participants as Record<string, unknown>;
    const members = participants.members as Array<Record<string, unknown>>;
    const alice = members.find((m) => m.owner === "alice");
    const bob = members.find((m) => m.owner === "bob");
    expect(alice?.experiments).toBe(1);
    expect(alice?.results).toBe(1);
    expect(bob?.experiments).toBe(1);
    expect(bob?.results).toBe(0);
  });

  it("narrows to grant-tagged records when grantId is given", async () => {
    const GRANT_ID = 3;
    const deps: ProgressReportScaffoldDeps = {
      readWork: async () =>
        makeReadResult([
          {
            owner: "carol",
            records: [
              // Project linked to the grant.
              makeRecord("project", "p1", {
                id: 1,
                name: "Grant Project",
                funding_account_id: GRANT_ID,
                updated_at: isoAgo(5),
              }),
              // Experiment in that project (reverse-mapped).
              makeRecord("task_experiment", "te1", {
                name: "PCR run",
                project_id: 1,
                updated_at: isoAgo(4),
              }),
              // Experiment in a different project (NOT grant-tagged).
              makeRecord("task_experiment", "te2", {
                name: "Unrelated run",
                project_id: 99,
                updated_at: isoAgo(3),
              }),
            ],
          },
        ]),
      listFundingAccounts: async () =>
        [makeFundingAccount(GRANT_ID, "NIH R01")] as never,
    };
    const tool = makeProgressReportScaffoldTool(deps);
    const res = (await tool.execute({ grantId: GRANT_ID })) as Record<string, unknown>;
    expect(res.hasLab).toBe(true);
    const grant = res.grant as Record<string, unknown>;
    expect(grant.id).toBe(GRANT_ID);
    const sections = res.sections as Record<string, unknown>;
    const acc = sections.accomplishments as Record<string, unknown>;
    // Only te1 (reverse-mapped to the grant) should count; te2 is not grant-tagged.
    expect(acc.experiments).toBe(1);
  });

  it("uses the default period (365 days) when args are omitted", async () => {
    const deps: ProgressReportScaffoldDeps = {
      readWork: async () =>
        makeReadResult([{ owner: "alice", records: [] }]),
      listFundingAccounts: async () => [],
    };
    const tool = makeProgressReportScaffoldTool(deps);
    const res = (await tool.execute({})) as Record<string, unknown>;
    expect(res.hasLab).toBe(true);
    // periodStart and periodEnd should be ISO strings.
    expect(typeof res.periodStart).toBe("string");
    expect(typeof res.periodEnd).toBe("string");
    // periodStart should be approximately 365 days before periodEnd.
    const start = new Date(res.periodStart as string).getTime();
    const end = new Date(res.periodEnd as string).getTime();
    const diffDays = (end - start) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeGreaterThan(364);
    expect(diffDays).toBeLessThan(366);
  });

  it("falls back to defaults when ISO strings are invalid", async () => {
    const deps: ProgressReportScaffoldDeps = {
      readWork: async () =>
        makeReadResult([{ owner: "alice", records: [] }]),
      listFundingAccounts: async () => [],
    };
    const tool = makeProgressReportScaffoldTool(deps);
    // Pass invalid dates; the tool should not throw and should use defaults.
    const res = (await tool.execute({
      periodStart: "not-a-date",
      periodEnd: "also-bad",
    })) as Record<string, unknown>;
    expect(res.hasLab).toBe(true);
    expect(typeof res.periodStart).toBe("string");
    expect(typeof res.periodEnd).toBe("string");
  });

  it("degrades to hasLab:false when readWork fails", async () => {
    const deps: ProgressReportScaffoldDeps = {
      readWork: async () => ({
        ok: false as const,
        error: "not a lab head",
        members: [],
      }),
      listFundingAccounts: async () => [],
    };
    const tool = makeProgressReportScaffoldTool(deps);
    const res = (await tool.execute({})) as Record<string, unknown>;
    expect(res.hasLab).toBe(false);
    expect(typeof res.note).toBe("string");
  });

  it("the note string on the top-level result is always present", async () => {
    const deps: ProgressReportScaffoldDeps = {
      readWork: async () =>
        makeReadResult([{ owner: "alice", records: [] }]),
      listFundingAccounts: async () => [],
    };
    const tool = makeProgressReportScaffoldTool(deps);
    const res = (await tool.execute({})) as Record<string, unknown>;
    expect(typeof res.note).toBe("string");
    expect((res.note as string).length).toBeGreaterThan(10);
  });
});

// ===========================================================================
// Phase 4: Operations tools
// ===========================================================================

// ---------------------------------------------------------------------------
// Helpers for Phase 4 tests
// ---------------------------------------------------------------------------

function makeInventoryItem(
  id: number,
  name: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    name,
    category: "reagent",
    vendor: null,
    low_at_count: null,
    owner: "alice",
    ...overrides,
  };
}

function makeInventoryStock(
  id: number,
  itemId: number,
  containerCount: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    item_id: itemId,
    container_count: containerCount,
    status: "in_stock",
    expiration_date: null,
    location_text: null,
    location_node_id: null,
    ...overrides,
  };
}

function makePurchaseRecord(
  id: number,
  itemName: string,
  totalPrice: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    item_name: itemName,
    quantity: 1,
    price_per_unit: totalPrice,
    shipping_fees: 0,
    total_price: totalPrice,
    vendor: null,
    order_status: "needs_ordering",
    funding_account_id: null,
    funding_string: null,
    catalog_number: null,
    category: null,
    assigned_to: null,
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// reorder_digest
// ---------------------------------------------------------------------------

describe("reorder_digest", () => {
  it("flags LOW items by count threshold", async () => {
    const deps: ReorderDigestDeps = {
      readWork: async () =>
        makeReadResult([
          {
            owner: "alice",
            records: [
              // Item with low_at_count=5; current total=2, so LOW.
              makeRecord("inventory", "i1", makeInventoryItem(1, "TRIS Buffer", {
                low_at_count: 5,
                vendor: "Sigma",
              })),
              makeRecord("inventory_stock", "s1", makeInventoryStock(10, 1, 2)),
            ],
          },
        ]),
    };

    const tool = makeReorderDigestTool(deps);
    const res = (await tool.execute({})) as Record<string, unknown>;
    expect(res.hasLab).toBe(true);
    const totals = res.totals as Record<string, number>;
    expect(totals.lowItems).toBe(1);
    expect(totals.outItems).toBe(0);
    const lowItems = res.lowItems as Array<Record<string, unknown>>;
    expect(lowItems[0].name).toBe("TRIS Buffer");
    expect(lowItems[0].count).toBe(2);
    expect(lowItems[0].threshold).toBe(5);
    expect(lowItems[0].vendor).toBe("Sigma");
  });

  it("flags LOW items via stock status 'low' even if above threshold", async () => {
    const deps: ReorderDigestDeps = {
      readWork: async () =>
        makeReadResult([
          {
            owner: "alice",
            records: [
              makeRecord("inventory", "i1", makeInventoryItem(1, "Ethanol", {
                low_at_count: null,
              })),
              makeRecord("inventory_stock", "s1", makeInventoryStock(10, 1, 3, {
                status: "low",
              })),
            ],
          },
        ]),
    };

    const tool = makeReorderDigestTool(deps);
    const res = (await tool.execute({})) as Record<string, unknown>;
    const totals = res.totals as Record<string, number>;
    expect(totals.lowItems).toBe(1);
    const lowItems = res.lowItems as Array<Record<string, unknown>>;
    expect(lowItems[0].name).toBe("Ethanol");
  });

  it("flags OUT items when container_count sums to zero", async () => {
    const deps: ReorderDigestDeps = {
      readWork: async () =>
        makeReadResult([
          {
            owner: "alice",
            records: [
              makeRecord("inventory", "i1", makeInventoryItem(1, "GFP Antibody")),
              makeRecord("inventory_stock", "s1", makeInventoryStock(10, 1, 0)),
            ],
          },
        ]),
    };

    const tool = makeReorderDigestTool(deps);
    const res = (await tool.execute({})) as Record<string, unknown>;
    const totals = res.totals as Record<string, number>;
    expect(totals.outItems).toBe(1);
    expect(totals.lowItems).toBe(0);
    const outItems = res.outItems as Array<Record<string, unknown>>;
    expect(outItems[0].name).toBe("GFP Antibody");
  });

  it("flags OUT items via stock status 'empty'", async () => {
    const deps: ReorderDigestDeps = {
      readWork: async () =>
        makeReadResult([
          {
            owner: "alice",
            records: [
              makeRecord("inventory", "i1", makeInventoryItem(1, "DMSO")),
              makeRecord("inventory_stock", "s1", makeInventoryStock(10, 1, 1, {
                status: "empty",
              })),
            ],
          },
        ]),
    };

    const tool = makeReorderDigestTool(deps);
    const res = (await tool.execute({})) as Record<string, unknown>;
    const totals = res.totals as Record<string, number>;
    expect(totals.outItems).toBe(1);
  });

  it("populates reorderQueue from purchases with order_status 'needs_ordering'", async () => {
    const deps: ReorderDigestDeps = {
      readWork: async () =>
        makeReadResult([
          {
            owner: "alice",
            records: [
              makeRecord("purchase", "pu1", makePurchaseRecord(1, "Tips 200ul", 25, {
                vendor: "Fisher",
                assigned_to: "bob",
                order_status: "needs_ordering",
              })),
              // "ordered" should NOT appear in the queue.
              makeRecord("purchase", "pu2", makePurchaseRecord(2, "Tubes 15ml", 15, {
                order_status: "ordered",
              })),
            ],
          },
        ]),
    };

    const tool = makeReorderDigestTool(deps);
    const res = (await tool.execute({})) as Record<string, unknown>;
    const totals = res.totals as Record<string, number>;
    expect(totals.pendingOrders).toBe(1);
    const queue = res.reorderQueue as Array<Record<string, unknown>>;
    expect(queue).toHaveLength(1);
    expect(queue[0].itemName).toBe("Tips 200ul");
    expect(queue[0].vendor).toBe("Fisher");
    expect(queue[0].assignedTo).toBe("bob");
  });

  it("does not collide item ids across owners (per-owner isolation)", async () => {
    // Alice and Bob both have item id=1, but Alice's is LOW and Bob's is fine.
    const deps: ReorderDigestDeps = {
      readWork: async () =>
        makeReadResult([
          {
            owner: "alice",
            records: [
              makeRecord("inventory", "i1a", makeInventoryItem(1, "Alice's Reagent", {
                low_at_count: 10,
              })),
              makeRecord("inventory_stock", "s1a", makeInventoryStock(100, 1, 2)),
            ],
          },
          {
            owner: "bob",
            records: [
              makeRecord("inventory", "i1b", makeInventoryItem(1, "Bob's Reagent", {
                low_at_count: 1,
              })),
              makeRecord("inventory_stock", "s1b", makeInventoryStock(200, 1, 5)),
            ],
          },
        ]),
    };

    const tool = makeReorderDigestTool(deps);
    const res = (await tool.execute({})) as Record<string, unknown>;
    const totals = res.totals as Record<string, number>;
    // Alice's item (count=2, threshold=10) is LOW; Bob's (count=5, threshold=1) is fine.
    expect(totals.lowItems).toBe(1);
    const lowItems = res.lowItems as Array<Record<string, unknown>>;
    expect(lowItems[0].owner).toBe("alice");
    expect(lowItems[0].name).toBe("Alice's Reagent");
  });

  it("degrades cleanly when readWork fails", async () => {
    const deps: ReorderDigestDeps = {
      readWork: async () => ({
        ok: false as const,
        error: "not a lab head",
        members: [],
      }),
    };

    const tool = makeReorderDigestTool(deps);
    const res = (await tool.execute({})) as Record<string, unknown>;
    expect(res.hasLab).toBe(false);
    expect(typeof res.note).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// spend_summary
// ---------------------------------------------------------------------------

describe("spend_summary", () => {
  it("separates placed vs pending spend", async () => {
    const deps: SpendSummaryDeps = {
      readWork: async () =>
        makeReadResult([
          {
            owner: "alice",
            records: [
              makeRecord("purchase", "pu1", makePurchaseRecord(1, "Antibody", 100, {
                order_status: "ordered",
                updated_at: isoAgo(5),
              })),
              makeRecord("purchase", "pu2", makePurchaseRecord(2, "Tips", 50, {
                order_status: "needs_ordering",
                updated_at: isoAgo(3),
              })),
              makeRecord("purchase", "pu3", makePurchaseRecord(3, "Columns", 200, {
                order_status: "received",
                updated_at: isoAgo(1),
              })),
            ],
          },
        ]),
      listFundingAccounts: async () => [],
    };

    const tool = makeSpendSummaryTool(deps);
    const res = (await tool.execute({})) as Record<string, unknown>;
    expect(res.hasLab).toBe(true);
    const totals = res.totals as Record<string, number>;
    // placed = ordered(100) + received(200) = 300
    expect(totals.placed).toBe(300);
    // pending = needs_ordering(50)
    expect(totals.pending).toBe(50);
    expect(totals.count).toBe(3);
  });

  it("filters by periodDays using isWithinDays", async () => {
    const deps: SpendSummaryDeps = {
      readWork: async () =>
        makeReadResult([
          {
            owner: "alice",
            records: [
              // Within 30-day window.
              makeRecord("purchase", "pu1", makePurchaseRecord(1, "Reagent A", 75, {
                order_status: "ordered",
                updated_at: isoAgo(10),
              })),
              // Outside 30-day window.
              makeRecord("purchase", "pu2", makePurchaseRecord(2, "Reagent B", 200, {
                order_status: "ordered",
                updated_at: isoAgo(60),
              })),
            ],
          },
        ]),
      listFundingAccounts: async () => [],
    };

    const tool = makeSpendSummaryTool(deps);
    const res = (await tool.execute({ periodDays: 30 })) as Record<string, unknown>;
    const totals = res.totals as Record<string, number>;
    expect(totals.placed).toBe(75);
    expect(totals.count).toBe(1);
  });

  it("provides byVendor breakdown", async () => {
    const deps: SpendSummaryDeps = {
      readWork: async () =>
        makeReadResult([
          {
            owner: "alice",
            records: [
              makeRecord("purchase", "pu1", makePurchaseRecord(1, "Item A", 100, {
                vendor: "Sigma",
                order_status: "ordered",
                updated_at: isoAgo(1),
              })),
              makeRecord("purchase", "pu2", makePurchaseRecord(2, "Item B", 50, {
                vendor: "Sigma",
                order_status: "ordered",
                updated_at: isoAgo(1),
              })),
              makeRecord("purchase", "pu3", makePurchaseRecord(3, "Item C", 30, {
                vendor: null,
                order_status: "ordered",
                updated_at: isoAgo(1),
              })),
            ],
          },
        ]),
      listFundingAccounts: async () => [],
    };

    const tool = makeSpendSummaryTool(deps);
    const res = (await tool.execute({ groupBy: "vendor" })) as Record<string, unknown>;
    expect("byVendor" in res).toBe(true);
    expect("byGrant" in res).toBe(false);
    const byVendor = res.byVendor as Array<Record<string, unknown>>;
    const sigma = byVendor.find((v) => v.vendor === "Sigma");
    const unspec = byVendor.find((v) => v.vendor === "Unspecified");
    expect(sigma?.total).toBe(150);
    expect(sigma?.count).toBe(2);
    expect(unspec?.total).toBe(30);
  });

  it("provides byGrant breakdown and resolves grant names", async () => {
    const GRANT_ID = 7;
    const deps: SpendSummaryDeps = {
      readWork: async () =>
        makeReadResult([
          {
            owner: "alice",
            records: [
              makeRecord("purchase", "pu1", makePurchaseRecord(1, "Primers", 80, {
                funding_account_id: GRANT_ID,
                order_status: "ordered",
                updated_at: isoAgo(2),
              })),
              makeRecord("purchase", "pu2", makePurchaseRecord(2, "Tips", 20, {
                funding_account_id: null,
                order_status: "ordered",
                updated_at: isoAgo(2),
              })),
            ],
          },
        ]),
      listFundingAccounts: async () =>
        [makeFundingAccount(GRANT_ID, "NIH R01 GM123456")] as never,
    };

    const tool = makeSpendSummaryTool(deps);
    const res = (await tool.execute({ groupBy: "grant" })) as Record<string, unknown>;
    expect("byGrant" in res).toBe(true);
    expect("byVendor" in res).toBe(false);
    const byGrant = res.byGrant as Array<Record<string, unknown>>;
    const grantEntry = byGrant.find((g) => g.grantId === GRANT_ID);
    expect(grantEntry?.grantName).toBe("NIH R01 GM123456");
    expect(grantEntry?.total).toBe(80);
    const noGrant = byGrant.find((g) => g.grantId === null);
    expect(noGrant?.grantName).toBe("No grant");
    expect(noGrant?.total).toBe(20);
  });

  it("provides both byVendor and byGrant when groupBy is 'both' (default)", async () => {
    const deps: SpendSummaryDeps = {
      readWork: async () =>
        makeReadResult([
          {
            owner: "alice",
            records: [
              makeRecord("purchase", "pu1", makePurchaseRecord(1, "Item", 50, {
                vendor: "Fisher",
                order_status: "ordered",
                updated_at: isoAgo(1),
              })),
            ],
          },
        ]),
      listFundingAccounts: async () => [],
    };

    const tool = makeSpendSummaryTool(deps);
    const res = (await tool.execute({})) as Record<string, unknown>;
    expect("byVendor" in res).toBe(true);
    expect("byGrant" in res).toBe(true);
  });

  it("restricts to a specific grantId when given", async () => {
    const GRANT_ID = 3;
    const deps: SpendSummaryDeps = {
      readWork: async () =>
        makeReadResult([
          {
            owner: "alice",
            records: [
              makeRecord("purchase", "pu1", makePurchaseRecord(1, "Included", 100, {
                funding_account_id: GRANT_ID,
                order_status: "ordered",
                updated_at: isoAgo(1),
              })),
              makeRecord("purchase", "pu2", makePurchaseRecord(2, "Excluded", 999, {
                funding_account_id: 99,
                order_status: "ordered",
                updated_at: isoAgo(1),
              })),
            ],
          },
        ]),
      listFundingAccounts: async () =>
        [makeFundingAccount(GRANT_ID, "NSF Grant")] as never,
    };

    const tool = makeSpendSummaryTool(deps);
    const res = (await tool.execute({ grantId: GRANT_ID })) as Record<string, unknown>;
    const grant = res.grant as Record<string, unknown> | null;
    expect(grant).not.toBeNull();
    expect(grant?.id).toBe(GRANT_ID);
    expect(grant?.name).toBe("NSF Grant");
    const totals = res.totals as Record<string, number>;
    expect(totals.placed).toBe(100);
    expect(totals.count).toBe(1);
  });

  it("rounds money to two decimals", async () => {
    const deps: SpendSummaryDeps = {
      readWork: async () =>
        makeReadResult([
          {
            owner: "alice",
            records: [
              makeRecord("purchase", "pu1", makePurchaseRecord(1, "Item", 33.333, {
                order_status: "ordered",
                updated_at: isoAgo(1),
              })),
              makeRecord("purchase", "pu2", makePurchaseRecord(2, "Item2", 66.667, {
                order_status: "ordered",
                updated_at: isoAgo(1),
              })),
            ],
          },
        ]),
      listFundingAccounts: async () => [],
    };

    const tool = makeSpendSummaryTool(deps);
    const res = (await tool.execute({ groupBy: "vendor" })) as Record<string, unknown>;
    const totals = res.totals as Record<string, number>;
    // 33.333 + 66.667 = 100.000; individual rounding then sum may vary slightly.
    // The key check is that the total_price values were not left as floating garbage.
    expect(totals.placed.toString().split(".")[1]?.length ?? 0).toBeLessThanOrEqual(2);
  });

  it("degrades cleanly when readWork fails", async () => {
    const deps: SpendSummaryDeps = {
      readWork: async () => ({
        ok: false as const,
        error: "not a lab head",
        members: [],
      }),
      listFundingAccounts: async () => [],
    };

    const tool = makeSpendSummaryTool(deps);
    const res = (await tool.execute({})) as Record<string, unknown>;
    expect(res.hasLab).toBe(false);
    expect(typeof res.note).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// inventory_audit
// ---------------------------------------------------------------------------

describe("inventory_audit", () => {
  it("flags stocks expiring within the window", async () => {
    const soonIso = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
    const deps: InventoryAuditDeps = {
      readWork: async () =>
        makeReadResult([
          {
            owner: "alice",
            records: [
              makeRecord("inventory", "i1", makeInventoryItem(1, "PCR Kit")),
              makeRecord("inventory_stock", "s1", makeInventoryStock(10, 1, 2, {
                expiration_date: soonIso,
              })),
            ],
          },
        ]),
    };

    const tool = makeInventoryAuditTool(deps);
    // Default 30-day window: 10 days from now is within it.
    const res = (await tool.execute({})) as Record<string, unknown>;
    const totals = res.totals as Record<string, number>;
    expect(totals.expiring).toBe(1);
    const exp = res.expiring as Array<Record<string, unknown>>;
    expect(exp[0].itemName).toBe("PCR Kit");
    expect((exp[0].daysUntil as number)).toBeCloseTo(10, 0);
  });

  it("flags stocks already past their expiration date (daysUntil negative)", async () => {
    const pastIso = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const deps: InventoryAuditDeps = {
      readWork: async () =>
        makeReadResult([
          {
            owner: "alice",
            records: [
              makeRecord("inventory", "i1", makeInventoryItem(1, "Old Enzyme")),
              makeRecord("inventory_stock", "s1", makeInventoryStock(10, 1, 1, {
                expiration_date: pastIso,
              })),
            ],
          },
        ]),
    };

    const tool = makeInventoryAuditTool(deps);
    const res = (await tool.execute({})) as Record<string, unknown>;
    const exp = res.expiring as Array<Record<string, unknown>>;
    expect(exp.length).toBeGreaterThanOrEqual(1);
    expect((exp[0].daysUntil as number)).toBeLessThan(0);
  });

  it("flags stocks with status 'expired' even without expiration_date", async () => {
    const deps: InventoryAuditDeps = {
      readWork: async () =>
        makeReadResult([
          {
            owner: "alice",
            records: [
              makeRecord("inventory", "i1", makeInventoryItem(1, "Old Buffer")),
              makeRecord("inventory_stock", "s1", makeInventoryStock(10, 1, 1, {
                status: "expired",
                expiration_date: null,
              })),
            ],
          },
        ]),
    };

    const tool = makeInventoryAuditTool(deps);
    const res = (await tool.execute({})) as Record<string, unknown>;
    const totals = res.totals as Record<string, number>;
    expect(totals.expiring).toBe(1);
  });

  it("does not flag stocks expiring OUTSIDE the window", async () => {
    // 60 days from now is outside the default 30-day window.
    const farFuture = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();
    const deps: InventoryAuditDeps = {
      readWork: async () =>
        makeReadResult([
          {
            owner: "alice",
            records: [
              makeRecord("inventory", "i1", makeInventoryItem(1, "Fresh Reagent")),
              makeRecord("inventory_stock", "s1", makeInventoryStock(10, 1, 3, {
                expiration_date: farFuture,
              })),
            ],
          },
        ]),
    };

    const tool = makeInventoryAuditTool(deps);
    const res = (await tool.execute({ expiringDays: 30 })) as Record<string, unknown>;
    const totals = res.totals as Record<string, number>;
    expect(totals.expiring).toBe(0);
  });

  it("flags out-of-stock items (zero total containers)", async () => {
    const deps: InventoryAuditDeps = {
      readWork: async () =>
        makeReadResult([
          {
            owner: "alice",
            records: [
              makeRecord("inventory", "i1", makeInventoryItem(1, "Empty Buffer")),
              makeRecord("inventory_stock", "s1", makeInventoryStock(10, 1, 0)),
            ],
          },
        ]),
    };

    const tool = makeInventoryAuditTool(deps);
    const res = (await tool.execute({})) as Record<string, unknown>;
    const totals = res.totals as Record<string, number>;
    expect(totals.outOfStock).toBeGreaterThanOrEqual(1);
    const out = res.outOfStock as Array<Record<string, unknown>>;
    expect(out.some((o) => o.itemName === "Empty Buffer")).toBe(true);
  });

  it("flags unlocated stocks (count > 0 and no location)", async () => {
    const deps: InventoryAuditDeps = {
      readWork: async () =>
        makeReadResult([
          {
            owner: "alice",
            records: [
              makeRecord("inventory", "i1", makeInventoryItem(1, "Floating Stock")),
              // Has containers but no location.
              makeRecord("inventory_stock", "s1", makeInventoryStock(10, 1, 3, {
                location_text: null,
                location_node_id: null,
              })),
              // This stock HAS a location -- should NOT be unlocated.
              makeRecord("inventory_stock", "s2", makeInventoryStock(11, 1, 2, {
                location_text: "Fridge A",
                location_node_id: null,
              })),
            ],
          },
        ]),
    };

    const tool = makeInventoryAuditTool(deps);
    const res = (await tool.execute({})) as Record<string, unknown>;
    const totals = res.totals as Record<string, number>;
    expect(totals.unlocated).toBe(1);
    const unlocated = res.unlocated as Array<Record<string, unknown>>;
    expect(unlocated[0].stockId).toBe(10);
    expect(unlocated[0].itemName).toBe("Floating Stock");
  });

  it("does NOT flag unlocated stocks with zero containers", async () => {
    // A stock with count=0 and no location is OUT, not unlocated (it has no real containers to place).
    const deps: InventoryAuditDeps = {
      readWork: async () =>
        makeReadResult([
          {
            owner: "alice",
            records: [
              makeRecord("inventory", "i1", makeInventoryItem(1, "Empty")),
              makeRecord("inventory_stock", "s1", makeInventoryStock(10, 1, 0, {
                location_text: null,
                location_node_id: null,
              })),
            ],
          },
        ]),
    };

    const tool = makeInventoryAuditTool(deps);
    const res = (await tool.execute({})) as Record<string, unknown>;
    const totals = res.totals as Record<string, number>;
    expect(totals.unlocated).toBe(0);
  });

  it("resolves item names from the same owner's item records", async () => {
    const deps: InventoryAuditDeps = {
      readWork: async () =>
        makeReadResult([
          {
            owner: "alice",
            records: [
              makeRecord("inventory", "i1", makeInventoryItem(1, "Named Reagent")),
              makeRecord("inventory_stock", "s1", makeInventoryStock(10, 1, 0)),
            ],
          },
        ]),
    };

    const tool = makeInventoryAuditTool(deps);
    const res = (await tool.execute({})) as Record<string, unknown>;
    const out = res.outOfStock as Array<Record<string, unknown>>;
    expect(out[0].itemName).toBe("Named Reagent");
    expect(out[0].owner).toBe("alice");
  });

  it("degrades cleanly when readWork fails", async () => {
    const deps: InventoryAuditDeps = {
      readWork: async () => ({
        ok: false as const,
        error: "not a lab head",
        members: [],
      }),
    };

    const tool = makeInventoryAuditTool(deps);
    const res = (await tool.execute({})) as Record<string, unknown>;
    expect(res.hasLab).toBe(false);
    expect(typeof res.note).toBe("string");
  });
});
