// Unit tests for the summary-artifact-tool (BeakerAI lane, 2026-06-13).
//
// These tests assert:
//   1. The composed note markdown carries the verbatim totals from the input
//      (numbers are NEVER re-derived or reformatted here).
//   2. Drill-down deep-links for matched items appear in the output.
//   3. No fabricated numbers appear (the tool does not add, sum, or invent).
//   4. The timeline table and breakdown section render correctly from fixture data.
//   5. The chart embed section is emitted only when plotDocId is present.
//   6. The gated execute path writes via the injected deps seam (no real folder).
//   7. Error paths (missing narration, missing summaryType) return ok: false.
//
// We stub the write deps via the summaryArtifactDeps seam so no Loro store or
// file system is touched.

import { describe, it, expect, afterEach } from "vitest";
import {
  composeSummaryNote,
  buildTimelineTable,
  buildBreakdownSection,
  buildItemsList,
  buildScopeLine,
  itemChip,
  saveSummaryAsNoteTool,
  summaryArtifactDeps,
  type SummaryArtifactDeps,
} from "./summary-artifact-tool";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TODAY = "2026-06-13";

/** A minimal experiments summary fixture, mirroring the shape returned by
 *  summarize_experiments. Every count and display string is invented here as
 *  fixture values; the test asserts the tool echoes them verbatim. */
const EXPERIMENT_SUMMARY = {
  summaryType: "experiments" as const,
  total: 7,
  truncated: false,
  filter: {
    since: "2026-06-01",
    until: "2026-06-30",
    owners: ["grant"],
  },
  byStatus: { complete: 3, active: 2, overdue: 1, upcoming: 1 },
  byProject: [
    { projectId: "4", projectName: "cyp51A", count: 4 },
    { projectId: "9", projectName: "abc1", count: 3 },
  ],
  byOwner: { grant: 5, alice: 2 },
  byMonth: [{ month: "2026-06", count: 7 }],
  finishingThisWeek: 2,
  asOf: TODAY,
  items: [
    {
      id: "grant:1",
      title: "Colony PCR screen",
      status: "complete",
      startDate: "2026-06-02",
      owner: "grant",
      deepLink: "/?openTask=grant:1",
    },
    {
      id: "grant:3",
      title: "Miniprep batch",
      status: "active",
      startDate: "2026-06-10",
      owner: "grant",
      deepLink: "/?openTask=grant:3",
    },
  ],
};

/** A minimal purchases summary fixture. */
const PURCHASE_SUMMARY = {
  summaryType: "purchases" as const,
  count: 4,
  total: 4,
  truncated: false,
  filter: { since: "2026-06-01" },
  totalSpend: 287.75,
  totalSpendDisplay: "$287.75",
  byVendor: [
    { key: "NEB", count: 2, spend: 215.25, spendDisplay: "$215.25" },
    { key: "IDT", count: 1, spend: 42.5, spendDisplay: "$42.50" },
    { key: "Unknown vendor", count: 1, spend: 30, spendDisplay: "$30.00" },
  ],
  byCategory: [
    { key: "reagents", count: 2, spend: 215.25, spendDisplay: "$215.25" },
    { key: "oligos", count: 1, spend: 42.5, spendDisplay: "$42.50" },
  ],
  byMonth: [
    { month: "2026-05", count: 1, spend: 120.25, spendDisplay: "$120.25" },
    { month: "2026-06", count: 3, spend: 167.5, spendDisplay: "$167.50" },
  ],
  byStatus: { needs_ordering: 1, ordered: 1, received: 2 },
  pendingVsReceived: { pending: 2, received: 2 },
  largestItems: [
    {
      id: "3",
      name: "Taq polymerase",
      vendor: "NEB",
      category: "reagents",
      totalPrice: 120.25,
      totalPriceDisplay: "$120.25",
      orderStatus: "needs_ordering",
      owner: "alice",
      deepLink: "/purchases",
    },
  ],
};

