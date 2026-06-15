// LLC business tracker, pure calc tests. No DB, no network.

import { describe, expect, it } from "vitest";

import {
  APPLE_DEV_FEE_CENTS,
  APPLE_DEV_FEE_SOURCE,
  DEFAULT_ENTITY,
  GOOGLE_DEV_FEE_CENTS,
  GOOGLE_DEV_FEE_SOURCE,
  computeReimbursement,
  computeSummary,
  devAccountFeeSeeds,
  emailArchiveMarkdown,
  formatUSD,
  monthlyBurnCents,
  nextFederalEstimate,
  nextSubscriptionOccurrence,
  nextWisconsinAnnualReport,
  subscriptionDeadlines,
  upcomingDeadlines,
  type BusinessEmail,
  type EntityConfig,
  type LedgerEntry,
  type PaymentMethod,
  type Subscription,
} from "../calc";

function entry(
  id: number,
  date: string,
  direction: "in" | "out",
  amountCents: number,
): LedgerEntry {
  return { id, date, direction, category: "", amountCents, note: "", taxCategory: "", paidWith: null, source: "manual" };
}

describe("computeSummary", () => {
  it("sums in/out, nets, reserves only on positive net, floors safe-to-draw", () => {
    const ledger = [
      entry(1, "2026-06-01", "in", 10_000),
      entry(2, "2026-06-03", "out", 2_000),
      entry(3, "2026-05-20", "in", 5_000),
    ];
    const s = computeSummary(ledger, 25);
    expect(s.moneyInCents).toBe(15_000);
    expect(s.moneyOutCents).toBe(2_000);
    expect(s.netCents).toBe(13_000);
    expect(s.reserveCents).toBe(3_250); // 25% of 13000
    expect(s.safeToDrawCents).toBe(9_750);
  });

  it("does not reserve against a loss and never returns a negative draw", () => {
    const ledger = [
      entry(1, "2026-06-01", "in", 1_000),
      entry(2, "2026-06-02", "out", 4_000),
    ];
    const s = computeSummary(ledger, 30);
    expect(s.netCents).toBe(-3_000);
    expect(s.reserveCents).toBe(0);
    expect(s.safeToDrawCents).toBe(0);
  });

  it("groups by month, newest first", () => {
    const ledger = [
      entry(1, "2026-06-01", "in", 10_000),
      entry(2, "2026-05-01", "out", 2_000),
    ];
    const s = computeSummary(ledger, 0);
    expect(s.byMonth.map((m) => m.month)).toEqual(["2026-06", "2026-05"]);
    expect(s.byMonth[0].netCents).toBe(10_000);
    expect(s.byMonth[1].netCents).toBe(-2_000);
  });
});

describe("nextWisconsinAnnualReport", () => {
  it("maps a February formation to the Q1 end (March 31)", () => {
    const d = nextWisconsinAnnualReport("2025-02-14", new Date("2026-01-10T00:00:00Z"));
    expect(d.dueDate).toBe("2026-03-31");
  });

  it("maps an August formation to the Q3 end (September 30)", () => {
    const d = nextWisconsinAnnualReport("2024-08-20", new Date("2026-01-10T00:00:00Z"));
    expect(d.dueDate).toBe("2026-09-30");
  });

  it("rolls to next year once this year's quarter end has passed", () => {
    // Feb formation -> Q1 -> Mar 31. On Apr 1 it should point at next year.
    const d = nextWisconsinAnnualReport("2025-02-14", new Date("2026-04-01T00:00:00Z"));
    expect(d.dueDate).toBe("2027-03-31");
  });
});

describe("nextFederalEstimate", () => {
  it("returns the next nominal quarterly date", () => {
    const d = nextFederalEstimate(new Date("2026-05-01T00:00:00Z"));
    expect(d.dueDate).toBe("2026-06-15");
  });

  it("rolls to January 15 of next year after September", () => {
    const d = nextFederalEstimate(new Date("2026-10-01T00:00:00Z"));
    expect(d.dueDate).toBe("2027-01-15");
  });
});

