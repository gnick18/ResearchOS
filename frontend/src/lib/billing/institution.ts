// Institution tier Phase 4: the institution registry + department roster (Neon).
//
// An institution is a CONTAINER of departments, one payer above several dept
// pools (docs/proposals/2026-06-13-department-institution-tier.md). Mirrors
// billing/dept.ts one tier up. Keyed by a generated institution_id (NOT the
// admin's email hash) so an admin who also runs a dept/lab does not collide.
//
// institution_members is keyed by (institution_id, dept_id): the institution
// sponsors the DEPARTMENT (which sponsors its labs), so the link is to the dept,
// not the dept admin's person. One active institution per department.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

let sqlSingleton: NeonQueryFunction<false, false> | null = null;
function getSql(): NeonQueryFunction<false, false> {
  if (sqlSingleton) return sqlSingleton;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Institution billing cannot reach Neon.");
  sqlSingleton = neon(url);
  return sqlSingleton;
}

export type InstitutionMemberStatus = "invited" | "active" | "declined";

export interface InstitutionRecord {
  institutionId: string;
  name: string;
  adminOwnerKey: string;
  adminEd25519Pub: string;
}
export interface InstitutionDeptRecord {
  institutionId: string;
  deptId: string;
  status: InstitutionMemberStatus;
  label: string | null;
}

type InstRow = {
  institution_id: string;
  name: string;
  admin_owner_key: string;
  admin_ed25519_pub: string;
};
type DeptMemberRow = {
  institution_id: string;
  dept_id: string;
  status: string;
  label: string | null;
};

