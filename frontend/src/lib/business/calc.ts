// LLC business tracker, pure calculation + types (NO server imports).
//
// Split out from the Neon persistence (db.ts) so the client component and the
// unit tests can import the math and the deadline logic without dragging the
// database driver into the browser bundle, the same split capacity-shared.ts
// uses. Everything here is a pure function of its inputs.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

/** The singleton entity-facts record for the LLC. */
export interface EntityConfig {
  legalName: string;
  state: string;
  /** The state entity / filing ID (Wisconsin DFI), e.g. "R098462". */
  entityId: string | null;
  /** ISO date, "YYYY-MM-DD", or null if not entered yet. */
  formationDate: string | null;
  ein: string | null;
  registeredAgent: string | null;
  /** A label for the business bank account, never the account number. */
  bankLabel: string | null;
  /** Where the actual filed documents live on disk (the ResearchOS_LLC folder). */
  docsFolder: string | null;
  /**
   * Whether metered cloud storage is taxable in Wisconsin. "pending" until the
   * WI DOR replies to the filed inquiry. This is a HARD GATE, no real customer
   * is billed while it is "pending". "taxable" means register before charging,
   * "exempt" means clear to charge.
   */
  salesTaxStatus: SalesTaxStatus;
  /** Free-text note on the sales-tax determination (the DOR filing, the reply). */
  salesTaxNote: string | null;
  /** Tax reserve percentage, 0..100. A placeholder until confirmed. */
  reservePct: number;
}

export type SalesTaxStatus = "pending" | "taxable" | "exempt";

/** One setup / compliance action item. */
export interface BusinessTask {
  id: number;
  label: string;
  done: boolean;
  /** ISO timestamp when marked done, or null. */
  doneAt: string | null;
}

/**
 * An archived copy of a business email the site sent (deadline reminders now,
 * payment receipts later). Business correspondence only, never OTP codes or
 * share invites. Kept as an LLC record and exportable to the document folder.
 */
export interface BusinessEmail {
  id: number;
  kind: string;
  toEmail: string;
  subject: string;
  body: string;
  /** ISO timestamp when sent. */
  sentAt: string;
}

/** Serializes the email archive into a single Markdown record for the folder. */
export function emailArchiveMarkdown(
  emails: BusinessEmail[],
  entityName: string,
): string {
  const head = [
    `# ${entityName || "ResearchOS LLC"} email records`,
    "",
    `Business correspondence the site sent. ${emails.length} record${emails.length === 1 ? "" : "s"}, newest first.`,
    "Generated from the business tracker. Save into the LLC document folder.",
    "",
  ];
  const blocks = emails.map((e) =>
    [
      `## ${e.sentAt} - ${e.subject}`,
      "",
      `- Kind: ${e.kind}`,
      `- To: ${e.toEmail}`,
      "",
      e.body,
      "",
      "---",
      "",
    ].join("\n"),
  );
  return head.concat(blocks).join("\n");
}

export type LedgerDirection = "in" | "out";

/** One money-in or money-out entry. amountCents is a positive integer. */
export interface LedgerEntry {
  id: number;
  /** ISO date, "YYYY-MM-DD". */
  date: string;
  direction: LedgerDirection;
  category: string;
  amountCents: number;
  note: string;
  /** "manual" for hand entry; later "infra-estimate" / "storage-payment". */
  source: string;
}

export interface MonthTotals {
  /** "YYYY-MM". */
  month: string;
  inCents: number;
  outCents: number;
  netCents: number;
}

export interface BusinessSummary {
  moneyInCents: number;
  moneyOutCents: number;
  netCents: number;
  /** Held back for taxes, only on positive net. */
  reserveCents: number;
  /** Net minus reserve, floored at zero. What is safe to draw. */
  safeToDrawCents: number;
  /** Newest month first. */
  byMonth: MonthTotals[];
}

export interface Deadline {
  key: string;
  label: string;
  /** ISO date, "YYYY-MM-DD". */
  dueDate: string;
  /** Whole days from today (UTC). Negative if already past. */
  daysUntil: number;
  note?: string;
}

export const DEFAULT_ENTITY: EntityConfig = {
  legalName: "",
  state: "Wisconsin",
  entityId: null,
  formationDate: null,
  ein: null,
  registeredAgent: null,
  bankLabel: null,
  docsFolder: null,
  salesTaxStatus: "pending",
  salesTaxNote: null,
  reservePct: 30,
};

// --- date helpers, all in UTC so a timezone never shifts a due date ---

