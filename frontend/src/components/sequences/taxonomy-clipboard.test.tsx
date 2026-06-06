// sequence editor master. Tests for the app-scoped taxonomy clipboard. Covers
// copy then read, clear, the localStorage round-trip (a fresh module load picks
// up a prior copy, simulating a reload), the reactive hook, and SSR safety (the
// functions never throw when localStorage is missing). The clipboard module is a
// singleton, so the reload test reloads it via vi.resetModules + dynamic import.
//
// This lives as a .test.tsx so it runs in the jsdom project (localStorage +
// renderHook); the pure primitive test stays in the node project.

import { describe, expect, it, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  copyTaxonomy,
  getCopiedTaxonomy,
  clearTaxonomy,
  useTaxonomyClipboard,
} from "@/lib/sequences/taxonomy-clipboard";

const STORAGE_KEY = "researchos.sequences.taxonomyClipboard.v1";

const SAMPLE = {
  organism: "Homo sapiens",
  tax_id: "9606",
  tax_lineage: [{ taxId: "9606", name: "Homo sapiens", rank: "species" }],
  copiedFromName: "Homo sapiens",
};

beforeEach(() => {
  clearTaxonomy();
  window.localStorage.clear();
});

describe("taxonomy clipboard", () => {
  it("copies then reads the same taxonomy back", () => {
    expect(getCopiedTaxonomy()).toBeNull();
    copyTaxonomy(SAMPLE);
    expect(getCopiedTaxonomy()).toEqual(SAMPLE);
  });

  it("clears the clipboard", () => {
    copyTaxonomy(SAMPLE);
    clearTaxonomy();
    expect(getCopiedTaxonomy()).toBeNull();
  });

  it("persists a copy to localStorage", () => {
    copyTaxonomy(SAMPLE);
    const raw = window.localStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw as string)).toEqual(SAMPLE);
    // Clearing removes the persisted entry.
    clearTaxonomy();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("hydrates a prior copy from localStorage on a fresh module load (reload)", async () => {
    // Seed localStorage as if a copy was made in a prior visit, then load a
    // FRESH instance of the module so its lazy hydration reads the entry.
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(SAMPLE));
    vi.resetModules();
    const fresh = await import("@/lib/sequences/taxonomy-clipboard");
    expect(fresh.getCopiedTaxonomy()).toEqual(SAMPLE);
  });

  it("exposes a reactive hook that updates on copy and clear", () => {
    const { result } = renderHook(() => useTaxonomyClipboard());
    expect(result.current.copied).toBeNull();

    act(() => result.current.copyTaxonomy(SAMPLE));
    expect(result.current.copied).toEqual(SAMPLE);

    act(() => result.current.clearTaxonomy());
    expect(result.current.copied).toBeNull();
  });

  it("is SSR-safe: functions do not throw when localStorage is unavailable", () => {
    const original = window.localStorage;
    // Simulate the server (no localStorage) by removing it for the duration.
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("localStorage is not available");
      },
    });
    try {
      expect(() => copyTaxonomy(SAMPLE)).not.toThrow();
      expect(() => getCopiedTaxonomy()).not.toThrow();
      expect(() => clearTaxonomy()).not.toThrow();
    } finally {
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        value: original,
      });
    }
  });
});