describe("upcomingDeadlines", () => {
  it("includes the WI report only when a formation date is set, sorted by date", () => {
    const withDate: EntityConfig = {
      legalName: "x",
      state: "Wisconsin",
      entityId: null,
      formationDate: "2025-02-14",
      ein: null,
      registeredAgent: null,
      duns: null,
      businessPhone: null,
      appleEnrollmentId: null,
      appleEnrollmentDate: null,
      googlePlayAccount: null,
      googleEnrollmentDate: null,
      bankLabel: null,
      docsFolder: null,
      salesTaxStatus: "pending",
      salesTaxNote: null,
      reservePct: 30,
      fundingGrantNo: null,
    };
    const list = upcomingDeadlines(withDate, new Date("2026-05-01T00:00:00Z"));
    expect(list.map((d) => d.key)).toEqual(["fed-estimate", "wi-annual-report"]);
    // sorted ascending by date: Jun 15 before Mar 31 next... here both 2026
    expect(list[0].dueDate <= list[1].dueDate).toBe(true);

    const noDate = { ...withDate, formationDate: null };
    const list2 = upcomingDeadlines(noDate, new Date("2026-05-01T00:00:00Z"));
    expect(list2.map((d) => d.key)).toEqual(["fed-estimate"]);
  });
});

describe("devAccountFeeSeeds", () => {
  const today = "2026-06-09";

  it("seeds nothing when neither dev account is filled in", () => {
    expect(devAccountFeeSeeds(DEFAULT_ENTITY, today)).toEqual([]);
  });

  it("seeds the Apple $99 fee dated at the enrollment date", () => {
    const config: EntityConfig = {
      ...DEFAULT_ENTITY,
      appleEnrollmentDate: "2026-06-01",
    };
    const seeds = devAccountFeeSeeds(config, today);
    expect(seeds).toHaveLength(1);
    expect(seeds[0].source).toBe(APPLE_DEV_FEE_SOURCE);
    expect(seeds[0].amountCents).toBe(APPLE_DEV_FEE_CENTS);
    expect(seeds[0].date).toBe("2026-06-01");
  });

  it("seeds the Google $25 fee dated at its enrollment date when set", () => {
    const config: EntityConfig = {
      ...DEFAULT_ENTITY,
      googlePlayAccount: "gnick317@gmail.com",
      googleEnrollmentDate: "2026-06-05",
    };
    const seeds = devAccountFeeSeeds(config, today);
    expect(seeds).toHaveLength(1);
    expect(seeds[0].source).toBe(GOOGLE_DEV_FEE_SOURCE);
    expect(seeds[0].amountCents).toBe(GOOGLE_DEV_FEE_CENTS);
    expect(seeds[0].date).toBe("2026-06-05");
  });

  it("falls back to today for the Google fee when no registration date is set", () => {
    const config: EntityConfig = {
      ...DEFAULT_ENTITY,
      googlePlayAccount: "gnick317@gmail.com",
    };
    const seeds = devAccountFeeSeeds(config, today);
    expect(seeds[0].date).toBe(today);
  });

  it("seeds both fees when both accounts are filled in", () => {
    const config: EntityConfig = {
      ...DEFAULT_ENTITY,
      appleEnrollmentDate: "2026-06-01",
      googlePlayAccount: "gnick317@gmail.com",
      googleEnrollmentDate: "2026-06-05",
    };
    const seeds = devAccountFeeSeeds(config, today);
    expect(seeds.map((s) => s.source)).toEqual([
      APPLE_DEV_FEE_SOURCE,
      GOOGLE_DEV_FEE_SOURCE,
    ]);
  });
});

describe("emailArchiveMarkdown", () => {
  const emails: BusinessEmail[] = [
    {
      id: 2,
      kind: "deadline-reminder",
      toEmail: "grant@example.com",
      subject: "Reminder: WI annual report due in 3 days",
      body: "It is due on 2026-09-30.",
      sentAt: "2026-09-27T13:00:00.000Z",
    },
  ];

  it("renders a titled record with the count, recipient, subject, and body", () => {
    const md = emailArchiveMarkdown(emails, "ResearchOS LLC");
    expect(md).toContain("# ResearchOS LLC email records");
    expect(md).toContain("1 record");
    expect(md).toContain("grant@example.com");
    expect(md).toContain("Reminder: WI annual report due in 3 days");
    expect(md).toContain("It is due on 2026-09-30.");
  });

  it("falls back to a default name and pluralizes", () => {
    const md = emailArchiveMarkdown([], "");
    expect(md).toContain("# ResearchOS LLC email records");
    expect(md).toContain("0 records");
  });
});

