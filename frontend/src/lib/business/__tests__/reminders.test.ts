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

  it("prices Neon at $0.35/GB-month and R2 at $0.015/GB-month", () => {
    const est = estimateMonthlyInfraCostCents(1 * GB, 10 * GB);
    expect(est.neonCents).toBe(35); // 1 GB * $0.35
    expect(est.r2Cents).toBe(15); // 10 GB * $0.015 = $0.15
    expect(est.totalCents).toBe(50);
  });

  it("treats a null (unavailable) measurement as zero", () => {
    const est = estimateMonthlyInfraCostCents(null, 2 * GB);
    expect(est.neonCents).toBe(0);
    expect(est.r2Cents).toBe(3); // 2 GB * $0.015 = $0.03
    expect(est.totalCents).toBe(3);
  });
});
