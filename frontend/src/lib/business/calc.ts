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
  /** Dun & Bradstreet D-U-N-S number, the 9-digit business identifier. Required
   *  to enroll the Apple Developer Program and Google Play accounts under the LLC
   *  as an organization. Null until obtained. */
  duns: string | null;
  /** The LLC business phone number (the Tello prepaid line). Public, it shows on
   *  the app store listings and is the verified contact for the Apple and Google
   *  Play developer accounts. Null until set. */
  businessPhone: string | null;
  /** Apple Developer Program enrollment ID (e.g. "PTR262UUT9"), for the iOS app. */
  appleEnrollmentId: string | null;
  /** ISO date the Apple Developer Program was enrolled, anchors the $99/yr
   *  renewal deadline. Null until set. */
  appleEnrollmentDate: string | null;
  /** Google Play developer account (email and/or developer account ID). */
  googlePlayAccount: string | null;
  /** ISO date the Google Play developer account was registered. Dates the $25
   *  one-time registration fee in the ledger. Null until set. */
  googleEnrollmentDate: string | null;
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
  /**
   * The UW research award number the project originated under (the UW
   * Distinguished Research Fellowship), recorded for the IP disclosure. Internal
   * operator-console record only, never shown on any public surface. Null until set.
   */
  fundingGrantNo: string | null;
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
  /** Tax category id (see tax-categories.ts), "" when uncategorized. Drives the
   *  year-end Schedule C summary. Empty for income and old rows. */
  taxCategory: string;
  /** The payment method (business_payment_methods.id) this entry was paid with,
   *  or null if untagged. Drives the owner-fronted reimbursement total. Null on
   *  old rows entered before this column existed. */
  paidWith: number | null;
  /** "manual" for hand entry; later "infra-estimate" / "storage-payment". */
  source: string;
}

export type PaymentMethodKind = "llc" | "personal";

/**
 * A card or bank account the LLC uses. Labels and the last four digits only,
 * never the full card number, expiry, or CVV (PCI keeps those out of any store,
 * and the last four is the display-safe part printed on every receipt). `kind`
 * separates the LLC's own accounts from a personal card the owner fronted a
 * purchase on, which is what the reimbursement total keys off.
 */
export interface PaymentMethod {
  id: number;
  label: string;
  /** Last four digits only, or "" when not entered. */
  last4: string;
  kind: PaymentMethodKind;
  /** Free-text status, e.g. "Active", "Printing", "Bank", "Phasing out". */
  status: string;
  sort: number;
}

/** The ledger categories the reimbursement actions write. A capital
 *  contribution is money-in (the owner's outlay becomes equity); a reimbursement
 *  draw is money-out (the LLC pays the owner back). Both SETTLE what is owed, so
 *  computeReimbursement subtracts them, and the tax summary treats the draw as a
 *  non-deductible owner draw rather than a business expense. */
export const OWNER_CONTRIBUTION_CATEGORY = "Owner capital contribution";
export const OWNER_DRAW_CATEGORY = "Owner draw (reimbursement)";

/** True for the owner-draw / capital-contribution rows the reimbursement actions
 *  create, so callers can keep them out of expense math. */
export function isReimbursementSettlement(e: LedgerEntry): boolean {
  return (
    e.category === OWNER_CONTRIBUTION_CATEGORY ||
    e.category === OWNER_DRAW_CATEGORY
  );
}

export interface ReimbursementSummary {
  /** Total cents of money-out entries paid on a personal method. */
  frontedCents: number;
  /** Total already settled via a capital contribution or a reimbursement draw. */
  settledCents: number;
  /** What the LLC still owes the owner, floored at zero. */
  outstandingCents: number;
  /** How many money-out entries make up the fronted total. */
  count: number;
}

/**
 * Works out what the LLC owes the owner for purchases fronted on a personal
 * card. Pure. A purchase counts only when its `paidWith` maps to a method whose
 * kind is "personal". The capital-contribution and reimbursement-draw rows the
 * actions write are subtracted as already-settled, so recording a settlement
 * drops the outstanding amount to zero instead of letting a second click
 * double-count it. Income and untagged rows are ignored.
 */