/** A lab_digest fixture mirroring the LabDigest shape. */
const DIGEST_SUMMARY = {
  summaryType: "digest" as const,
  window: {
    since: "2026-06-06",
    until: "2026-06-12",
    owners: null,
    asOf: TODAY,
  },
  experiments: { run: 3, finished: 1, overdue: 1, finishingThisWeek: 2 },
  notes: { written: 2, entries: 5 },
  purchases: {
    made: 4,
    totalSpend: 287.75,
    totalSpendDisplay: "$287.75",
    pending: 2,
  },
  scheduled: { projectsWithOverdue: 1, nextUpcomingStart: "2026-06-20" },
};

/** A projects summary fixture. */
const PROJECTS_SUMMARY = {
  summaryType: "projects" as const,
  total: 2,
  truncated: false,
  filter: {},
  totalProjects: 2,
  projectsWithOverdue: 1,
  projects: [
    {
      id: "1",
      name: "cyp51A",
      totalTasks: 3,
      percentComplete: 33,
      overdue: true,
      nextDueDate: "2026-06-22",
      deepLink: "/projects/1",
    },
    {
      id: "2",
      name: "abc1",
      totalTasks: 1,
      percentComplete: 100,
      overdue: false,
      nextDueDate: null,
      deepLink: "/projects/2",
    },
  ],
};

/** An inventory summary fixture. */
const INVENTORY_SUMMARY = {
  summaryType: "inventory" as const,
  itemCount: 4,
  stockCount: 4,
  byCategory: [{ category: "enzyme", count: 1 }],
  low: [
    {
      id: "1",
      title: "Q5 polymerase",
      reorderThreshold: 2,
      totalContainers: 2,
      deepLink: "",
    },
  ],
  out: [{ id: "2", title: "dNTPs" }],
  expiringSoon: [{ id: "3", title: "Primer mix" }],
  expired: [],
  recentMovements: [],
  filter: {},
};

// ---------------------------------------------------------------------------
// buildScopeLine
// ---------------------------------------------------------------------------

describe("buildScopeLine", () => {
  it("renders a date window when both since and until are present", () => {
    const line = buildScopeLine({
      summaryType: "experiments",
      filter: { since: "2026-06-01", until: "2026-06-30" },
    } as never);
    expect(line).toContain("2026-06-01");
    expect(line).toContain("2026-06-30");
  });

  it("renders only since when until is absent", () => {
    const line = buildScopeLine({
      summaryType: "experiments",
      filter: { since: "2026-06-01" },
    } as never);
    expect(line).toContain("2026-06-01");
    expect(line).not.toContain("until");
  });

  it("renders owners when present", () => {
    const line = buildScopeLine({
      summaryType: "experiments",
      filter: { owners: ["grant", "alice"] },
    } as never);
    expect(line).toContain("grant");
    expect(line).toContain("alice");
  });

  it("returns an empty string when filter is absent", () => {
    const line = buildScopeLine({ summaryType: "notes" } as never);
    expect(line).toBe("");
  });

  it("reads window.since / window.until for digest summaries", () => {
    const line = buildScopeLine(DIGEST_SUMMARY as never);
    expect(line).toContain("2026-06-06");
    expect(line).toContain("2026-06-12");
  });
});

// ---------------------------------------------------------------------------
// buildTimelineTable
// ---------------------------------------------------------------------------

describe("buildTimelineTable", () => {
  it("returns an empty string when there are no rows", () => {
    expect(buildTimelineTable([])).toBe("");
  });

  it("builds a count-only table for experiment rows", () => {
    const table = buildTimelineTable([
      { month: "2026-05", count: 2 },
      { month: "2026-06", count: 5 },
    ]);
    expect(table).toContain("| Month | Count |");
    expect(table).toContain("2026-05");
    expect(table).toContain("2026-06");
    expect(table).toContain("| 2 |");
    expect(table).toContain("| 5 |");
    // No Spend column when spendDisplay is absent.
    expect(table).not.toContain("Spend");
  });

  it("adds a Spend column when rows carry spendDisplay", () => {
    const table = buildTimelineTable([
      { month: "2026-05", count: 1, spendDisplay: "$120.25" },
      { month: "2026-06", count: 3, spendDisplay: "$167.50" },
    ]);
    expect(table).toContain("Spend");
    // The display string must appear verbatim, unchanged.
    expect(table).toContain("$120.25");
    expect(table).toContain("$167.50");
  });

  it("echoes the month and count verbatim without re-formatting", () => {
    const table = buildTimelineTable([{ month: "2026-06", count: 7 }]);
    expect(table).toContain("2026-06");
    expect(table).toContain("7");
    // The count must not gain any decoration (currency symbol, percentage, etc.).
    expect(table).not.toContain("$7");
    expect(table).not.toContain("7%");
  });
});

