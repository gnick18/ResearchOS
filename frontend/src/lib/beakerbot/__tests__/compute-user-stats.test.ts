// frontend/src/lib/beakerbot/__tests__/compute-user-stats.test.ts
//
// Unit tests for computeUserStats. All data sources are mocked via
// vi.mock("@/lib/local-api") so no real FSA / file-system code runs.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock declarations (hoisted before imports) ────────────────────────────────

const mockListAllForUser = vi.fn();
const mockProjectsList = vi.fn();
const mockNotesList = vi.fn();

vi.mock("@/lib/local-api", () => ({
  tasksApi: { listAllForUser: (...a: unknown[]) => mockListAllForUser(...a) },
  projectsApi: { list: (...a: unknown[]) => mockProjectsList(...a) },
  notesApi: { list: (...a: unknown[]) => mockNotesList(...a) },
}));

import { computeUserStats } from "../compute-user-stats";

// ── Fixtures ─────────────────────────────────────────────────────────────────

/** A fixed "now" in ms. Corresponds to 2024-06-10T00:00:00.000Z. */
const NOW = 1_718_006_400_000;

/** ISO string 10 days before NOW. */
const DATE_10D_AGO = new Date(NOW - 10 * 86_400_000).toISOString();
/** ISO string 5 days before NOW (within 7-day window). */
const DATE_5D_AGO = new Date(NOW - 5 * 86_400_000).toISOString();
/** ISO string 2 days before NOW (within 7-day window + current month). */
const DATE_2D_AGO = new Date(NOW - 2 * 86_400_000).toISOString();
/** ISO date string 200 days before NOW (outside 6-month window). */
const DATE_200D_AGO = new Date(NOW - 200 * 86_400_000).toISOString().slice(0, 10);
/** ISO date string 30 days before NOW (within 6-month window). */
const DATE_30D_AGO = new Date(NOW - 30 * 86_400_000).toISOString().slice(0, 10);
/** ISO datetime 30 days before NOW (for future-date exclusion test). */
const DATE_30D_FUTURE = new Date(NOW + 30 * 86_400_000).toISOString().slice(0, 10);

/** Helper to make a minimal task record. */
function makeTask(overrides: {
  task_type: "experiment" | "purchase" | "list";
  start_date: string;
}) {
  return { id: Math.random(), task_type: overrides.task_type, start_date: overrides.start_date };
}

/** Helper to make a minimal note record. */
function makeNote(overrides: {
  entries?: Array<{ content: string; updated_at: string; created_at?: string }>;
  note_kind?: "meeting" | "note";
  created_at?: string | null;
  one_on_one_id?: string;
}) {
  return {
    id: Math.random(),
    title: "Test note",
    entries: (overrides.entries ?? []).map((e) => ({
      id: "e1",
      title: "",
      date: "",
      content: e.content,
      // When an explicit created_at is provided for the entry, use it;
      // otherwise mirror updated_at (the common case in production).
      created_at: e.created_at ?? e.updated_at,
      updated_at: e.updated_at,
    })),
    note_kind: overrides.note_kind ?? undefined,
    created_at: overrides.created_at ?? undefined,
    one_on_one_id: overrides.one_on_one_id ?? undefined,
  };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockListAllForUser.mockResolvedValue([]);
  mockProjectsList.mockResolvedValue([]);
  mockNotesList.mockResolvedValue([]);
});

// ── Experiment counting ───────────────────────────────────────────────────────

describe("experiments field", () => {
  it("counts tasks with task_type experiment", async () => {
    mockListAllForUser.mockResolvedValue([
      makeTask({ task_type: "experiment", start_date: DATE_30D_AGO }),
      makeTask({ task_type: "experiment", start_date: DATE_30D_AGO }),
      makeTask({ task_type: "list", start_date: DATE_30D_AGO }),
      makeTask({ task_type: "purchase", start_date: DATE_30D_AGO }),
    ]);
    const result = await computeUserStats("alice", NOW);
    expect(result.experiments).toBe(2);
  });

  it("omits experiments when count is zero", async () => {
    mockListAllForUser.mockResolvedValue([
      makeTask({ task_type: "list", start_date: DATE_30D_AGO }),
    ]);
    const result = await computeUserStats("alice", NOW);
    expect(result.experiments).toBeUndefined();
  });

  it("passes the user argument to tasksApi.listAllForUser", async () => {
    await computeUserStats("bob", NOW);
    expect(mockListAllForUser).toHaveBeenCalledWith("bob");
  });
});

// ── experimentsLast6Months boundary ──────────────────────────────────────────

