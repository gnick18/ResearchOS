// Department tier Phase 1: the department registry + lab-head roster (Neon).
//
// A department is a CONTAINER of labs, one payer above several lab pools (see
// docs/proposals/2026-06-13-department-institution-tier.md). This is the org +
// billing layer ONE tier above billing/lab.ts; it mirrors that file's shape.
//
// Two tables.
//   departments:  (dept_id) -> name, admin_owner_key, admin_ed25519_pub. The dept
//     is keyed by a generated dept_id (NOT the admin's email hash) so a dept admin
//     who is ALSO a lab head does not collide with their own lab in
//     billing_lab_members.
//   dept_members: (dept_id, labhead_owner_key) -> status. A lab head is sponsored
//     by at most one department at a time (enforced by a partial unique index).
//
// Phase 1 is org only (no charging): the payer cascade lab -> dept lands with the
// billing phase. getDeptForLabHead is provided now so that cascade can hook in.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

let sqlSingleton: NeonQueryFunction<false, false> | null = null;

function getSql(): NeonQueryFunction<false, false> {
  if (sqlSingleton) return sqlSingleton;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set. Dept billing cannot reach Neon.");
  }
  sqlSingleton = neon(url);
  return sqlSingleton;
}

export type DeptMemberStatus = "invited" | "active" | "declined";
export type DeptMemberSource = "invite" | "directory";

export interface DepartmentRecord {
  deptId: string;
  name: string;
  /** The dept admin's peppered email hash (ownerKeyForEmail). */
  adminOwnerKey: string;
  /** Hex Ed25519 admin pubkey, used to verify dept invite signatures. */
  adminEd25519Pub: string;
}

export interface DeptLabHeadRecord {
  deptId: string;
  labHeadOwnerKey: string;
  status: DeptMemberStatus;
  /** The label the admin typed when inviting (display only, PI-side). */
  label: string | null;
  source: DeptMemberSource;
}

type DeptRow = {
  dept_id: string;
  name: string;
  admin_owner_key: string;
  admin_ed25519_pub: string;
};
type MemberRow = {
  dept_id: string;
  labhead_owner_key: string;
  status: string;
  label: string | null;
  source: string | null;
};

export async function ensureDeptSchema(): Promise<void> {
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS departments (
      dept_id           text primary key,
      name              text not null,
      admin_owner_key   text not null,
      admin_ed25519_pub text not null,
      created_at        timestamptz default now(),
      updated_at        timestamptz default now()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS dept_members (
      dept_id           text not null,
      labhead_owner_key text not null,
      status            text not null default 'invited',
      label             text,
      source            text not null default 'invite',
      created_at        timestamptz default now(),
      updated_at        timestamptz default now(),
      primary key (dept_id, labhead_owner_key)
    )
  `;
  // A lab head is sponsored by at most one department at a time.
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_dept_labhead
      ON dept_members (labhead_owner_key)
      WHERE status = 'active'
  `;
}

/** Creates a department (idempotent on dept_id). The caller becomes the admin. */
export async function createDepartment(rec: DepartmentRecord): Promise<void> {
  const sql = getSql();
  await sql`
    INSERT INTO departments (dept_id, name, admin_owner_key, admin_ed25519_pub, updated_at)
    VALUES (${rec.deptId}, ${rec.name}, ${rec.adminOwnerKey}, ${rec.adminEd25519Pub}, now())
    ON CONFLICT (dept_id) DO UPDATE SET
      name = ${rec.name},
      admin_owner_key = ${rec.adminOwnerKey},
      admin_ed25519_pub = ${rec.adminEd25519Pub},
      updated_at = now()
  `;
}

export async function getDepartment(deptId: string): Promise<DepartmentRecord | null> {
  const sql = getSql();
  const rows = (await sql`
    SELECT dept_id, name, admin_owner_key, admin_ed25519_pub
    FROM departments WHERE dept_id = ${deptId} LIMIT 1
  `) as DeptRow[];
  if (!rows.length) return null;
  const r = rows[0];
  return {
    deptId: r.dept_id,
    name: r.name,
    adminOwnerKey: r.admin_owner_key,
    adminEd25519Pub: r.admin_ed25519_pub,
  };
}

/**
 * Enrolls a lab head as ACTIVE in a department in one step, for the dept-join
 * flow where the lab head already consented by accepting the signed invite link
 * (so there is no separate invite/accept handshake row). Declines the lab head's
 * other departments first (one dept per lab head), then upserts active. Idempotent.
 */
export async function enrollLabHeadActive(
  deptId: string,
  labHeadOwnerKey: string,
  label: string | null = null,
): Promise<void> {
  const sql = getSql();
  // One active department per lab head: drop any other dept's row first, so the
  // partial unique index never sees two active rows mid-transition.
  await sql`
    UPDATE dept_members SET status = 'declined', updated_at = now()
    WHERE labhead_owner_key = ${labHeadOwnerKey}
      AND dept_id <> ${deptId}
      AND status <> 'declined'
  `;
  await sql`
    INSERT INTO dept_members (dept_id, labhead_owner_key, status, label, source, updated_at)
    VALUES (${deptId}, ${labHeadOwnerKey}, 'active', ${label}, 'invite', now())
    ON CONFLICT (dept_id, labhead_owner_key) DO UPDATE SET
      status = 'active',
      label = COALESCE(${label}, dept_members.label),
      updated_at = now()
  `;
}

/** The department's lab-head roster (active + invited), for the admin's view. */
export async function listDeptLabHeads(deptId: string): Promise<DeptLabHeadRecord[]> {
  const sql = getSql();
  const rows = (await sql`
    SELECT dept_id, labhead_owner_key, status, label, source
    FROM dept_members
    WHERE dept_id = ${deptId} AND status <> 'declined'
    ORDER BY status, created_at
  `) as MemberRow[];
  return rows.map((r) => ({
    deptId: r.dept_id,
    labHeadOwnerKey: r.labhead_owner_key,
    status: r.status as DeptMemberStatus,
    label: r.label ?? null,
    source: r.source === "directory" ? "directory" : "invite",
  }));
}

/** The dept admin removes a lab head (or rescinds). Reverts the lab to self-billing. */
export async function removeLabHead(
  deptId: string,
  labHeadOwnerKey: string,
): Promise<void> {
  const sql = getSql();
  await sql`
    DELETE FROM dept_members
    WHERE dept_id = ${deptId} AND labhead_owner_key = ${labHeadOwnerKey}
  `;
}

/**
 * The department that actively sponsors a lab head, or null. This is the hook the
 * payer cascade (member -> lab -> dept) will use once billing lands: a lab whose
 * head is active in a paying department resolves its pool up to the department.
 */
export async function getDeptForLabHead(
  labHeadOwnerKey: string,
): Promise<string | null> {
  const sql = getSql();
  const rows = (await sql`
    SELECT dept_id FROM dept_members
    WHERE labhead_owner_key = ${labHeadOwnerKey} AND status = 'active'
    LIMIT 1
  `) as { dept_id: string }[];
  return rows.length ? rows[0].dept_id : null;
}
