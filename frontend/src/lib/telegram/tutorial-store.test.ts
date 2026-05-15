// frontend/src/lib/telegram/tutorial-store.test.ts
//
// Unit tests for the per-user Telegram tutorial sidecar at
// users/<u>/_telegram_tutorial.json. Covers:
//
//   1. Lazy default on missing file (no disk write).
//   2. Round-trip: write then read returns the same shape.
//   3. Normalize-on-read: malformed payload (raw === null branch +
//      unrecognized active_step + tutorial_active false but step set).
//   4. startTelegramTutorialStep helper writes the canonical "active"
//      shape with timestamp.
//   5. clearTelegramTutorial helper writes the canonical "inactive"
//      shape.

import { beforeEach, describe, expect, it, vi } from "vitest";

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

import {
  clearTelegramTutorial,
  readTelegramTutorial,
  startTelegramTutorialStep,
  writeTelegramTutorial,
} from "./tutorial-store";

const USER = "alex";
const PATH = `users/${USER}/_telegram_tutorial.json`;

beforeEach(() => {
  memFs.clear();
});

describe("tutorial-store", () => {
  it("returns the lazy default when the sidecar is missing", async () => {
    const state = await readTelegramTutorial(USER);
    expect(state.tutorial_active).toBe(false);
    expect(state.active_step).toBeNull();
    expect(state.active_since).toBeNull();
    expect(state.version).toBe(1);
    // Lazy: no write happened on read.
    expect(memFs.has(PATH)).toBe(false);
  });

  it("round-trips through writeTelegramTutorial + readTelegramTutorial", async () => {
    await writeTelegramTutorial(USER, {
      version: 1,
      tutorial_active: true,
      active_step: "first-photo",
      active_since: "2026-05-15T12:00:00.000Z",
    });
    const state = await readTelegramTutorial(USER);
    expect(state.tutorial_active).toBe(true);
    expect(state.active_step).toBe("first-photo");
    expect(state.active_since).toBe("2026-05-15T12:00:00.000Z");
  });

  it("normalizes an unrecognized active_step to null", async () => {
    memFs.set(PATH, {
      version: 1,
      tutorial_active: true,
      active_step: "some-future-step",
      active_since: "2026-05-15T12:00:00.000Z",
    });
    const state = await readTelegramTutorial(USER);
    expect(state.tutorial_active).toBe(true);
    expect(state.active_step).toBeNull();
  });

  it("forces step + timestamp to null when tutorial_active is false", async () => {
    // Defensive: a partial write from a future build shouldn't leave
    // a stale step value visible to the polling loop.
    memFs.set(PATH, {
      version: 1,
      tutorial_active: false,
      active_step: "first-photo",
      active_since: "2026-05-15T12:00:00.000Z",
    });
    const state = await readTelegramTutorial(USER);
    expect(state.tutorial_active).toBe(false);
    expect(state.active_step).toBeNull();
    expect(state.active_since).toBeNull();
  });

  it("treats raw=null as the default shape", async () => {
    // No entry at all: covers the raw === null branch in normalize().
    const state = await readTelegramTutorial(USER);
    expect(state).toEqual({
      version: 1,
      tutorial_active: false,
      active_step: null,
      active_since: null,
    });
  });

  it("startTelegramTutorialStep writes the active shape with a timestamp", async () => {
    const before = Date.now();
    const next = await startTelegramTutorialStep(USER, "first-photo");
    const after = Date.now();
    expect(next.tutorial_active).toBe(true);
    expect(next.active_step).toBe("first-photo");
    expect(next.active_since).not.toBeNull();
    const stamped = Date.parse(next.active_since!);
    expect(stamped).toBeGreaterThanOrEqual(before);
    expect(stamped).toBeLessThanOrEqual(after);
    // Persisted to disk.
    const reread = await readTelegramTutorial(USER);
    expect(reread.tutorial_active).toBe(true);
    expect(reread.active_step).toBe("first-photo");
  });

  it("clearTelegramTutorial writes the inactive shape", async () => {
    await startTelegramTutorialStep(USER, "first-photo");
    const cleared = await clearTelegramTutorial(USER);
    expect(cleared.tutorial_active).toBe(false);
    expect(cleared.active_step).toBeNull();
    expect(cleared.active_since).toBeNull();
    const reread = await readTelegramTutorial(USER);
    expect(reread.tutorial_active).toBe(false);
  });
});
