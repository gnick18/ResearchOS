import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isLabArchivesConfigured } from "./config";

/**
 * Node-env tests for the capture-mode override on `isLabArchivesConfigured`.
 *
 * The override path inspects `window.sessionStorage`, `window.location`, and
 * `URLSearchParams` (a Node builtin). We stub a minimal `window` global on
 * each case so we don't drag in jsdom.
 */

type StorageMap = Record<string, string>;

function installWindow({
  search = "",
  pathname = "/settings",
  storage = {} as StorageMap,
}: {
  search?: string;
  pathname?: string;
  storage?: StorageMap;
}) {
  const fakeStorage: Storage = {
    getItem: (k: string) => (k in storage ? storage[k] : null),
    setItem: (k: string, v: string) => { storage[k] = v; },
    removeItem: (k: string) => { delete storage[k]; },
    clear: () => { for (const k of Object.keys(storage)) delete storage[k]; },
    key: (i: number) => Object.keys(storage)[i] ?? null,
    get length() { return Object.keys(storage).length; },
  };
  (globalThis as unknown as { window: unknown }).window = {
    sessionStorage: fakeStorage,
    location: { search, pathname },
  };
}

function clearWindow() {
  delete (globalThis as Partial<{ window: unknown }>).window;
}

describe("isLabArchivesConfigured", () => {
  const ORIGINAL_ENV = process.env.NEXT_PUBLIC_LABARCHIVES_ENABLED;

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_LABARCHIVES_ENABLED;
    clearWindow();
  });

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env.NEXT_PUBLIC_LABARCHIVES_ENABLED;
    } else {
      process.env.NEXT_PUBLIC_LABARCHIVES_ENABLED = ORIGINAL_ENV;
    }
    clearWindow();
    vi.restoreAllMocks();
  });

  // ── Default (non-capture) behavior ─────────────────────────────────────

  it("returns false when the env flag is unset and we're not in capture mode", () => {
    installWindow({}); // plain /settings, no params
    expect(isLabArchivesConfigured()).toBe(false);
  });

  it("returns true when NEXT_PUBLIC_LABARCHIVES_ENABLED === '1' and we're not in capture mode", () => {
    process.env.NEXT_PUBLIC_LABARCHIVES_ENABLED = "1";
    installWindow({});
    expect(isLabArchivesConfigured()).toBe(true);
  });

  it("ignores the labArchivesConfigured URL param outside of capture mode", () => {
    // Critical: outside of demo / wikiCapture, the URL param MUST NOT
    // override real config — otherwise a regular user could spoof a
    // 'configured' state in production.
    installWindow({ search: "?labArchivesConfigured=1" });
    expect(isLabArchivesConfigured()).toBe(false);
  });

  it("is SSR-safe (returns env value when window is undefined)", () => {
    clearWindow();
    expect(isLabArchivesConfigured()).toBe(false);
    process.env.NEXT_PUBLIC_LABARCHIVES_ENABLED = "1";
    expect(isLabArchivesConfigured()).toBe(true);
  });

  // ── Capture-mode override ──────────────────────────────────────────────

  it("returns true under ?wikiCapture=1&labArchivesConfigured=1 even with env flag unset", () => {
    installWindow({ search: "?wikiCapture=1&labArchivesConfigured=1" });
    expect(isLabArchivesConfigured()).toBe(true);
  });

  it("returns false under ?wikiCapture=1&labArchivesConfigured=0 even with env flag set", () => {
    process.env.NEXT_PUBLIC_LABARCHIVES_ENABLED = "1";
    installWindow({ search: "?wikiCapture=1&labArchivesConfigured=0" });
    expect(isLabArchivesConfigured()).toBe(false);
  });

  it("returns false under ?wikiCapture=1 with no labArchivesConfigured param (default purple/demo state)", () => {
    process.env.NEXT_PUBLIC_LABARCHIVES_ENABLED = "1";
    installWindow({ search: "?wikiCapture=1" });
    expect(isLabArchivesConfigured()).toBe(false);
  });

  it("honors the override under /demo/* as well", () => {
    installWindow({ pathname: "/demo", search: "?labArchivesConfigured=1" });
    expect(isLabArchivesConfigured()).toBe(true);
  });

  it("honors the override when the sticky researchos:demo-mode flag is set", () => {
    installWindow({
      search: "?labArchivesConfigured=1",
      storage: { "researchos:demo-mode": "1" },
    });
    expect(isLabArchivesConfigured()).toBe(true);
  });
});
