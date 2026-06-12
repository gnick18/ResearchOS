import { beforeEach, describe, expect, it, vi } from "vitest";

// PubChem-descriptor persistence (BeakerAI, 2026-06-12). Asserts that the four
// PubChem physicochemical descriptors (XLogP, H-bond donor / acceptor counts,
// TPSA) supplied to moleculesApi.create are written to the .meta.json sidecar
// and round-trip back through get / list, while a non-PubChem create (no
// descriptors supplied) leaves the fields undefined with no null-key spam.
//
// Same in-memory fileService fake the molecule-store test uses, so this never
// touches the real File System Access. RDKit is browser-only and getRdkit()
// rejects under Node, so identityPatch returns {} (caught), which is fine here:
// we assert ONLY the descriptor behavior, not the RDKit identity fields.

const files = new Map<string, string>();

vi.mock("../file-system/file-service", () => ({
  fileService: {
    async ensureDir() {
      return null;
    },
    async listFiles(dir: string) {
      const prefix = `${dir}/`;
      return [...files.keys()]
        .filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes("/"))
        .map((p) => p.slice(prefix.length));
    },
    async readJson<T>(path: string): Promise<T | null> {
      const raw = files.get(path);
      return raw == null ? null : (JSON.parse(raw) as T);
    },
    async writeJson<T>(path: string, data: T) {
      files.set(path, JSON.stringify(data));
    },
    async readText(path: string) {
      return files.get(path) ?? null;
    },
    async writeText(path: string, content: string) {
      files.set(path, content);
    },
    async deleteFile(path: string) {
      return files.delete(path);
    },
  },
}));

vi.mock("../storage/json-store", () => ({
  getCurrentUserCached: async () => "grant",
}));

import { moleculesApi, type MoleculeMeta } from "./api";

const MOLFILE = "\n  fake molfile body\nM  END\n";

describe("moleculesApi.create PubChem descriptor persistence", () => {
  beforeEach(() => {
    files.clear();
  });

  it("persists the four PubChem descriptors to the sidecar and round-trips them", async () => {
    const { meta } = await moleculesApi.create(MOLFILE, {
      name: "Caffeine",
      source: "pubchem",
      pubchem_cid: 2519,
      xlogp: -0.1,
      h_bond_donor_count: 0,
      h_bond_acceptor_count: 6,
      tpsa: 58.4,
    });

    // Written onto the returned meta.
    expect(meta.xlogp).toBe(-0.1);
    expect(meta.h_bond_donor_count).toBe(0);
    expect(meta.h_bond_acceptor_count).toBe(6);
    expect(meta.tpsa).toBe(58.4);

    // Round-trips back through get.
    const got = await moleculesApi.get(meta.id);
    expect(got?.meta.xlogp).toBe(-0.1);
    expect(got?.meta.h_bond_donor_count).toBe(0);
    expect(got?.meta.h_bond_acceptor_count).toBe(6);
    expect(got?.meta.tpsa).toBe(58.4);

    // And through list.
    const listed = await moleculesApi.list();
    const found = listed.find((m) => m.id === meta.id);
    expect(found?.tpsa).toBe(58.4);

    // Persisted to the on-disk sidecar bytes.
    const sidecar = JSON.parse(
      files.get(`users/grant/molecules/${meta.id}.meta.json`) ?? "{}",
    ) as MoleculeMeta;
    expect(sidecar.xlogp).toBe(-0.1);
    expect(sidecar.tpsa).toBe(58.4);
  });

  it("writes a descriptor PubChem reported as null AS null (records 'no value')", async () => {
    const { meta } = await moleculesApi.create(MOLFILE, {
      name: "Some salt",
      source: "pubchem",
      pubchem_cid: 123,
      xlogp: null,
      h_bond_donor_count: null,
      h_bond_acceptor_count: null,
      tpsa: null,
    });
    expect(meta.xlogp).toBeNull();
    expect(meta.tpsa).toBeNull();
    const sidecar = JSON.parse(
      files.get(`users/grant/molecules/${meta.id}.meta.json`) ?? "{}",
    ) as Record<string, unknown>;
    // The keys ARE present (value null), distinguishing "PubChem has none" from
    // a non-PubChem molecule that never carries the keys at all.
    expect("xlogp" in sidecar).toBe(true);
    expect(sidecar.xlogp).toBeNull();
  });

  it("leaves the descriptors undefined for a non-PubChem (hand-drawn) create", async () => {
    const { meta } = await moleculesApi.create(MOLFILE, {
      name: "Hand drawn",
      source: "drawn",
    });
    expect(meta.xlogp).toBeUndefined();
    expect(meta.h_bond_donor_count).toBeUndefined();
    expect(meta.h_bond_acceptor_count).toBeUndefined();
    expect(meta.tpsa).toBeUndefined();

    // No null-key spam on the persisted sidecar: the descriptor keys are absent.
    const sidecar = JSON.parse(
      files.get(`users/grant/molecules/${meta.id}.meta.json`) ?? "{}",
    ) as Record<string, unknown>;
    expect("xlogp" in sidecar).toBe(false);
    expect("h_bond_donor_count" in sidecar).toBe(false);
    expect("h_bond_acceptor_count" in sidecar).toBe(false);
    expect("tpsa" in sidecar).toBe(false);
  });

  it("leaves the descriptors undefined for a file-imported create", async () => {
    const { meta } = await moleculesApi.create(MOLFILE, {
      name: "Imported file",
      source: "imported",
    });
    expect(meta.xlogp).toBeUndefined();
    expect(meta.tpsa).toBeUndefined();
    const sidecar = JSON.parse(
      files.get(`users/grant/molecules/${meta.id}.meta.json`) ?? "{}",
    ) as Record<string, unknown>;
    expect("tpsa" in sidecar).toBe(false);
  });
});
