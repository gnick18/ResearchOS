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
  type BusinessEmail,
  type BusinessTask,
  type EntityConfig,
  type LedgerDirection,
  type LedgerEntry,
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
  await sql`ALTER TABLE business_entity ADD COLUMN IF NOT EXISTS bank_label text`;
  await sql`ALTER TABLE business_entity ADD COLUMN IF NOT EXISTS docs_folder text`;
  await sql`ALTER TABLE business_entity ADD COLUMN IF NOT EXISTS sales_tax_status text`;
  await sql`ALTER TABLE business_entity ADD COLUMN IF NOT EXISTS sales_tax_note text`;
  await sql`ALTER TABLE business_entity ADD COLUMN IF NOT EXISTS reserve_pct numeric NOT NULL DEFAULT 30`;
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
  await seedDefaultsOnce(sql);
}

// The known facts (from the filed Articles, entity ID R098462, and the
// ResearchOS_LLC document folder the other agent organized) plus the open
// action items from that folder's README. Seeded ONCE, the first time the
// entity row is created, so re-running the schema never overwrites edits and
// deleting tasks never re-seeds them.
// Only PUBLIC-record facts are seeded here (entity ID, formation date, agent
// are all public in the WI DFI registry). Sensitive values like the EIN and
// bank details are NOT hardcoded, this file is in the open-source repo. Enter
// those in the /admin/business entity card; they live only in the private Neon
// DB, never in source.
const SEED_ENTITY = {
  legalName: "ResearchOS LLC",
  state: "Wisconsin",
  entityId: "R098462",
  formationDate: "2026-06-01",
  ein: null as string | null,
  registeredAgent: "Grant R. Nickles (self; WI Form 13 filed, Northwest cancelled)",
  bankLabel: null as string | null,
  docsFolder: "~/Documents/ResearchOS_LLC/",
  salesTaxStatus: "pending",
  salesTaxNote:
    "WI DOR sales-tax inquiry filed 2026-06-05 (DORSalesandUse@wisconsin.gov), reply expected ~1 week. Do not bill a real customer until it lands.",
  reservePct: 30,
};

// The open items as of 2026-06-05. Formation, EIN, operating agreement, the
// registered-agent change, Mercury, and the Stripe account are done, so they
// are not seeded as open tasks.
const SEED_TASKS = [
  "HARD GATE: wait for the WI DOR sales-tax reply (filed 2026-06-05) before billing any real customer",
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
        formation_date = COALESCE(formation_date, ${SEED_ENTITY.formationDate}::date),
        sales_tax_status = COALESCE(sales_tax_status, ${SEED_ENTITY.salesTaxStatus})
      WHERE id = 1
    `;
    return;
  }
  await sql`
    INSERT INTO business_entity
      (id, legal_name, state, entity_id, formation_date, ein, registered_agent,
       bank_label, docs_folder, sales_tax_status, sales_tax_note, reserve_pct)
    VALUES
      (1, ${SEED_ENTITY.legalName}, ${SEED_ENTITY.state}, ${SEED_ENTITY.entityId},
       ${SEED_ENTITY.formationDate}, ${SEED_ENTITY.ein}, ${SEED_ENTITY.registeredAgent},
       ${SEED_ENTITY.bankLabel}, ${SEED_ENTITY.docsFolder}, ${SEED_ENTITY.salesTaxStatus},
       ${SEED_ENTITY.salesTaxNote}, ${SEED_ENTITY.reservePct})
    ON CONFLICT (id) DO NOTHING
  `;
  for (let i = 0; i < SEED_TASKS.length; i += 1) {
    await sql`INSERT INTO business_tasks (label, sort) VALUES (${SEED_TASKS[i]}, ${i})`;
  }
}

type EntityRow = {
  legal_name: string | null;
  state: string | null;
  entity_id: string | null;
  formation_date: string | null;
  ein: string | null;
  registered_agent: string | null;
  bank_label: string | null;
  docs_folder: string | null;
  sales_tax_status: string | null;
  sales_tax_note: string | null;
  reserve_pct: string | number | null;
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
    bankLabel: r.bank_label ?? null,
    docsFolder: r.docs_folder ?? null,
    salesTaxStatus: normalizeSalesTaxStatus(r.sales_tax_status),
    salesTaxNote: r.sales_tax_note ?? null,
    reservePct: r.reserve_pct == null ? DEFAULT_ENTITY.reservePct : Number(r.reserve_pct),
  };
}

/** The entity-facts record, or sensible defaults if none has been saved yet. */
export async function getEntity(): Promise<EntityConfig> {
  const sql = getSql();
  const rows = (await sql`
    SELECT legal_name, state, entity_id, formation_date, ein, registered_agent,
           bank_label, docs_folder, sales_tax_status, sales_tax_note, reserve_pct
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
       bank_label, docs_folder, sales_tax_status, sales_tax_note, reserve_pct, updated_at)
    VALUES
      (1, ${config.legalName}, ${config.state}, ${config.entityId},
       ${config.formationDate}, ${config.ein}, ${config.registeredAgent},
       ${config.bankLabel}, ${config.docsFolder}, ${config.salesTaxStatus},
       ${config.salesTaxNote}, ${config.reservePct}, now())
    ON CONFLICT (id) DO UPDATE SET
      legal_name = EXCLUDED.legal_name,
      state = EXCLUDED.state,
      entity_id = EXCLUDED.entity_id,
      formation_date = EXCLUDED.formation_date,
      ein = EXCLUDED.ein,
      registered_agent = EXCLUDED.registered_agent,
      bank_label = EXCLUDED.bank_label,
      docs_folder = EXCLUDED.docs_folder,
      sales_tax_status = EXCLUDED.sales_tax_status,
      sales_tax_note = EXCLUDED.sales_tax_note,
      reserve_pct = EXCLUDED.reserve_pct,
      updated_at = now()
  `;
  return getEntity();
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
};

function rowToEntry(r: LedgerRow): LedgerEntry {
  return {
    id: Number(r.id),
    date: toIsoDateString(r.entry_date) ?? "",
    direction: (r.direction === "in" ? "in" : "out") as LedgerDirection,
    category: r.category ?? "",
    amountCents: Number(r.amount_cents),
    note: r.note ?? "",
    source: r.source ?? "manual",
  };
}

/** Every ledger entry, newest entry date first. */
export async function listLedger(): Promise<LedgerEntry[]> {
  const sql = getSql();
  const rows = (await sql`
    SELECT id, entry_date, direction, category, amount_cents, note, source
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
  source?: string;
}

/** Appends one ledger entry and returns it. */
export async function addLedgerEntry(entry: NewLedgerEntry): Promise<LedgerEntry> {
  const sql = getSql();
  const rows = (await sql`
    INSERT INTO business_ledger (entry_date, direction, category, amount_cents, note, source)
    VALUES (${entry.date}, ${entry.direction}, ${entry.category}, ${entry.amountCents}, ${entry.note}, ${entry.source ?? "manual"})
    RETURNING id, entry_date, direction, category, amount_cents, note, source
  `) as LedgerRow[];
  return rowToEntry(rows[0]);
}

/** Removes one ledger entry by id. */
export async function deleteLedgerEntry(id: number): Promise<void> {
  const sql = getSql();
  await sql`DELETE FROM business_ledger WHERE id = ${id}`;
}
