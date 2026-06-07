// Flat-plan billing, lab-level (consolidated) sponsorship.
//
// A lab head (PI) can pay for their whole lab on one invoice. This file owns the
// membership registry and the resolution helpers that decide who pays for a
// given owner's storage.
//
// Membership model (Grant 2026-06-07): EXPLICIT enrollment, member MUST ACCEPT.
// The PI invites a member by email (we store only the peppered owner-key hash,
// never the address), which writes an 'invited' row. The member accepts or
// declines from their own settings; only on accept does the lab start paying for
// them and any individual subscription they held end. A member is sponsored by
// at most one lab at a time, so accepting one invite declines the rest.
//
// One table.
//   billing_lab_members: (lab_owner_key, member_owner_key) -> status, where
//     status is 'invited' | 'active' | 'declined'. The PI is NOT stored here as
//     a member of their own lab; they are implied by owning the lab. The pooled
//     free tier counts the PI plus every 'active' member.
//
// Resolution. getSponsoringLab(memberKey) returns the lab_owner_key that an
// active row points at, or null. Payer resolution for a doc is then: the doc
// owner's sponsoring lab if that lab is on a paid lab plan, else the owner's own
// plan.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

let sqlSingleton: NeonQueryFunction<false, false> | null = null;

function getSql(): NeonQueryFunction<false, false> {
  if (sqlSingleton) return sqlSingleton;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set. Lab billing cannot reach Neon.");
  }
  sqlSingleton = neon(url);
  return sqlSingleton;
}

export type LabMemberStatus = "invited" | "active" | "declined";

export interface LabMemberRecord {
  labOwnerKey: string;
  memberOwnerKey: string;
  status: LabMemberStatus;
  /**
   * Whether the member opted in to showing their INDIVIDUAL usage to the PI. The
   * lab aggregate is always visible; per-member usage defaults to private until
   * the member turns this on (Grant 2026-06-07).
   */
  usageVisible: boolean;
  /**
   * The email the PI typed when inviting this member, kept so the PI's roster is
   * readable (a list of bare hashes is useless). PI-only: it is returned to the
   * lab owner for their own roster and never exposed to other members. The PI
   * already possesses these addresses, this just remembers them.
   */
  label: string | null;
}

type MemberRow = {
  lab_owner_key: string;
  member_owner_key: string;
  status: string;
  usage_visible: boolean | null;
  label: string | null;
};

function rowToMember(r: MemberRow): LabMemberRecord {
  return {
    labOwnerKey: r.lab_owner_key,
    memberOwnerKey: r.member_owner_key,
    status: r.status as LabMemberStatus,
    usageVisible: r.usage_visible === true,
    label: r.label ?? null,
  };
}

export async function ensureLabSchema(): Promise<void> {
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS billing_lab_members (
      lab_owner_key    text not null,
      member_owner_key text not null,
      status           text not null default 'invited',
      created_at       timestamptz default now(),
      updated_at       timestamptz default now(),
      primary key (lab_owner_key, member_owner_key)
    )
  `;
  await sql`ALTER TABLE billing_lab_members ADD COLUMN IF NOT EXISTS usage_visible boolean not null default false`;
  await sql`ALTER TABLE billing_lab_members ADD COLUMN IF NOT EXISTS label text`;
  // A member can be sponsored by at most one lab at once. Enforced at the data
  // layer too, so a race cannot leave two active sponsors for one owner.
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_member
      ON billing_lab_members (member_owner_key)
      WHERE status = 'active'
  `;
}

/** The member toggles whether their individual usage is visible to the PI. */
export async function setMemberUsageVisibility(
  labOwnerKey: string,
  memberOwnerKey: string,
  visible: boolean,
): Promise<void> {
  const sql = getSql();
  await sql`
    UPDATE billing_lab_members SET usage_visible = ${visible}, updated_at = now()
    WHERE lab_owner_key = ${labOwnerKey} AND member_owner_key = ${memberOwnerKey}
  `;
}

/**
 * Invites a member into a lab (idempotent). A fresh or previously-declined row
 * becomes 'invited' again; an already-active membership is left untouched so a
 * re-invite never disturbs a paying relationship.
 */
