// LLC business tracker, persistence on Neon.
//
// Operator-only. Two tables, a singleton entity-facts row and an append-only
// ledger of money-in / money-out entries. Everything derived (totals, reserve,
// safe-to-draw, deadlines) is computed from these in calc.ts, never stored, the
// same one-source-of-truth pattern the transparency report uses.
//
// The Neon HTTP driver is created lazily from DATABASE_URL inside a singleton,
// so importing this module during build or tsc never needs the connection
// string. Schema creation is idempotent and called at the start of the route.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

import {
  DEFAULT_ENTITY,
  devAccountFeeSeeds,
  GOOGLE_DEV_FEE_CENTS,
  GOOGLE_DEV_FEE_SOURCE,
  type BusinessEmail,
  type BusinessTask,
  type EntityConfig,
  type LedgerDirection,
  type LedgerEntry,
  type PaymentMethod,
  type PaymentMethodKind,
  type Subscription,
  type SubscriptionCadence,
} from "./calc";

let sqlSingleton: NeonQueryFunction<false, false> | null = null;

function getSql(): NeonQueryFunction<false, false> {
  if (sqlSingleton) return sqlSingleton;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. The business tracker cannot reach Neon without it.",
    );
  }
  sqlSingleton = neon(url);
  return sqlSingleton;
}

/**
 * Creates the two business tables if they do not exist. Idempotent. The entity
 * table is pinned to a single row (id = 1) by a check constraint, so there is
 * always exactly one entity-facts record.
 */
