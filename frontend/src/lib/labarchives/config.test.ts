import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import {
  isLabArchivesConfigured,
  readLabArchivesCredsFromRequest,
} from "./config";

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

describe("readLabArchivesCredsFromRequest", () => {
  const ORIG_KEY = process.env.LABARCHIVES_ACCESS_KEY_ID;
  const ORIG_PW = process.env.LABARCHIVES_ACCESS_PASSWORD;
  const ORIG_URL = process.env.LABARCHIVES_API_BASE_URL;
  const fakeReq = {} as NextRequest;

  beforeEach(() => {
    delete process.env.LABARCHIVES_ACCESS_KEY_ID;
    delete process.env.LABARCHIVES_ACCESS_PASSWORD;
    delete process.env.LABARCHIVES_API_BASE_URL;
  });

  afterEach(() => {
    if (ORIG_KEY === undefined) delete process.env.LABARCHIVES_ACCESS_KEY_ID;
    else process.env.LABARCHIVES_ACCESS_KEY_ID = ORIG_KEY;
    if (ORIG_PW === undefined) delete process.env.LABARCHIVES_ACCESS_PASSWORD;
    else process.env.LABARCHIVES_ACCESS_PASSWORD = ORIG_PW;
    if (ORIG_URL === undefined) delete process.env.LABARCHIVES_API_BASE_URL;
    else process.env.LABARCHIVES_API_BASE_URL = ORIG_URL;
  });

  it("env vars win over the body's deployerCreds", () => {
    process.env.LABARCHIVES_ACCESS_KEY_ID = "env-akid";
    process.env.LABARCHIVES_ACCESS_PASSWORD = "env-pw";
    const out = readLabArchivesCredsFromRequest(fakeReq, {
      deployerCreds: { accessKeyId: "body-akid", accessPassword: "body-pw" },
    });
    expect(out.accessKeyId).toBe("env-akid");
    expect(out.accessPassword).toBe("env-pw");
    expect(out.baseUrl).toBe("https://api.labarchives.com/api");
  });

  it("falls back to body.deployerCreds when env vars are unset", () => {
    const out = readLabArchivesCredsFromRequest(fakeReq, {
      deployerCreds: {
        accessKeyId: "body-akid",
        accessPassword: "body-pw",
        baseUrl: "https://auapi.labarchives.com/api",
      },
    });
    expect(out.accessKeyId).toBe("body-akid");
    expect(out.accessPassword).toBe("body-pw");
    expect(out.baseUrl).toBe("https://auapi.labarchives.com/api");
  });

  it("defaults baseUrl to the US endpoint when body omits it", () => {
    const out = readLabArchivesCredsFromRequest(fakeReq, {
      deployerCreds: { accessKeyId: "a", accessPassword: "b" },
    });
    expect(out.baseUrl).toBe("https://api.labarchives.com/api");
  });

  it("throws when neither env nor body supplies creds", () => {
    expect(() => readLabArchivesCredsFromRequest(fakeReq, {})).toThrow(
      /not configured/i,
    );
    expect(() => readLabArchivesCredsFromRequest(fakeReq, null)).toThrow(
      /not configured/i,
    );
  });

  it("rejects empty / non-string deployerCreds fields", () => {
    expect(() =>
      readLabArchivesCredsFromRequest(fakeReq, {
        deployerCreds: { accessKeyId: "", accessPassword: "b" },
      }),
    ).toThrow(/malformed/i);
    expect(() =>
      readLabArchivesCredsFromRequest(fakeReq, {
        deployerCreds: { accessKeyId: "a", accessPassword: 42 },
      }),
    ).toThrow(/malformed/i);
  });

  it("rejects absurdly long fields", () => {
    const big = "x".repeat(2000);
    expect(() =>
      readLabArchivesCredsFromRequest(fakeReq, {
        deployerCreds: { accessKeyId: big, accessPassword: "b" },
      }),
    ).toThrow(/too long/i);
    expect(() =>
      readLabArchivesCredsFromRequest(fakeReq, {
        deployerCreds: { accessKeyId: "a", accessPassword: big },
      }),
    ).toThrow(/too long/i);
  });

  it("rejects baseUrl that isn't http(s)", () => {
    expect(() =>
      readLabArchivesCredsFromRequest(fakeReq, {
        deployerCreds: {
          accessKeyId: "a",
          accessPassword: "b",
          baseUrl: "file:///etc/passwd",
        },
      }),
    ).toThrow(/http.s/i);
  });
});
