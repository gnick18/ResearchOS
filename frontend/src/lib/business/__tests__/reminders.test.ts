// LLC business tracker, reminder logic + infra-cost estimate tests.

import { describe, expect, it } from "vitest";

import { estimateMonthlyInfraCostCents } from "@/lib/sharing/capacity-shared";

import type { Deadline } from "../calc";
import { dueForReminder, reminderSubject, reminderText } from "../reminders";

function dl(daysUntil: number, label = "Wisconsin LLC annual report"): Deadline {
  return { key: "wi-annual-report", label, dueDate: "2026-09-30", daysUntil };
}

describe("dueForReminder", () => {
  it("fires only on threshold days", () => {
    const deadlines = [dl(14), dl(13), dl(7), dl(5), dl(3), dl(1), dl(0), dl(-1)];
    const due = dueForReminder(deadlines).map((d) => d.threshold);
    expect(due).toEqual([14, 7, 3, 1, 0]);
  });

  it("returns nothing when no deadline lands on a threshold", () => {
    expect(dueForReminder([dl(20), dl(10), dl(2)])).toEqual([]);
  });
});

describe("reminder copy", () => {
  it("phrases today, tomorrow, and in-N days", () => {
    expect(reminderSubject(dl(0))).toContain("due today");
    expect(reminderSubject(dl(1))).toContain("due tomorrow");
    expect(reminderSubject(dl(3))).toContain("in 3 days");
  });

  it("includes the date, the note, and the tracker pointer", () => {
    const d: Deadline = { ...dl(3), note: "Roughly $25 to the WI DFI." };
    const text = reminderText(d);
    expect(text).toContain("2026-09-30");
    expect(text).toContain("Roughly $25");
    expect(text).toContain("/admin/business");
  });
});

describe("estimateMonthlyInfraCostCents", () => {
  const GB = 1024 ** 3;

  it("charges Durable Objects and R2 only above their free tiers, plus the fixed base", () => {
    // 7 GB collab = 2 GB over the 5 GB DO free tier; 12 GB R2 = 2 GB over its
    // 10 GB free tier. Fixed base is Workers Paid + Vercel Pro = $25.
    const est = estimateMonthlyInfraCostCents(7 * GB, 12 * GB);
    expect(est.doCents).toBe(40); // 2 GB * $0.20
    expect(est.r2Cents).toBe(3); // 2 GB * $0.015 = $0.03
    expect(est.fixedBaseCents).toBe(2500);
    expect(est.totalCents).toBe(2543);
  });

  it("reads only the fixed base while usage is inside the free tiers", () => {
    // 1 GB collab and 5 GB R2 are both well within free, so storage is $0.
    const est = estimateMonthlyInfraCostCents(1 * GB, 5 * GB);
    expect(est.doCents).toBe(0);
    expect(est.r2Cents).toBe(0);
    expect(est.totalCents).toBe(2500);
  });

  it("treats a null (unavailable) measurement as zero storage", () => {
    const est = estimateMonthlyInfraCostCents(null, 12 * GB);
    expect(est.doCents).toBe(0);
    expect(est.r2Cents).toBe(3); // 2 GB over free * $0.015 = $0.03
    expect(est.totalCents).toBe(2503);
  });
});
