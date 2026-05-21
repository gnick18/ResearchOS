// frontend/src/lib/streak/__tests__/calendar-pto-sync.test.ts
//
// Unit tests for Phase S5 calendar PTO sync helper. Covers the
// one-way sync contract from STREAK_AND_MILESTONES_PROPOSAL.md §6.5:
//
//  - check + save adds the event's date(s) to pto_dates
//  - uncheck + save removes the previously-PTO event's date(s)
//  - multi-day event expansion (add + remove all dates in range)
//  - one-way: removing a date from pto_dates externally doesn't
//    touch the event (verified by the helper only ever calling
//    patchStreak, never eventsApi)
//  - errors swallowed at boundary (patchStreak failure doesn't throw)
//
// The fileService is mocked with an in-memory Map (same pattern as
// streak-sidecar.test.ts) so patchStreak round-trips touch our
// scratch state, not OPFS.

import { describe, expect, it, vi, beforeEach } from "vitest";

const memFs = new Map<string, unknown>();

vi.mock("@/lib/file-system/file-service", () => ({
  fileService: {
    readJson: vi.fn(async (path: string) => {
      const v = memFs.get(path);
      return v === undefined ? null : v;
    }),
    writeJson: vi.fn(async (path: string, data: unknown) => {
      memFs.set(path, data);
    }),
    isConnected: vi.fn(() => true),
  },
}));

vi.mock("@/lib/file-system/user-metadata", () => ({
  getUserMetadata: vi.fn(async () => null),
}));

import {
  INITIAL_STREAK,
  readStreak,
  patchStreak,
  __resetStreakWriteQueueForTests,
  type StreakSidecar,
} from "../streak-sidecar";
import {
  addDatesToPto,
  expandDateRange,
  removeDatesFromPto,
  syncEventPtoChange,
} from "../calendar-pto-sync";

const USER = "alex";
const PATH = `users/${USER}/_streak.json`;

beforeEach(() => {
  memFs.clear();
  __resetStreakWriteQueueForTests();
});

describe("expandDateRange", () => {
  it("returns a single-day array for a same-start-end event", () => {
    expect(expandDateRange("2026-06-15", "2026-06-15")).toEqual(["2026-06-15"]);
  });

  it("returns a single-day array when end_date is null (all-day same day)", () => {
    expect(expandDateRange("2026-06-15", null)).toEqual(["2026-06-15"]);
    expect(expandDateRange("2026-06-15", undefined)).toEqual(["2026-06-15"]);
  });

  it("expands a 3-day inclusive range", () => {
    expect(expandDateRange("2026-06-15", "2026-06-17")).toEqual([
      "2026-06-15",
      "2026-06-16",
      "2026-06-17",
    ]);
  });

  it("expands across a month boundary", () => {
    expect(expandDateRange("2026-05-30", "2026-06-02")).toEqual([
      "2026-05-30",
      "2026-05-31",
      "2026-06-01",
      "2026-06-02",
    ]);
  });

  it("returns just the start when end is before start (malformed)", () => {
    expect(expandDateRange("2026-06-15", "2026-06-10")).toEqual(["2026-06-15"]);
  });

  it("returns empty for malformed start", () => {
    expect(expandDateRange("nope", "2026-06-15")).toEqual([]);
  });

  it("caps the expansion at 366 days as a defensive bound", () => {
    // A 5-year range (should cap, not loop forever).
    const out = expandDateRange("2026-01-01", "2030-12-31");
    expect(out.length).toBeLessThanOrEqual(367);
    expect(out[0]).toBe("2026-01-01");
  });
});

describe("addDatesToPto / removeDatesFromPto", () => {
  it("addDatesToPto dedupes and sorts", () => {
    expect(addDatesToPto(["2026-06-15"], ["2026-06-14", "2026-06-15"])).toEqual(
      ["2026-06-14", "2026-06-15"],
    );
  });

  it("addDatesToPto drops empty / non-string entries", () => {
    expect(
      addDatesToPto(["2026-06-15"], ["", "2026-06-16"]),
    ).toEqual(["2026-06-15", "2026-06-16"]);
  });

  it("removeDatesFromPto removes only the requested entries", () => {
    expect(
      removeDatesFromPto(
        ["2026-06-14", "2026-06-15", "2026-06-16"],
        ["2026-06-15"],
      ),
    ).toEqual(["2026-06-14", "2026-06-16"]);
  });

  it("removeDatesFromPto is a no-op when the date isn't there", () => {
    expect(
      removeDatesFromPto(["2026-06-14"], ["2026-06-15"]),
    ).toEqual(["2026-06-14"]);
  });
});

