# Department + Institution tier

Status: DESIGN, decisions locked with Grant 2026-06-13. Mockup-first before code.
Builds on: the Lab tier + the lab-systems convergence + unified roster (this is
the org/billing layer ABOVE the lab). Related: `2026-06-13-lab-systems-convergence.md`,
the pricing model in AGENTS.md (dept/inst pay a sustaining rate via a recurring
Stripe invoice to procurement).

House style: no em-dashes, no emojis, no mid-sentence colons.

## The model (Grant)

A strict tier hierarchy, each level inviting only the level directly below:

```
Institution  --invites-->  Department admins
Department   --invites-->  Lab heads (PIs)
Lab head     --invites-->  Members        <-- EXISTING system, unchanged
```

- A **Department** admin sends lab-head invite links, sees who accepted, and sees
  the labs (and their members) under the department.
- An **Institution** admin is one more layer on top, inviting a department admin
  per department, seeing the departments and their roll-up.
- Lab-head -> member enrollment is the system we already shipped; it is reused
  verbatim, not rebuilt.

## The key architectural decision (LOCKED): org + billing, NOT a crypto tier

The Lab tier has two planes: a crypto/data plane (the head-signed `LabRecordDO`
plus sealed lab keys, giving members cryptographic access to SHARED LAB DATA) and
a billing/org plane (the Neon roster). A department does NOT share a data folder.
A dept admin manages billing, org structure, and acceptance/usage visibility, and
never decrypts a lab's research data. So the dept/institution layer is **org +
billing only**:

- NO `DeptRecordDO` / `InstitutionRecordDO`, NO sealed key envelopes, NO lab-key
  cascade. Those exist only because labs share encrypted data; the org tiers do not.
- Invite ACCEPTANCE records to Neon (a roster row + identity binding), not to a
  signed membership-log DO.

This is dramatically smaller and lower-risk than replicating the lab crypto stack
two levels up.

## What is reused (patterns, not the crypto)

- **Signed invite links** (`lib/lab/lab-invite.ts` pattern): a dept admin mints a
  single-use, expiring, head-signed capability link for a lab head; the verb is
  domain-separated ("dept-invite" vs "lab-invite"). The link proves the dept admin
  authored it. The lab head accepts by signing in; acceptance is recorded in Neon
  (no key sealing). Same pattern one level up for institution -> dept-admin.
- **Billing roster** (`lib/billing/lab.ts` pattern): new `billing_dept_members`
  (dept_owner_key -> lab_owner_key, status, label, source) and later
  `billing_institution_members` (institution_owner_key -> dept_owner_key, ...),
  mirroring `billing_lab_members`. The lab<->member table is untouched.
- **Payer cascade**: extend `resolveBillingOwner` from member -> lab to
  member -> lab -> dept -> institution. The highest paying tier covers everything
  below it, which is the "dept/institution pays a sustaining rate that funds the
  free individual tiers" model.
- **Account roles**: extend `AccountType` to add `dept_admin` and
  `institution_admin`; add `dept_id` / `institution_id` to UserSettings + a
  lab's dept linkage. A person can hold multiple roles.
- **Admin panel pattern**: the dept/institution admin screens mirror the People /
  `LabMembershipPanel` shape (invite, see acceptances, roster, roll-up), extended
  into a usage + cost command center (below).
- **Directory** (`lib/sharing/directory`): new `directory_depts` /
  `directory_institutions` listings + request-to-join, mirroring `directory_labs`.

## The Department admin screen (the rich part, per Grant)

Not just a roster. A department admin paying for their labs gets a command center
to see what they pay for and right-size it over time:

- **Roster**: lab heads who accepted + each lab's registered account names,
  grouped by lab. (Identities + names are visible to the dept admin who pays;
  research data contents are NEVER exposed.)
- **Usage breakdown**: department total, then per-lab, then per-account, for
  storage + activity.
- **Usage over time**: trend summaries (month over month) so the admin can see
  where usage is going and forecast.
- **Plan right-sizing**: built-in controls to raise or lower the monthly plan
  based on actual usage, so the amount paid can be optimized to real need over
  time (the self-serve plan builder from the pricing model).
- **Invite**: send lab-head invite links + see pending vs accepted.

DEPENDENCY: usage-over-time needs historical usage, not just the current snapshot.
Today `getOwnerUsage` (current bytes) + `opsSince` (this-month writes) exist; a
per-owner usage-history (monthly snapshots) is a new foundation this screen needs.

## Privacy model

The dept admin (the payer) sees: lab-head identities, registered account names,
and usage figures broken down by lab + account. They do NOT see research data
(notes, experiments, files) or member PII beyond the account name/email already
part of the org relationship. Institution admin sees the same one level up
(departments + their roll-up), not individual member data.

## Billing (the heaviest new piece)

Per the pricing model, dept/institution bill via a **recurring Stripe invoice to
procurement**, NOT the hosted-checkout flow individuals/labs use. None of that
exists yet (only `INDIVIDUAL_PLANS` + `LAB_PLANS` + hosted checkout). New work:
- A `department` plan audience + a self-serve plan builder (size by labs/seats/
  usage), priced at the sustaining rate above bare cost.
- The Stripe recurring-invoice-to-procurement flow (vs Checkout).
- Payer-cascade enforcement so a lab in a paying dept resolves its members'
  storage to the dept's allowance.
This piece is gated on Grant's Stripe products + the WI sales-tax determination
(the same gate as lab go-live), so it can be the LAST sub-phase.

## Phasing (Department first)

1. **Org foundation**: `dept_admin` role + dept_id linkage; dept directory +
   signed lab-head invite links + Neon acceptance; the dept roster (lab heads +
   accepted status). No charging yet.
2. **Usage command center**: per-lab / per-account usage breakdown + the
   usage-history foundation + over-time summaries on the dept admin screen.
3. **Billing**: department plan + the self-serve right-sizing builder + the Stripe
   procurement-invoice flow + the member->lab->dept payer cascade. (Gated on
   Stripe + WI sales tax.)
4. **Institution tier**: the same org+billing pattern one level up (institution ->
   dept-admin invites, `billing_institution_members`, institution admin screen,
   payer cascade dept->institution). A later layer once Department is solid.

## Open items for the mockup review

- The exact dept admin dashboard layout (roster + usage breakdown + over-time +
  plan right-sizing in one screen, or tabbed).
- How the plan right-sizing presents (a recommended size from observed usage? a
  manual seat/storage slider? both?).
- Where dept-admin mode lives in nav (a dept lens like the PI lab lens, or a
  dedicated /department surface).

Next step: an interactive mockup of the Department admin dashboard for Grant to
review (per the UI-review-via-mockup convention) before any build.