export async function ensureBusinessSchema(): Promise<void> {
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS business_entity (
      id int primary key default 1,
      legal_name text default '',
      state text default 'Wisconsin',
      entity_id text,
      formation_date date,
      ein text,
      registered_agent text,
      bank_label text,
      docs_folder text,
      sales_tax_status text not null default 'pending',
      sales_tax_note text,
      reserve_pct numeric not null default 30,
      updated_at timestamptz default now(),
      CONSTRAINT business_entity_singleton CHECK (id = 1)
    )
  `;
  // Additive columns for a business_entity table created by an earlier version.
  // ADD COLUMN IF NOT EXISTS is idempotent. This MUST cover every column getEntity
  // reads, otherwise a table that predates a column makes the SELECT fail with
  // "column does not exist" and the whole /admin/business read 500s. Complete the
  // set so the schema self-heals regardless of which version created the table.
  await sql`ALTER TABLE business_entity ADD COLUMN IF NOT EXISTS legal_name text DEFAULT ''`;
  await sql`ALTER TABLE business_entity ADD COLUMN IF NOT EXISTS state text DEFAULT 'Wisconsin'`;
  await sql`ALTER TABLE business_entity ADD COLUMN IF NOT EXISTS entity_id text`;
  await sql`ALTER TABLE business_entity ADD COLUMN IF NOT EXISTS formation_date date`;
  await sql`ALTER TABLE business_entity ADD COLUMN IF NOT EXISTS ein text`;
  await sql`ALTER TABLE business_entity ADD COLUMN IF NOT EXISTS registered_agent text`;
  await sql`ALTER TABLE business_entity ADD COLUMN IF NOT EXISTS duns text`;
  await sql`ALTER TABLE business_entity ADD COLUMN IF NOT EXISTS business_phone text`;
  await sql`ALTER TABLE business_entity ADD COLUMN IF NOT EXISTS apple_enrollment_id text`;
  await sql`ALTER TABLE business_entity ADD COLUMN IF NOT EXISTS apple_enrollment_date date`;
  await sql`ALTER TABLE business_entity ADD COLUMN IF NOT EXISTS google_play_account text`;
  await sql`ALTER TABLE business_entity ADD COLUMN IF NOT EXISTS google_enrollment_date date`;
  await sql`ALTER TABLE business_entity ADD COLUMN IF NOT EXISTS bank_label text`;
  await sql`ALTER TABLE business_entity ADD COLUMN IF NOT EXISTS docs_folder text`;
  await sql`ALTER TABLE business_entity ADD COLUMN IF NOT EXISTS sales_tax_status text`;
  await sql`ALTER TABLE business_entity ADD COLUMN IF NOT EXISTS sales_tax_note text`;
  await sql`ALTER TABLE business_entity ADD COLUMN IF NOT EXISTS reserve_pct numeric NOT NULL DEFAULT 30`;
  await sql`ALTER TABLE business_entity ADD COLUMN IF NOT EXISTS funding_grant_no text`;
  await sql`ALTER TABLE business_entity ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now()`;
  await sql`
    CREATE TABLE IF NOT EXISTS business_ledger (
      id bigserial primary key,
      entry_date date not null,
      direction text not null,
      category text default '',
      amount_cents bigint not null,
      note text default '',
      source text not null default 'manual',
      created_at timestamptz default now()
    )
  `;
  await sql`ALTER TABLE business_ledger ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual'`;
  await sql`ALTER TABLE business_ledger ADD COLUMN IF NOT EXISTS tax_category text NOT NULL DEFAULT ''`;
  // The payment method a ledger entry was paid with (business_payment_methods.id),
  // nullable so every old row and every income row stays untagged. No FK on
  // purpose, the table is loosely coupled the same way the rest of the schema is,
  // and a deleted card must not cascade-delete its history.
  await sql`ALTER TABLE business_ledger ADD COLUMN IF NOT EXISTS paid_with bigint`;
  await sql`
    CREATE TABLE IF NOT EXISTS business_tasks (
      id bigserial primary key,
      label text not null,
      done boolean not null default false,
      sort int not null default 0,
      created_at timestamptz default now(),
      done_at timestamptz
    )
  `;
  await sql`ALTER TABLE business_tasks ADD COLUMN IF NOT EXISTS sort int NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE business_tasks ADD COLUMN IF NOT EXISTS done_at timestamptz`;
  await sql`
    CREATE TABLE IF NOT EXISTS business_emails (
      id bigserial primary key,
      kind text not null,
      to_email text not null,
      subject text not null default '',
      body text not null default '',
      sent_at timestamptz default now()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS business_payment_methods (
      id bigserial primary key,
      label text not null default '',
      last4 text not null default '',
      kind text not null default 'llc',
      status text not null default '',
      sort int not null default 0,
      created_at timestamptz default now()
    )
  `;
  await sql`ALTER TABLE business_payment_methods ADD COLUMN IF NOT EXISTS last4 text NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE business_payment_methods ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'llc'`;
  await sql`ALTER TABLE business_payment_methods ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE business_payment_methods ADD COLUMN IF NOT EXISTS sort int NOT NULL DEFAULT 0`;
  await sql`
    CREATE TABLE IF NOT EXISTS business_subscriptions (
      id bigserial primary key,
      label text not null default '',
      amount_cents bigint not null default 0,
      cadence text not null default 'monthly',
      paid_with bigint,
      next_renewal date,
      sort int not null default 0,
      created_at timestamptz default now()
    )
  `;
  await sql`ALTER TABLE business_subscriptions ADD COLUMN IF NOT EXISTS cadence text NOT NULL DEFAULT 'monthly'`;
  await sql`ALTER TABLE business_subscriptions ADD COLUMN IF NOT EXISTS paid_with bigint`;
  await sql`ALTER TABLE business_subscriptions ADD COLUMN IF NOT EXISTS next_renewal date`;
  await sql`ALTER TABLE business_subscriptions ADD COLUMN IF NOT EXISTS sort int NOT NULL DEFAULT 0`;
  await seedDefaultsOnce(sql);
  await seedKnownExpensesOnce();
  await seedPaymentMethodsOnce(sql);
}

// The known facts (from the filed Articles, entity ID R098462, and the
// ResearchOS_LLC document folder the other agent organized) plus the open
// action items from that folder's README. Seeded ONCE, the first time the
// entity row is created, so re-running the schema never overwrites edits and
// deleting tasks never re-seeds them.
// Only PUBLIC-record facts are seeded here (entity ID, formation date, agent
// are all public in the WI DFI registry; the D-U-N-S is a public business
// identifier, printed on credit reports and handed to vendors, so it is seeded
// too, Grant's call 2026-06-10). Sensitive values like the EIN and bank details
// are NOT hardcoded, this file is in the open-source repo. Enter those in the
// /admin/business entity card; they live only in the private Neon DB, never in
// source.
const SEED_ENTITY = {
  legalName: "ResearchOS LLC",
  state: "Wisconsin",
  entityId: "R098462",
  formationDate: "2026-06-01",
  ein: null as string | null,
  registeredAgent: "Grant R. Nickles (self; WI Form 13 filed, Northwest cancelled)",
  duns: "145038194",
  businessPhone: "+1 (608) 895-6655",
  bankLabel: null as string | null,
  docsFolder: "~/Documents/ResearchOS_LLC/",
  salesTaxStatus: "pending",
  salesTaxNote:
    "WI DOR sales-tax question UNCONFIRMED. A 2026-06-10 search of all three mailboxes (gnick317, wisc.edu, researchos.llc) found no sent email, no confirmation, and no reply, so it is unclear the 2026-06-05 inquiry ever went through. Re-file via the WI DOR portal from researchos.llc and SAVE the confirmation. Do not bill a real customer until a real determination lands.",
  reservePct: 30,
};