describe("experimentsLast6Months field", () => {
  it("counts experiments whose start_date is within 180 days of now", async () => {
    mockListAllForUser.mockResolvedValue([
      makeTask({ task_type: "experiment", start_date: DATE_30D_AGO }),  // within
      makeTask({ task_type: "experiment", start_date: DATE_200D_AGO }), // outside
    ]);
    const result = await computeUserStats("alice", NOW);
    expect(result.experimentsLast6Months).toBe(1);
  });

  it("omits experimentsLast6Months when zero are in the 6-month window", async () => {
    mockListAllForUser.mockResolvedValue([
      makeTask({ task_type: "experiment", start_date: DATE_200D_AGO }),
    ]);
    const result = await computeUserStats("alice", NOW);
    expect(result.experimentsLast6Months).toBeUndefined();
  });

  it("includes an experiment whose start_date is 179 days ago (well within boundary)", async () => {
    // YYYY-MM-DD dates parse as midnight UTC; use a date comfortably inside
    // the 180-day window to avoid sub-day edge cases.
    const nearBoundary = new Date(NOW - 179 * 86_400_000).toISOString().slice(0, 10);
    mockListAllForUser.mockResolvedValue([
      makeTask({ task_type: "experiment", start_date: nearBoundary }),
    ]);
    const result = await computeUserStats("alice", NOW);
    expect(result.experimentsLast6Months).toBe(1);
  });

  it("excludes an experiment whose start_date is 181 days ago (past the 6-month boundary)", async () => {
    const outside = new Date(NOW - 181 * 86_400_000).toISOString().slice(0, 10);
    mockListAllForUser.mockResolvedValue([
      makeTask({ task_type: "experiment", start_date: outside }),
    ]);
    const result = await computeUserStats("alice", NOW);
    expect(result.experimentsLast6Months).toBeUndefined();
  });

  it("excludes a future-dated experiment (past-only window)", async () => {
    // start_date 30 days in the future must not be counted even though it is
    // within 180 days of now. withinWindow enforces ms <= now.
    mockListAllForUser.mockResolvedValue([
      makeTask({ task_type: "experiment", start_date: DATE_30D_FUTURE }),
    ]);
    const result = await computeUserStats("alice", NOW);
    expect(result.experimentsLast6Months).toBeUndefined();
  });

  it("counts a past experiment but not a future-dated one in the same list", async () => {
    mockListAllForUser.mockResolvedValue([
      makeTask({ task_type: "experiment", start_date: DATE_30D_AGO }),
      makeTask({ task_type: "experiment", start_date: DATE_30D_FUTURE }),
    ]);
    const result = await computeUserStats("alice", NOW);
    expect(result.experimentsLast6Months).toBe(1);
  });
});

// ── Projects ──────────────────────────────────────────────────────────────────

describe("projects field", () => {
  it("counts the total number of projects", async () => {
    mockProjectsList.mockResolvedValue([{ id: 1 }, { id: 2 }, { id: 3 }]);
    const result = await computeUserStats("alice", NOW);
    expect(result.projects).toBe(3);
  });

  it("omits projects when count is zero", async () => {
    mockProjectsList.mockResolvedValue([]);
    const result = await computeUserStats("alice", NOW);
    expect(result.projects).toBeUndefined();
  });
});

// ── Notes ─────────────────────────────────────────────────────────────────────

describe("notes field", () => {
  it("counts the total number of notes", async () => {
    mockNotesList.mockResolvedValue([makeNote({}), makeNote({}), makeNote({})]);
    const result = await computeUserStats("alice", NOW);
    expect(result.notes).toBe(3);
  });

  it("omits notes when count is zero", async () => {
    mockNotesList.mockResolvedValue([]);
    const result = await computeUserStats("alice", NOW);
    expect(result.notes).toBeUndefined();
  });
});

// ── wordsLastWeek ─────────────────────────────────────────────────────────────

