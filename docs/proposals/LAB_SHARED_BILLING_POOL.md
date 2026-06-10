# Lab shared billing pool (payer resolution)

Status: DESIGN, awaiting sign-off. 2026-06-09. Author: HR (orchestrator).
Related: PER_OWNER_STORAGE_TALLY.md (the per-owner tally this builds on),
COLLAB_STORAGE_D1_DO_MIGRATION.md (cost-enforcement gate),
METERED_STORAGE_PRICING.md (the pricing model), LLC_BUSINESS_OPS (metered storage).

House style: no em-dashes, no emojis, no mid-sentence colons.

## The model (Grant, 2026-06-09)

In lab mode only the lab head (PI) ever pays. A member joining a lab assumes the
PI already set the lab up, and if the lab is capped out that is on the PI, never
the member.

The free tier must NOT be per user. It is a single shared resource for the whole
lab. The reason the free tier exists at all is to subsidize SOLO users (the free
users carried by paying labs and donations). Donations are expected from lab
heads, not solo users. So a lab does not get a free bonus that scales with how
many people join it.

Worry being designed out: a PI spinning up a lab and farming the free tier, where
every member who joins adds another free allowance to the lab's shared storage.

## Current behavior and the gap

The per-owner tally + cap enforcement already shipped (PER_OWNER_STORAGE_TALLY.md,
commits 618a2dd99 + 300407031). Today:

- `collab_doc_sizes` is keyed by the DOC OWNER (the member who created the doc),
  resolved from the doc's Ed25519 owner_pubkey via getBindingByPubkey.
- `getOwnerUsage(ownerKey)` sums that one owner's docs.
- `quotaBytesForOwner(ownerKey)` returns the lab's PAID plan cap if the owner is
  an active member of a paid-plan lab (getSponsoringLab + isLabSponsor), else the
  owner's own active plan, else `FREE_ALLOWANCE_BYTES`. `activityAllowanceForOwner`
  mirrors this for writes/month.
- The DO cap check (owner-state route) maps the doc's owner_pubkey to the member
  and checks that MEMBER's usage vs that member's cap.

Three gaps versus the model above:

1. **Free tier is per user.** A lab member not on a paid lab plan gets their own
   `FREE_ALLOWANCE_BYTES`. A PI with N free members pools N free allowances into
   the lab. This is exactly the abuse vector.
2. **Even paid, the pool is not shared.** Usage is summed per member and each is
   checked against the full lab cap, so a lab of N members can hold N times the
   lab allowance.
3. **Directory lab-join is not linked to billing.** `billing_lab_members`
   (lab_owner_key <-> member_owner_key) is populated only by a SEPARATE billing
   invite flow (/api/billing/lab/members -> inviteMember, which today also
   requires the PI to already have an active paid sub). Joining a lab through the
   directory (the 8e approve path) does not enroll the member in the lab's
   billing pool, so getSponsoringLab returns null for directory-joined members
   and they are billed as solo.

## Design

One rule makes the whole model fall out.

> Bill every doc to **resolveBillingOwner(owner) = getSponsoringLab(owner) ?? owner**.

A lab member's storage and activity resolve to the PI's key (lab_owner_key, which
is the PI's `ownerKeyForEmail` and equals `directory_labs.pi_email_hash`). The PI
and solo users resolve to themselves. Apply this resolution at BOTH the tally
(usage) and the cap check (allowance), for storage AND activity.

Consequences, all for free:

- **One shared pool per lab.** All members' docs aggregate under the PI's key, so
  `getOwnerUsage(piKey)` is the lab-wide total and `quotaBytesForOwner(piKey)` is
  the lab's single allowance (the PI's plan if paid, else one
  `FREE_ALLOWANCE_BYTES`).
- **Only the PI pays.** Members never hold a subscription; they inherit the lab
  ceiling. Cap-out is checked against lab-wide usage, so it is the PI's problem.
- **No per-member free bonus.** Members resolve to the PI's one allowance. A free
  lab shares a single 1 GB pool no matter how many join.
- **Solo users unchanged.** resolveBillingOwner(solo) = solo, so each solo user
  keeps their own `FREE_ALLOWANCE_BYTES`, the subsidized free tier.

The PI's own docs resolve to the PI key directly (getSponsoringLab(piKey) is null
because the PI is the lab, not a member), so they land in the same pool. The lab
pool key IS the PI key. Nothing separate to maintain.

### Free lab allowance

A free lab (PI with no paid sub) gets one `FREE_ALLOWANCE_BYTES` (default 1 GB),
the same as a solo user, shared across the whole lab. Heavy labs upgrade (PI pays)
or donate, which matches "labs that really use this are the ones who pay or
donate." The number is a single constant and easy to tune; 1 GB shared is the
proposed default.

## Changes (file by file)

1. **`resolveBillingOwner(ownerKey)`** in `frontend/src/lib/billing/lab.ts` (or
   db.ts): `return (await getSponsoringLab(ownerKey)) ?? ownerKey`. Fail-safe to
   `ownerKey` on any error (a member is billed as solo rather than escaping a
   cap).

2. **Tally** (`/api/collab/doc-size`): after resolving ownerPubkey -> member
   emailHash, store usage under `resolveBillingOwner(emailHash)`. Usage then
   aggregates per lab. The route already re-runs on every ~5 min backup tick, so
   membership changes self-heal (a member who joins/leaves re-attributes within a
   tick).

3. **Cap check** (`/api/billing/owner-state`): resolve the member to the billing
   owner before comparing usage vs cap, so the DO blocks against the lab-wide pool.
   `getOwnerUsage` + `quotaBytesForOwner` are both called on the resolved key.