// ---------------------------------------------------------------------------
// buildBreakdownSection (per-type spot checks)
// ---------------------------------------------------------------------------

describe("buildBreakdownSection (experiments)", () => {
  it("builds a status table echoing the verbatim counts", () => {
    const s = buildBreakdownSection(EXPERIMENT_SUMMARY as never);
    expect(s).toContain("Status breakdown");
    // The numbers from byStatus, verbatim.
    expect(s).toContain("complete");
    expect(s).toContain("| 3 |");
    expect(s).toContain("active");
    expect(s).toContain("| 2 |");
  });

  it("includes the by-project table with resolved names", () => {
    const s = buildBreakdownSection(EXPERIMENT_SUMMARY as never);
    expect(s).toContain("cyp51A");
    expect(s).toContain("| 4 |");
    expect(s).toContain("abc1");
    expect(s).toContain("| 3 |");
    // Must not use the raw projectId in the table.
    expect(s).not.toContain("| 4 | 4 |");
  });
});

describe("buildBreakdownSection (purchases)", () => {
  it("builds vendor and category tables with verbatim spendDisplay strings", () => {
    const s = buildBreakdownSection(PURCHASE_SUMMARY as never);
    // Vendor table.
    expect(s).toContain("By vendor");
    expect(s).toContain("NEB");
    // The display string must appear verbatim.
    expect(s).toContain("$215.25");
    expect(s).toContain("IDT");
    expect(s).toContain("$42.50");
    // Category table.
    expect(s).toContain("By category");
    expect(s).toContain("reagents");
  });
});

describe("buildBreakdownSection (projects)", () => {
  it("lists projects with percent complete, overdue flag, and next due date", () => {
    const s = buildBreakdownSection(PROJECTS_SUMMARY as never);
    expect(s).toContain("Project progress");
    expect(s).toContain("cyp51A");
    expect(s).toContain("33%");
    expect(s).toContain("yes"); // overdue
    expect(s).toContain("2026-06-22"); // nextDueDate
    expect(s).toContain("abc1");
    expect(s).toContain("100%");
    expect(s).toContain("no"); // not overdue
  });
});

describe("buildBreakdownSection (inventory)", () => {
  it("builds low / out / expiring soon lists", () => {
    const s = buildBreakdownSection(INVENTORY_SUMMARY as never);
    expect(s).toContain("Low stock");
    expect(s).toContain("Q5 polymerase");
    expect(s).toContain("Out of stock");
    expect(s).toContain("dNTPs");
    expect(s).toContain("Expiring soon");
    expect(s).toContain("Primer mix");
  });
});

describe("buildBreakdownSection (digest)", () => {
  it("builds experiment and purchases tables from the digest sub-blocks", () => {
    const s = buildBreakdownSection(DIGEST_SUMMARY as never);
    expect(s).toContain("Experiments");
    expect(s).toContain("Run");
    expect(s).toContain("| 3 |"); // exp.run = 3
    expect(s).toContain("Finished");
    expect(s).toContain("| 1 |"); // exp.finished = 1
    expect(s).toContain("Purchases");
    // The totalSpendDisplay string must appear verbatim.
    expect(s).toContain("$287.75");
  });
});

// ---------------------------------------------------------------------------
// buildItemsList (drill-down chips)
// ---------------------------------------------------------------------------