describe("wordsLastWeek field", () => {
  it("sums words from entries updated within 7 days", async () => {
    mockNotesList.mockResolvedValue([
      makeNote({
        entries: [
          { content: "hello world foo", updated_at: DATE_5D_AGO }, // 3 words, within window
          { content: "one two three four five", updated_at: DATE_2D_AGO }, // 5 words, within window
        ],
      }),
    ]);
    const result = await computeUserStats("alice", NOW);
    expect(result.wordsLastWeek).toBe(8);
  });

  it("excludes entries whose updated_at is older than 7 days", async () => {
    mockNotesList.mockResolvedValue([
      makeNote({
        entries: [
          { content: "old entry words here", updated_at: DATE_10D_AGO }, // outside 7d window
        ],
      }),
    ]);
    const result = await computeUserStats("alice", NOW);
    expect(result.wordsLastWeek).toBeUndefined();
  });

  it("omits wordsLastWeek when all entries are outside the 7-day window", async () => {
    mockNotesList.mockResolvedValue([
      makeNote({
        entries: [
          { content: "ancient text from long ago", updated_at: DATE_10D_AGO },
        ],
      }),
    ]);
    const result = await computeUserStats("alice", NOW);
    expect(result.wordsLastWeek).toBeUndefined();
  });

  it("omits wordsLastWeek when notes have no entries", async () => {
    mockNotesList.mockResolvedValue([makeNote({ entries: [] })]);
    const result = await computeUserStats("alice", NOW);
    expect(result.wordsLastWeek).toBeUndefined();
  });

  it("handles empty content strings without throwing", async () => {
    mockNotesList.mockResolvedValue([
      makeNote({
        entries: [{ content: "", updated_at: DATE_2D_AGO }],
      }),
    ]);
    const result = await computeUserStats("alice", NOW);
    expect(result.wordsLastWeek).toBeUndefined();
  });
});

// ── checkinsThisMonth ─────────────────────────────────────────────────────────

describe("checkinsThisMonth field", () => {
  it("counts notes with note_kind meeting created this calendar month", async () => {
    // DATE_2D_AGO is within the current month (NOW = 2024-06-10).
    mockNotesList.mockResolvedValue([
      makeNote({ note_kind: "meeting", created_at: DATE_2D_AGO }),
      makeNote({ note_kind: "meeting", created_at: DATE_2D_AGO }),
      makeNote({ note_kind: "note", created_at: DATE_2D_AGO }), // wrong kind
    ]);
    const result = await computeUserStats("alice", NOW);
    expect(result.checkinsThisMonth).toBe(2);
  });

  it("excludes meeting notes from a prior month", async () => {
    // DATE_10D_AGO for NOW=2024-06-10 is 2024-05-31, which is a different month.
    const priorMonthNote = makeNote({
      note_kind: "meeting",
      created_at: new Date(NOW - 15 * 86_400_000).toISOString(), // 2024-05-26
    });
    mockNotesList.mockResolvedValue([priorMonthNote]);
    const result = await computeUserStats("alice", NOW);
    expect(result.checkinsThisMonth).toBeUndefined();
  });

  it("omits checkinsThisMonth when no meeting notes exist this month", async () => {
    mockNotesList.mockResolvedValue([
      makeNote({ note_kind: "note", created_at: DATE_2D_AGO }),
    ]);
    const result = await computeUserStats("alice", NOW);
    expect(result.checkinsThisMonth).toBeUndefined();
  });

  it("ignores notes without note_kind set", async () => {
    mockNotesList.mockResolvedValue([
      makeNote({ created_at: DATE_2D_AGO }), // note_kind is undefined
    ]);
    const result = await computeUserStats("alice", NOW);
    expect(result.checkinsThisMonth).toBeUndefined();
  });

  // ── created_at fallback via entry timestamps ──────────────────────────────

  it("counts a meeting note with no created_at when its entry.created_at is in the current month", async () => {
    // Simulates an older meeting note (pre-2026-05-24) that never had
    // created_at written. The entry's created_at provides the fallback date.
    mockNotesList.mockResolvedValue([
      makeNote({
        note_kind: "meeting",
        created_at: null, // absent on older notes
        entries: [{ content: "discussed aims", updated_at: DATE_2D_AGO, created_at: DATE_2D_AGO }],
      }),
    ]);
    const result = await computeUserStats("alice", NOW);
    expect(result.checkinsThisMonth).toBe(1);
  });

  it("counts a meeting note with no created_at when its entry.updated_at is in the current month", async () => {
    // Falls back to updated_at when created_at is also absent from the entry.
    mockNotesList.mockResolvedValue([
      makeNote({
        note_kind: "meeting",
        created_at: undefined,
        entries: [{ content: "q3 planning", updated_at: DATE_2D_AGO }],
      }),
    ]);
    const result = await computeUserStats("alice", NOW);
    expect(result.checkinsThisMonth).toBe(1);
  });

  it("uses the earliest entry timestamp when multiple entries are present", async () => {
    // The earliest entry is in a prior month; the note must not be counted.
    // NOW = 2024-06-10. DATE_10D_AGO = 2024-05-31 (prior month).
    const priorMonthEntryDate = new Date(NOW - 15 * 86_400_000).toISOString(); // 2024-05-26
    mockNotesList.mockResolvedValue([
      makeNote({
        note_kind: "meeting",
        created_at: null,
        entries: [
          { content: "older entry", updated_at: priorMonthEntryDate },
          { content: "newer entry", updated_at: DATE_2D_AGO },
        ],
      }),
    ]);
    const result = await computeUserStats("alice", NOW);
    // Earliest entry is prior month so the note is excluded.
    expect(result.checkinsThisMonth).toBeUndefined();
  });

  it("skips a meeting note when no created_at and no entries provide a date", async () => {
    mockNotesList.mockResolvedValue([
      makeNote({
        note_kind: "meeting",
        created_at: null,
        entries: [], // no entries to fall back to
      }),
    ]);
    const result = await computeUserStats("alice", NOW);
    expect(result.checkinsThisMonth).toBeUndefined();
  });

  it("prefers note.created_at over entry timestamps when both are present", async () => {
    // note.created_at is in the current month; entry timestamp is prior month.
    // The note's own created_at should win and the note should be counted.
    const priorMonthEntryDate = new Date(NOW - 15 * 86_400_000).toISOString();
    mockNotesList.mockResolvedValue([
      makeNote({
        note_kind: "meeting",
        created_at: DATE_2D_AGO,
        entries: [{ content: "note", updated_at: priorMonthEntryDate }],
      }),
    ]);
    const result = await computeUserStats("alice", NOW);
    expect(result.checkinsThisMonth).toBe(1);
  });
});