// The open items as of 2026-06-05. Formation, EIN, operating agreement, the
// registered-agent change, Mercury, and the Stripe account are done, so they
// are not seeded as open tasks.
const SEED_TASKS = [
  "HARD GATE: re-file the WI DOR sales-tax question via the portal from researchos.llc + SAVE the confirmation (the 2026-06-05 filing left no trace in any mailbox); do not bill a real customer until a determination lands",
  "On the DOR reply, set the sales-tax status below and register with WI if taxable",
  "At go-live, put the live Stripe keys + hosted webhook + live price in Vercel Production and flip BILLING_ENABLED",
];

async function seedDefaultsOnce(
  sql: NeonQueryFunction<false, false>,
): Promise<void> {
  const existing = (await sql`SELECT 1 FROM business_entity WHERE id = 1`) as unknown[];
  if (existing.length > 0) {
    // The row predates some known facts (it was seeded by an earlier version or
    // started blank). Backfill ONLY the stable identifiers that are still blank,
    // using COALESCE / a blank check, so nothing entered in the UI is ever
    // overwritten. The mutable fields (agent, bank, reserve, tasks) are left
    // exactly as they are.
    await sql`
      UPDATE business_entity SET
        legal_name = CASE WHEN legal_name IS NULL OR legal_name = ''
                          THEN ${SEED_ENTITY.legalName} ELSE legal_name END,
        entity_id = COALESCE(entity_id, ${SEED_ENTITY.entityId}),
        ein = COALESCE(ein, ${SEED_ENTITY.ein}),
        duns = COALESCE(duns, ${SEED_ENTITY.duns}),
        business_phone = COALESCE(business_phone, ${SEED_ENTITY.businessPhone}),
        formation_date = COALESCE(formation_date, ${SEED_ENTITY.formationDate}::date),
        sales_tax_status = COALESCE(sales_tax_status, ${SEED_ENTITY.salesTaxStatus})
      WHERE id = 1
    `;
    return;
  }
  await sql`
    INSERT INTO business_entity
      (id, legal_name, state, entity_id, formation_date, ein, registered_agent,
       duns, business_phone, bank_label, docs_folder, sales_tax_status, sales_tax_note, reserve_pct)
    VALUES
      (1, ${SEED_ENTITY.legalName}, ${SEED_ENTITY.state}, ${SEED_ENTITY.entityId},
       ${SEED_ENTITY.formationDate}, ${SEED_ENTITY.ein}, ${SEED_ENTITY.registeredAgent},
       ${SEED_ENTITY.duns}, ${SEED_ENTITY.businessPhone}, ${SEED_ENTITY.bankLabel}, ${SEED_ENTITY.docsFolder}, ${SEED_ENTITY.salesTaxStatus},
       ${SEED_ENTITY.salesTaxNote}, ${SEED_ENTITY.reservePct})
    ON CONFLICT (id) DO NOTHING
  `;
  for (let i = 0; i < SEED_TASKS.length; i += 1) {
    await sql`INSERT INTO business_tasks (label, sort) VALUES (${SEED_TASKS[i]}, ${i})`;
  }
}

// Known one-time / launch expenses that should always appear in the ledger,
// seeded idempotently by source so a re-run or a page reload never duplicates
// them. The Tello eSIM is the LLC prepaid mobile line bought 2026-06-10 for the
// app-store developer accounts (Google Play and Apple both require a real,
// verifiable mobile number, and VoIP numbers are rejected); amountCents is the
// actual charged total including tax. The Google Play $25 registration is logged
// here too (org account created 2026-06-10) under the shared GOOGLE_DEV_FEE_SOURCE
// tag, so it dedupes with the entity-card reconcile path and never double-logs
// when the Google Play account field is later filled in. Deleting a row and
// reloading re-seeds it, by design, the same as the auto-seeded dev-account fees.
const KNOWN_EXPENSE_SEEDS: NewLedgerEntry[] = [
  {
    date: "2026-06-10",
    direction: "out",
    category: "Dev accounts",
    amountCents: 2468,
    note: "Tello prepaid eSIM, the LLC business phone line for the Google Play and Apple developer accounts (Pay As You Go, no monthly fee)",
    taxCategory: "office",
    source: "tello-esim-2026-06-10",
  },
  {
    date: "2026-06-10",
    direction: "out",
    category: "Dev accounts",
    amountCents: GOOGLE_DEV_FEE_CENTS,
    note: "Google Play developer registration, the LLC organization account ($25 one-time)",
    taxCategory: "fees_licenses",
    source: GOOGLE_DEV_FEE_SOURCE,
  },
];

