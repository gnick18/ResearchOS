import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the registry with controllable fake migrations and the marker with an
// in-memory store, so the test exercises the runner's orchestration alone.
const fakeMigrations: Array<{
  id: string;
  title: string;
  run: () => Promise<{ changed: number; scanned: number; failed: number }>;
}> = [];
vi.mock("./registry", () => ({
  get MIGRATIONS() {
    return fakeMigrations;
  },
}));

const markerStore = new Map<string, string[]>();
vi.mock("./marker", () => ({
  readMarker: vi.fn(async (user: string) => ({
    applied: markerStore.get(user) ?? [],
    updatedAt: "",
  })),
  writeMarker: vi.fn(async (user: string, applied: string[]) => {
    markerStore.set(user, applied);
  }),
}));

import { runPendingMigrations } from "./runner";

beforeEach(() => {
  fakeMigrations.length = 0;
  markerStore.clear();
});
afterEach(() => vi.clearAllMocks());

function migration(id: string, changed: number, opts: { throws?: boolean } = {}) {
  return {
    id,
    title: id,
    run: vi.fn(async () => {
      if (opts.throws) throw new Error(`${id} boom`);
      return { changed, scanned: changed + 1, failed: 0 };
    }),
  };
}

describe("runPendingMigrations", () => {
  it("runs all pending, aggregates changed, marks them applied", async () => {
    fakeMigrations.push(migration("a", 2), migration("b", 3));
    const summary = await runPendingMigrations("mira");

    expect(summary.ran).toEqual(["a", "b"]);
    expect(summary.totalChanged).toBe(5);
    expect(summary.failures).toHaveLength(0);
    expect(markerStore.get("mira")).toEqual(["a", "b"]);
  });

  it("skips migrations already in the marker (does not re-run them)", async () => {
    markerStore.set("mira", ["a"]);
    const a = migration("a", 9);
    const b = migration("b", 1);
    fakeMigrations.push(a, b);

    const summary = await runPendingMigrations("mira");

    expect(a.run).not.toHaveBeenCalled();
    expect(b.run).toHaveBeenCalledOnce();
    expect(summary.ran).toEqual(["b"]);
    expect(markerStore.get("mira")).toEqual(["a", "b"]);
  });

  it("marks a migration applied even when it changed nothing", async () => {
    fakeMigrations.push(migration("a", 0));
    const summary = await runPendingMigrations("mira");
    expect(summary.totalChanged).toBe(0);
    expect(markerStore.get("mira")).toEqual(["a"]);
  });

  it("a thrown migration is isolated: not marked, others still run", async () => {
    fakeMigrations.push(
      migration("a", 1),
      migration("b", 0, { throws: true }),
      migration("c", 4),
    );
    const summary = await runPendingMigrations("mira");

    expect(summary.ran).toEqual(["a", "c"]);
    expect(summary.totalChanged).toBe(5);
    expect(summary.failures.map((f) => f.id)).toEqual(["b"]);
    // b is NOT recorded, so it retries next connect.
    expect(markerStore.get("mira")).toEqual(["a", "c"]);
  });
});