function parseISODate(iso: string | Date): Date {
  // The Postgres `date` column can arrive as a JS Date (Neon driver) rather than
  // an ISO string, so accept both rather than assuming `.split` exists.
  if (iso instanceof Date) {
    return new Date(
      Date.UTC(iso.getUTCFullYear(), iso.getUTCMonth(), iso.getUTCDate()),
    );
  }
  const [y, m, d] = String(iso).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Last calendar day of the given month (monthIndex 0..11) in the given year. */
function lastDayOfMonthUTC(year: number, monthIndex: number): Date {
  // Day 0 of the next month is the last day of this month.
  return new Date(Date.UTC(year, monthIndex + 1, 0));
}

function startOfTodayUTC(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

function daysUntil(due: Date, now: Date): number {
  const today = startOfTodayUTC(now);
  return Math.round((due.getTime() - today.getTime()) / 86_400_000);
}

// --- summary ---

/**
 * Rolls the ledger into totals and the tax reserve. Reserve applies only to a
 * positive net (you do not reserve against a loss), and safe-to-draw is what is
 * left after the reserve, never negative.
 */
export function computeSummary(
  entries: LedgerEntry[],
  reservePct: number,
): BusinessSummary {
  let moneyInCents = 0;
  let moneyOutCents = 0;
  const months = new Map<string, MonthTotals>();
  for (const e of entries) {
    if (e.direction === "in") moneyInCents += e.amountCents;
    else moneyOutCents += e.amountCents;
    const key = e.date.slice(0, 7);
    const m = months.get(key) ?? { month: key, inCents: 0, outCents: 0, netCents: 0 };
    if (e.direction === "in") m.inCents += e.amountCents;
    else m.outCents += e.amountCents;
    m.netCents = m.inCents - m.outCents;
    months.set(key, m);
  }
  const netCents = moneyInCents - moneyOutCents;
  const pct = Math.min(Math.max(reservePct, 0), 100);
  const reserveCents = netCents > 0 ? Math.round((netCents * pct) / 100) : 0;
  const safeToDrawCents = Math.max(netCents - reserveCents, 0);
  const byMonth = [...months.values()].sort((a, b) => b.month.localeCompare(a.month));
  return { moneyInCents, moneyOutCents, netCents, reserveCents, safeToDrawCents, byMonth };
}

// --- deadlines ---

/**
 * The next Wisconsin LLC annual report due date. For a domestic LLC the report
 * is due the last day of the calendar quarter that contains the formation
 * anniversary (March 31, June 30, September 30, or December 31). This returns
 * the next such date on or after today. The very first report's timing can
 * differ, so verify against the WI DFI for the first filing.
 */
export function nextWisconsinAnnualReport(
  formationDateISO: string,
  now: Date = new Date(),
): Deadline {
  const formation = parseISODate(formationDateISO);
  const quarter = Math.floor(formation.getUTCMonth() / 3); // 0..3
  const quarterEndMonth = quarter * 3 + 2; // 2, 5, 8, 11
  const today = startOfTodayUTC(now);
  let year = today.getUTCFullYear();
  let due = lastDayOfMonthUTC(year, quarterEndMonth);
  if (due.getTime() < today.getTime()) {
    year += 1;
    due = lastDayOfMonthUTC(year, quarterEndMonth);
  }
  return {
    key: "wi-annual-report",
    label: "Wisconsin LLC annual report",
    dueDate: toISODate(due),
    daysUntil: daysUntil(due, now),
    note: "Roughly $25 online to the WI DFI. Verify the current fee and the first-filing rule.",
  };
}

/**
 * The next federal quarterly estimated-tax date. The nominal dates are about
 * April 15, June 15, September 15, and January 15 of the following year. These
 * shift for weekends and holidays, and a single-member LLC may or may not owe
 * estimates, so this is a reminder to check, not tax advice.
 */
export function nextFederalEstimate(now: Date = new Date()): Deadline {
  const today = startOfTodayUTC(now);
  const y = today.getUTCFullYear();
  const candidates = [
    [y, 0, 15],
    [y, 3, 15],
    [y, 5, 15],
    [y, 8, 15],
    [y + 1, 0, 15],
  ].map(([yy, mm, dd]) => new Date(Date.UTC(yy, mm, dd)));
  const next =
    candidates.find((d) => d.getTime() >= today.getTime()) ??
    candidates[candidates.length - 1];
  return {
    key: "fed-estimate",
    label: "Federal quarterly estimated tax",
    dueDate: toISODate(next),
    daysUntil: daysUntil(next, now),
    note: "Approximate date; shifts for weekends and holidays. Confirm whether estimates are required.",
  };
}

/** Target date for the Vercel Open Source Program application (Summer 2026
 *  cohort). The Spring cohort closed 2026-06-03 and the program runs quarterly,
 *  so this is an estimate with buffer. Confirm the real open and close dates at
 *  vercel.link/oss-apply. */
export const VERCEL_OSS_APPLICATION_TARGET = "2026-08-15";

/** One-time reminder to apply to the Vercel Open Source Program. Returns null
 *  once it is more than two weeks past the target, so it drops off the strip
 *  instead of lingering as permanently overdue. */
export function vercelOssApplicationDeadline(now: Date = new Date()): Deadline | null {
  const due = new Date(`${VERCEL_OSS_APPLICATION_TARGET}T00:00:00Z`);
  const d = daysUntil(due, now);
  if (d < -14) return null;
  return {
    key: "vercel-oss-application",
    label: "Apply to the Vercel Open Source Program (Summer cohort)",
    dueDate: VERCEL_OSS_APPLICATION_TARGET,
    daysUntil: d,
    note: "Spring cohort closed 2026-06-03; the program runs quarterly, so this date is an estimate. Confirm the Summer open and close dates at vercel.link/oss-apply and apply before the deadline. Draft answers are in docs/proposals/VERCEL_OSS_PROGRAM_APPLICATION.md.",
  };
}

/** The upcoming deadlines, soonest first. WI report only if a formation date is set. */
export function upcomingDeadlines(
  config: EntityConfig,
  now: Date = new Date(),
): Deadline[] {
  const out: Deadline[] = [];
  if (config.formationDate) {
    out.push(nextWisconsinAnnualReport(config.formationDate, now));
  }
  out.push(nextFederalEstimate(now));
  return out.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

/** "$1,234.56" from a cents integer. Negative renders with a leading minus. */
export function formatUSD(cents: number): string {
  const neg = cents < 0;
  const dollars = Math.abs(cents) / 100;
  const s = dollars.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
  return neg ? `-${s}` : s;
}