async function seedKnownExpensesOnce(): Promise<void> {
  for (const entry of KNOWN_EXPENSE_SEEDS) {
    await addLedgerEntryBySource(entry);
  }
}

// The LLC's known cards and accounts. Seeded ONCE, only when the table is empty,
// so a re-run never overwrites an edit and deleting a card never re-seeds it.
// Only the last FOUR digits are stored, the display-safe part PCI permits on
// receipts and screens; the full card number, expiry, and CVV are never put in
// source or the database. The Mercury last-four already live in the committed
// business-page mockup, so seeding them adds nothing new. The personal Amex is
// seeded WITHOUT its last four (enter it in the UI), keeping the owner's personal
// card digits out of the open-source repo entirely.
const SEED_PAYMENT_METHODS: Array<Omit<PaymentMethod, "id">> = [
  { label: "Mercury Mastercard credit", last4: "6744", kind: "llc", status: "Active", sort: 0 },
  { label: "Mercury card", last4: "2696", kind: "llc", status: "Printing", sort: 1 },
  { label: "Mercury Checking", last4: "9490", kind: "llc", status: "Bank", sort: 2 },
  { label: "Mercury Savings", last4: "7540", kind: "llc", status: "Bank", sort: 3 },
  { label: "Personal Amex", last4: "", kind: "personal", status: "Phasing out", sort: 4 },
];

async function seedPaymentMethodsOnce(
  sql: NeonQueryFunction<false, false>,
): Promise<void> {
  const existing = (await sql`
    SELECT 1 FROM business_payment_methods LIMIT 1
  `) as unknown[];
  if (existing.length > 0) return;
  for (const m of SEED_PAYMENT_METHODS) {
    await sql`
      INSERT INTO business_payment_methods (label, last4, kind, status, sort)
      VALUES (${m.label}, ${m.last4}, ${m.kind}, ${m.status}, ${m.sort})
    `;
  }
}

type EntityRow = {
  legal_name: string | null;
  state: string | null;
  entity_id: string | null;
  formation_date: string | null;
  ein: string | null;
  registered_agent: string | null;
  duns: string | null;
  business_phone: string | null;
  apple_enrollment_id: string | null;
  apple_enrollment_date: string | null;
  google_play_account: string | null;
  google_enrollment_date: string | null;
  bank_label: string | null;
  docs_folder: string | null;
  sales_tax_status: string | null;
  sales_tax_note: string | null;
  reserve_pct: string | number | null;
  funding_grant_no: string | null;
};

function normalizeSalesTaxStatus(v: string | null): EntityConfig["salesTaxStatus"] {
  return v === "taxable" || v === "exempt" ? v : "pending";
}

/** A Postgres `date` column can arrive as a JS Date (Neon driver) or an ISO
 *  string. Normalize to a plain "YYYY-MM-DD" string so the UI date input and the
 *  deadline math (which assume strings) never choke on a Date object. */
function toIsoDateString(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "string") return v.slice(0, 10);
  return null;
}

function rowToEntity(r: EntityRow): EntityConfig {
  return {
    legalName: r.legal_name ?? "",
    state: r.state ?? "Wisconsin",
    entityId: r.entity_id ?? null,
    formationDate: toIsoDateString(r.formation_date),
    ein: r.ein ?? null,
    registeredAgent: r.registered_agent ?? null,
    duns: r.duns ?? null,
    businessPhone: r.business_phone ?? null,
    appleEnrollmentId: r.apple_enrollment_id ?? null,
    appleEnrollmentDate: toIsoDateString(r.apple_enrollment_date),
    googlePlayAccount: r.google_play_account ?? null,
    googleEnrollmentDate: toIsoDateString(r.google_enrollment_date),
    bankLabel: r.bank_label ?? null,
    docsFolder: r.docs_folder ?? null,
    salesTaxStatus: normalizeSalesTaxStatus(r.sales_tax_status),
    salesTaxNote: r.sales_tax_note ?? null,
    reservePct: r.reserve_pct == null ? DEFAULT_ENTITY.reservePct : Number(r.reserve_pct),
    fundingGrantNo: r.funding_grant_no ?? DEFAULT_ENTITY.fundingGrantNo,
  };
}