// ── Error isolation ───────────────────────────────────────────────────────────

describe("error isolation", () => {
  it("omits experiment fields when tasksApi throws but still returns other fields", async () => {
    mockListAllForUser.mockRejectedValue(new Error("FSA not ready"));
    mockProjectsList.mockResolvedValue([{ id: 1 }]);
    mockNotesList.mockResolvedValue([makeNote({ entries: [{ content: "hi", updated_at: DATE_2D_AGO }] })]);

    const result = await computeUserStats("alice", NOW);
    expect(result.experiments).toBeUndefined();
    expect(result.experimentsLast6Months).toBeUndefined();
    expect(result.projects).toBe(1);
    expect(result.notes).toBe(1);
    expect(result.wordsLastWeek).toBe(1);
  });

  it("omits projects when projectsApi throws but still returns other fields", async () => {
    mockListAllForUser.mockResolvedValue([
      makeTask({ task_type: "experiment", start_date: DATE_30D_AGO }),
    ]);
    mockProjectsList.mockRejectedValue(new Error("disk error"));
    mockNotesList.mockResolvedValue([]);

    const result = await computeUserStats("alice", NOW);
    expect(result.experiments).toBe(1);
    expect(result.projects).toBeUndefined();
  });

  it("omits notes/words/checkins when notesApi throws but still returns other fields", async () => {
    mockListAllForUser.mockResolvedValue([
      makeTask({ task_type: "experiment", start_date: DATE_30D_AGO }),
    ]);
    mockProjectsList.mockResolvedValue([{ id: 1 }]);
    mockNotesList.mockRejectedValue(new Error("parse error"));

    const result = await computeUserStats("alice", NOW);
    expect(result.experiments).toBe(1);
    expect(result.projects).toBe(1);
    expect(result.notes).toBeUndefined();
    expect(result.wordsLastWeek).toBeUndefined();
    expect(result.checkinsThisMonth).toBeUndefined();
  });

  it("never rejects even when all data sources throw", async () => {
    mockListAllForUser.mockRejectedValue(new Error("x"));
    mockProjectsList.mockRejectedValue(new Error("y"));
    mockNotesList.mockRejectedValue(new Error("z"));

    await expect(computeUserStats("alice", NOW)).resolves.toEqual({});
  });
});

// ── Zero-count omission ───────────────────────────────────────────────────────

describe("zero counts are omitted", () => {
  it("returns an empty object when all stores return empty arrays", async () => {
    const result = await computeUserStats("alice", NOW);
    expect(result).toEqual({});
  });
});

// ── Caller does not own updatedAt/streakDays/lastActivityAt ──────────────────

describe("fields that are the caller's responsibility", () => {
  it("never sets updatedAt", async () => {
    const result = await computeUserStats("alice", NOW);
    expect(result).not.toHaveProperty("updatedAt");
  });

  it("never sets streakDays", async () => {
    const result = await computeUserStats("alice", NOW);
    expect(result).not.toHaveProperty("streakDays");
  });

  it("never sets lastActivityAt", async () => {
    const result = await computeUserStats("alice", NOW);
    expect(result).not.toHaveProperty("lastActivityAt");
  });
});
