// Operator-only full-account wipe (server-only, destructive).
//
// Given one identity (a solo/lab owner key, a raw email, a department id, or an
// institution id) this module enumerates and then deletes EVERY cloud-side row
// that identity owns, across all of billing, the directory, relay, collab, the
// lab-site / BYO tables, and the slug registry, then deletes the Stripe customer
// so a saved test card does not linger. It NEVER touches anything on the
// person's own disk, the local-first data lives only on their computer and there
// is nothing server-side to delete for it.
//
// One identity hash covers almost everything. ownerKeyForEmail(email) is the
// SAME peppered HMAC the directory stores as email_hash, the relay stores as
// recipient/sender_email_hash, and collab stores as owner_hash (the collab DO
// resolves a pubkey to this exact hash before writing). So a solo or lab owner
// is one value, owner_key, and the wipe deletes strictly by it. Departments and
// institutions are organisations keyed by their own generated id, so they are
// deleted by that id (plus their member + usage-snapshot rows and their
// org_billing row).
//
// Safety posture. Every delete is an EXACT key match, never a prefix or a LIKE,
// so the blast radius is exactly one identity. The whole purge runs against a
// single Neon handle table-by-table, in one place, so the coverage is auditable
// rather than scattered across thirteen module singletons. Each statement is
// wrapped so one failing table (or a table that does not yet exist on this
// deployment) does not sink the rest, the wipe reports what it managed to
// delete. It is idempotent, wiping an already-gone identity returns ok with zero
// counts and never throws.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

import { ownerKeyForEmail } from "@/lib/billing/owner";
import { getStripe } from "@/lib/billing/stripe";

export type Sql = NeonQueryFunction<false, false>;

let sqlSingleton: Sql | null = null;

/** Lazily builds the Neon handle from DATABASE_URL. Throws a clear error when the
 *  connection string is missing so a misconfigured deploy fails at request time
 *  rather than with an opaque driver error. */
export function getWipeSql(): Sql {
  if (sqlSingleton) return sqlSingleton;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set. The account wipe cannot reach Neon.");
  }
  sqlSingleton = neon(url);
  return sqlSingleton;
}

/** Test seam, lets a unit test inject a mock Neon handle. */
export function __setWipeSqlForTests(mock: Sql | null): void {
  sqlSingleton = mock;
}

// ---------------------------------------------------------------------------
// Target resolution
// ---------------------------------------------------------------------------

export interface WipeTargetInput {
  /** A pre-hashed owner key (the peppered email hash). */
  ownerKey?: string | null;
  /** A raw email, hashed here into the owner key. */
  email?: string | null;
  /** A department id, the target is the whole department org. */
  deptId?: string | null;
  /** An institution id, the target is the whole institution org. */
  institutionId?: string | null;
}

export type WipeTarget =
  | { kind: "owner"; ownerKey: string; email: string | null }
  | { kind: "dept"; deptId: string }
  | { kind: "institution"; institutionId: string };

/**
 * Resolves the request body into exactly one wipe target. An email is hashed
 * with the same ownerKeyForEmail the billing and directory layers use, so an
 * operator can wipe by email without ever sending the plaintext to the table
 * layer. Throws on an empty or ambiguous target so the caller returns a clean
 * 400 rather than guessing which identity to delete.
 */
export function resolveWipeTarget(input: WipeTargetInput): WipeTarget {
  const hasOwner = !!input.ownerKey;
  const hasEmail = !!input.email;
  const hasDept = !!input.deptId;
  const hasInst = !!input.institutionId;
  const count = [hasOwner || hasEmail, hasDept, hasInst].filter(Boolean).length;

  if (count === 0) {
    throw new Error("no wipe target was given");
  }
  if (count > 1) {
    throw new Error("more than one wipe target was given, pass exactly one");
  }

  if (hasDept) return { kind: "dept", deptId: input.deptId as string };
  if (hasInst) {
    return { kind: "institution", institutionId: input.institutionId as string };
  }

  // Owner target. An explicit ownerKey wins, otherwise hash the email.
  if (hasOwner) {
    return { kind: "owner", ownerKey: input.ownerKey as string, email: input.email ?? null };
  }
  const email = (input.email as string).trim();
  if (!email) throw new Error("the email was empty");
  return { kind: "owner", ownerKey: ownerKeyForEmail(email), email };
}