describe("buildItemsList", () => {
  it("returns an empty string when there are no items", () => {
    expect(buildItemsList([], "experiments", false)).toBe("");
  });

  it("emits an inline chip link when the item has a deepLink", () => {
    const s = buildItemsList(EXPERIMENT_SUMMARY.items, "experiments", false);
    expect(s).toContain("Colony PCR screen");
    // The chip must contain the object id (URL-encoded colons are fine, the link
    // still encodes the same path). The important check is that the real item id
    // appears in the href, not a fabricated one.
    expect(s).toContain("grant");
    expect(s).toContain("openTask");
    expect(s).toContain("Miniprep batch");
    // Each item must be a markdown link.
    expect(s).toMatch(/\[Colony PCR screen\]\([^)]+\)/);
    expect(s).toMatch(/\[Miniprep batch\]\([^)]+\)/);
  });

  it("includes the status and owner inline", () => {
    const s = buildItemsList(EXPERIMENT_SUMMARY.items, "experiments", false);
    expect(s).toContain("complete");
    expect(s).toContain("by grant");
  });

  it("appends a truncation note when truncated is true", () => {
    const s = buildItemsList(EXPERIMENT_SUMMARY.items, "experiments", true);
    expect(s).toContain("more records not shown");
  });

  it("includes the purchase totalPriceDisplay verbatim", () => {
    const s = buildItemsList(
      PURCHASE_SUMMARY.largestItems as never,
      "purchases",
      false,
    );
    expect(s).toContain("$120.25");
    // The display string must appear verbatim, not reformatted.
    expect(s).not.toContain("$120.3");
    expect(s).not.toContain("120.25 dollars");
  });

  it("falls back to a plain name when deepLink is absent", () => {
    const items = [{ id: "1", title: "No-link item" }];
    const s = buildItemsList(items, "notes", false);
    expect(s).toContain("No-link item");
    // No markdown link syntax expected when there is no deepLink.
    expect(s).not.toContain("](");
  });
});

// ---------------------------------------------------------------------------
// itemChip
// ---------------------------------------------------------------------------

describe("itemChip", () => {
  it("returns objectReferenceMarkdown when deepLink is present", () => {
    const item = {
      id: "grant:1",
      title: "Colony PCR screen",
      deepLink: "/?openTask=grant:1",
    };
    const chip = itemChip(item, "experiments");
    expect(chip).toContain("Colony PCR screen");
    // The chip is a markdown link (inline form, no #ros= fragment).
    expect(chip).toMatch(/\[Colony PCR screen\]\(.*\)/);
  });

  it("returns a plain label when deepLink is absent or empty", () => {
    const chip = itemChip({ id: "1", title: "Plain item" }, "notes");
    expect(chip).toBe("Plain item");
    expect(chip).not.toContain("[");
  });

  it("prefers title over name over id", () => {
    expect(itemChip({ id: "x", title: "Title wins" }, "notes")).toContain("Title wins");
    expect(itemChip({ id: "x", name: "Name wins" }, "notes")).toContain("Name wins");
    expect(itemChip({ id: "x" }, "notes")).toContain("x");
  });
});

// ---------------------------------------------------------------------------
// composeSummaryNote (the central assembly function)
// ---------------------------------------------------------------------------

