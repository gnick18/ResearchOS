// Cross-boundary sharing, relay budget constants.
//
// Pins the FINAL numbers (Grant, 2026-06-03) so a stray edit that drifts the
// display from the enforcement, or silently shrinks the budget, fails loudly.

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

  it("free storage budget is exactly 5 GiB", () => {
    expect(FREE_STORAGE_BYTES).toBe(5 * 1024 * 1024 * 1024);
    expect(FREE_STORAGE_BYTES).toBe(5368709120);
  });

  it("TTL is 30 days, in days and in milliseconds", () => {
    expect(TTL_DAYS).toBe(30);
    expect(TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
    expect(TTL_MS).toBe(TTL_DAYS * 24 * 60 * 60 * 1000);
  });
});
