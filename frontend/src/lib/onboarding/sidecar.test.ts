// frontend/src/lib/onboarding/sidecar.test.ts
//
// Unit tests for the onboarding sidecar's v2 → v3 migration. Pinning
// the migration contract here means a future schema bump (v4+) that
// accidentally clobbers a user's v2 picks (mode / tips / tips_off /
// shown_count) trips a red test instead of silently wiping state.
//
// The orchestrator-side gating tests live in `orchestrator.test.ts`.
// This file is narrowly scoped to the read/write round-trip and the
// normalize() backfill defaults for the v3 fields.

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
  },
}));

import { readOnboarding, writeOnboarding } from "./sidecar";

const USER = "alex";
const PATH = `users/${USER}/_onboarding.json`;

beforeEach(() => {
  memFs.clear();
});

describe("sidecar v2 → v3 migration", () => {
  it("reads a v2-shaped sidecar cleanly and backfills v3 fields to null", async () => {
    // A real v2 record as it would have been written by the previous
    // build: mode set, tips populated, no v3 fields anywhere.
    memFs.set(PATH, {
      version: 2,
      first_seen_at: "2026-05-14T10:00:00.000Z",
      active_seconds: 1200,
      last_tip_at: 600,
      tips: {
        "home-welcome": {
          shown_at: "2026-05-14T10:05:00.000Z",
          dismissed_at: "2026-05-14T10:05:30.000Z",
          outcome: "got-it",
        },
      },
      tips_off: false,
      shown_count: 1,
      mode: "suggestions",
    });
    const sc = await readOnboarding(USER);
    // v2 fields preserved untouched.
    expect(sc.mode).toBe("suggestions");
    expect(sc.tips_off).toBe(false);
    expect(sc.shown_count).toBe(1);
    expect(sc.active_seconds).toBe(1200);
    expect(sc.last_tip_at).toBe(600);
    expect(sc.first_seen_at).toBe("2026-05-14T10:00:00.000Z");
    expect(sc.tips["home-welcome"].outcome).toBe("got-it");
    // v3 fields backfilled to null.
    expect(sc.use_cases).toBeNull();
    expect(sc.wizard_completed_at).toBeNull();
    expect(sc.wizard_skipped_at).toBeNull();
    // Version bumps to 3 on normalize.
    expect(sc.version).toBe(3);
  });

  it("round-trips a v3 sidecar with picked use_cases through normalize()", async () => {
    memFs.set(PATH, {
      version: 3,
      first_seen_at: "2026-05-20T08:00:00.000Z",
      active_seconds: 0,
      last_tip_at: 0,
      tips: {},
      tips_off: false,
      shown_count: 0,
      mode: "suggestions",
      use_cases: ["postdoc"],
      wizard_completed_at: null,
      wizard_skipped_at: null,
    });
    const sc = await readOnboarding(USER);
    expect(sc.use_cases).toEqual(["postdoc"]);
    expect(sc.wizard_completed_at).toBeNull();
    expect(sc.wizard_skipped_at).toBeNull();

    // Write back and re-read — round-trip preserves the picks.
    await writeOnboarding(USER, sc);
    const sc2 = await readOnboarding(USER);
    expect(sc2.use_cases).toEqual(["postdoc"]);
    expect(sc2.version).toBe(3);
  });

  it("round-trips a v3 sidecar with wizard_completed_at set", async () => {
    memFs.set(PATH, {
      version: 3,
      first_seen_at: "2026-05-20T08:00:00.000Z",
      active_seconds: 0,
      last_tip_at: 0,
      tips: {},
      tips_off: false,
      shown_count: 0,
      mode: "suggestions",
      use_cases: ["phd_experiments", "computational"],
      wizard_completed_at: "2026-05-20T12:00:00Z",
      wizard_skipped_at: null,
    });
    const sc = await readOnboarding(USER);
    expect(sc.wizard_completed_at).toBe("2026-05-20T12:00:00Z");
    expect(sc.use_cases).toEqual(["phd_experiments", "computational"]);

    await writeOnboarding(USER, sc);
    const sc2 = await readOnboarding(USER);
    expect(sc2.wizard_completed_at).toBe("2026-05-20T12:00:00Z");
    expect(sc2.use_cases).toEqual(["phd_experiments", "computational"]);
  });

  it("normalizes an invalid use_cases value (number) to null without crashing", async () => {
    memFs.set(PATH, {
      version: 3,
      first_seen_at: "2026-05-20T08:00:00.000Z",
      active_seconds: 0,
      last_tip_at: 0,
      tips: {},
      tips_off: false,
      shown_count: 0,
      mode: null,
      // Junk value — should normalize to null.
      use_cases: 42,
      wizard_completed_at: null,
      wizard_skipped_at: null,
    });
    const sc = await readOnboarding(USER);
    expect(sc.use_cases).toBeNull();
  });

  it("normalizes an invalid use_cases value (object) to null", async () => {
    memFs.set(PATH, {
      version: 3,
      first_seen_at: "2026-05-20T08:00:00.000Z",
      active_seconds: 0,
      last_tip_at: 0,
      tips: {},
      tips_off: false,
      shown_count: 0,
      mode: null,
      use_cases: { wrong: "shape" },
      wizard_completed_at: null,
      wizard_skipped_at: null,
    });
    const sc = await readOnboarding(USER);
    expect(sc.use_cases).toBeNull();
  });

  it("normalizes an array with non-string members to null", async () => {
    memFs.set(PATH, {
      version: 3,
      use_cases: ["postdoc", 42, null],
    });
    const sc = await readOnboarding(USER);
    expect(sc.use_cases).toBeNull();
  });

  it("accepts an empty array for use_cases (wizard run, no picks)", async () => {
    memFs.set(PATH, {
      version: 3,
      use_cases: [],
    });
    const sc = await readOnboarding(USER);
    expect(sc.use_cases).toEqual([]);
  });

  it("a missing sidecar reads as a fresh v3 default", async () => {
    const sc = await readOnboarding(USER);
    expect(sc.version).toBe(3);
    expect(sc.mode).toBeNull();
    expect(sc.use_cases).toBeNull();
    expect(sc.wizard_completed_at).toBeNull();
    expect(sc.wizard_skipped_at).toBeNull();
    expect(sc.other_use_case).toBeNull();
  });

  it("round-trips other_use_case (Phase 2a additive v3 extension)", async () => {
    memFs.set(PATH, {
      version: 3,
      first_seen_at: "2026-05-20T08:00:00.000Z",
      active_seconds: 0,
      last_tip_at: 0,
      tips: {},
      tips_off: false,
      shown_count: 0,
      mode: "suggestions",
      use_cases: [],
      wizard_completed_at: "2026-05-20T12:00:00Z",
      wizard_skipped_at: null,
      other_use_case: "physics simulations",
    });
    const sc = await readOnboarding(USER);
    expect(sc.other_use_case).toBe("physics simulations");
    await writeOnboarding(USER, sc);
    const sc2 = await readOnboarding(USER);
    expect(sc2.other_use_case).toBe("physics simulations");
  });

  it("normalizes whitespace-only other_use_case to null", async () => {
    memFs.set(PATH, {
      version: 3,
      other_use_case: "   ",
    });
    const sc = await readOnboarding(USER);
    expect(sc.other_use_case).toBeNull();
  });

  it("normalizes a non-string other_use_case to null", async () => {
    memFs.set(PATH, {
      version: 3,
      other_use_case: 42,
    });
    const sc = await readOnboarding(USER);
    expect(sc.other_use_case).toBeNull();
  });
});
