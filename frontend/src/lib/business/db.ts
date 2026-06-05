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
      formation_date date,
      ein text,
      registered_agent text,
      bank_label text,
      reserve_pct numeric not null default 25,
      updated_at timestamptz default now(),
      CONSTRAINT business_entity_singleton CHECK (id = 1)
    )
  `;
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
}

type EntityRow = {
  legal_name: string | null;
  state: string | null;
  formation_date: string | null;
  ein: string | null;
  registered_agent: string | null;
  bank_label: string | null;
  reserve_pct: string | number | null;
};

function rowToEntity(r: EntityRow): EntityConfig {
  return {
    legalName: r.legal_name ?? "",
    state: r.state ?? "Wisconsin",
    formationDate: r.formation_date ?? null,
    ein: r.ein ?? null,
    registeredAgent: r.registered_agent ?? null,
    bankLabel: r.bank_label ?? null,
    reservePct: r.reserve_pct == null ? DEFAULT_ENTITY.reservePct : Number(r.reserve_pct),
  };
}

/** The entity-facts record, or sensible defaults if none has been saved yet. */
export async function getEntity(): Promise<EntityConfig> {
  const sql = getSql();
  const rows = (await sql`
    SELECT legal_name, state, formation_date, ein, registered_agent, bank_label, reserve_pct
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
      (id, legal_name, state, formation_date, ein, registered_agent, bank_label, reserve_pct, updated_at)
    VALUES
      (1, ${config.legalName}, ${config.state}, ${config.formationDate},
       ${config.ein}, ${config.registeredAgent}, ${config.bankLabel}, ${config.reservePct}, now())
    ON CONFLICT (id) DO UPDATE SET
      legal_name = EXCLUDED.legal_name,
      state = EXCLUDED.state,
      formation_date = EXCLUDED.formation_date,
      ein = EXCLUDED.ein,
      registered_agent = EXCLUDED.registered_agent,
      bank_label = EXCLUDED.bank_label,
      reserve_pct = EXCLUDED.reserve_pct,
      updated_at = now()
  `;
  return getEntity();
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
    date: r.entry_date,
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
