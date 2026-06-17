// Operator-only account roster (server-only).
//
// Builds the three lists the admin Accounts panel shows, all registered solo
// users, all labs, and all departments and institutions, each as a thin summary
// row with a stable id the wipe endpoints key on. It NEVER returns a plaintext
// email, the directory stores only peppered hashes, so a solo user with no
// published profile is labelled by a short hash prefix.
//
// Resilience. Each sub-query is wrapped so one failing or not-yet-created table
// does not sink the whole response, the roster returns whatever it can read.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

export type Sql = NeonQueryFunction<false, false>;

let sqlSingleton: Sql | null = null;

function getSql(): Sql {
  if (sqlSingleton) return sqlSingleton;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set. The account roster cannot reach Neon.");
  }
  sqlSingleton = neon(url);
  return sqlSingleton;
}

/** Test seam, injects a mock Neon handle. */
export function __setRosterSqlForTests(mock: Sql | null): void {
  sqlSingleton = mock;
}

export interface SoloRow {
  ownerKey: string;
  label: string;
  plan: "solo" | "lab" | "free";
  createdAt: string | null;
  hasCard: boolean;
}

export interface LabRow {
  ownerKey: string;
  label: string;
  memberCount: number;
  createdAt: string | null;
  hasCard: boolean;
}

export interface OrgRow {
  /** "dept" or "institution", so the panel calls the right wipe key. */
  kind: "dept" | "institution";
  id: string;
  label: string;
  memberCount: number;
  createdAt: string | null;
  hasCard: boolean;
}

export interface Roster {
  solo: SoloRow[];
  labs: LabRow[];
  depts: OrgRow[];
}

/** A short, non-reversible label for an owner with no human name, the first 10
 *  hex chars of the peppered hash plus a "(no profile)" tag. The hash is already
 *  one-way, so a prefix leaks nothing a full hash would not. */
function shortHashLabel(ownerKey: string): string {
  return `${ownerKey.slice(0, 10)} (no profile)`;
}

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

/**
 * Builds the full roster. Labs are the directory_labs rows (one per PI). Solo
 * users are every directory identity that is NOT a lab PI, labelled by their
 * account_profiles or directory_profiles name where they published one, else the
 * hash prefix. Departments and institutions come from their own tables. Each row
 * carries the earliest timestamp we can read for it and whether a Stripe
 * customer is on record. Sorted newest-first so a just-created test account sits
 * at the top.
 */
