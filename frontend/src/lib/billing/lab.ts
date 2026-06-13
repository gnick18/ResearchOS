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
  /**
   * How the row was created. 'directory' means it was reconciled from the lab's
   * DO membership roster (the member has real folder/data access). 'invite' means
   * the PI sponsored them by email through /api/billing/lab/members with no data
   * lab membership (an outside collaborator). The unified PI roster uses this to
   * separate true lab members from sponsored-only collaborators.
   */
  source: LabMemberSource;
}

export type LabMemberSource = "directory" | "invite";

type MemberRow = {
  lab_owner_key: string;
  member_owner_key: string;
  status: string;
  usage_visible: boolean | null;
  label: string | null;
  source: string | null;
};

function rowToMember(r: MemberRow): LabMemberRecord {
  return {
    labOwnerKey: r.lab_owner_key,
    memberOwnerKey: r.member_owner_key,
    status: r.status as LabMemberStatus,
    usageVisible: r.usage_visible === true,
    label: r.label ?? null,
    source: r.source === "directory" ? "directory" : "invite",
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
  // How the row was created. 'directory' rows are reconciled from the lab's DO
  // roster (auto-enroll on join, auto-remove on leave); 'invite' rows come from
  // the PI's manual /api/billing/lab/members sponsorship of an external owner.
  // The roster reconcile only manages 'directory' rows so it never clobbers a
  // manually-invited external member. Existing rows default to 'invite'.
  await sql`ALTER TABLE billing_lab_members ADD COLUMN IF NOT EXISTS source text not null default 'invite'`;
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
    SELECT lab_owner_key, member_owner_key, status, usage_visible, label, source
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
    SELECT lab_owner_key, member_owner_key, status, usage_visible, label, source
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

/**
 * The billing owner a doc's usage and cap resolve to. A member of a lab resolves
 * to their lab (the PI's owner key), so every member's storage and activity
 * aggregate into ONE shared lab pool against the PI's single allowance; the PI
 * and solo users resolve to themselves. This is the single rule that makes the
 * lab a shared resource (only the PI pays, no per-member free bonus) while solo
 * users keep their own free tier. See docs/proposals/LAB_SHARED_BILLING_POOL.md.
 *
 * FAIL-SAFE to the owner's own key on any error, so a directory hiccup bills a
 * member as solo (subject to a cap) rather than escaping enforcement entirely.
 */
export async function resolveBillingOwner(ownerKey: string): Promise<string> {
  try {
    return (await getSponsoringLab(ownerKey)) ?? ownerKey;
  } catch {
    return ownerKey;
  }
}

/**
 * Enrolls a member as ACTIVE in a lab in one step, for the directory lab-join
 * flow where the member already consented by REQUESTING to join and the PI
 * approved (so there is no separate invite/accept handshake). Unlike inviteMember
 * this needs no prior paid sub from the PI, because a free lab is still a shared
 * pool. Declines the member's other active labs first (one lab per member), then
 * upserts this row active. Idempotent.
 */
export async function enrollMemberActive(
  labOwnerKey: string,
  memberOwnerKey: string,
  label: string | null = null,
): Promise<void> {
  if (labOwnerKey === memberOwnerKey) return; // a PI is not their own member
  const sql = getSql();
  // One active sponsor per member: drop any other lab's active/invited row.
  await sql`
    UPDATE billing_lab_members SET status = 'declined', updated_at = now()
    WHERE member_owner_key = ${memberOwnerKey}
      AND lab_owner_key <> ${labOwnerKey}
      AND status <> 'declined'
  `;
  await sql`
    INSERT INTO billing_lab_members (lab_owner_key, member_owner_key, status, label, source, updated_at)
    VALUES (${labOwnerKey}, ${memberOwnerKey}, 'active', ${label}, 'directory', now())
    ON CONFLICT (lab_owner_key, member_owner_key) DO UPDATE SET
      status = 'active',
      label = COALESCE(${label}, billing_lab_members.label),
      source = 'directory',
      updated_at = now()
  `;
}

/**
 * Reconciles a lab's DIRECTORY-sourced membership to exactly the given member
 * set, for the DO roster reporting hook. Members who joined by an invite link
 * (membership lives in the LabRecordDO with no Neon touchpoint) are enrolled,
 * and directory members who left (a departure rotates the lab log, dropping them
 * from the roster) are removed. Idempotent and self-healing: each membership-log
 * change re-reports the full roster. Manually-invited external members (source
 * 'invite') are never touched, so the two sponsorship paths do not clobber each
 * other. See docs/proposals/LAB_SHARED_BILLING_POOL.md.
 */
export async function reconcileLabMembers(
  labOwnerKey: string,
  members: { memberOwnerKey: string; label?: string | null }[],
): Promise<void> {
  const sql = getSql();
  const wanted = new Set(members.map((m) => m.memberOwnerKey));

  // Enroll (or refresh) every current roster member as an active directory row.
  for (const m of members) {
    await enrollMemberActive(labOwnerKey, m.memberOwnerKey, m.label ?? null);
  }

  // Remove directory members who are no longer on the roster (they left the lab).
  // Only 'directory' rows, so a manual 'invite' sponsorship is left intact.
  const activeDir = (await sql`
    SELECT member_owner_key FROM billing_lab_members
    WHERE lab_owner_key = ${labOwnerKey}
      AND status = 'active'
      AND source = 'directory'
  `) as { member_owner_key: string }[];
  for (const row of activeDir) {
    if (!wanted.has(row.member_owner_key)) {
      await removeMember(labOwnerKey, row.member_owner_key);
    }
  }
}

// ---------------------------------------------------------------------------
// Unified PI roster classification (the one-roster-with-billing-chip view).
//
// The PI's lab has two memberships that live on different planes: data/folder
// access (the head-signed DO membership log, keyed by Ed25519 pubkey) and the
// billing pool (this table, keyed by email hash). The unified roster shows the
// DATA-lab members as the primary list, each annotated with a billing chip, and
// surfaces billing-only rows (sponsored outside collaborators with no data
// access) as a separate group. The keyspaces meet at the directory binding
// (pubkey -> email hash), resolved by the caller before this pure step.
// ---------------------------------------------------------------------------

/** A member's billing state relative to the PI's pool. */
export type LabBillingStatus =
  // An active paid/pooled seat in this lab.
  | "active"
  // Invited to the billing pool but not yet accepted (billing-only path).
  | "pending"
  // Has a directory identity but no billing row yet (e.g. reconcile has not run,
  // or billing is off). They will enroll on the next roster sync.
  | "unbilled"
  // In the data lab but no directory binding yet, so not billable at all until
  // their auto-bind lands on a future login (the timing-race case).
  | "no_identity";

/** A data-lab member, annotated with their billing status. */
export interface UnifiedLabMember {
  /** Display username from the DO roster. */
  username: string | null;
  /** Ed25519 pubkey (the DO roster identity). */
  pubkey: string;
  /** The resolved billing key (email hash), or null when unbound. */
  memberKey: string | null;
  billingStatus: LabBillingStatus;
  /** Whether the member opted into per-member usage visibility (billing rows). */
  usageVisible: boolean;
}

/** A billing-only sponsored collaborator (no data-lab membership). */
export interface SponsoredCollaborator {
  memberKey: string;
  label: string | null;
  status: LabMemberStatus;
  usageVisible: boolean;
}

export interface ClassifiedRoster {
  /** Data-lab members with their billing chip. */
  members: UnifiedLabMember[];
  /** Billing seats with no data-lab membership (outside collaborators). */
  sponsored: SponsoredCollaborator[];
}

/**
 * Pure join of the data-lab roster against the billing rows. The caller resolves
 * each DO roster member's pubkey to its directory binding email hash first
 * (null when unbound) and passes the billing rows from listLabMembers. No I/O,
 * so it is unit-testable.
 *
 * - members: every data-lab member, billing chip derived from a matching active/
 *   invited row, else unbilled (bound) or no_identity (unbound).
 * - sponsored: billing rows whose email hash is NOT a data-lab member, i.e. the
 *   PI sponsored them by email with no folder access (outside collaborators).
 *   Declined rows are already filtered out upstream by listLabMembers.
 */
export function classifyLabRoster(
  dataMembers: {
    pubkey: string;
    username: string | null;
    memberKey: string | null;
  }[],
  billingRows: LabMemberRecord[],
): ClassifiedRoster {
  const rowByKey = new Map(billingRows.map((r) => [r.memberOwnerKey, r]));
  const dataMemberKeys = new Set<string>();

  const members: UnifiedLabMember[] = dataMembers.map((dm) => {
    if (dm.memberKey) dataMemberKeys.add(dm.memberKey);
    const row = dm.memberKey ? rowByKey.get(dm.memberKey) : undefined;
    let billingStatus: LabBillingStatus;
    if (!dm.memberKey) {
      billingStatus = "no_identity";
    } else if (row?.status === "active") {
      billingStatus = "active";
    } else if (row?.status === "invited") {
      billingStatus = "pending";
    } else {
      billingStatus = "unbilled";
    }
    return {
      username: dm.username,
      pubkey: dm.pubkey,
      memberKey: dm.memberKey,
      billingStatus,
      usageVisible: row?.usageVisible === true,
    };
  });

  // Sponsored-only collaborators: any billing row that is not one of the data
  // members. These were added through the billing-only email-invite path and
  // have a seat without folder access.
  const sponsored: SponsoredCollaborator[] = billingRows
    .filter((r) => !dataMemberKeys.has(r.memberOwnerKey))
    .map((r) => ({
      memberKey: r.memberOwnerKey,
      label: r.label,
      status: r.status,
      usageVisible: r.usageVisible,
    }));

  return { members, sponsored };
}

