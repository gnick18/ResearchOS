// frontend/src/lib/__tests__/deposits-api.test.ts
//
// Deposit tracking data layer (deposit-tracking bot, 2026-06-18).
//
// Covers:
//   - depositsApi.create round-trip: record is persisted, doi defaults null,
//     deposited_at is set to now, owner comes from the mocked current user.
//   - depositsApi.list returns the created record.
//   - depositsApi.update sets doi on an existing record.
//   - depositsApi.listForUser scoping: only returns records for the requested
//     owner (the list / listForUser split).
//   - depositsApi.delete removes the record.
//
// Mirrors the mocking style of inventory-api.test.ts.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { describe, expect, it, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// In-memory file-service mock (same pattern as inventory-api.test.ts).
// ---------------------------------------------------------------------------

const memFs = new Map<string, unknown>();
const listed = new Map<string, string[]>();

function trackFile(path: string): void {
  const slash = path.lastIndexOf("/");
  const dir = path.slice(0, slash);
  const fileName = path.slice(slash + 1);
  const existing = listed.get(dir) ?? [];
  if (!existing.includes(fileName)) listed.set(dir, [...existing, fileName]);
}

vi.mock("../file-system/file-service", () => ({
  fileService: {
    readJson: vi.fn(async (path: string) => {
      const v = memFs.get(path);
      return v === undefined ? null : v;
    }),
    writeJson: vi.fn(async (path: string, data: unknown) => {
      memFs.set(path, data);
      trackFile(path);
    }),
    ensureDir: vi.fn(async () => null),
    listFiles: vi.fn(async (path: string) => listed.get(path) ?? []),
    deleteFile: vi.fn(async (path: string) => {
      memFs.delete(path);
      return true;
    }),
    readText: vi.fn(async () => null),
    writeText: vi.fn(async () => {}),
    isConnected: vi.fn(() => true),
  },
}));

vi.mock("../file-system/indexeddb-store", () => ({
  getCurrentUser: vi.fn(async () => "alice"),
}));

vi.mock("../file-system/user-discovery", () => ({
  discoverUsers: vi.fn(async () => ["alice", "bob"]),
}));

import { depositsApi } from "../local-api";
import { clearCurrentUserCache } from "../storage/json-store";

beforeEach(() => {
  memFs.clear();
  listed.clear();
  clearCurrentUserCache();
});

// ---------------------------------------------------------------------------
// Create + read round-trip.
// ---------------------------------------------------------------------------

describe("depositsApi create + read", () => {
  it("creates a deposit under the current user and reads it back", async () => {
    const rec = await depositsApi.create({
      task_id: 42,
      project_id: null,
      repository: "zenodo",
      title: "Proteomics dataset",
    });

    expect(rec.id).toBe(1);
    expect(rec.task_id).toBe(42);
    expect(rec.project_id).toBeNull();
    expect(rec.repository).toBe("zenodo");
    expect(rec.title).toBe("Proteomics dataset");
    expect(rec.owner).toBe("alice");
    expect(memFs.has("users/alice/deposits/1.json")).toBe(true);

    const readBack = await depositsApi.get(1);
    expect(readBack?.title).toBe("Proteomics dataset");
    expect(readBack?.repository).toBe("zenodo");
  });

  it("defaults doi to null on create", async () => {
    const rec = await depositsApi.create({
      task_id: 7,
      repository: "figshare",
    });

    expect(rec.doi).toBeNull();
    expect(rec.concept_doi).toBeNull();
    expect(rec.version_sequence).toBeNull();
    expect(rec.prior_version_id).toBeNull();
  });

  it("sets deposited_at to a recent ISO timestamp on create", async () => {
    const before = Date.now();
    const rec = await depositsApi.create({
      task_id: 5,
      repository: "zenodo",
    });
    const after = Date.now();

    expect(rec.deposited_at).toBeTruthy();
    const ts = new Date(rec.deposited_at!).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it("stores doi when provided on create", async () => {
    const rec = await depositsApi.create({
      task_id: 3,
      repository: "zenodo",
      doi: "10.5281/zenodo.9999999",
    });

    expect(rec.doi).toBe("10.5281/zenodo.9999999");
  });
});

// ---------------------------------------------------------------------------
// list + listForUser scoping.
// ---------------------------------------------------------------------------

describe("depositsApi list and listForUser", () => {
  it("list() returns all deposits under the current user", async () => {
    await depositsApi.create({ task_id: 1, repository: "zenodo" });
    await depositsApi.create({ task_id: 2, repository: "figshare" });

    const all = await depositsApi.list();
    expect(all).toHaveLength(2);
    const repos = all.map((r) => r.repository).sort();
    expect(repos).toEqual(["figshare", "zenodo"]);
  });

  it("listForUser() returns only deposits belonging to the requested owner", async () => {
    // Write a deposit for alice (current user).
    await depositsApi.create({ task_id: 10, repository: "zenodo" });

    // Manually write a deposit for bob via the store path so we can test
    // owner-scoped reads.
    memFs.set("users/bob/deposits/1.json", {
      id: 1,
      task_id: 99,
      project_id: null,
      repository: "figshare",
      title: "Bob dataset",
      doi: null,
      concept_doi: null,
      version_sequence: null,
      prior_version_id: null,
      deposited_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      owner: "bob",
      shared_with: [],
      created_by: "bob",
    });
    const bobDir = "users/bob/deposits";
    listed.set(bobDir, ["1.json"]);

    const aliceDeposits = await depositsApi.listForUser("alice");
    const bobDeposits = await depositsApi.listForUser("bob");

    expect(aliceDeposits).toHaveLength(1);
    expect(aliceDeposits[0].task_id).toBe(10);

    expect(bobDeposits).toHaveLength(1);
    expect(bobDeposits[0].task_id).toBe(99);
    expect(bobDeposits[0].repository).toBe("figshare");
  });
});

// ---------------------------------------------------------------------------
// update.
// ---------------------------------------------------------------------------

describe("depositsApi update", () => {
  it("sets doi on an existing record", async () => {
    const rec = await depositsApi.create({
      task_id: 1,
      repository: "zenodo",
    });
    expect(rec.doi).toBeNull();

    const updated = await depositsApi.update(rec.id, {
      doi: "10.5281/zenodo.1234567",
    });

    expect(updated?.doi).toBe("10.5281/zenodo.1234567");
    // Other fields unchanged.
    expect(updated?.task_id).toBe(1);
    expect(updated?.repository).toBe("zenodo");
  });

  it("sets concept_doi independently of doi", async () => {
    const rec = await depositsApi.create({
      task_id: 2,
      repository: "zenodo",
    });

    const updated = await depositsApi.update(rec.id, {
      concept_doi: "10.5281/zenodo.concept.42",
    });

    expect(updated?.concept_doi).toBe("10.5281/zenodo.concept.42");
    expect(updated?.doi).toBeNull();
  });

  it("returns null when updating a non-existent id", async () => {
    const result = await depositsApi.update(9999, { doi: "10.1/nope" });
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// delete.
// ---------------------------------------------------------------------------

describe("depositsApi delete", () => {
  it("removes the record so subsequent get returns null", async () => {
    const rec = await depositsApi.create({
      task_id: 55,
      repository: "other",
    });

    await depositsApi.delete(rec.id);

    const gone = await depositsApi.get(rec.id);
    expect(gone).toBeNull();
  });
});