export async function buildRoster(): Promise<Roster> {
  const sql = getSql();

  // ── Labs (directory_labs, keyed by the PI email hash) ──
  const labRows = await safe(async () => {
    const rows = (await sql`
      SELECT l.pi_email_hash AS owner_key,
             l.name,
             l.pi_display_name,
             l.member_count,
             l.created_at,
             (b.stripe_customer_id IS NOT NULL) AS has_card
      FROM directory_labs l
      LEFT JOIN cloud_balance b ON b.owner_key = l.pi_email_hash
      ORDER BY l.created_at DESC NULLS LAST
    `) as Array<{
      owner_key: string;
      name: string | null;
      pi_display_name: string | null;
      member_count: number | string | null;
      created_at: string | null;
      has_card: boolean | null;
    }>;
    return rows.map<LabRow>((r) => ({
      ownerKey: r.owner_key,
      label: r.name?.trim()
        ? r.name
        : r.pi_display_name?.trim()
          ? `${r.pi_display_name}'s lab`
          : shortHashLabel(r.owner_key),
      memberCount: Number(r.member_count ?? 0),
      createdAt: r.created_at,
      hasCard: !!r.has_card,
    }));
  }, [] as LabRow[]);

  const labOwnerKeys = new Set(labRows.map((l) => l.ownerKey));

  // ── Solo users (every directory identity that is not a lab PI) ──
  // The display name, if any, comes from the account profile first, then the
  // published directory profile (joined via the identity fingerprint).
  const soloRows = await safe(async () => {
    const rows = (await sql`
      SELECT i.email_hash AS owner_key,
             i.created_at,
             ap.display_name AS account_name,
             dp.display_name AS profile_name,
             dp.affiliation,
             (b.stripe_customer_id IS NOT NULL) AS has_card,
             (s.owner_key IS NOT NULL) AS is_paid
      FROM directory_identities i
      LEFT JOIN account_profiles ap ON ap.owner_key = i.email_hash
      LEFT JOIN directory_profiles dp ON dp.fingerprint = i.fingerprint
      LEFT JOIN cloud_balance b ON b.owner_key = i.email_hash
      LEFT JOIN billing_subscriptions s
        ON s.owner_key = i.email_hash AND s.status = 'active'
      ORDER BY i.created_at DESC NULLS LAST
    `) as Array<{
      owner_key: string;
      created_at: string | null;
      account_name: string | null;
      profile_name: string | null;
      affiliation: string | null;
      has_card: boolean | null;
      is_paid: boolean | null;
    }>;
    return rows
      .filter((r) => !labOwnerKeys.has(r.owner_key))
      .map<SoloRow>((r) => {
        const name = r.account_name?.trim() || r.profile_name?.trim() || "";
        const label = name
          ? r.affiliation?.trim()
            ? `${name} (${r.affiliation})`
            : name
          : shortHashLabel(r.owner_key);
        return {
          ownerKey: r.owner_key,
          label,
          plan: r.is_paid ? "solo" : "free",
          createdAt: r.created_at,
          hasCard: !!r.has_card,
        };
      });
  }, [] as SoloRow[]);

  // ── Departments ──
  const deptRows = await safe(async () => {
    const rows = (await sql`
      SELECT d.dept_id,
             d.name,
             d.created_at,
             (SELECT count(*)::int FROM dept_members m
                WHERE m.dept_id = d.dept_id AND m.status = 'active') AS members,
             (ob.stripe_customer_id IS NOT NULL) AS has_card
      FROM departments d
      LEFT JOIN org_billing ob
        ON ob.tier = 'department' AND ob.entity_id = d.dept_id
      ORDER BY d.created_at DESC NULLS LAST
    `) as Array<{
      dept_id: string;
      name: string | null;
      created_at: string | null;
      members: number | string | null;
      has_card: boolean | null;
    }>;
    return rows.map<OrgRow>((r) => ({
      kind: "dept",
      id: r.dept_id,
      label: r.name?.trim() ? r.name : `Department ${r.dept_id.slice(0, 8)}`,
      memberCount: Number(r.members ?? 0),
      createdAt: r.created_at,
      hasCard: !!r.has_card,
    }));
  }, [] as OrgRow[]);

  // ── Institutions ──
  const instRows = await safe(async () => {
    const rows = (await sql`
      SELECT n.institution_id,
             n.name,
             n.created_at,
             (SELECT count(*)::int FROM institution_members m
                WHERE m.institution_id = n.institution_id AND m.status = 'active') AS members,
             (ob.stripe_customer_id IS NOT NULL) AS has_card
      FROM institutions n
      LEFT JOIN org_billing ob
        ON ob.tier = 'institution' AND ob.entity_id = n.institution_id
      ORDER BY n.created_at DESC NULLS LAST
    `) as Array<{
      institution_id: string;
      name: string | null;
      created_at: string | null;
      members: number | string | null;
      has_card: boolean | null;
    }>;
    return rows.map<OrgRow>((r) => ({
      kind: "institution",
      id: r.institution_id,
      label: r.name?.trim() ? r.name : `Institution ${r.institution_id.slice(0, 8)}`,
      memberCount: Number(r.members ?? 0),
      createdAt: r.created_at,
      hasCard: !!r.has_card,
    }));
  }, [] as OrgRow[]);

  // Depts and institutions share one list, institutions first then departments,
  // each already newest-first within its group.
  const depts: OrgRow[] = [...instRows, ...deptRows];

  return { solo: soloRows, labs: labRows, depts };
}
