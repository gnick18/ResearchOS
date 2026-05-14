// frontend/src/lib/import/eln/iso-date-portion.test.ts
//
// Regression test for the timezone-drift bug in ELN import date derivation.
//
// `isoDatePortion` is used by `deriveStartDate` (and the page-creator header)
// to turn an ISO timestamp into a calendar date for the imported task. The
// pre-fix implementation sliced the first 10 chars of the ISO string, which
// produced the *UTC* date — wrong by a day for any timestamp whose UTC date
// doesn't match the user's local date (e.g. an entry updated at 00:30 UTC in
// a US/Eastern timezone is actually 19:30 the previous day locally).
//
// The fixed implementation routes through `toLocaleDateString("en-CA")`, which
// returns YYYY-MM-DD in the *local* timezone. We verify the local-tz behavior
// here for the common pure-date case; full TZ-spoofing in vitest is awkward
// (Date is global) so we lean on the contract: same date in, same date out,
// and an ISO with explicit zone returns the local-tz date.

import { describe, expect, it } from "vitest";
import { isoDatePortion } from "./apply";

describe("isoDatePortion", () => {
  it("returns YYYY-MM-DD for a plain date-only string", () => {
    // Pure date inputs (no time) get parsed as UTC midnight by `new Date`.
    // In any timezone west of UTC that midnight is the previous day locally;
    // in any timezone east of UTC it's the same day. We can't assert a
    // specific value here without spoofing the TZ — but we can assert the
    // shape and that the function doesn't throw.
    const out = isoDatePortion("2026-03-26");
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("returns YYYY-MM-DD for an ISO timestamp with explicit zone", () => {
    const out = isoDatePortion("2026-03-26T12:00:00Z");
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("uses the local timezone (not UTC) for the date portion", () => {
    // 2026-03-26T00:30:00Z is local 2026-03-25 in any zone with offset
    // < -00:30. In UTC or any zone >= UTC, the local date stays 2026-03-26.
    //
    // We compute the expected local date the same way the implementation
    // does (toLocaleDateString("en-CA")) and verify they match. This
    // catches the regression: the old code returned "2026-03-26" unconditionally
    // (via slice), so in a UTC-05:00 zone it would diverge from the local date.
    const iso = "2026-03-26T00:30:00Z";
    const expected = new Date(iso).toLocaleDateString("en-CA");
    expect(isoDatePortion(iso)).toBe(expected);
  });

  it("falls back to today for an unparseable string", () => {
    const out = isoDatePortion("not-a-date");
    const today = new Date().toLocaleDateString("en-CA");
    expect(out).toBe(today);
  });

  it("handles an ISO timestamp with offset (non-Z) and stays consistent", () => {
    const iso = "2026-03-25T19:30:00-05:00";
    // Same instant as 2026-03-26T00:30:00Z. Both should yield the same
    // local-tz date — that's the whole point of the fix.
    const a = isoDatePortion(iso);
    const b = isoDatePortion("2026-03-26T00:30:00Z");
    expect(a).toBe(b);
  });
});