export async function ensureInstitutionSchema(): Promise<void> {
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS institutions (
      institution_id    text primary key,
      name              text not null,
      admin_owner_key   text not null,
      admin_ed25519_pub text not null,
      created_at        timestamptz default now(),
      updated_at        timestamptz default now()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS institution_members (
      institution_id text not null,
      dept_id        text not null,
      status         text not null default 'invited',
      label          text,
      created_at     timestamptz default now(),
      updated_at     timestamptz default now(),
      primary key (institution_id, dept_id)
    )
  `;
  // A department is sponsored by at most one institution at a time.
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_institution_dept
      ON institution_members (dept_id)
      WHERE status = 'active'
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS institution_usage_snapshots (
      institution_id text not null,
      ym             text not null,
      storage_bytes  bigint not null default 0,
      sync_count     integer not null default 0,
      updated_at     timestamptz default now(),
      primary key (institution_id, ym)
    )
  `;
}

export async function createInstitution(rec: InstitutionRecord): Promise<void> {
  const sql = getSql();
  await sql`
    INSERT INTO institutions (institution_id, name, admin_owner_key, admin_ed25519_pub, updated_at)
    VALUES (${rec.institutionId}, ${rec.name}, ${rec.adminOwnerKey}, ${rec.adminEd25519Pub}, now())
    ON CONFLICT (institution_id) DO UPDATE SET
      name = ${rec.name},
      admin_owner_key = ${rec.adminOwnerKey},
      admin_ed25519_pub = ${rec.adminEd25519Pub},
      updated_at = now()
  `;
}

export async function getInstitution(institutionId: string): Promise<InstitutionRecord | null> {
  const sql = getSql();
  const rows = (await sql`
    SELECT institution_id, name, admin_owner_key, admin_ed25519_pub
    FROM institutions WHERE institution_id = ${institutionId} LIMIT 1
  `) as InstRow[];
  if (!rows.length) return null;
  const r = rows[0];
  return {
    institutionId: r.institution_id,
    name: r.name,
    adminOwnerKey: r.admin_owner_key,
    adminEd25519Pub: r.admin_ed25519_pub,
  };
}

export async function getInstitutionByAdmin(
  adminOwnerKey: string,
): Promise<InstitutionRecord | null> {
  const sql = getSql();
  const rows = (await sql`
    SELECT institution_id, name, admin_owner_key, admin_ed25519_pub
    FROM institutions WHERE admin_owner_key = ${adminOwnerKey}
    ORDER BY created_at LIMIT 1
  `) as InstRow[];
  if (!rows.length) return null;
  const r = rows[0];
  return {
    institutionId: r.institution_id,
    name: r.name,
    adminOwnerKey: r.admin_owner_key,
    adminEd25519Pub: r.admin_ed25519_pub,
  };
}

/** Enrolls a department as ACTIVE in an institution (the accept path). One active
 *  institution per dept: declines the dept's other institutions first. Idempotent. */
export async function enrollDeptActive(
  institutionId: string,
  deptId: string,
  label: string | null = null,
): Promise<void> {
  const sql = getSql();
  await sql`
    UPDATE institution_members SET status = 'declined', updated_at = now()
    WHERE dept_id = ${deptId}
      AND institution_id <> ${institutionId}
      AND status <> 'declined'
  `;
  await sql`
    INSERT INTO institution_members (institution_id, dept_id, status, label, updated_at)
    VALUES (${institutionId}, ${deptId}, 'active', ${label}, now())
    ON CONFLICT (institution_id, dept_id) DO UPDATE SET
      status = 'active',
      label = COALESCE(${label}, institution_members.label),
      updated_at = now()
  `;
}

export async function listInstitutionDepts(
  institutionId: string,
): Promise<InstitutionDeptRecord[]> {
  const sql = getSql();
  const rows = (await sql`
    SELECT institution_id, dept_id, status, label
    FROM institution_members
    WHERE institution_id = ${institutionId} AND status <> 'declined'
    ORDER BY status, created_at
  `) as DeptMemberRow[];
  return rows.map((r) => ({
    institutionId: r.institution_id,
    deptId: r.dept_id,
    status: r.status as InstitutionMemberStatus,
    label: r.label ?? null,
  }));
}

export async function removeDept(institutionId: string, deptId: string): Promise<void> {
  const sql = getSql();
  await sql`
    DELETE FROM institution_members
    WHERE institution_id = ${institutionId} AND dept_id = ${deptId}
  `;
}

/** The institution that actively sponsors a department, or null. The payer-cascade
 *  hook (member -> lab -> dept -> institution) for the billing phase. */
export async function getInstitutionForDept(deptId: string): Promise<string | null> {
  const sql = getSql();
  const rows = (await sql`
    SELECT institution_id FROM institution_members
    WHERE dept_id = ${deptId} AND status = 'active' LIMIT 1
  `) as { institution_id: string }[];
  return rows.length ? rows[0].institution_id : null;
}

export async function recordInstitutionUsageSnapshot(
  institutionId: string,
  ym: string,
  storageBytes: number,
  syncCount: number,
): Promise<void> {
  const sql = getSql();
  await sql`
    INSERT INTO institution_usage_snapshots (institution_id, ym, storage_bytes, sync_count, updated_at)
    VALUES (${institutionId}, ${ym}, ${Math.round(storageBytes)}, ${Math.round(syncCount)}, now())
    ON CONFLICT (institution_id, ym) DO UPDATE SET
      storage_bytes = ${Math.round(storageBytes)},
      sync_count = ${Math.round(syncCount)},
      updated_at = now()
  `;
}

export async function getInstitutionUsageHistory(
  institutionId: string,
  months = 6,
): Promise<Array<{ ym: string; storageBytes: number; syncCount: number }>> {
  const sql = getSql();
  const rows = (await sql`
    SELECT ym, storage_bytes, sync_count
    FROM institution_usage_snapshots
    WHERE institution_id = ${institutionId}
    ORDER BY ym DESC LIMIT ${months}
  `) as { ym: string; storage_bytes: number; sync_count: number }[];
  return rows
    .map((r) => ({
      ym: r.ym,
      storageBytes: Number(r.storage_bytes),
      syncCount: Number(r.sync_count),
    }))
    .reverse();
}