/** The entity-facts record, or sensible defaults if none has been saved yet. */
export async function getEntity(): Promise<EntityConfig> {
  const sql = getSql();
  const rows = (await sql`
    SELECT legal_name, state, entity_id, formation_date, ein, registered_agent,
           duns, business_phone, apple_enrollment_id, apple_enrollment_date, google_play_account,
           google_enrollment_date, bank_label, docs_folder, sales_tax_status,
           sales_tax_note, reserve_pct, funding_grant_no
    FROM business_entity WHERE id = 1
  `) as EntityRow[];
  if (!rows.length) return { ...DEFAULT_ENTITY };
  return rowToEntity(rows[0]);
}

/** Inserts or updates the singleton entity-facts row. */
export async function upsertEntity(config: EntityConfig): Promise<EntityConfig> {
  const sql = getSql();
  await sql`
    INSERT INTO business_entity
      (id, legal_name, state, entity_id, formation_date, ein, registered_agent,
       duns, business_phone, apple_enrollment_id, apple_enrollment_date, google_play_account,
       google_enrollment_date, bank_label,
       docs_folder, sales_tax_status, sales_tax_note, reserve_pct, funding_grant_no, updated_at)
    VALUES
      (1, ${config.legalName}, ${config.state}, ${config.entityId},
       ${config.formationDate}, ${config.ein}, ${config.registeredAgent},
       ${config.duns}, ${config.businessPhone}, ${config.appleEnrollmentId}, ${config.appleEnrollmentDate},
       ${config.googlePlayAccount}, ${config.googleEnrollmentDate},
       ${config.bankLabel}, ${config.docsFolder},
       ${config.salesTaxStatus}, ${config.salesTaxNote}, ${config.reservePct}, ${config.fundingGrantNo}, now())
    ON CONFLICT (id) DO UPDATE SET
      legal_name = EXCLUDED.legal_name,
      state = EXCLUDED.state,
      entity_id = EXCLUDED.entity_id,
      formation_date = EXCLUDED.formation_date,
      ein = EXCLUDED.ein,
      registered_agent = EXCLUDED.registered_agent,
      duns = EXCLUDED.duns,
      business_phone = EXCLUDED.business_phone,
      apple_enrollment_id = EXCLUDED.apple_enrollment_id,
      apple_enrollment_date = EXCLUDED.apple_enrollment_date,
      google_play_account = EXCLUDED.google_play_account,
      google_enrollment_date = EXCLUDED.google_enrollment_date,
      bank_label = EXCLUDED.bank_label,
      docs_folder = EXCLUDED.docs_folder,
      sales_tax_status = EXCLUDED.sales_tax_status,
      sales_tax_note = EXCLUDED.sales_tax_note,
      reserve_pct = EXCLUDED.reserve_pct,
      funding_grant_no = EXCLUDED.funding_grant_no,
      updated_at = now()
  `;
  await reconcileDevAccountFees(sql, config);
  return getEntity();
}

/**
 * Auto-seeds the dev-account fees (Apple $99/year, Google Play $25 one-time) into
 * the ledger so they flow into the books without manual entry. Idempotent by the
 * ledger `source` tag: one row per fee, inserted the first time the enrollment is
 * filled in, and its date re-synced to the enrollment date on later saves. The
 * amount, category, and note are left untouched on an existing row, so any manual
 * edit to the entry survives. Deleting the row and re-saving re-seeds it, by
 * design (the fee is a real, recurring fact of the books).
 */
async function reconcileDevAccountFees(
  sql: NeonQueryFunction<false, false>,
  config: EntityConfig,
): Promise<void> {
  const todayISO = new Date().toISOString().slice(0, 10);
  for (const seed of devAccountFeeSeeds(config, todayISO)) {
    const existing = (await sql`
      SELECT id FROM business_ledger WHERE source = ${seed.source} LIMIT 1
    `) as unknown[];
    if (existing.length === 0) {
      await sql`
        INSERT INTO business_ledger
          (entry_date, direction, category, amount_cents, note, source)
        VALUES
          (${seed.date}, 'out', ${seed.category}, ${seed.amountCents}, ${seed.note}, ${seed.source})
      `;
    } else {
      await sql`
        UPDATE business_ledger SET entry_date = ${seed.date} WHERE source = ${seed.source}
      `;
    }
  }
}

