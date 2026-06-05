// Cross-boundary sharing, relay budget constants.
//
// Pins the budget numbers so a stray edit that drifts the display from the
// enforcement, or silently changes the budget, fails loudly. The per-inbox byte
// budget was lowered 5 GB -> 1 GB (Grant, 2026-06-05); see relay/limits.ts.

import { describe, expect, it } from "vitest";

import {
  FREE_STORAGE_BYTES,
  PENDING_SHARE_CAP,
  TTL_DAYS,
  TTL_MS,
} from "../limits";

describe("relay limits", () => {
  it("pending-share cap is 100", () => {
    expect(PENDING_SHARE_CAP).toBe(100);
  });

  it("free storage budget is exactly 1 GiB", () => {
    expect(FREE_STORAGE_BYTES).toBe(1 * 1024 * 1024 * 1024);
    expect(FREE_STORAGE_BYTES).toBe(1073741824);
  });

  it("TTL is 30 days, in days and in milliseconds", () => {
    expect(TTL_DAYS).toBe(30);
    expect(TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
    expect(TTL_MS).toBe(TTL_DAYS * 24 * 60 * 60 * 1000);
  });
});