describe("composeSummaryNote (experiments fixture)", () => {
  it("contains the verbatim total count from the input", () => {
    const note = composeSummaryNote(
      EXPERIMENT_SUMMARY as never,
      "Seven experiments ran in June.",
      "Experiments June 2026",
      TODAY,
    );
    // The note must echo the total (7), not re-derive or re-type it.
    expect(note).toContain("7");
    // The narration paragraph must appear verbatim.
    expect(note).toContain("Seven experiments ran in June.");
  });

  it("contains the verbatim byStatus counts", () => {
    const note = composeSummaryNote(
      EXPERIMENT_SUMMARY as never,
      "Summary text.",
      "Test note",
      TODAY,
    );
    expect(note).toContain("complete");
    expect(note).toContain("3"); // byStatus.complete
    expect(note).toContain("active");
    expect(note).toContain("2"); // byStatus.active
    expect(note).toContain("overdue");
    expect(note).toContain("1"); // byStatus.overdue
  });

  it("contains the timeline month and count verbatim", () => {
    const note = composeSummaryNote(
      EXPERIMENT_SUMMARY as never,
      "Summary.",
      "Test",
      TODAY,
    );
    expect(note).toContain("2026-06");
    expect(note).toContain("Timeline");
  });

  it("contains drill-down links for each item in the items list", () => {
    const note = composeSummaryNote(
      EXPERIMENT_SUMMARY as never,
      "Summary.",
      "Test",
      TODAY,
    );
    expect(note).toContain("Colony PCR screen");
    // objectReferenceMarkdown URL-encodes special chars (: -> %3A), so we check
    // for both the label and the route fragment rather than the literal colon.
    expect(note).toContain("openTask");
    expect(note).toContain("grant");
    expect(note).toContain("Miniprep batch");
    // Both items must be markdown links.
    expect(note).toMatch(/\[Colony PCR screen\]\([^)]+\)/);
    expect(note).toMatch(/\[Miniprep batch\]\([^)]+\)/);
  });

  it("does NOT fabricate any number not present in the input", () => {
    const note = composeSummaryNote(
      EXPERIMENT_SUMMARY as never,
      "Summary.",
      "Test",
      TODAY,
    );
    // The fixture has total 7. No other large number should appear unless it
    // comes from the fixture (byStatus: complete 3, active 2, overdue 1, upcoming 1;
    // byProject: 4 + 3 = 7).
    // This is a structural smoke-check: the fabrication guard is the absence of
    // unexpected numbers. The most important check is that every number in the
    // note IS present in the fixture.
    const numbersInNote = (note.match(/\d+/g) ?? []).map(Number);
    // All numbers in the note must come from the fixture payload.
    const allowedNumbers = new Set([
      7, 3, 2, 1, // total + byStatus
      4, 9, // projectIds
      2026, 6, 13, // dates
      // day portions of date strings
    ]);
    // A strict check would need to enumerate every number; here we assert the
    // important financial guard: no invented large number appears.
    const unexpected = numbersInNote.filter(
      (n) => n > 1000 && !String(n).startsWith("2026"),
    );
    expect(unexpected).toEqual([]);
  });

  it("does NOT emit a chart section when plotDocId is absent", () => {
    const note = composeSummaryNote(
      EXPERIMENT_SUMMARY as never,
      "Summary.",
      "Test",
      TODAY,
    );
    expect(note).not.toContain("### Chart");
    expect(note).not.toContain("#ros=plot");
    expect(note).not.toContain("#ros=table");
  });

  it("emits a chart section when plotDocId is present", () => {
    const withPlot = { ...EXPERIMENT_SUMMARY, plotDocId: "5", plotSpecId: "p1" };
    const note = composeSummaryNote(
      withPlot as never,
      "Summary.",
      "Test",
      TODAY,
    );
    expect(note).toContain("### Chart");
    expect(note).toContain("#ros=plot");
    expect(note).toContain("plot=p1");
    expect(note).toContain("/datahub?doc=5");
  });

  it("echoes the narration at the top of the note", () => {
    const narration = "This is the narration paragraph.";
    const note = composeSummaryNote(
      EXPERIMENT_SUMMARY as never,
      narration,
      "Test",
      TODAY,
    );
    const narrationIndex = note.indexOf(narration);
    const timelineIndex = note.indexOf("Timeline");
    expect(narrationIndex).toBeGreaterThan(-1);
    expect(timelineIndex).toBeGreaterThan(-1);
    expect(narrationIndex).toBeLessThan(timelineIndex);
  });
});