describe("formatUSD", () => {
  it("formats cents as USD with a sign for negatives", () => {
    expect(formatUSD(123_456)).toBe("$1,234.56");
    expect(formatUSD(0)).toBe("$0.00");
    expect(formatUSD(-5_00)).toBe("-$5.00");
  });
});

describe("computeReimbursement", () => {
  const methods: PaymentMethod[] = [
    { id: 1, label: "Mercury credit", last4: "6744", kind: "llc", status: "Active", sort: 0 },
    { id: 9, label: "Personal Amex", last4: "", kind: "personal", status: "Phasing out", sort: 1 },
  ];

  function paid(
    id: number,
    direction: "in" | "out",
    amountCents: number,
    paidWith: number | null,
  ): LedgerEntry {
    return {
      id,
      date: "2026-06-10",
      direction,
      category: "",
      amountCents,
      note: "",
      taxCategory: "",
      paidWith,
      source: "manual",
    };
  }

  function settlement(
    id: number,
    direction: "in" | "out",
    amountCents: number,
    category: string,
  ): LedgerEntry {
    return {
      id,
      date: "2026-06-10",
      direction,
      category,
      amountCents,
      note: "",
      taxCategory: "",
      paidWith: null,
      source: "manual",
    };
  }

  it("sums only money-out entries tagged to a personal method", () => {
    const ledger = [
      paid(1, "out", 2_468, 9), // Amex (personal) -> counts
      paid(2, "out", 2_500, 9), // Amex (personal) -> counts
      paid(3, "out", 20_000, 1), // Mercury (llc) -> ignored
      paid(4, "out", 5_000, null), // untagged -> ignored
      paid(5, "in", 10_000, 9), // income on Amex -> ignored
    ];
    const r = computeReimbursement(ledger, methods);
    expect(r.frontedCents).toBe(4_968);
    expect(r.outstandingCents).toBe(4_968);
    expect(r.count).toBe(2);
  });

  it("subtracts a recorded capital contribution so it does not double-count", () => {
    const ledger = [
      paid(1, "out", 4_968, 9),
      settlement(2, "in", 4_968, "Owner capital contribution"),
    ];
    const r = computeReimbursement(ledger, methods);
    expect(r.frontedCents).toBe(4_968);
    expect(r.settledCents).toBe(4_968);
    expect(r.outstandingCents).toBe(0);
  });

  it("is zero when nothing is tagged personal", () => {
    const r = computeReimbursement([paid(1, "out", 999, 1)], methods);
    expect(r).toEqual({ frontedCents: 0, settledCents: 0, outstandingCents: 0, count: 0 });
  });
});

describe("subscriptions", () => {
  function sub(
    id: number,
    label: string,
    amountCents: number,
    cadence: "monthly" | "yearly",
    nextRenewal: string | null = null,
  ): Subscription {
    return { id, label, amountCents, cadence, paidWith: null, nextRenewal, sort: 0 };
  }

  it("blends monthly burn, amortizing yearly subs to a twelfth", () => {
    const subs = [
      sub(1, "Max1", 20_000, "monthly"),
      sub(2, "Max2", 20_000, "monthly"),
      sub(3, "Apple", 9_900, "yearly"), // 9900 / 12 = 825
    ];
    expect(monthlyBurnCents(subs)).toBe(40_825);
    expect(monthlyBurnCents([])).toBe(0);
  });

  it("rolls a renewal forward to the next occurrence on or after today", () => {
    const now = new Date("2026-06-10T00:00:00Z");
    expect(nextSubscriptionOccurrence("2026-01-15", "monthly", now)).toBe("2026-06-15");
    expect(nextSubscriptionOccurrence("2026-08-01", "monthly", now)).toBe("2026-08-01");
    expect(nextSubscriptionOccurrence("2025-09-01", "yearly", now)).toBe("2026-09-01");
  });

  it("makes deadlines only for subs with a date, rolled forward", () => {
    const now = new Date("2026-06-10T00:00:00Z");
    const dls = subscriptionDeadlines(
      [sub(7, "Tello", 800, "monthly", "2026-06-12"), sub(8, "NoDate", 500, "monthly", null)],
      now,
    );
    expect(dls).toHaveLength(1);
    expect(dls[0].key).toBe("sub-renewal-7");
    expect(dls[0].dueDate).toBe("2026-06-12");
    expect(dls[0].daysUntil).toBe(2);
  });
});
