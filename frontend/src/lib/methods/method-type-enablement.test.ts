// frontend/src/lib/methods/method-type-enablement.test.ts
//
// Extension Store Phase U2 (extension-store U2 bot) coverage for the
// method-type ENABLE/DISABLE curation layer:
//   - pure resolution: absent => all enabled (back-compat default), empty
//     array => everything off (but `compound` always on), unknown ids dropped
//   - toggle math: disabling materializes "all except this", re-enabling
//     restores, `compound` is never persisted
//   - the picker-gating helpers (isMethodTypeEnabled / filterEnabledMetas)
//   - the FULL settings round-trip through a mocked disk: default all-enabled,
//     disabling hides a type, re-enabling restores, isolated per-account
//
// The file-service is mocked so the settings store round-trips against an
// in-memory map (mirrors last-seen-announcement.test.ts).

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
    fileExists: vi.fn(async (path: string) => memFs.has(path)),
  },
}));

// The settings writer mirrors a couple of fields to _user_metadata.json;
// stub that path so the round-trip doesn't need the real metadata store.
vi.mock("@/lib/file-system/user-metadata", () => ({
  getUserMetadata: vi.fn(async () => null),
  setUserMetadataField: vi.fn(async () => null),
  setUserMetadataColors: vi.fn(async () => null),
}));

import {
  allMethodTypeIds,
  resolveEnabledMethodTypes,
  isMethodTypeEnabled,
  filterEnabledMetas,
  toggleMethodTypeEnabled,
  readEnabledMethodTypes,
  setMethodTypeEnabled,
} from "./method-type-enablement";
import { METHOD_TYPE_REGISTRY } from "./method-type-registry";

beforeEach(() => {
  memFs.clear();
});

describe("resolveEnabledMethodTypes()", () => {
  it("treats ABSENT as all types enabled (back-compat default)", () => {
    const set = resolveEnabledMethodTypes(undefined);
    const all = allMethodTypeIds();
    expect(set.size).toBe(all.length);
    for (const id of all) expect(set.has(id)).toBe(true);
    // null is also absent.
    expect(resolveEnabledMethodTypes(null).size).toBe(all.length);
  });

  it("treats an EMPTY array as everything off — except always-on compound", () => {
    const set = resolveEnabledMethodTypes([]);
    // compound is always forced on (hidden-from-picker, reached by extending).
    expect(set.has("compound")).toBe(true);
    expect(set.has("pcr")).toBe(false);
    expect(set.has("markdown")).toBe(false);
    expect(set.size).toBe(1);
  });

  it("honors an explicit subset and always-includes compound", () => {
    const set = resolveEnabledMethodTypes(["markdown", "pcr"]);
    expect(set.has("markdown")).toBe(true);
    expect(set.has("pcr")).toBe(true);
    expect(set.has("compound")).toBe(true); // forced on
    expect(set.has("mass_spec")).toBe(false);
  });

  it("drops unknown / removed ids", () => {
    const set = resolveEnabledMethodTypes(["pcr", "ghost_type", "markdown"]);
    expect(set.has("pcr")).toBe(true);
    expect(set.has("markdown")).toBe(true);
    expect([...set]).not.toContain("ghost_type");
  });
});

describe("isMethodTypeEnabled()", () => {
  it("is true for everything when absent", () => {
    expect(isMethodTypeEnabled("mass_spec", undefined)).toBe(true);
  });
  it("reflects the persisted subset", () => {
    expect(isMethodTypeEnabled("pcr", ["pcr"])).toBe(true);
    expect(isMethodTypeEnabled("mass_spec", ["pcr"])).toBe(false);
  });
  it("is always true for compound regardless of the set", () => {
    expect(isMethodTypeEnabled("compound", [])).toBe(true);
    expect(isMethodTypeEnabled("compound", ["pcr"])).toBe(true);
  });
});

describe("filterEnabledMetas()", () => {
  it("filters a cosmetic-meta list to the enabled types", () => {
    const metas = [
      METHOD_TYPE_REGISTRY.markdown,
      METHOD_TYPE_REGISTRY.pcr,
      METHOD_TYPE_REGISTRY.mass_spec,
    ];
    const kept = filterEnabledMetas(metas, ["markdown", "pcr"]);
    expect(kept.map((m) => m.id)).toEqual(["markdown", "pcr"]);
  });
});

describe("toggleMethodTypeEnabled()", () => {
  it("disabling from absent materializes 'all except this one'", () => {
    const next = toggleMethodTypeEnabled("mass_spec", false, undefined);
    expect(next).not.toContain("mass_spec");
    // compound is never persisted (it's always-on / implied).
    expect(next).not.toContain("compound");
    // everything else stays.
    expect(next).toContain("markdown");
    expect(next).toContain("pcr");
  });

  it("re-enabling adds the type back", () => {
    const disabled = toggleMethodTypeEnabled("pcr", false, undefined);
    expect(disabled).not.toContain("pcr");
    const reenabled = toggleMethodTypeEnabled("pcr", true, disabled);
    expect(reenabled).toContain("pcr");
  });

  it("preserves registry order in the materialized array", () => {
    const next = toggleMethodTypeEnabled("mass_spec", false, undefined);
    const expectedOrder = allMethodTypeIds().filter(
      (id) => id !== "mass_spec" && id !== "compound",
    );
    expect(next).toEqual(expectedOrder);
  });

  it("never persists compound and no-ops a request to toggle it", () => {
    const next = toggleMethodTypeEnabled("compound", false, ["pcr"]);
    expect(next).not.toContain("compound");
    expect(next).toContain("pcr");
  });
});

describe("settings round-trip", () => {
  it("a brand-new account reads as ALL types enabled (no field on disk)", async () => {
    const set = await readEnabledMethodTypes("alex");
    expect(set.size).toBe(allMethodTypeIds().length);
    expect(set.has("mass_spec")).toBe(true);
  });

  it("disabling a type hides it, and re-enabling restores it", async () => {
    // Disable mass_spec.
    await setMethodTypeEnabled("alex", "mass_spec", false);
    let set = await readEnabledMethodTypes("alex");
    expect(set.has("mass_spec")).toBe(false);
    expect(set.has("pcr")).toBe(true); // unrelated type unaffected

    // Re-enable it.
    await setMethodTypeEnabled("alex", "mass_spec", true);
    set = await readEnabledMethodTypes("alex");
    expect(set.has("mass_spec")).toBe(true);
  });

  it("is isolated between two accounts on the same disk", async () => {
    await setMethodTypeEnabled("alex", "pcr", false);
    // mira never touched her settings -> still all-enabled.
    const alexSet = await readEnabledMethodTypes("alex");
    const miraSet = await readEnabledMethodTypes("mira");
    expect(alexSet.has("pcr")).toBe(false);
    expect(miraSet.has("pcr")).toBe(true);
  });
});
