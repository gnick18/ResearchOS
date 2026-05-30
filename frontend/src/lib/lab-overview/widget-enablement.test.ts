// frontend/src/lib/lab-overview/widget-enablement.test.ts
//
// Extension Store Phase U3 (extension-store U3 bot) coverage for the widget
// ENABLE/DISABLE curation layer:
//   - pure resolution: absent => all enabled (back-compat default), empty
//     array => everything off, unknown ids dropped, instance ids normalized
//   - toggle math: disabling materializes "all except this", re-enabling
//     restores, registry order preserved
//   - the palette/store offering gate (isWidgetEnabled / filterEnabledWidgets)
//     never widens visibility (it is an extra filter, not an override)
//   - the FULL settings round-trip through a mocked disk: default all-enabled,
//     disabling hides a widget, re-enabling restores, isolated per-account
//
// The file-service is mocked so the settings store round-trips against an
// in-memory map (mirrors method-type-enablement.test.ts).

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
  allWidgetIds,
  resolveEnabledWidgets,
  isWidgetEnabled,
  filterEnabledWidgets,
  toggleWidgetEnabled,
  readEnabledWidgets,
  setWidgetEnabled,
} from "./widget-enablement";
import { WIDGET_CATALOG, singleProjectInstanceId } from "@/components/lab-overview/widgets/registry";
import { visibleCatalog } from "@/components/lab-overview/widgets/types";

beforeEach(() => {
  memFs.clear();
});

describe("resolveEnabledWidgets()", () => {
  it("treats ABSENT as all widgets enabled (back-compat default)", () => {
    const set = resolveEnabledWidgets(undefined);
    const all = allWidgetIds();
    expect(set.size).toBe(all.length);
    for (const id of all) expect(set.has(id)).toBe(true);
    // null is also absent.
    expect(resolveEnabledWidgets(null).size).toBe(all.length);
  });

  it("treats an EMPTY array as everything off", () => {
    const set = resolveEnabledWidgets([]);
    expect(set.size).toBe(0);
    expect(set.has("announcements")).toBe(false);
  });

  it("honors an explicit subset", () => {
    const set = resolveEnabledWidgets(["announcements", "metrics"]);
    expect(set.has("announcements")).toBe(true);
    expect(set.has("metrics")).toBe(true);
    expect(set.has("comment-feed")).toBe(false);
  });

  it("drops unknown / removed ids", () => {
    const set = resolveEnabledWidgets(["announcements", "ghost_widget"]);
    expect(set.has("announcements")).toBe(true);
    expect([...set]).not.toContain("ghost_widget");
  });

  it("normalizes an instance id to its base catalog id", () => {
    const instanceId = singleProjectInstanceId("alex", 5);
    const set = resolveEnabledWidgets([instanceId]);
    expect(set.has("single-project")).toBe(true);
    expect(set.has(instanceId)).toBe(false);
  });
});

describe("isWidgetEnabled()", () => {
  it("is true for everything when absent", () => {
    expect(isWidgetEnabled("metrics", undefined)).toBe(true);
  });
  it("reflects the persisted subset", () => {
    expect(isWidgetEnabled("announcements", ["announcements"])).toBe(true);
    expect(isWidgetEnabled("metrics", ["announcements"])).toBe(false);
  });
  it("is tolerant of an instance id", () => {
    const instanceId = singleProjectInstanceId("mira", 2);
    expect(isWidgetEnabled(instanceId, ["single-project"])).toBe(true);
  });
});

describe("filterEnabledWidgets()", () => {
  it("filters a catalog to the enabled widgets", () => {
    const some = WIDGET_CATALOG.slice(0, 4);
    const keepId = some[1].id;
    const kept = filterEnabledWidgets(some, [keepId]);
    expect(kept.map((w) => w.id)).toEqual([keepId]);
  });

  it("absent => the catalog passes through unchanged", () => {
    const kept = filterEnabledWidgets(WIDGET_CATALOG, undefined);
    expect(kept.length).toBe(WIDGET_CATALOG.length);
  });

  it("NEVER widens visibility: it only narrows an already-gated catalog", () => {
    // A member's already-gated catalog excludes PI-only widgets (e.g.
    // metrics). Even if `metrics` is in the enabled set, it must not appear
    // because the gate happens BEFORE this filter.
    const memberCatalog = visibleCatalog(WIDGET_CATALOG, "member");
    expect(memberCatalog.some((w) => w.id === "metrics")).toBe(false);
    const filtered = filterEnabledWidgets(memberCatalog, [
      "metrics",
      "announcements",
    ]);
    // metrics still absent (gating wins); announcements present (gated +
    // enabled).
    expect(filtered.some((w) => w.id === "metrics")).toBe(false);
    expect(filtered.some((w) => w.id === "announcements")).toBe(true);
  });
});

describe("toggleWidgetEnabled()", () => {
  it("disabling from absent materializes 'all except this one'", () => {
    const next = toggleWidgetEnabled("metrics", false, undefined);
    expect(next).not.toContain("metrics");
    expect(next).toContain("announcements");
    // everything else stays.
    expect(next.length).toBe(allWidgetIds().length - 1);
  });

  it("re-enabling adds the widget back", () => {
    const disabled = toggleWidgetEnabled("announcements", false, undefined);
    expect(disabled).not.toContain("announcements");
    const reenabled = toggleWidgetEnabled("announcements", true, disabled);
    expect(reenabled).toContain("announcements");
  });

  it("preserves registry order in the materialized array", () => {
    const next = toggleWidgetEnabled("metrics", false, undefined);
    const expectedOrder = allWidgetIds().filter((id) => id !== "metrics");
    expect(next).toEqual(expectedOrder);
  });
});

describe("settings round-trip", () => {
  it("a brand-new account reads as ALL widgets enabled (no field on disk)", async () => {
    const set = await readEnabledWidgets("alex");
    expect(set.size).toBe(allWidgetIds().length);
    expect(set.has("metrics")).toBe(true);
  });

  it("disabling a widget hides it, and re-enabling restores it", async () => {
    await setWidgetEnabled("alex", "metrics", false);
    let set = await readEnabledWidgets("alex");
    expect(set.has("metrics")).toBe(false);
    expect(set.has("announcements")).toBe(true); // unrelated widget unaffected

    await setWidgetEnabled("alex", "metrics", true);
    set = await readEnabledWidgets("alex");
    expect(set.has("metrics")).toBe(true);
  });

  it("is isolated between two accounts on the same disk", async () => {
    await setWidgetEnabled("alex", "announcements", false);
    // mira never touched her settings -> still all-enabled.
    const alexSet = await readEnabledWidgets("alex");
    const miraSet = await readEnabledWidgets("mira");
    expect(alexSet.has("announcements")).toBe(false);
    expect(miraSet.has("announcements")).toBe(true);
  });
});
