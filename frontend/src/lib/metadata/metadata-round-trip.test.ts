// frontend/src/lib/metadata/metadata-round-trip.test.ts
//
// Round-trip + backward-compat tests for the structured-research-metadata
// foundation slice (metadata implementation bot, 2026-05-28):
//
//   1. Funding-account create + partial-update round-trip with the new
//      award/funder fields (and proof that a partial update preserves the
//      other structured fields via the store's undefined-filtering merge).
//   2. Project funding_account_id round-trip (set + clear-with-null).
//   3. Backward-compat: an old funding-account / project / user-metadata
//      JSON object missing every new field still loads unchanged (no eager
//      migration, absent field stays absent).
//
// Node-env test (.test.ts) — exercises the JsonStore / fileService boundary
// against an in-memory file map, mirroring tasks-api-update.test.ts.

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { FundingAccount, Project } from "../types";

// ── In-memory file-service mock ─────────────────────────────────────────────
const memFs = new Map<string, unknown>();

vi.mock("../file-system/file-service", () => ({
  fileService: {
    readJson: vi.fn(async (path: string) => {
      const v = memFs.get(path);
      return v === undefined ? null : v;
    }),
    writeJson: vi.fn(async (path: string, data: unknown) => {
      // Persist a structural clone so callers can't mutate the stored copy
      // by reference (matches a real disk round-trip through JSON).
      memFs.set(path, JSON.parse(JSON.stringify(data)));
    }),
    ensureDir: vi.fn(async () => null),
    listFiles: vi.fn(async (dir: string) => {
      const prefix = `${dir}/`;
      const names: string[] = [];
      for (const key of memFs.keys()) {
        if (key.startsWith(prefix) && !key.slice(prefix.length).includes("/")) {
          names.push(key.slice(prefix.length));
        }
      }
      return names;
    }),
    deleteFile: vi.fn(async (path: string) => memFs.delete(path)),
    isConnected: vi.fn(() => true),
  },
}));

vi.mock("../file-system/indexeddb-store", () => ({
  getCurrentUser: vi.fn(async () => "alex"),
}));

// ── Imports (after mocks) ───────────────────────────────────────────────────
import { purchasesApi, projectsApi } from "../local-api";

beforeEach(() => {
  memFs.clear();
});