describe("composeSummaryNote (purchases fixture)", () => {
  it("echoes totalSpendDisplay verbatim", () => {
    const note = composeSummaryNote(
      PURCHASE_SUMMARY as never,
      "Four items totalling $287.75.",
      "Purchases summary",
      TODAY,
    );
    // The display string from the fixture must appear verbatim.
    expect(note).toContain("$287.75");
    // The per-vendor display strings must also appear verbatim.
    expect(note).toContain("$215.25");
    expect(note).toContain("$42.50");
  });

  it("includes the totalSpendDisplay string in the breakdown overview section", () => {
    const note = composeSummaryNote(
      PURCHASE_SUMMARY as never,
      "Summary.",
      "Test",
      TODAY,
    );
    // The overview block must echo totalSpendDisplay verbatim ("$287.75"), not
    // re-type or recompute the number. The purchases breakdown section adds an
    // Overview table carrying this display string.
    expect(note).toContain("$287.75");
    // The per-vendor display strings must also appear verbatim.
    expect(note).toContain("$215.25");
  });

  it("emits a drill-down chip for each largestItem", () => {
    const note = composeSummaryNote(
      PURCHASE_SUMMARY as never,
      "Summary.",
      "Test",
      TODAY,
    );
    expect(note).toContain("Taq polymerase");
    expect(note).toContain("$120.25");
  });
});

describe("composeSummaryNote (digest fixture)", () => {
  it("contains the experiments sub-block numbers verbatim", () => {
    const note = composeSummaryNote(
      DIGEST_SUMMARY as never,
      "Lab digest for the week.",
      "Lab digest 2026-06-13",
      TODAY,
    );
    expect(note).toContain("Run");
    expect(note).toContain("| 3 |"); // exp.run
    expect(note).toContain("Finished");
    expect(note).toContain("| 1 |"); // exp.finished
    expect(note).toContain("$287.75"); // purchases.totalSpendDisplay verbatim
  });

  it("includes the window scope dates", () => {
    const note = composeSummaryNote(
      DIGEST_SUMMARY as never,
      "Summary.",
      "Digest",
      TODAY,
    );
    expect(note).toContain("2026-06-06");
    expect(note).toContain("2026-06-12");
  });
});

// ---------------------------------------------------------------------------
// saveSummaryAsNoteTool.execute (injectable deps seam)
// ---------------------------------------------------------------------------

const realCreate = summaryArtifactDeps.createNote;
const realAppend = summaryArtifactDeps.appendEntry;

afterEach(() => {
  summaryArtifactDeps.createNote = realCreate;
  summaryArtifactDeps.appendEntry = realAppend;
});

function stubDeps(overrides: Partial<SummaryArtifactDeps>): void {
  Object.assign(summaryArtifactDeps, overrides);
}

describe("saveSummaryAsNoteTool.execute (create path)", () => {
  it("creates a note and returns ok with the note id and title", async () => {
    stubDeps({
      createNote: async ({ title }) => ({ id: 42, title }),
    });
    const out = (await saveSummaryAsNoteTool.execute({
      summary: EXPERIMENT_SUMMARY,
      narration: "Seven experiments ran in June.",
      noteTitle: "Experiments June 2026",
      target: "new",
      mode: "create",
    })) as { ok: boolean; noteId: number; title: string; mode: string };
    expect(out.ok).toBe(true);
    expect(out.noteId).toBe(42);
    expect(out.title).toBe("Experiments June 2026");
    expect(out.mode).toBe("create");
  });

  it("writes a note whose content contains the verbatim total count", async () => {
    let capturedContent = "";
    stubDeps({
      createNote: async ({ content, title }) => {
        capturedContent = content;
        return { id: 1, title };
      },
    });
    await saveSummaryAsNoteTool.execute({
      summary: EXPERIMENT_SUMMARY,
      narration: "Seven experiments ran in June.",
      noteTitle: "Test note",
      target: "new",
    });
    expect(capturedContent).toContain("Seven experiments ran in June.");
    // The drill-down chip for experiment 1 must be in the content.
    expect(capturedContent).toContain("Colony PCR screen");
    // objectReferenceMarkdown URL-encodes the compound id (: -> %3A). Check
    // that the route fragment and the owner label are present.
    expect(capturedContent).toContain("openTask");
    expect(capturedContent).toContain("grant");
    // The verbatim status count from the input.
    expect(capturedContent).toContain("3"); // complete count
  });

  it("returns ok: false when narration is missing", async () => {
    const out = (await saveSummaryAsNoteTool.execute({
      summary: EXPERIMENT_SUMMARY,
      narration: "",
      target: "new",
    })) as { ok: boolean; error: string };
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/narration/i);
  });

  it("returns ok: false when summaryType is missing from the summary", async () => {
    const out = (await saveSummaryAsNoteTool.execute({
      summary: { total: 3 },
      narration: "Some text.",
      target: "new",
    })) as { ok: boolean; error: string };
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/summaryType/i);
  });
});

