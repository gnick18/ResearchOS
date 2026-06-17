// Tests for view-mode-pref.ts: per-table localStorage preference that persists
// the last-viewed mode (editable vs dataset) across navigation.

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock localStorage before importing the module so the module-scope reads pick
// up the mock. vitest runs each test file in its own JS environment, so this
// mock is isolated.
const store: Record<string, string> = {};
const localStorageMock = {
  getItem: vi.fn((key: string) => store[key] ?? null),
  setItem: vi.fn((key: string, val: string) => { store[key] = val; }),
  removeItem: vi.fn((key: string) => { delete store[key]; }),
  clear: vi.fn(() => { for (const k in store) delete store[k]; }),
};

Object.defineProperty(globalThis, "window", {
  value: { localStorage: localStorageMock },
  writable: true,
});
Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  writable: true,
});

import {
  getViewModePref,
  setViewModePref,
  getLinkedDatasetId,
  setLinkedDatasetId,
} from "../view-mode-pref";

describe("view-mode-pref", () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // View mode preference
  // ---------------------------------------------------------------------------

  it("returns null when no preference has been stored", () => {
    expect(getViewModePref("user1", "table-1")).toBeNull();
  });

  it("stores and retrieves the dataset preference", () => {
    setViewModePref("user1", "table-1", "dataset");
    expect(getViewModePref("user1", "table-1")).toBe("dataset");
  });

  it("stores and retrieves the editable preference", () => {
    setViewModePref("user1", "table-1", "editable");
    expect(getViewModePref("user1", "table-1")).toBe("editable");
  });

  it("overwrites an existing preference", () => {
    setViewModePref("user1", "table-1", "dataset");
    setViewModePref("user1", "table-1", "editable");
    expect(getViewModePref("user1", "table-1")).toBe("editable");
  });

  it("scopes preference by owner so two owners do not share a pref", () => {
    setViewModePref("user1", "table-1", "dataset");
    expect(getViewModePref("user2", "table-1")).toBeNull();
  });

  it("scopes preference by tableId", () => {
    setViewModePref("user1", "table-1", "dataset");
    expect(getViewModePref("user1", "table-2")).toBeNull();
  });

  it("stores multiple preferences without collision", () => {
    setViewModePref("user1", "table-1", "dataset");
    setViewModePref("user1", "table-2", "editable");
    setViewModePref("user2", "table-1", "dataset");
    expect(getViewModePref("user1", "table-1")).toBe("dataset");
    expect(getViewModePref("user1", "table-2")).toBe("editable");
    expect(getViewModePref("user2", "table-1")).toBe("dataset");
  });

  // ---------------------------------------------------------------------------
  // Table -> dataset link
  // ---------------------------------------------------------------------------

  it("returns null when no link has been stored", () => {
    expect(getLinkedDatasetId("user1", "table-1")).toBeNull();
  });

  it("stores and retrieves a table->dataset link", () => {
    setLinkedDatasetId("user1", "table-1", "ds-42");
    expect(getLinkedDatasetId("user1", "table-1")).toBe("ds-42");
  });

  it("overwrites a prior link (convert run again produces a new dataset)", () => {
    setLinkedDatasetId("user1", "table-1", "ds-42");
    setLinkedDatasetId("user1", "table-1", "ds-99");
    expect(getLinkedDatasetId("user1", "table-1")).toBe("ds-99");
  });

  it("scopes link by owner", () => {
    setLinkedDatasetId("user1", "table-1", "ds-42");
    expect(getLinkedDatasetId("user2", "table-1")).toBeNull();
  });

  it("scopes link by tableId", () => {
    setLinkedDatasetId("user1", "table-1", "ds-42");
    expect(getLinkedDatasetId("user1", "table-2")).toBeNull();
  });

  it("stores multiple links without collision", () => {
    setLinkedDatasetId("user1", "table-1", "ds-1");
    setLinkedDatasetId("user1", "table-2", "ds-2");
    setLinkedDatasetId("user2", "table-1", "ds-3");
    expect(getLinkedDatasetId("user1", "table-1")).toBe("ds-1");
    expect(getLinkedDatasetId("user1", "table-2")).toBe("ds-2");
    expect(getLinkedDatasetId("user2", "table-1")).toBe("ds-3");
  });

  // ---------------------------------------------------------------------------
  // Graceful fallback on corrupted storage
  // ---------------------------------------------------------------------------

  it("returns null gracefully when localStorage contains invalid JSON (view mode)", () => {
    store["ros-datahub-view-mode-v1"] = "not-json{{{";
    expect(getViewModePref("user1", "table-1")).toBeNull();
  });

  it("returns null gracefully when localStorage contains invalid JSON (link)", () => {
    store["ros-datahub-table-dataset-v1"] = "not-json{{{";
    expect(getLinkedDatasetId("user1", "table-1")).toBeNull();
  });
});
