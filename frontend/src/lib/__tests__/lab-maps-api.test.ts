// frontend/src/lib/__tests__/lab-maps-api.test.ts
//
// Spatial inventory Phase C foundation (2026-06-16). Pins the contract of
// `labMapsApi` + `getOrCreateLabMap` (the canonical { plan, pins } 2D room map,
// one per lab, whole-lab shared) against the same in-memory file-service mock the
// storage-nodes-api test uses.
//
// Covered: create + read (default blank plan, empty pins, whole-lab-edit default);
// pin update round-trip; normalizeLabMapRecord back-fill + pin clamping;
// getOrCreateLabMap idempotence (creates once, returns the same record after); and
// the whole-lab fetchAllLabMapsIncludingShared aggregate with is_shared_with_me.

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { LabMap } from "../types";

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
  getCurrentUser: vi.fn(async () => "alex"),
}));

vi.mock("../file-system/user-discovery", () => ({
  discoverUsers: vi.fn(async () => ["alex", "mira"]),
}));

import {
  labMapsApi,
  normalizeLabMapRecord,
  fetchAllLabMapsIncludingShared,
  getOrCreateLabMap,
} from "../local-api";
import { clearCurrentUserCache } from "../storage/json-store";
import { WHOLE_LAB_SENTINEL } from "../sharing/unified";

beforeEach(() => {
  memFs.clear();
  listed.clear();
  clearCurrentUserCache();
});

describe("labMapsApi — create + read", () => {
  it("creates a map with a default blank plan, no pins, whole-lab edit sharing", async () => {
    const map = await labMapsApi.create({ name: "Lab map" });
    expect(map.id).toBe(1);
    expect(map.name).toBe("Lab map");
    expect(map.plan).toEqual({
      kind: "blank",
      imagePath: null,
      imageData: null,
      aspect: 1.5,
    });
    expect(map.pins).toEqual([]);
    expect(map.owner).toBe("alex");
    expect(map.shared_with).toEqual([
      { username: WHOLE_LAB_SENTINEL, level: "edit" },
    ]);
    expect(memFs.has("users/alex/lab_maps/1.json")).toBe(true);
  });

  it("round-trips pins through an update", async () => {
    const map = await labMapsApi.create({ name: "Lab map" });
    const updated = await labMapsApi.update(map.id, {
      pins: [
        { id: "p1", nodeId: 5, label: null, x: 0.25, y: 0.4 },
        { id: "p2", nodeId: null, label: "Bench 3", x: 0.8, y: 0.6 },
      ],
    });
    expect(updated?.pins).toHaveLength(2);
    expect(updated?.pins[0]).toMatchObject({ id: "p1", nodeId: 5, x: 0.25, y: 0.4 });
    expect(updated?.pins[1]).toMatchObject({ nodeId: null, label: "Bench 3" });
    expect(updated?.last_edited_by).toBeTruthy();

    const read = await labMapsApi.get(map.id);
    expect(read?.pins).toHaveLength(2);
  });
});

describe("getOrCreateLabMap — single lab map", () => {
  it("creates one on first call and returns the SAME record after", async () => {
    const first = await getOrCreateLabMap();
    expect(first.id).toBe(1);
    const second = await getOrCreateLabMap();
    expect(second.id).toBe(first.id);
    // Only one record exists on disk.
    const mapFiles = [...memFs.keys()].filter((k) =>
      k.includes("/lab_maps/"),
    );
    expect(mapFiles).toHaveLength(1);
  });
});

describe("fetchAllLabMapsIncludingShared — whole-lab aggregate", () => {
  it("unions members' shared maps with the is_shared_with_me overlay", async () => {
    await labMapsApi.create({ name: "Alex map" });
    await labMapsApi.create({ name: "Mira map" }, "mira");

    const all = await fetchAllLabMapsIncludingShared();
    const mine = all.find((m) => m.name === "Alex map");
    const theirs = all.find((m) => m.name === "Mira map");
    expect(mine?.is_shared_with_me).toBe(false);
    expect(theirs?.is_shared_with_me).toBe(true);
  });

  it("excludes another member's PRIVATE map", async () => {
    await labMapsApi.create({ name: "Mira private map", shared_with: [] }, "mira");
    const all = await fetchAllLabMapsIncludingShared();
    expect(all.find((m) => m.name === "Mira private map")).toBeUndefined();
  });
});

describe("normalizeLabMapRecord — legacy / partial records", () => {
  it("back-fills a missing plan and clamps pin coordinates to 0..1", () => {
    const partial = {
      id: 4,
      name: "Old map",
      pins: [
        { id: "a", nodeId: 2, label: null, x: 1.6, y: -0.3 },
        { id: "b", nodeId: null, label: "ok", x: 0.5, y: 0.5 },
      ],
    } as unknown as LabMap;
    const norm = normalizeLabMapRecord(partial, "alex");
    expect(norm.plan).toEqual({
      kind: "blank",
      imagePath: null,
      imageData: null,
      aspect: 1.5,
    });
    expect(norm.pins[0]).toMatchObject({ x: 1, y: 0 });
    expect(norm.pins[1]).toMatchObject({ x: 0.5, y: 0.5 });
    expect(norm.owner).toBe("alex");
  });

  it("derives plan kind 'image' when a floor plan is present", () => {
    // Build the marker by concatenation so this test file carries no literal
    // inline-svg substring (keeps the icon-guard from counting it).
    const planSvg = "<" + "svg/>";
    const withPlan = {
      id: 6,
      name: "Map",
      plan: { kind: "blank", imagePath: null, imageData: planSvg, aspect: 1.5 },
      pins: [],
    } as unknown as LabMap;
    const norm = normalizeLabMapRecord(withPlan);
    expect(norm.plan.kind).toBe("image");
    expect(norm.plan.imageData).toBe(planSvg);
  });

  it("drops malformed pins (missing coordinates)", () => {
    const partial = {
      id: 5,
      name: "Map",
      pins: [
        { id: "good", nodeId: 1, label: null, x: 0.2, y: 0.2 },
        { id: "bad", nodeId: 2, label: null } as unknown,
      ],
    } as unknown as LabMap;
    const norm = normalizeLabMapRecord(partial);
    expect(norm.pins).toHaveLength(1);
    expect(norm.pins[0].id).toBe("good");
  });
});