// ---------------------------------------------------------------------------
// Table coverage
// ---------------------------------------------------------------------------

/** One per-table delete, named so the preview and the wipe share the exact same
 *  coverage list. `run` returns the number of rows it deleted. */
interface TableDelete {
  table: string;
  run: (sql: Sql) => Promise<number>;
}

/** Helper, runs a DELETE and returns the affected row count. The Neon HTTP
 *  driver does not surface a rowCount on a plain tagged-template, so every delete
 *  uses RETURNING 1 and counts the returned rows. */
async function deleteCount(
  rows: Promise<unknown> | unknown,
): Promise<number> {
  const result = (await rows) as unknown[];
  return Array.isArray(result) ? result.length : 0;
}

/**
 * The full set of owner-keyed deletes for a solo or lab owner, in a safe order
 * (member and child rows before the identity rows). Every entry keys strictly on
 * the single owner_key / email_hash, which are the same peppered hash.
 *
 * beta_testers is keyed by PLAINTEXT email, not the hash, so it is only included
 * when the email is known (an email target, or an ownerKey target that also
 * carried the email). Without the email we cannot resolve that row, and we never
 * guess.
 */
export function ownerTableDeletes(
  ownerKey: string,
  email: string | null,
): TableDelete[] {
  const deletes: TableDelete[] = [
    // Cloud (Model A) billing.
    {
      table: "cloud_balance",
      run: (sql) =>
        deleteCount(sql`DELETE FROM cloud_balance WHERE owner_key = ${ownerKey} RETURNING 1`),
    },
    {
      table: "cloud_usage_ledger",
      run: (sql) =>
        deleteCount(sql`DELETE FROM cloud_usage_ledger WHERE owner_key = ${ownerKey} RETURNING 1`),
    },
    // AI token billing.
    {
      table: "ai_balances",
      run: (sql) =>
        deleteCount(sql`DELETE FROM ai_balances WHERE owner_key = ${ownerKey} RETURNING 1`),
    },
    {
      table: "ai_ledger",
      run: (sql) =>
        deleteCount(sql`DELETE FROM ai_ledger WHERE owner_key = ${ownerKey} RETURNING 1`),
    },
    // Flat-plan subscription + grants.
    {
      table: "billing_subscriptions",
      run: (sql) =>
        deleteCount(sql`DELETE FROM billing_subscriptions WHERE owner_key = ${ownerKey} RETURNING 1`),
    },
    {
      table: "billing_grants",
      run: (sql) =>
        deleteCount(sql`DELETE FROM billing_grants WHERE owner_key = ${ownerKey} RETURNING 1`),
    },
    // Lab membership, the owner could be a PI (lab) or a sponsored member, so
    // delete every row where they appear on either side of the relationship.
    {
      table: "billing_lab_members",
      run: (sql) =>
        deleteCount(
          sql`DELETE FROM billing_lab_members
              WHERE lab_owner_key = ${ownerKey} OR member_owner_key = ${ownerKey}
              RETURNING 1`,
        ),
    },
    // Department membership where this owner is a lab head.
    {
      table: "dept_members",
      run: (sql) =>
        deleteCount(sql`DELETE FROM dept_members WHERE labhead_owner_key = ${ownerKey} RETURNING 1`),
    },
    // Directory identity + everything keyed off the email hash.
    {
      table: "directory_identities",
      run: (sql) =>
        deleteCount(sql`DELETE FROM directory_identities WHERE email_hash = ${ownerKey} RETURNING 1`),
    },
    {
      table: "directory_key_history",
      run: (sql) =>
        deleteCount(sql`DELETE FROM directory_key_history WHERE email_hash = ${ownerKey} RETURNING 1`),
    },
    {
      table: "directory_orcid_links",
      run: (sql) =>
        deleteCount(sql`DELETE FROM directory_orcid_links WHERE email_hash = ${ownerKey} RETURNING 1`),
    },
    // The published profile is keyed by the fingerprint, which lives on the
    // identity row, so resolve the fingerprint first then delete the profile.
    {
      table: "directory_profiles",
      run: async (sql) => {
        const fps = (await sql`
          SELECT fingerprint FROM directory_identities WHERE email_hash = ${ownerKey}
        `) as Array<{ fingerprint: string | null }>;
        let n = 0;
        for (const r of fps) {
          if (!r.fingerprint) continue;
          n += await deleteCount(
            sql`DELETE FROM directory_profiles WHERE fingerprint = ${r.fingerprint} RETURNING 1`,
          );
        }
        return n;
      },
    },
    // Labs this owner is the PI of, plus the join-request rows they raised.
    {
      table: "directory_labs",
      run: (sql) =>
        deleteCount(sql`DELETE FROM directory_labs WHERE pi_email_hash = ${ownerKey} RETURNING 1`),
    },
    {
      table: "directory_lab_requests",
      run: (sql) =>
        deleteCount(
          sql`DELETE FROM directory_lab_requests WHERE requester_email_hash = ${ownerKey} RETURNING 1`,
        ),
    },
    // Relay, both inbound and outbound rows.
    {
      table: "relay_inbox",
      run: (sql) =>
        deleteCount(
          sql`DELETE FROM relay_inbox
              WHERE recipient_email_hash = ${ownerKey} OR sender_email_hash = ${ownerKey}
              RETURNING 1`,
        ),
    },
    {
      table: "relay_invite",
      run: (sql) =>
        deleteCount(
          sql`DELETE FROM relay_invite
              WHERE recipient_email_hash = ${ownerKey} OR sender_email_hash = ${ownerKey}
              RETURNING 1`,
        ),
    },
    // Collab, keyed by owner_hash (the same email hash) and lab_owner_key.
    {
      table: "collab_doc_sizes",
      run: (sql) =>
        deleteCount(sql`DELETE FROM collab_doc_sizes WHERE owner_hash = ${ownerKey} RETURNING 1`),
    },
    {
      table: "collab_owner_writes",
      run: (sql) =>
        deleteCount(sql`DELETE FROM collab_owner_writes WHERE owner_hash = ${ownerKey} RETURNING 1`),
    },
    {
      table: "lab_hosted_assets",
      run: (sql) =>
        deleteCount(sql`DELETE FROM lab_hosted_assets WHERE lab_owner_key = ${ownerKey} RETURNING 1`),
    },
    // Lab site + pages + BYO connections.
    {
      table: "lab_site_pages",
      run: (sql) =>
        deleteCount(sql`DELETE FROM lab_site_pages WHERE lab_owner_key = ${ownerKey} RETURNING 1`),
    },
    {
      table: "lab_sites",
      run: (sql) =>
        deleteCount(sql`DELETE FROM lab_sites WHERE lab_owner_key = ${ownerKey} RETURNING 1`),
    },
    {
      table: "lab_byo_sites",
      run: (sql) =>
        deleteCount(sql`DELETE FROM lab_byo_sites WHERE lab_owner_key = ${ownerKey} RETURNING 1`),
    },
    {
      table: "lab_byo_github",
      run: (sql) =>
        deleteCount(sql`DELETE FROM lab_byo_github WHERE lab_owner_key = ${ownerKey} RETURNING 1`),
    },
    // Account profile.
    {
      table: "account_profiles",
      run: (sql) =>
        deleteCount(sql`DELETE FROM account_profiles WHERE owner_key = ${ownerKey} RETURNING 1`),
    },
    // Reserved slugs, released back to the namespace. Scoped to this owner so a
    // system-reserved slug (owner_key NULL) is never touched.
    {
      table: "slug_registry",
      run: (sql) =>
        deleteCount(sql`DELETE FROM slug_registry WHERE owner_key = ${ownerKey} RETURNING 1`),
    },
  ];

  // beta_testers is keyed by plaintext email, only deletable when we have it.
  if (email) {
    const canonical = email.trim().toLowerCase();
    deletes.push({
      table: "beta_testers",
      run: (sql) =>
        deleteCount(sql`DELETE FROM beta_testers WHERE lower(email) = ${canonical} RETURNING 1`),
    });
  }

  return deletes;
}

