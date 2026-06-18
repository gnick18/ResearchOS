// Unit tests for the calendar range helpers that guard against an inverted
// date range (end before start). An inverted range used to save silently and
// then render the event on zero days, making it unclickable and looking like
// data loss. These cover the form guard (validateEventRange), the render-path
// clamp (effectiveEndDate), and day-coverage (eventCoversDate).

import { describe, expect, it } from "vitest";
import {
  effectiveEndDate,
  eventCoversDate,
  validateEventRange,
} from "../utils";

describe("validateEventRange", () => {
  it("rejects an end date before the start date", () => {
    const r = validateEventRange({
      startDate: "2026-06-19",
      endDate: "2026-06-13",
      startTime: "",
      endTime: "",
    });
    expect(r.endDateInvalid).toBe(true);
    expect(r.endTimeInvalid).toBe(false);
  });

  it("accepts an end date on or after the start date", () => {
    expect(
      validateEventRange({
        startDate: "2026-06-19",
        endDate: "2026-06-21",
        startTime: "",
        endTime: "",
      }).endDateInvalid,
    ).toBe(false);
    // Same day is valid.
    expect(
      validateEventRange({
        startDate: "2026-06-19",
        endDate: "2026-06-19",
        startTime: "",
        endTime: "",
      }).endDateInvalid,
    ).toBe(false);
  });

  it("accepts an overnight event: later end date with an earlier wall-clock time", () => {
    // Start Mon 14:00, end Tue 13:00. The clock time is earlier than the
    // start, but the later date makes it a legitimate overnight event.
    const r = validateEventRange({
      startDate: "2026-06-15",
      endDate: "2026-06-16",
      startTime: "14:00",
      endTime: "13:00",
    });
    expect(r.endDateInvalid).toBe(false);
    expect(r.endTimeInvalid).toBe(false);
  });

  it("rejects an end time before the start time on the same day", () => {
    const r = validateEventRange({
      startDate: "2026-06-15",
      endDate: "2026-06-15",
      startTime: "14:00",
      endTime: "13:00",
    });
    expect(r.endTimeInvalid).toBe(true);
  });

  it("rejects a same-day time inversion when no end date is set", () => {
    const r = validateEventRange({
      startDate: "2026-06-15",
      endDate: "",
      startTime: "14:00",
      endTime: "13:00",
    });
    expect(r.endTimeInvalid).toBe(true);
  });

  it("accepts an ordered same-day time range", () => {
    const r = validateEventRange({
      startDate: "2026-06-15",
      endDate: "2026-06-15",
      startTime: "09:00",
      endTime: "17:00",
    });
    expect(r.endDateInvalid).toBe(false);
    expect(r.endTimeInvalid).toBe(false);
  });
});

describe("effectiveEndDate", () => {
  it("returns the end date for a normal range", () => {
    expect(
      effectiveEndDate({ start_date: "2026-06-15", end_date: "2026-06-17" }),
    ).toBe("2026-06-17");
  });

  it("falls back to the start date when end is null", () => {
    expect(
      effectiveEndDate({ start_date: "2026-06-15", end_date: null }),
    ).toBe("2026-06-15");
  });

  it("clamps an inverted range to the start date", () => {
    expect(
      effectiveEndDate({ start_date: "2026-06-19", end_date: "2026-06-13" }),
    ).toBe("2026-06-19");
  });
});

describe("eventCoversDate", () => {
  it("covers the start day for an inverted range (never zero days)", () => {
    const inverted = { start_date: "2026-06-19", end_date: "2026-06-13" };
    // The start day is still covered so the event stays clickable...
    expect(eventCoversDate(inverted, "2026-06-19")).toBe(true);
    // ...and no day inside the bogus reversed span is rendered.
    expect(eventCoversDate(inverted, "2026-06-15")).toBe(false);
    expect(eventCoversDate(inverted, "2026-06-13")).toBe(false);
  });

  it("covers every day of a normal multi-day range", () => {
    const ev = { start_date: "2026-06-15", end_date: "2026-06-17" };
    expect(eventCoversDate(ev, "2026-06-15")).toBe(true);
    expect(eventCoversDate(ev, "2026-06-16")).toBe(true);
    expect(eventCoversDate(ev, "2026-06-17")).toBe(true);
    expect(eventCoversDate(ev, "2026-06-18")).toBe(false);
  });
});
