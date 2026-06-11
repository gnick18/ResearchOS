// Calculators snapshot builder tests (Custom Calculator Builder Phase 3,
// 2026-06-10).
//
// Covers:
//   buildCalculatorsSnapshot — an own custom calculator appears with its full
//     runnable spec (inputs / steps / conditionals / outputs) and isShared false.
//   buildCalculatorsSnapshot — the uid is namespaced by owner so the phone keys
//     a list without numeric-id collisions.
//   buildCalculatorsSnapshot — gated off when the builder flag is unset (the
//     snapshot is empty so nothing syncs until the feature ships).
//
// Mirrors inventory-snapshot.test.ts (same in-memory file-service mock). The
// builder flag is an inlined NEXT_PUBLIC_* const evaluated at module load, so
// instead of stubbing the env (too late under vitest hoisting) we mock the
// builder-config module with a mutable holder each test flips.

// ── Mocks (must precede the imports under test) ───────────────────────────────

const memFs = new Map<string, unknown>();
const listed = new Map<string, string[]>();

// Mutable builder-flag holder. The mock reads it through a getter so a test can
// flip the flag before calling buildCalculatorsSnapshot.
const flag = { enabled: true };

import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@/lib/calculators/builder-config", () => ({
  get CALC_BUILDER_ENABLED() {
    return flag.enabled;
  },
}));

vi.mock("@/lib/file-system/file-service", () => ({
  fileService: {
    readJson: vi.fn(async (path: string) => {
      const v = memFs.get(path);
      return v === undefined ? null : v;
    }),
    writeJson: vi.fn(async (path: string, data: unknown) => {
      memFs.set(path, data);
      const dir = path.slice(0, path.lastIndexOf("/"));
      const name = path.slice(path.lastIndexOf("/") + 1);
      const existing = listed.get(dir) ?? [];
      if (!existing.includes(name)) listed.set(dir, [...existing, name]);
    }),
    ensureDir: vi.fn(async () => null),
    listFiles: vi.fn(async (path: string) => listed.get(path) ?? []),
    deleteFile: vi.fn(async () => false),
    readText: vi.fn(async () => null),
    writeText: vi.fn(async () => {}),
    isConnected: vi.fn(() => true),
  },
}));

vi.mock("@/lib/file-system/indexeddb-store", () => ({
  getCurrentUser: vi.fn(async () => "alice"),
}));

// The whole-lab read aggregate walks "every user". Pin discovery to the single
// seeded user so the builder reads only alice's records in this unit test.
vi.mock("@/lib/file-system/user-discovery", () => ({
  discoverUsers: vi.fn(async () => ["alice"]),
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { buildCalculatorsSnapshot } from "../calculators-snapshot";
import { calculatorsApi } from "@/lib/local-api";
import { clearCurrentUserCache } from "@/lib/storage/json-store";

beforeEach(() => {
  memFs.clear();
  listed.clear();
  clearCurrentUserCache();
  flag.enabled = true;
});

// ── Builder ON ────────────────────────────────────────────────────────────────

describe("buildCalculatorsSnapshot — builder enabled", () => {
  it("includes an own calculator with its full runnable spec", async () => {
    await calculatorsApi.create({
      name: "Doubling time",
      description: "n1 -> n2 over hours",
      field: "Microbiology",
      inputs: [
        { key: "n1", type: "number", label: "Start count", default: 100000 },
        { key: "n2", type: "number", label: "End count", default: 800000 },
        { key: "hours", type: "number", label: "Hours", default: 6 },
      ],
      steps: [{ key: "rate", expr: "ln(n2 / n1) / hours" }],
      conditionals: [],
      outputs: [
        { label: "Doubling time", expr: "ln(2) / rate", unit: "h" },
      ],
    });

    const snap = await buildCalculatorsSnapshot();
    expect(snap.calculators).toHaveLength(1);
    const c = snap.calculators[0];
    expect(c.name).toBe("Doubling time");
    expect(c.field).toBe("Microbiology");
    expect(c.isShared).toBe(false);
    expect(c.ownerLabel).toBe("alice");
    // uid namespaced by owner so two members never collide on the phone.
    expect(c.uid).toBe("alice:1");
    // Full spec carried verbatim for the ported engine.
    expect(c.inputs).toHaveLength(3);
    expect(c.steps[0].expr).toBe("ln(n2 / n1) / hours");
    expect(c.outputs[0].expr).toBe("ln(2) / rate");
    expect(snap.generatedAt).toEqual(expect.any(String));
  });
});

// ── Builder OFF ───────────────────────────────────────────────────────────────

describe("buildCalculatorsSnapshot — builder disabled", () => {
  it("returns an empty snapshot so nothing syncs until the feature ships", async () => {
    flag.enabled = false;
    // Builder off. No calculator is even read.
    await calculatorsApi.create({
      name: "Should not sync",
      description: "",
      inputs: [],
      steps: [],
      conditionals: [],
      outputs: [],
    });

    const snap = await buildCalculatorsSnapshot();
    expect(snap.calculators).toEqual([]);
  });
});