/**
 * The deletes for a department ORG (not a member, the whole department). Removes
 * the department row, its lab-head member rows, its usage snapshots, its
 * org_billing row, any institution_members row that links it up, and any slug it
 * reserved.
 */
export function deptTableDeletes(deptId: string): TableDelete[] {
  return [
    {
      table: "dept_members",
      run: (sql) =>
        deleteCount(sql`DELETE FROM dept_members WHERE dept_id = ${deptId} RETURNING 1`),
    },
    {
      table: "dept_usage_snapshots",
      run: (sql) =>
        deleteCount(sql`DELETE FROM dept_usage_snapshots WHERE dept_id = ${deptId} RETURNING 1`),
    },
    {
      table: "institution_members",
      run: (sql) =>
        deleteCount(sql`DELETE FROM institution_members WHERE dept_id = ${deptId} RETURNING 1`),
    },
    {
      table: "org_billing",
      run: (sql) =>
        deleteCount(
          sql`DELETE FROM org_billing WHERE tier = 'department' AND entity_id = ${deptId} RETURNING 1`,
        ),
    },
    {
      table: "slug_registry",
      run: (sql) =>
        deleteCount(
          sql`DELETE FROM slug_registry WHERE kind = 'department' AND ref = ${deptId} RETURNING 1`,
        ),
    },
    {
      table: "departments",
      run: (sql) =>
        deleteCount(sql`DELETE FROM departments WHERE dept_id = ${deptId} RETURNING 1`),
    },
  ];
}

