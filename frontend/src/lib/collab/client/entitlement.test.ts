// External live-collab HOST entitlement, client read (Grant 2026-06-18).
//
// Pins the fail-closed contract: the helper returns true ONLY when the server
// answers { entitled: true }. Any other answer, a non-ok response, or a network
// error reads as false, so a free account is never let through by a glitch.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isExternalCollabHostEntitled } from "./entitlement";

describe("isExternalCollabHostEntitled", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns true when the server says entitled", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ entitled: true }) })),
    );
    expect(await isExternalCollabHostEntitled()).toBe(true);
  });

  it("returns false when the server says not entitled", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ entitled: false }) })),
    );
    expect(await isExternalCollabHostEntitled()).toBe(false);
  });

  it("returns false when the response is not ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, json: async () => ({}) })),
    );
    expect(await isExternalCollabHostEntitled()).toBe(false);
  });

  it("returns false when the fetch throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    expect(await isExternalCollabHostEntitled()).toBe(false);
  });
});