describe("syncEventPtoChange, single-day events", () => {
  it("create + checked: adds the event date to pto_dates", async () => {
    await syncEventPtoChange(USER, null, {
      isPto: true,
      dates: ["2026-06-15"],
    });
    const sc = await readStreak(USER);
    expect(sc.pto_dates).toEqual(["2026-06-15"]);
  });

  it("create + unchecked: no-op (no write)", async () => {
    await syncEventPtoChange(USER, null, {
      isPto: false,
      dates: ["2026-06-15"],
    });
    expect(memFs.has(PATH)).toBe(false);
  });

  it("edit: previously checked, now unchecked removes the date", async () => {
    // Seed: the date is already in pto_dates (event was PTO before).
    const seeded: StreakSidecar = {
      ...INITIAL_STREAK,
      pto_dates: ["2026-06-15"],
    };
    memFs.set(PATH, seeded);

    await syncEventPtoChange(
      USER,
      { isPto: true, dates: ["2026-06-15"] },
      { isPto: false, dates: ["2026-06-15"] },
    );
    const sc = await readStreak(USER);
    expect(sc.pto_dates).toEqual([]);
  });

  it("edit: still checked, no change is a no-op", async () => {
    const seeded: StreakSidecar = {
      ...INITIAL_STREAK,
      pto_dates: ["2026-06-15"],
    };
    memFs.set(PATH, seeded);

    await syncEventPtoChange(
      USER,
      { isPto: true, dates: ["2026-06-15"] },
      { isPto: true, dates: ["2026-06-15"] },
    );
    // Date stayed in place.
    const sc = await readStreak(USER);
    expect(sc.pto_dates).toEqual(["2026-06-15"]);
  });

  it("edit: still checked, date moved (remove old + add new)", async () => {
    const seeded: StreakSidecar = {
      ...INITIAL_STREAK,
      pto_dates: ["2026-06-15"],
    };
    memFs.set(PATH, seeded);

    await syncEventPtoChange(
      USER,
      { isPto: true, dates: ["2026-06-15"] },
      { isPto: true, dates: ["2026-06-20"] },
    );
    const sc = await readStreak(USER);
    expect(sc.pto_dates).toEqual(["2026-06-20"]);
  });

  it("delete (next=null): removes the previously-PTO date", async () => {
    const seeded: StreakSidecar = {
      ...INITIAL_STREAK,
      pto_dates: ["2026-06-15", "2026-06-20"],
    };
    memFs.set(PATH, seeded);

    await syncEventPtoChange(
      USER,
      { isPto: true, dates: ["2026-06-15"] },
      null,
    );
    const sc = await readStreak(USER);
    expect(sc.pto_dates).toEqual(["2026-06-20"]);
  });

  it("delete of an unchecked event: no-op", async () => {
    const seeded: StreakSidecar = {
      ...INITIAL_STREAK,
      pto_dates: ["2026-06-15"],
    };
    memFs.set(PATH, seeded);

    await syncEventPtoChange(
      USER,
      { isPto: false, dates: ["2026-06-15"] },
      null,
    );
    const sc = await readStreak(USER);
    // Untouched.
    expect(sc.pto_dates).toEqual(["2026-06-15"]);
  });
});