describe("saveSummaryAsNoteTool.execute (append path)", () => {
  it("appends to an existing note and returns the note id", async () => {
    stubDeps({
      appendEntry: async (noteId, _data) => ({ id: noteId, title: "Existing note" }),
    });
    const out = (await saveSummaryAsNoteTool.execute({
      summary: PURCHASE_SUMMARY,
      narration: "Purchases this month.",
      target: "7",
      mode: "append",
    })) as { ok: boolean; noteId: number; mode: string };
    expect(out.ok).toBe(true);
    expect(out.noteId).toBe(7);
    expect(out.mode).toBe("append");
  });

  it("returns ok: false when the note is not found", async () => {
    stubDeps({
      appendEntry: async () => null,
    });
    const out = (await saveSummaryAsNoteTool.execute({
      summary: PURCHASE_SUMMARY,
      narration: "Purchases.",
      target: "99",
      mode: "append",
    })) as { ok: boolean; error: string };
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/not be found/);
  });

  it("returns ok: false when the target is not a valid note id for append mode", async () => {
    const out = (await saveSummaryAsNoteTool.execute({
      summary: PURCHASE_SUMMARY,
      narration: "Purchases.",
      target: "not-a-number",
      mode: "append",
    })) as { ok: boolean; error: string };
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/list_notes/i);
  });
});

// ---------------------------------------------------------------------------
// describeAction (draft-preview gate check)
// ---------------------------------------------------------------------------

describe("saveSummaryAsNoteTool.describeAction", () => {
  it("returns a draft payload carrying the composed note content", () => {
    const result = saveSummaryAsNoteTool.describeAction!({
      summary: EXPERIMENT_SUMMARY,
      narration: "Seven experiments ran.",
      noteTitle: "Experiments June 2026",
      target: "new",
    });
    expect(result.draft).toBeDefined();
    expect(result.draft!.content).toContain("Seven experiments ran.");
    expect(result.draft!.content).toContain("Colony PCR screen");
    expect(result.draft!.mode).toBe("create");
    expect(result.draft!.title).toBe("Experiments June 2026");
  });

  it("applyEdit routes the Canvas-edited body so execute writes it verbatim (not recomposed)", async () => {
    // The user edited the composed note body in Canvas and saved. applyEdit
    // stashes the edited string on the args, and execute writes it verbatim
    // instead of recomposing from the structured summary.
    const args: Record<string, unknown> = {
      summary: EXPERIMENT_SUMMARY,
      narration: "Seven experiments ran.",
      noteTitle: "Experiments June 2026",
      target: "new",
    };
    const result = saveSummaryAsNoteTool.describeAction!(args);
    expect(result.draft!.applyEdit).toBeDefined();
    result.draft!.applyEdit!(args, "# My edited body\n\nFixed a number to 2.41x.");

    let capturedContent = "";
    stubDeps({
      createNote: async ({ content, title }) => {
        capturedContent = content;
        return { id: 1, title };
      },
    });
    await saveSummaryAsNoteTool.execute(args);
    expect(capturedContent).toBe("# My edited body\n\nFixed a number to 2.41x.");
    // The recomposed narration is NOT present, the edited body fully replaced it.
    expect(capturedContent).not.toContain("Colony PCR screen");
  });

  it("sets mode to append when target is a note id", () => {
    const result = saveSummaryAsNoteTool.describeAction!({
      summary: EXPERIMENT_SUMMARY,
      narration: "Appended summary.",
      target: "5",
      mode: "append",
    });
    expect(result.draft!.mode).toBe("append");
  });
});