export function computeReimbursement(
  entries: LedgerEntry[],
  methods: PaymentMethod[],
): ReimbursementSummary {
  const personalIds = new Set(
    methods.filter((m) => m.kind === "personal").map((m) => m.id),
  );
  let frontedCents = 0;
  let settledCents = 0;
  let count = 0;
  for (const e of entries) {
    if (isReimbursementSettlement(e)) {
      settledCents += e.amountCents;
      continue;
    }
    if (e.direction !== "out") continue;
    if (e.paidWith == null || !personalIds.has(e.paidWith)) continue;
    frontedCents += e.amountCents;
    count += 1;
  }
  const outstandingCents = Math.max(frontedCents - settledCents, 0);
  return { frontedCents, settledCents, outstandingCents, count };
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
  // Default null on purpose: the value is entered in the operator-only console
  // and persisted to the private DB, never hardcoded in this public source file.
  fundingGrantNo: null,
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
/**
 * The next Apple Developer Program renewal, the annual anniversary of the
 * enrollment date. The $99/year membership auto-renews, so this is a reminder to
 * confirm the charge or cancel before it if the iOS app is not continuing.
 */
export function nextAppleRenewal(
  enrollmentDateISO: string,
  now: Date = new Date(),
): Deadline {
  const enrolled = parseISODate(enrollmentDateISO);
  const today = startOfTodayUTC(now);
  let year = today.getUTCFullYear();
  const mkDue = (y: number) =>
    new Date(Date.UTC(y, enrolled.getUTCMonth(), enrolled.getUTCDate()));
  let due = mkDue(year);
  if (due.getTime() < today.getTime()) due = mkDue((year += 1));
  return {
    key: "apple-dev-renewal",
    label: "Apple Developer Program renewal",
    dueDate: toISODate(due),
    daysUntil: daysUntil(due, now),
    note: "$99/year, auto-renews. Cancel at least a day before if not continuing the iOS app.",
  };
}

// --- dev-account fees (auto-seeded into the ledger) ---

/** The Apple Developer Program membership, $99/year. */
export const APPLE_DEV_FEE_CENTS = 9900;
/** The Google Play developer registration, $25 one-time. */
export const GOOGLE_DEV_FEE_CENTS = 2500;
/** Ledger source tags for the auto-seeded dev-account fees. db.ts reconciles
 *  one ledger row per source, so these stay idempotent across re-saves. */
export const APPLE_DEV_FEE_SOURCE = "apple-dev-fee";
export const GOOGLE_DEV_FEE_SOURCE = "google-dev-fee";

/** One auto-seeded dev-account fee, ready to reconcile into business_ledger. */
export interface DevFeeSeed {
  source: string;
  /** ISO date "YYYY-MM-DD". */
  date: string;
  amountCents: number;
  category: string;
  note: string;
}

/**
 * The dev-account fees that should appear in the ledger for this entity config.
 * Pure. db.ts reconciles each into business_ledger idempotently by source, so a
 * fee is logged once and its date stays in sync with the enrollment date. The
 * Apple fee is dated at the enrollment date; the Google fee at its enrollment
 * date, falling back to todayISO (a one-time fee still needs a date for the
 * books). A fee is only seeded once its account / enrollment is filled in.
 */
export function devAccountFeeSeeds(
  config: EntityConfig,
  todayISO: string,
): DevFeeSeed[] {
  const out: DevFeeSeed[] = [];
  if (config.appleEnrollmentDate) {
    out.push({
      source: APPLE_DEV_FEE_SOURCE,
      date: config.appleEnrollmentDate,
      amountCents: APPLE_DEV_FEE_CENTS,
      category: "Dev accounts",
      note: "Apple Developer Program enrollment ($99/year)",
    });
  }
  if (config.googlePlayAccount) {
    out.push({
      source: GOOGLE_DEV_FEE_SOURCE,
      date: config.googleEnrollmentDate ?? todayISO,
      amountCents: GOOGLE_DEV_FEE_CENTS,
      category: "Dev accounts",
      note: "Google Play developer registration ($25 one-time)",
    });
  }
  return out;
}

export function upcomingDeadlines(
  config: EntityConfig,
  now: Date = new Date(),
): Deadline[] {
  const out: Deadline[] = [];
  if (config.formationDate) {
    out.push(nextWisconsinAnnualReport(config.formationDate, now));
  }
  if (config.appleEnrollmentDate) {
    out.push(nextAppleRenewal(config.appleEnrollmentDate, now));
  }
  out.push(nextFederalEstimate(now));
  return out.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

// --- recurring subscriptions ---

export type SubscriptionCadence = "monthly" | "yearly";

/** One recurring charge (a Claude Max seat, the Tello top-up, Apple Developer).
 *  paidWith points at a business_payment_methods.id, null when untagged. */
export interface Subscription {
  id: number;
  label: string;
  amountCents: number;
  cadence: SubscriptionCadence;
  paidWith: number | null;
  /** ISO date "YYYY-MM-DD" of the next renewal, or null. */
  nextRenewal: string | null;
  sort: number;
}

/** Total monthly burn. Monthly subs count at face value; yearly subs are
 *  amortized to a twelfth, so the number is a true blended monthly cost. */
export function monthlyBurnCents(subs: Subscription[]): number {
  let cents = 0;
  for (const s of subs) {
    cents +=
      s.cadence === "yearly" ? Math.round(s.amountCents / 12) : s.amountCents;
  }
  return cents;
}

/** Rolls an ISO renewal date forward to the next occurrence on or after today,
 *  stepping by the cadence, so a monthly sub always surfaces its upcoming charge
 *  instead of a stale past date. */
export function nextSubscriptionOccurrence(
  nextRenewalISO: string,
  cadence: SubscriptionCadence,
  now: Date = new Date(),
): string {
  const d = parseISODate(nextRenewalISO);
  const today = startOfTodayUTC(now);
  let guard = 0;
  while (d.getTime() < today.getTime() && guard < 600) {
    if (cadence === "yearly") d.setUTCFullYear(d.getUTCFullYear() + 1);
    else d.setUTCMonth(d.getUTCMonth() + 1);
    guard += 1;
  }
  return toISODate(d);
}

/** Renewal deadlines for the subscriptions that have a date, each rolled to its
 *  next occurrence, so they merge into the deadline strip and nothing lapses. */
export function subscriptionDeadlines(
  subs: Subscription[],
  now: Date = new Date(),
): Deadline[] {
  const out: Deadline[] = [];
  for (const s of subs) {
    if (!s.nextRenewal) continue;
    const due = nextSubscriptionOccurrence(s.nextRenewal, s.cadence, now);
    out.push({
      key: `sub-renewal-${s.id}`,
      label: `${s.label} renews`,
      dueDate: due,
      daysUntil: daysUntil(parseISODate(due), now),
      note: `${formatUSD(s.amountCents)} ${s.cadence}.`,
    });
  }
  return out;
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