describe("syncEventPtoChange, multi-day events", () => {
  it("create + checked: adds every date in the inclusive range", async () => {
    await syncEventPtoChange(USER, null, {
      isPto: true,
      dates: ["2026-06-15", "2026-06-16", "2026-06-17"],
    });
    const sc = await readStreak(USER);
    expect(sc.pto_dates).toEqual(["2026-06-15", "2026-06-16", "2026-06-17"]);
  });

  it("delete of multi-day PTO event: removes every date in the previous range", async () => {
    const seeded: StreakSidecar = {
      ...INITIAL_STREAK,
      pto_dates: ["2026-06-15", "2026-06-16", "2026-06-17", "2026-07-04"],
    };
    memFs.set(PATH, seeded);

    await syncEventPtoChange(
      USER,
      {
        isPto: true,
        dates: ["2026-06-15", "2026-06-16", "2026-06-17"],
      },
      null,
    );
    const sc = await readStreak(USER);
    // The unrelated 4 July date kept; the 3-day range removed.
    expect(sc.pto_dates).toEqual(["2026-07-04"]);
  });

  it("edit shrinks the range: removes the dropped tail day", async () => {
    const seeded: StreakSidecar = {
      ...INITIAL_STREAK,
      pto_dates: ["2026-06-15", "2026-06-16", "2026-06-17"],
    };
    memFs.set(PATH, seeded);

    await syncEventPtoChange(
      USER,
      {
        isPto: true,
        dates: ["2026-06-15", "2026-06-16", "2026-06-17"],
      },
      {
        isPto: true,
        dates: ["2026-06-15", "2026-06-16"],
      },
    );
    const sc = await readStreak(USER);
    expect(sc.pto_dates).toEqual(["2026-06-15", "2026-06-16"]);
  });

  it("does not touch unrelated pto_dates entries from Settings / Gantt", async () => {
    // Mixed seed: one date from the event, one from a manual Settings entry.
    const seeded: StreakSidecar = {
      ...INITIAL_STREAK,
      pto_dates: ["2026-06-15", "2026-12-25"],
    };
    memFs.set(PATH, seeded);

    // Uncheck the event for 6-15.
    await syncEventPtoChange(
      USER,
      { isPto: true, dates: ["2026-06-15"] },
      { isPto: false, dates: ["2026-06-15"] },
    );
    const sc = await readStreak(USER);
    // The Settings-added 12-25 entry must persist; only the event date drops.
    expect(sc.pto_dates).toEqual(["2026-12-25"]);
  });
});

describe("syncEventPtoChange, defensive", () => {
  it("ignores empty / placeholder usernames", async () => {
    await syncEventPtoChange("", null, { isPto: true, dates: ["2026-06-15"] });
    await syncEventPtoChange("_no_user_", null, {
      isPto: true,
      dates: ["2026-06-15"],
    });
    expect(memFs.has(PATH)).toBe(false);
  });

  it("swallows patchStreak failures (boundary discipline)", async () => {
    // Coerce writeJson to throw on this single call.
    const { fileService } = await import("@/lib/file-system/file-service");
    const writeJson = fileService.writeJson as unknown as ReturnType<typeof vi.fn>;
    writeJson.mockRejectedValueOnce(new Error("disk on fire"));

    // Should NOT throw (calendar save must not be blocked).
    await expect(
      syncEventPtoChange(USER, null, {
        isPto: true,
        dates: ["2026-06-15"],
      }),
    ).resolves.toBeUndefined();
  });
});

describe("one-way sync invariant", () => {
  it("calling patchStreak to remove a pto_dates entry does not write back to any event store", async () => {
    // The helper imports patchStreak but does NOT import or call
    // eventsApi. If the import set ever changes to introduce events
    // writes, this assertion will need to evolve, but today we just
    // verify a direct pto_dates mutation only touches _streak.json,
    // not any events/*.json path.
    memFs.set(PATH, {
      ...INITIAL_STREAK,
      pto_dates: ["2026-06-15"],
    });

    await patchStreak(USER, (cur) => ({
      ...cur,
      pto_dates: removeDatesFromPto(cur.pto_dates, ["2026-06-15"]),
    }));

    // Only _streak.json was touched. No events/*.json writes happened.
    const writtenPaths = Array.from(memFs.keys());
    expect(writtenPaths.filter((p) => p.startsWith(`users/${USER}/events/`)))
      .toEqual([]);
    expect(writtenPaths).toContain(PATH);
  });
});