type TaskRow = {
  id: string | number;
  label: string;
  done: boolean;
  done_at: string | null;
};

function rowToTask(r: TaskRow): BusinessTask {
  return { id: Number(r.id), label: r.label, done: r.done, doneAt: r.done_at };
}

/** Every task, open ones first, then by sort order. */
export async function listTasks(): Promise<BusinessTask[]> {
  const sql = getSql();
  const rows = (await sql`
    SELECT id, label, done, done_at FROM business_tasks
    ORDER BY done ASC, sort ASC, id ASC
  `) as TaskRow[];
  return rows.map(rowToTask);
}

/** Appends a task at the end of the sort order. */
export async function addTask(label: string): Promise<BusinessTask> {
  const sql = getSql();
  const rows = (await sql`
    INSERT INTO business_tasks (label, sort)
    VALUES (${label}, COALESCE((SELECT MAX(sort) + 1 FROM business_tasks), 0))
    RETURNING id, label, done, done_at
  `) as TaskRow[];
  return rowToTask(rows[0]);
}

/** Sets a task's done flag, stamping done_at when completing. */
export async function setTaskDone(id: number, done: boolean): Promise<void> {
  const sql = getSql();
  await sql`
    UPDATE business_tasks
    SET done = ${done}, done_at = ${done ? new Date().toISOString() : null}::timestamptz
    WHERE id = ${id}
  `;
}

/** Removes a task. */
export async function deleteTask(id: number): Promise<void> {
  const sql = getSql();
  await sql`DELETE FROM business_tasks WHERE id = ${id}`;
}

type EmailRow = {
  id: string | number;
  kind: string;
  to_email: string;
  subject: string;
  body: string;
  sent_at: string;
};

function rowToEmail(r: EmailRow): BusinessEmail {
  return {
    id: Number(r.id),
    kind: r.kind,
    toEmail: r.to_email,
    subject: r.subject,
    body: r.body,
    sentAt: r.sent_at,
  };
}

/**
 * Archives one business email as an LLC record. Business correspondence only
 * (deadline reminders, receipts), never OTP codes or share invites. Best-effort
 * at the call site, a failed archive must never fail a delivered email.
 */
export async function recordBusinessEmail(params: {
  kind: string;
  toEmail: string;
  subject: string;
  body: string;
}): Promise<void> {
  const sql = getSql();
  await sql`
    INSERT INTO business_emails (kind, to_email, subject, body)
    VALUES (${params.kind}, ${params.toEmail}, ${params.subject}, ${params.body})
  `;
}

/** The archived business emails, newest first, capped for the page. */
export async function listBusinessEmails(limit = 500): Promise<BusinessEmail[]> {
  const sql = getSql();
  const rows = (await sql`
    SELECT id, kind, to_email, subject, body, sent_at
    FROM business_emails
    ORDER BY sent_at DESC, id DESC
    LIMIT ${limit}
  `) as EmailRow[];
  return rows.map(rowToEmail);
}

type LedgerRow = {
  id: string | number;
  entry_date: string;
  direction: string;
  category: string | null;
  amount_cents: string | number;
  note: string | null;
  source: string | null;
  tax_category: string | null;
  paid_with: string | number | null;
};

function rowToEntry(r: LedgerRow): LedgerEntry {
  return {
    id: Number(r.id),
    date: toIsoDateString(r.entry_date) ?? "",
    direction: (r.direction === "in" ? "in" : "out") as LedgerDirection,
    category: r.category ?? "",
    amountCents: Number(r.amount_cents),
    note: r.note ?? "",
    taxCategory: r.tax_category ?? "",
    paidWith: r.paid_with == null ? null : Number(r.paid_with),
    source: r.source ?? "manual",
  };
}

/** Every ledger entry, newest entry date first. */
export async function listLedger(): Promise<LedgerEntry[]> {
  const sql = getSql();
  const rows = (await sql`
    SELECT id, entry_date, direction, category, amount_cents, note, source, tax_category, paid_with
    FROM business_ledger
    ORDER BY entry_date DESC, id DESC
  `) as LedgerRow[];
  return rows.map(rowToEntry);
}

export interface NewLedgerEntry {
  date: string;
  direction: LedgerDirection;
  category: string;
  amountCents: number;
  note: string;
  taxCategory?: string;
  paidWith?: number | null;
  source?: string;
}