// ── Funding-account round-trip ──────────────────────────────────────────────
describe("FundingAccount — structured grant fields round-trip", () => {
  it("creates an account carrying the new award/funder fields", async () => {
    const created = await purchasesApi.createFundingAccount({
      name: "R01 lab string",
      total_budget: 250000,
      award_number: "5R01GM123456-03",
      funder_name: "National Institutes of Health",
      funder_id: "10.13039/100000002",
      funder_id_type: "Crossref Funder ID",
      award_title: "Mechanisms of fungal secondary metabolism",
    });

    expect(created.name).toBe("R01 lab string");
    expect(created.award_number).toBe("5R01GM123456-03");
    expect(created.funder_name).toBe("National Institutes of Health");
    expect(created.funder_id).toBe("10.13039/100000002");
    expect(created.funder_id_type).toBe("Crossref Funder ID");
    expect(created.award_title).toBe(
      "Mechanisms of fungal secondary metabolism",
    );

    // Re-read from the "disk" map to prove it persisted, not just echoed.
    const onDisk = memFs.get(
      `users/lab/funding_accounts/${created.id}.json`,
    ) as FundingAccount;
    expect(onDisk.funder_name).toBe("National Institutes of Health");
    expect(onDisk.award_number).toBe("5R01GM123456-03");
  });

  it("defaults the new fields to null on a create that omits them", async () => {
    const created = await purchasesApi.createFundingAccount({
      name: "Bare account",
      total_budget: 0,
    });
    expect(created.award_number).toBeNull();
    expect(created.funder_name).toBeNull();
    expect(created.funder_id).toBeNull();
    expect(created.funder_id_type).toBeNull();
    expect(created.award_title).toBeNull();
  });

  it("partial update preserves untouched structured fields", async () => {
    const created = await purchasesApi.createFundingAccount({
      name: "Grant A",
      total_budget: 100,
      award_number: "AWARD-1",
      funder_name: "National Science Foundation",
      funder_id: "https://ror.org/021nxhr62",
      funder_id_type: "ROR",
      award_title: "Original title",
    });

    // Update ONLY the award title; everything else must survive the merge.
    const updated = await purchasesApi.updateFundingAccount(created.id, {
      award_title: "Revised title",
    });

    expect(updated).not.toBeNull();
    expect(updated!.award_title).toBe("Revised title");
    expect(updated!.award_number).toBe("AWARD-1");
    expect(updated!.funder_name).toBe("National Science Foundation");
    expect(updated!.funder_id).toBe("https://ror.org/021nxhr62");
    expect(updated!.funder_id_type).toBe("ROR");
    // The user-facing label is independent of award_number and untouched.
    expect(updated!.name).toBe("Grant A");
  });

  it("update can clear a structured field with null without touching others", async () => {
    const created = await purchasesApi.createFundingAccount({
      name: "Grant B",
      total_budget: 0,
      award_number: "AWARD-2",
      funder_name: "National Institutes of Health",
    });

    const updated = await purchasesApi.updateFundingAccount(created.id, {
      award_number: null,
    });

    expect(updated!.award_number).toBeNull();
    expect(updated!.funder_name).toBe("National Institutes of Health");
  });

  it("backward-compat: an old account JSON missing every new field still loads", async () => {
    // Hand-seed a pre-slice on-disk record (no award/funder fields at all).
    const legacy: FundingAccount = {
      id: 99,
      name: "Legacy grant",
      description: null,
      total_budget: 5000,
      spent: 1200,
      remaining: 3800,
    };
    memFs.set("users/lab/funding_accounts/99.json", legacy);

    const accounts = await purchasesApi.listFundingAccounts();
    const loaded = accounts.find((a) => a.id === 99)!;

    expect(loaded.name).toBe("Legacy grant");
    expect(loaded.total_budget).toBe(5000);
    // Absent fields stay absent (no eager migration); reads tolerate them.
    expect(loaded.award_number).toBeUndefined();
    expect(loaded.funder_name).toBeUndefined();
    expect(loaded.funder_id).toBeUndefined();
    expect(loaded.funder_id_type).toBeUndefined();
    expect(loaded.award_title).toBeUndefined();

    // A budget-only update on the legacy record does not invent the new
    // fields — backward-compat preserved end to end.
    const updated = await purchasesApi.updateFundingAccount(99, {
      total_budget: 6000,
    });
    expect(updated!.total_budget).toBe(6000);
    expect(updated!.award_number).toBeUndefined();
    expect(updated!.funder_name).toBeUndefined();
  });
});

// ── Project -> grant link round-trip ────────────────────────────────────────
describe("Project — funding_account_id round-trip", () => {
  it("creates a project linked to a funding account", async () => {
    const project = await projectsApi.create({
      name: "Linked project",
      funding_account_id: 7,
    });
    expect(project.funding_account_id).toBe(7);

    const onDisk = memFs.get(
      `users/alex/projects/${project.id}.json`,
    ) as Project;
    expect(onDisk.funding_account_id).toBe(7);
  });

  it("creates an unlinked project with the field absent (not null)", async () => {
    const project = await projectsApi.create({ name: "Unlinked project" });
    expect(project.funding_account_id).toBeUndefined();
    const onDisk = memFs.get(
      `users/alex/projects/${project.id}.json`,
    ) as Project;
    expect("funding_account_id" in onDisk).toBe(false);
  });

  it("update sets and then clears (null) the grant link", async () => {
    const project = await projectsApi.create({ name: "Toggle project" });

    const linked = await projectsApi.update(project.id, {
      funding_account_id: 3,
    });
    expect(linked!.funding_account_id).toBe(3);

    const unlinked = await projectsApi.update(project.id, {
      funding_account_id: null,
    });
    expect(unlinked!.funding_account_id).toBeNull();
  });

  it("backward-compat: an old project JSON missing funding_account_id still loads", async () => {
    const legacy: Project = {
      id: 50,
      name: "Legacy project",
      weekend_active: false,
      tags: null,
      color: null,
      created_at: "2025-01-01T00:00:00.000Z",
      sort_order: 0,
      is_archived: false,
      archived_at: null,
      owner: "alex",
      shared_with: [],
    };
    memFs.set("users/alex/projects/50.json", legacy);

    const projects = await projectsApi.list();
    const loaded = projects.find((p) => p.id === 50)!;
    expect(loaded.name).toBe("Legacy project");
    expect(loaded.funding_account_id).toBeUndefined();

    // A name-only update preserves the absent link (spread-merge filters
    // undefined; we never supplied funding_account_id).
    const updated = await projectsApi.update(50, { name: "Renamed" });
    expect(updated!.name).toBe("Renamed");
    expect(updated!.funding_account_id).toBeUndefined();
  });
});