/**
 * The deletes for an institution ORG. Removes the institution row, its
 * department-member rows, its usage snapshots, its org_billing row, and any slug
 * it reserved.
 */
export function institutionTableDeletes(institutionId: string): TableDelete[] {
  return [
    {
      table: "institution_members",
      run: (sql) =>
        deleteCount(
          sql`DELETE FROM institution_members WHERE institution_id = ${institutionId} RETURNING 1`,
        ),
    },
    {
      table: "institution_usage_snapshots",
      run: (sql) =>
        deleteCount(
          sql`DELETE FROM institution_usage_snapshots WHERE institution_id = ${institutionId} RETURNING 1`,
        ),
    },
    {
      table: "org_billing",
      run: (sql) =>
        deleteCount(
          sql`DELETE FROM org_billing WHERE tier = 'institution' AND entity_id = ${institutionId} RETURNING 1`,
        ),
    },
    {
      table: "slug_registry",
      run: (sql) =>
        deleteCount(
          sql`DELETE FROM slug_registry WHERE kind = 'institution' AND ref = ${institutionId} RETURNING 1`,
        ),
    },
    {
      table: "institutions",
      run: (sql) =>
        deleteCount(sql`DELETE FROM institutions WHERE institution_id = ${institutionId} RETURNING 1`),
    },
  ];
}

/** Picks the right coverage list for a resolved target. */
function tableDeletesFor(target: WipeTarget): TableDelete[] {
  if (target.kind === "owner") return ownerTableDeletes(target.ownerKey, target.email);
  if (target.kind === "dept") return deptTableDeletes(target.deptId);
  return institutionTableDeletes(target.institutionId);
}

// ---------------------------------------------------------------------------
// Stripe customer resolution
// ---------------------------------------------------------------------------

/**
 * Reads the Stripe customer id (and a masked form for display) for a target,
 * without deleting anything. For an owner it reads cloud_balance then
 * billing_subscriptions, for an org it reads org_billing. Returns null when no
 * customer is recorded. Resilient, a missing table or a query error returns null
 * rather than throwing.
 */