/** Appends one ledger entry and returns it. */
export async function addLedgerEntry(entry: NewLedgerEntry): Promise<LedgerEntry> {
  const sql = getSql();
  const rows = (await sql`
    INSERT INTO business_ledger (entry_date, direction, category, amount_cents, note, source, tax_category, paid_with)
    VALUES (${entry.date}, ${entry.direction}, ${entry.category}, ${entry.amountCents}, ${entry.note}, ${entry.source ?? "manual"}, ${entry.taxCategory ?? ""}, ${entry.paidWith ?? null})
    RETURNING id, entry_date, direction, category, amount_cents, note, source, tax_category, paid_with
  `) as LedgerRow[];
  return rowToEntry(rows[0]);
}

/**
 * Idempotent append keyed on `source`. If a row already carries this exact
 * non-empty source tag it is returned untouched (inserted: false), so a daily
 * inbox scan that re-posts the same receipt never double-logs it. An empty or
 * "manual" source has no stable identity, so it always inserts.
 */
export async function addLedgerEntryBySource(
  entry: NewLedgerEntry,
): Promise<{ entry: LedgerEntry; inserted: boolean }> {
  const source = entry.source ?? "";
  if (source && source !== "manual") {
    const sql = getSql();
    const existing = (await sql`
      SELECT id, entry_date, direction, category, amount_cents, note, source, tax_category, paid_with
      FROM business_ledger WHERE source = ${source} LIMIT 1
    `) as LedgerRow[];
    if (existing.length > 0) {
      return { entry: rowToEntry(existing[0]), inserted: false };
    }
  }
  return { entry: await addLedgerEntry(entry), inserted: true };
}

/** Sets the tax category on one existing ledger entry, returning the updated row. */
export async function setLedgerTaxCategory(
  id: number,
  taxCategory: string,
): Promise<LedgerEntry | null> {
  const sql = getSql();
  const rows = (await sql`
    UPDATE business_ledger SET tax_category = ${taxCategory} WHERE id = ${id}
    RETURNING id, entry_date, direction, category, amount_cents, note, source, tax_category, paid_with
  `) as LedgerRow[];
  return rows.length > 0 ? rowToEntry(rows[0]) : null;
}

/** Sets (or clears, when paidWith is null) the payment method on one ledger
 *  entry, returning the updated row. */
export async function setLedgerPaidWith(
  id: number,
  paidWith: number | null,
): Promise<LedgerEntry | null> {
  const sql = getSql();
  const rows = (await sql`
    UPDATE business_ledger SET paid_with = ${paidWith} WHERE id = ${id}
    RETURNING id, entry_date, direction, category, amount_cents, note, source, tax_category, paid_with
  `) as LedgerRow[];
  return rows.length > 0 ? rowToEntry(rows[0]) : null;
}

/** Removes every ledger entry carrying this exact source tag. Returns the count
 *  deleted. Used by the dev self-test to clean up its probe rows. */
export async function deleteLedgerEntriesBySource(source: string): Promise<number> {
  if (!source) return 0;
  const sql = getSql();
  const rows = (await sql`
    DELETE FROM business_ledger WHERE source = ${source} RETURNING id
  `) as { id: number }[];
  return rows.length;
}

/** Removes one ledger entry by id. */
export async function deleteLedgerEntry(id: number): Promise<void> {
  const sql = getSql();
  await sql`DELETE FROM business_ledger WHERE id = ${id}`;
}

// --- payment methods (cards and accounts, label + last four only) ---

type PaymentMethodRow = {
  id: string | number;
  label: string | null;
  last4: string | null;
  kind: string | null;
  status: string | null;
  sort: string | number | null;
};

function normalizeKind(v: string | null): PaymentMethodKind {
  return v === "personal" ? "personal" : "llc";
}

function rowToPaymentMethod(r: PaymentMethodRow): PaymentMethod {
  return {
    id: Number(r.id),
    label: r.label ?? "",
    last4: r.last4 ?? "",
    kind: normalizeKind(r.kind),
    status: r.status ?? "",
    sort: r.sort == null ? 0 : Number(r.sort),
  };
}

/** Every payment method, in sort order then id. */
export async function listPaymentMethods(): Promise<PaymentMethod[]> {
  const sql = getSql();
  const rows = (await sql`
    SELECT id, label, last4, kind, status, sort
    FROM business_payment_methods
    ORDER BY sort ASC, id ASC
  `) as PaymentMethodRow[];
  return rows.map(rowToPaymentMethod);
}

export interface NewPaymentMethod {
  label: string;
  last4: string;
  kind: PaymentMethodKind;
  status: string;
}