export async function inviteMember(
  labOwnerKey: string,
  memberOwnerKey: string,
  label: string | null = null,
): Promise<void> {
  if (labOwnerKey === memberOwnerKey) return; // a PI is not their own member
  const sql = getSql();
  await sql`
    INSERT INTO billing_lab_members (lab_owner_key, member_owner_key, status, label, updated_at)
    VALUES (${labOwnerKey}, ${memberOwnerKey}, 'invited', ${label}, now())
    ON CONFLICT (lab_owner_key, member_owner_key) DO UPDATE SET
      status = CASE WHEN billing_lab_members.status = 'active'
                    THEN 'active' ELSE 'invited' END,
      label = COALESCE(${label}, billing_lab_members.label),
      updated_at = now()
  `;
}

/**
 * The member accepts a lab's invite. Sets that row active and declines every
 * OTHER lab's row for the same member, so a member ends up sponsored by exactly
 * one lab. Returns false when there was no invite to accept.
 */
export async function acceptInvite(
  labOwnerKey: string,
  memberOwnerKey: string,
): Promise<boolean> {
  const sql = getSql();
  // Decline any other lab's rows for this member first, so the partial unique
  // index never sees two active rows mid-transition.
  await sql`
    UPDATE billing_lab_members SET status = 'declined', updated_at = now()
    WHERE member_owner_key = ${memberOwnerKey}
      AND lab_owner_key <> ${labOwnerKey}
      AND status <> 'declined'
  `;
  const rows = (await sql`
    UPDATE billing_lab_members SET status = 'active', updated_at = now()
    WHERE lab_owner_key = ${labOwnerKey}
      AND member_owner_key = ${memberOwnerKey}
      AND status = 'invited'
    RETURNING member_owner_key
  `) as { member_owner_key: string }[];
  return rows.length > 0;
}

/** The member declines a lab's invite. Idempotent. */
export async function declineInvite(
  labOwnerKey: string,
  memberOwnerKey: string,
): Promise<void> {
  const sql = getSql();
  await sql`
    UPDATE billing_lab_members SET status = 'declined', updated_at = now()
    WHERE lab_owner_key = ${labOwnerKey} AND member_owner_key = ${memberOwnerKey}
  `;
}

/**
 * The PI removes a member (or rescinds an invite). The row is deleted, and the
 * member reverts to individual billing for docs they own. Nothing is deleted
 * from their storage; the same freeze rules apply if they were over the free
 * tier.
 */
export async function removeMember(
  labOwnerKey: string,
  memberOwnerKey: string,
): Promise<void> {
  const sql = getSql();
  await sql`
    DELETE FROM billing_lab_members
    WHERE lab_owner_key = ${labOwnerKey} AND member_owner_key = ${memberOwnerKey}
  `;
}

/** Every row (invited + active) for a lab, for the PI's roster view. */
export async function listLabMembers(
  labOwnerKey: string,
): Promise<LabMemberRecord[]> {
  const sql = getSql();
  const rows = (await sql`
    SELECT lab_owner_key, member_owner_key, status, usage_visible, label
    FROM billing_lab_members
    WHERE lab_owner_key = ${labOwnerKey} AND status <> 'declined'
    ORDER BY status, created_at
  `) as MemberRow[];
  return rows.map(rowToMember);
}

/** Open invites awaiting a given member's decision, for their settings UI. */
export async function listInvitesForMember(
  memberOwnerKey: string,
): Promise<LabMemberRecord[]> {
  const sql = getSql();
  const rows = (await sql`
    SELECT lab_owner_key, member_owner_key, status, usage_visible, label
    FROM billing_lab_members
    WHERE member_owner_key = ${memberOwnerKey} AND status = 'invited'
    ORDER BY created_at
  `) as MemberRow[];
  return rows.map(rowToMember);
}

/**
 * The lab that actively sponsors a member, or null. This is the heart of payer
 * resolution: a member with an active row is billed through their lab, never
 * individually.
 */
export async function getSponsoringLab(
  memberOwnerKey: string,
): Promise<string | null> {
  const sql = getSql();
  const rows = (await sql`
    SELECT lab_owner_key FROM billing_lab_members
    WHERE member_owner_key = ${memberOwnerKey} AND status = 'active'
    LIMIT 1
  `) as { lab_owner_key: string }[];
  return rows.length ? rows[0].lab_owner_key : null;
}