export async function readStripeCustomer(
  sql: Sql,
  target: WipeTarget,
): Promise<{ customerId: string; masked: string } | null> {
  try {
    let customerId: string | null = null;
    if (target.kind === "owner") {
      const a = (await sql`
        SELECT stripe_customer_id FROM cloud_balance WHERE owner_key = ${target.ownerKey} LIMIT 1
      `) as Array<{ stripe_customer_id: string | null }>;
      customerId = a[0]?.stripe_customer_id ?? null;
      if (!customerId) {
        const b = (await sql`
          SELECT stripe_customer_id FROM billing_subscriptions WHERE owner_key = ${target.ownerKey} LIMIT 1
        `) as Array<{ stripe_customer_id: string | null }>;
        customerId = b[0]?.stripe_customer_id ?? null;
      }
    } else {
      const tier = target.kind === "dept" ? "department" : "institution";
      const id = target.kind === "dept" ? target.deptId : target.institutionId;
      const rows = (await sql`
        SELECT stripe_customer_id FROM org_billing
        WHERE tier = ${tier} AND entity_id = ${id} LIMIT 1
      `) as Array<{ stripe_customer_id: string | null }>;
      customerId = rows[0]?.stripe_customer_id ?? null;
    }
    if (!customerId) return null;
    return { customerId, masked: maskCustomerId(customerId) };
  } catch {
    return null;
  }
}

/** Masks a Stripe customer id for display (keeps the cus_ prefix and last 4). */
export function maskCustomerId(id: string): string {
  if (id.length <= 8) return id;
  const last4 = id.slice(-4);
  return `${id.slice(0, 4)}...${last4}`;
}

// ---------------------------------------------------------------------------
// Preview (dry run) and wipe
// ---------------------------------------------------------------------------

export interface TableRowCount {
  table: string;
  rows: number;
}

export interface WipePreview {
  target: { kind: WipeTarget["kind"]; id: string };
  perTable: TableRowCount[];
  total: number;
  stripeCustomer: string | null;
}

/**
 * DRY RUN. Counts exactly how many rows the wipe would delete per table, and
 * whether a Stripe customer would be deleted, WITHOUT deleting anything. Each
 * count is wrapped so a missing table reports zero rather than failing the whole
 * preview. Powers the confirm popup.
 */
export async function previewWipe(target: WipeTarget): Promise<WipePreview> {
  const sql = getWipeSql();
  const deletes = tableDeletesFor(target);
  const perTable: TableRowCount[] = [];

  for (const d of deletes) {
    try {
      const rows = await countRowsFor(sql, target, d.table);
      perTable.push({ table: d.table, rows });
    } catch {
      // A table that does not exist on this deployment, or any per-table error,
      // counts as zero so the preview still returns the rest.
      perTable.push({ table: d.table, rows: 0 });
    }
  }

  const stripe = await readStripeCustomer(sql, target);
  const total = perTable.reduce((acc, r) => acc + r.rows, 0);

  return {
    target: { kind: target.kind, id: targetId(target) },
    perTable,
    total,
    stripeCustomer: stripe ? stripe.masked : null,
  };
}

/** The stable id for a resolved target, used in the preview and the wipe result. */
function targetId(target: WipeTarget): string {
  if (target.kind === "owner") return target.ownerKey;
  if (target.kind === "dept") return target.deptId;
  return target.institutionId;
}

/**
 * Counts the rows a given table's delete WOULD remove, mirroring the delete's
 * WHERE clause exactly so the preview and the wipe agree. Kept in lockstep with
 * ownerTableDeletes / deptTableDeletes / institutionTableDeletes.
 */