4. **Auto-link directory join -> billing membership**. On the lab-join approve
   path (`/api/directory/labs/request/resolve`, action 'approve', and the direct
   invite-link accept path), enroll the member as ACTIVE in `billing_lab_members`:
   map `labId -> directory_labs.pi_email_hash` (the lab_owner_key) and use
   `requesterEmailHash` as the member_owner_key. This must NOT require the PI to
   have a paid sub (free labs are still labs with a shared pool), so it bypasses
   the paid-sub gate that the manual /api/billing/lab/members invite enforces.
   On leave/removal from the lab, set the row to a non-active status so the member
   reverts to solo billing.

5. **Simplify `quotaBytesForOwner` / `activityAllowanceForOwner`**. With
   resolution upstream, the internal getSponsoringLab branch becomes redundant for
   the member path. Keep them correct for a directly-passed key (PI or solo):
   active plan -> plan allowance, else `FREE_ALLOWANCE_BYTES` / free writes. The
   per-member free fallback for lab members disappears because members are never
   passed to these functions unresolved.

## Edge cases

- **Member in no lab** -> resolveBillingOwner = self -> solo free tier. Correct.
- **Member of two labs** -> getSponsoringLab returns one active row (LIMIT 1).
  Acceptable; a person should realistically be billed to one lab. Flagged for
  Grant if multi-lab membership is a real case.
- **PI downgrades / sub lapses** -> the pool falls back to one free allowance
  shared by the whole lab (not N), which is the safe direction.
- **Member leaves mid-month** -> their docs re-attribute to solo on the next tally
  tick; their share of the lab pool frees up. Their own free tier then applies to
  whatever docs they still own.
- **Existing billing invite flow** (/api/billing/lab/members) stays as the path
  for a PI to sponsor someone who is NOT a directory lab member (e.g. an external
  collaborator). The auto-link just covers the common case.

## Verification

- Unit tests for `resolveBillingOwner` (member -> lab, solo -> self, error -> self).
- Unit tests that `getOwnerUsage` aggregates across members once tally is keyed by
  the resolved owner, and that `quotaBytesForOwner` returns one free allowance for
  a free lab regardless of member count.
- A test that approving a directory join enrolls the member active in
  `billing_lab_members` under the correct PI key (no paid sub required).
- The positive over-cap block path (member pushes the lab over the shared pool ->
  DO signals MSG_SYNC_BLOCKED "quota") is a BILLING_ENABLED launch-time test with
  a mock owner-state + a grant, same as the existing cap enforcement.

## As built (2026-06-09, dormant behind BILLING_ENABLED)

Grant signed off (same 1 GB shared free pool, free labs auto-enroll, build it).
Built with two refinements over the plan above:

- **Tally stays keyed by the REAL doc owner** (not the resolved billing owner).
  This preserves the PI's per-member usage breakdown (the usageVisible roster in
  /api/billing/lab) and keeps that route's existing aggregate correct. The shared
  pool is computed only at the enforcement layer.
- **Pool via one SQL subquery, not an array param.** `getLabPoolUsage(ownerKey)`
  (collab/server/db.ts) sums the owner's own docs OR any owner_hash that is an
  active member of that owner's lab, in a single scalar-param query (the Neon HTTP
  driver's array-parameter binding is unproven in this codebase). For a solo user
  the member subquery is empty, so the pool is just their own usage.

Files:
- `resolveBillingOwner(ownerKey)` + `enrollMemberActive(lab, member, label)` in
  `billing/lab.ts`.
- `getLabPoolUsage(ownerKey)` in `collab/server/db.ts`.
- `/api/billing/owner-state`: resolve the member to the billing owner, then
  compare `getLabPoolUsage(billingKey)` vs `quotaBytesForOwner(billingKey)`.
- `/api/directory/labs/request/resolve` (approve): best-effort
  `enrollMemberActive(piEmailHash, requesterEmailHash, name)`, no paid sub
  required.
- `quotaBytesForOwner` left UNCHANGED: with the upstream resolution it is always
  called on the PI/solo key, where it correctly returns one plan allowance or one
  `FREE_ALLOWANCE_BYTES`; its internal sponsor branch is simply dead for a
  resolved key.
- Unit test `billing/__tests__/lab-resolution.test.ts` pins the resolve contract
  (member -> lab, solo -> self, error -> self). SQL aggregation + enrollment
  verify at the BILLING_ENABLED launch-time integration test.

INVITE-LINK GAP CLOSED (2026-06-09). The LabRecordDO now reports its full member
roster to a new `/api/billing/lab/reconcile` endpoint on every membership-log
change (create + add/remove/rotate append), so a member who joins purely by a
shared invite link is enrolled in the lab's billing pool. The DO sends Ed25519
PUBKEYS only (Vercel resolves them to email hashes via getBindingByPubkey, no
email leaves the DO), best-effort + fail-silent + secret-gated, mirroring the
doc-size reporting hook. `reconcileLabMembers(labKey, members)` enrolls roster
members and removes directory members who left, and is idempotent + self-healing
(each log change re-reports the full roster). A `source` column ('directory' vs
'invite') keeps the reconcile from clobbering a manually-invited external member.
Verified: relay lab.mjs (create/append/rotate/get) all pass with the hook;
frontend tsc + 16 billing/collab tests pass. SQL aggregation + live enrollment
verify at the BILLING_ENABLED launch-time integration test.

## Out of scope

- The per-owner ACTIVITY throttle in the DO write path itself (the 429-style
  spacing) is still deferred to billing-go-live; this doc only makes the activity
  ALLOWANCE resolve to the lab pool, matching storage.
- Stripe proration / seat math. The PI buys storage/activity, not seats; members
  are free to the PI under the shared pool, so there is no per-seat billing.
