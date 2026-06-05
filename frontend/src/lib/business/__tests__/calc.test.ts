// LLC business tracker, pure calc tests. No DB, no network.

import { describe, expect, it } from "vitest";

import {
  computeSummary,
  emailArchiveMarkdown,
  formatUSD,
  nextFederalEstimate,
  nextWisconsinAnnualReport,
  upcomingDeadlines,
  type BusinessEmail,
  type EntityConfig,
  type LedgerEntry,
} from "../calc";

function entry(
  id: number,
  date: string,
  direction: "in" | "out",
  amountCents: number,
): LedgerEntry {
  return { id, date, direction, category: "", amountCents, note: "", source: "manual" };
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
      bankLabel: null,
      docsFolder: null,
      reservePct: 25,
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