/** Appends a payment method at the end of the sort order. */
export async function addPaymentMethod(
  m: NewPaymentMethod,
): Promise<PaymentMethod> {
  const sql = getSql();
  const rows = (await sql`
    INSERT INTO business_payment_methods (label, last4, kind, status, sort)
    VALUES (${m.label}, ${m.last4}, ${m.kind}, ${m.status},
            COALESCE((SELECT MAX(sort) + 1 FROM business_payment_methods), 0))
    RETURNING id, label, last4, kind, status, sort
  `) as PaymentMethodRow[];
  return rowToPaymentMethod(rows[0]);
}

/** Updates the editable fields of one payment method. */
export async function updatePaymentMethod(
  id: number,
  m: NewPaymentMethod,
): Promise<PaymentMethod | null> {
  const sql = getSql();
  const rows = (await sql`
    UPDATE business_payment_methods
    SET label = ${m.label}, last4 = ${m.last4}, kind = ${m.kind}, status = ${m.status}
    WHERE id = ${id}
    RETURNING id, label, last4, kind, status, sort
  `) as PaymentMethodRow[];
  return rows.length > 0 ? rowToPaymentMethod(rows[0]) : null;
}

/** Removes a payment method. Ledger rows tagged with it keep their paid_with id
 *  (no cascade), so deleting a card never rewrites spend history; the tag simply
 *  stops resolving to a label. */
export async function deletePaymentMethod(id: number): Promise<void> {
  const sql = getSql();
  await sql`DELETE FROM business_payment_methods WHERE id = ${id}`;
}

// --- recurring subscriptions ---

type SubscriptionRow = {
  id: string | number;
  label: string | null;
  amount_cents: string | number | null;
  cadence: string | null;
  paid_with: string | number | null;
  next_renewal: string | null;
  sort: string | number | null;
};

function normalizeCadence(v: string | null): SubscriptionCadence {
  return v === "yearly" ? "yearly" : "monthly";
}

function rowToSubscription(r: SubscriptionRow): Subscription {
  return {
    id: Number(r.id),
    label: r.label ?? "",
    amountCents: r.amount_cents == null ? 0 : Number(r.amount_cents),
    cadence: normalizeCadence(r.cadence),
    paidWith: r.paid_with == null ? null : Number(r.paid_with),
    nextRenewal: toIsoDateString(r.next_renewal),
    sort: r.sort == null ? 0 : Number(r.sort),
  };
}

/** Every subscription, in sort order then id. */
export async function listSubscriptions(): Promise<Subscription[]> {
  const sql = getSql();
  const rows = (await sql`
    SELECT id, label, amount_cents, cadence, paid_with, next_renewal, sort
    FROM business_subscriptions
    ORDER BY sort ASC, id ASC
  `) as SubscriptionRow[];
  return rows.map(rowToSubscription);
}

export interface NewSubscription {
  label: string;
  amountCents: number;
  cadence: SubscriptionCadence;
  paidWith: number | null;
  nextRenewal: string | null;
}

/** Appends a subscription at the end of the sort order. */
export async function addSubscription(
  s: NewSubscription,
): Promise<Subscription> {
  const sql = getSql();
  const rows = (await sql`
    INSERT INTO business_subscriptions (label, amount_cents, cadence, paid_with, next_renewal, sort)
    VALUES (${s.label}, ${s.amountCents}, ${s.cadence}, ${s.paidWith}, ${s.nextRenewal},
            COALESCE((SELECT MAX(sort) + 1 FROM business_subscriptions), 0))
    RETURNING id, label, amount_cents, cadence, paid_with, next_renewal, sort
  `) as SubscriptionRow[];
  return rowToSubscription(rows[0]);
}

/** Updates the editable fields of one subscription. */
export async function updateSubscription(
  id: number,
  s: NewSubscription,
): Promise<Subscription | null> {
  const sql = getSql();
  const rows = (await sql`
    UPDATE business_subscriptions
    SET label = ${s.label}, amount_cents = ${s.amountCents}, cadence = ${s.cadence},
        paid_with = ${s.paidWith}, next_renewal = ${s.nextRenewal}
    WHERE id = ${id}
    RETURNING id, label, amount_cents, cadence, paid_with, next_renewal, sort
  `) as SubscriptionRow[];
  return rows.length > 0 ? rowToSubscription(rows[0]) : null;
}

/** Removes a subscription. */
export async function deleteSubscription(id: number): Promise<void> {
  const sql = getSql();
  await sql`DELETE FROM business_subscriptions WHERE id = ${id}`;
}