async function countRowsFor(
  sql: Sql,
  target: WipeTarget,
  table: string,
): Promise<number> {
  const one = async (rows: Promise<unknown>): Promise<number> => {
    const r = (await rows) as Array<{ n: number | string }>;
    return Number(r[0]?.n ?? 0);
  };

  if (target.kind === "owner") {
    const k = target.ownerKey;
    switch (table) {
      case "cloud_balance":
        return one(sql`SELECT count(*)::int AS n FROM cloud_balance WHERE owner_key = ${k}`);
      case "cloud_usage_ledger":
        return one(sql`SELECT count(*)::int AS n FROM cloud_usage_ledger WHERE owner_key = ${k}`);
      case "ai_balances":
        return one(sql`SELECT count(*)::int AS n FROM ai_balances WHERE owner_key = ${k}`);
      case "ai_ledger":
        return one(sql`SELECT count(*)::int AS n FROM ai_ledger WHERE owner_key = ${k}`);
      case "billing_subscriptions":
        return one(sql`SELECT count(*)::int AS n FROM billing_subscriptions WHERE owner_key = ${k}`);
      case "billing_grants":
        return one(sql`SELECT count(*)::int AS n FROM billing_grants WHERE owner_key = ${k}`);
      case "billing_lab_members":
        return one(
          sql`SELECT count(*)::int AS n FROM billing_lab_members WHERE lab_owner_key = ${k} OR member_owner_key = ${k}`,
        );
      case "dept_members":
        return one(sql`SELECT count(*)::int AS n FROM dept_members WHERE labhead_owner_key = ${k}`);
      case "directory_identities":
        return one(sql`SELECT count(*)::int AS n FROM directory_identities WHERE email_hash = ${k}`);
      case "directory_key_history":
        return one(sql`SELECT count(*)::int AS n FROM directory_key_history WHERE email_hash = ${k}`);
      case "directory_orcid_links":
        return one(sql`SELECT count(*)::int AS n FROM directory_orcid_links WHERE email_hash = ${k}`);
      case "directory_profiles":
        return one(
          sql`SELECT count(*)::int AS n FROM directory_profiles p
              JOIN directory_identities i USING (fingerprint)
              WHERE i.email_hash = ${k}`,
        );
      case "directory_labs":
        return one(sql`SELECT count(*)::int AS n FROM directory_labs WHERE pi_email_hash = ${k}`);
      case "directory_lab_requests":
        return one(
          sql`SELECT count(*)::int AS n FROM directory_lab_requests WHERE requester_email_hash = ${k}`,
        );
      case "relay_inbox":
        return one(
          sql`SELECT count(*)::int AS n FROM relay_inbox WHERE recipient_email_hash = ${k} OR sender_email_hash = ${k}`,
        );
      case "relay_invite":
        return one(
          sql`SELECT count(*)::int AS n FROM relay_invite WHERE recipient_email_hash = ${k} OR sender_email_hash = ${k}`,
        );
      case "collab_doc_sizes":
        return one(sql`SELECT count(*)::int AS n FROM collab_doc_sizes WHERE owner_hash = ${k}`);
      case "collab_owner_writes":
        return one(sql`SELECT count(*)::int AS n FROM collab_owner_writes WHERE owner_hash = ${k}`);
      case "lab_hosted_assets":
        return one(sql`SELECT count(*)::int AS n FROM lab_hosted_assets WHERE lab_owner_key = ${k}`);
      case "lab_site_pages":
        return one(sql`SELECT count(*)::int AS n FROM lab_site_pages WHERE lab_owner_key = ${k}`);
      case "lab_sites":
        return one(sql`SELECT count(*)::int AS n FROM lab_sites WHERE lab_owner_key = ${k}`);
      case "lab_byo_sites":
        return one(sql`SELECT count(*)::int AS n FROM lab_byo_sites WHERE lab_owner_key = ${k}`);
      case "lab_byo_github":
        return one(sql`SELECT count(*)::int AS n FROM lab_byo_github WHERE lab_owner_key = ${k}`);
      case "account_profiles":
        return one(sql`SELECT count(*)::int AS n FROM account_profiles WHERE owner_key = ${k}`);
      case "slug_registry":
        return one(sql`SELECT count(*)::int AS n FROM slug_registry WHERE owner_key = ${k}`);
      case "beta_testers": {
        const email = target.email ? target.email.trim().toLowerCase() : null;
        if (!email) return 0;
        return one(sql`SELECT count(*)::int AS n FROM beta_testers WHERE lower(email) = ${email}`);
      }
      default:
        return 0;
    }
  }

  if (target.kind === "dept") {
    const id = target.deptId;
    switch (table) {
      case "dept_members":
        return one(sql`SELECT count(*)::int AS n FROM dept_members WHERE dept_id = ${id}`);
      case "dept_usage_snapshots":
        return one(sql`SELECT count(*)::int AS n FROM dept_usage_snapshots WHERE dept_id = ${id}`);
      case "institution_members":
        return one(sql`SELECT count(*)::int AS n FROM institution_members WHERE dept_id = ${id}`);
      case "org_billing":
        return one(
          sql`SELECT count(*)::int AS n FROM org_billing WHERE tier = 'department' AND entity_id = ${id}`,
        );
      case "slug_registry":
        return one(
          sql`SELECT count(*)::int AS n FROM slug_registry WHERE kind = 'department' AND ref = ${id}`,
        );
      case "departments":
        return one(sql`SELECT count(*)::int AS n FROM departments WHERE dept_id = ${id}`);
      default:
        return 0;
    }
  }

  // institution
  const id = target.institutionId;
  switch (table) {
    case "institution_members":
      return one(sql`SELECT count(*)::int AS n FROM institution_members WHERE institution_id = ${id}`);
    case "institution_usage_snapshots":
      return one(
        sql`SELECT count(*)::int AS n FROM institution_usage_snapshots WHERE institution_id = ${id}`,
      );
    case "org_billing":
      return one(
        sql`SELECT count(*)::int AS n FROM org_billing WHERE tier = 'institution' AND entity_id = ${id}`,
      );
    case "slug_registry":
      return one(
        sql`SELECT count(*)::int AS n FROM slug_registry WHERE kind = 'institution' AND ref = ${id}`,
      );
    case "institutions":
      return one(sql`SELECT count(*)::int AS n FROM institutions WHERE institution_id = ${id}`);
    default:
      return 0;
  }
}

export interface WipeResult {
  ok: true;
  target: { kind: WipeTarget["kind"]; id: string };
  deleted: TableRowCount[];
  total: number;
  /** A human line describing the Stripe outcome. */
  stripe: string;
  /** Present only when Stripe errored, the DB purge still completed. */
  stripeError?: string;
}

/**
 * Performs the full wipe. Deletes every covered table strictly by the resolved
 * key, then deletes the Stripe customer (after detaching payment methods) so a
 * saved card does not linger. Stripe is wrapped in try/catch and a Stripe error
 * NEVER aborts the DB purge, it is reported as stripeError instead, so a Stripe
 * hiccup cannot leave the database half-wiped. Idempotent, an already-gone
 * identity returns zero counts.
 */
export async function performWipe(target: WipeTarget): Promise<WipeResult> {
  const sql = getWipeSql();

  // Read the Stripe customer BEFORE the DB rows that hold it are deleted.
  const stripeCustomer = await readStripeCustomer(sql, target);

  const deletes = tableDeletesFor(target);
  const deleted: TableRowCount[] = [];
  for (const d of deletes) {
    try {
      const n = await d.run(sql);
      deleted.push({ table: d.table, rows: n });
    } catch {
      // A missing table or a per-table error is reported as zero rather than
      // sinking the rest of the purge, so the wipe is as complete as possible.
      deleted.push({ table: d.table, rows: 0 });
    }
  }
  const total = deleted.reduce((acc, r) => acc + r.rows, 0);

  let stripe = "No Stripe customer was on record.";
  let stripeError: string | undefined;
  if (stripeCustomer) {
    try {
      const client = getStripe();
      // Detach every saved payment method so the test card cannot linger even if
      // the customer delete is somehow retained.
      try {
        const methods = await client.paymentMethods.list({
          customer: stripeCustomer.customerId,
          limit: 100,
        });
        for (const pm of methods.data) {
          try {
            await client.paymentMethods.detach(pm.id);
          } catch {
            // Already detached or not detachable, continue.
          }
        }
      } catch {
        // Listing methods failed, still attempt the customer delete below.
      }
      await client.customers.del(stripeCustomer.customerId);
      stripe = `Deleted Stripe customer ${stripeCustomer.masked}.`;
    } catch (e) {
      stripeError =
        e instanceof Error ? e.message : "the Stripe customer delete failed";
      stripe = `Could not delete Stripe customer ${stripeCustomer.masked}, the database rows were still removed.`;
    }
  }

  return {
    ok: true,
    target: { kind: target.kind, id: targetId(target) },
    deleted,
    total,
    stripe,
    ...(stripeError ? { stripeError } : {}),
  };
}
