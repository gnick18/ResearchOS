# Converging the two lab systems (data lab + billing lab)

Status: DIRECTION SET (Grant chose lazy + hardened, 2026-06-13). Build scope below.
Related: `LAB_SHARED_BILLING_POOL.md` (the shared-pool model this builds on),
`docs/testing/lab-funnel-controlled-harness.md`, the PI-experience handoff
`~/Desktop/HandoffForAgents/2026-06-12_pi-experience-and-lab-funnel.md` (section D).

House style: no em-dashes, no emojis, no mid-sentence colons.

## Why this exists

The 2026-06-12 funnel session flagged that ResearchOS has two parallel lab
systems and "no single call enrolls a member into both at once." That is true at
the API surface, but the real state is more specific than the one-liner, and the
specifics change what the right fix is. This doc records what is actually wired
today (with file references), names the genuine seams, and lays out the one
direction call that needs Grant before any code.

## The two systems, precisely

### System 1, the DATA lab (who can read and edit lab data)

Source of truth for folder/data access. Lives in the `LabRecordDO` on Cloudflare
plus the head-signed membership log.

- A member joins by an invite LINK, not by email. The head mints a signed
  capability (`mintLabInvite`, `lab-invite.ts`), the member accepts with whatever
  identity they choose, and their OAuth email is harvested and sealed to the head
  at accept time (privacy, the head does not know the member's email up front).
- The head finalizes the accept (`finalizePendingAccepts` ->
  `finalizeLabAccepts`), which appends the member to the membership-log roster in
  the DO.
- Identity keyspace: Ed25519 / X25519 pubkeys. Only the head's signing key can
  append to the log, so this membership can ONLY be mutated client-side by the
  head.

### System 2, the BILLING lab (who the PI pays for / the shared pool)

Source of truth for seats. Lives in Neon `billing_lab_members`, keyed by peppered
email-hash owner keys (`billing/lab.ts`).

A row becomes `active` two different ways:

- **2a, billing-only invite (`source = 'invite'`).** PI invites by email at
  `POST /api/billing/lab/members`, member accepts at `/api/billing/lab/respond`.
  Grants a paid SEAT and pool membership. Grants NO data access. Identity keyspace:
  email-hash.
- **2b, the auto bridge (`source = 'directory'`).** The DO posts its full roster
  to `POST /api/billing/lab/reconcile` on every membership-log change
  (`relay/src/worker.ts:3185` and `:3328` call `reportLabRoster`), which resolves
  each member pubkey to its directory binding email-hash and calls
  `enrollMemberActive`. This is the existing, one-directional DATA -> BILLING
  bridge. Its own comment says it "closes the invite-link gap."

So the systems are NOT fully disjoint. A member who joins the data lab AND has a
directory binding is auto-enrolled into the billing pool already, asynchronously.

## The actual seams (what still diverges, and why)

1. **The pubkey -> email-hash sync is a timing race (biggest correctness risk).**
   `reconcile` resolves each member via `getBindingByPubkey`. Every lab member
   DOES get a directory binding automatically (`autoBindLabProfile`, fired from
   `lab-session-effects.ts:254` on their first lab OAuth login), so the keyspaces
   are not fundamentally disjoint and NO placeholder schema is needed. The hole is
   ordering: the head appends the member to the DO log (which fires reconcile) at
   FINALIZE time, which can be before the member has next logged in and bound, or
   before the best-effort auto-bind succeeds (it silently retries next login). So
   reconcile runs, finds no binding yet, and silently skips them. The binding lands
   later, but reconcile only re-fires on the NEXT membership-log change, which may
   never come, so the member stays uncounted indefinitely. The fix is a RESYNC
   trigger once the binding lands, not a schema change.

2. **The reverse direction does not exist, and structurally cannot be a single
   transaction.** A PI who uses path 2a (billing-only email invite) grants a seat
   with no data access, and nothing adds them to the data lab. Billing lives on
   Vercel/Neon, the data log lives in the head-signed Cloudflare DO. No server
   holds the head's signing key, so no server-side call can enroll someone into
   the data lab. The ONLY actor that can mutate both planes is the head's own
   browser (it has the signing key and an authenticated billing session).

3. **The bridge is silently gated and best-effort.** `reportLabRoster` no-ops if
   the relay has no `APP_BASE_URL` (`worker.ts:3078`), and the POST is
   fail-silent with no retry and no periodic resync. If APP_BASE_URL is unset, or
   one POST fails and no further membership change follows, billing stays stale
   with no signal.

4. **The PI sees two mental models.** "Invite to lab" (data) and "sponsor a
   member" (billing) are separate surfaces with separate rosters, so the PI cannot
   answer "who is in my lab and is each one a paid seat" from one place.

## The structural constraint that decides the shape

Convergence cannot be a literal single DB transaction across both planes, because
the two memberships live on different trust planes and only the head's client can
write the data plane. Whatever we build, the data lab stays the authoritative
membership and billing is DERIVED from it. The real question is only HOW eagerly
billing is kept in sync, and how we present it to the PI.

Also note: the head does not have the member's email until accept time, so even an
"eager" enroll can only run at FINALIZE (when the head appends the member), not at
invite-mint, and it still routes through the same pubkey -> email-hash resolution.
This is why building a parallel eager billing path mostly duplicates the existing
reconcile resolution rather than avoiding it.

## Recommendation

Treat the DATA lab as the single source of truth for membership and make BILLING
a reliably-derived projection of it. Do not build a second enroll path. Instead:

- **Unify the PI's view.** One "Lab members" roster (the data-lab roster) with a
  per-member billing-status chip (active seat / pending / no-binding). This is the
  PI-Mode People surface, so it folds into that build.
- **Harden the bridge into a real sync** rather than a best-effort ping: ensure
  `APP_BASE_URL` is always set on the relay, add a bounded retry on the reconcile
  POST, and add a periodic full-roster resync (a cron or a head-login-time
  reconcile call) so a missed webhook self-heals without waiting for the next
  membership change.
- **Close the timing race with a resync trigger (no schema change).** When a
  member's auto-bind succeeds on their first lab login, have their client ask the
  relay to re-report its lab roster, so reconcile re-runs now that the binding
  exists and enrolls them. A new lightweight relay endpoint `POST /lab/resync`
  calls the existing `reportLabRoster` (the relay still holds the secret for the
  actual reconcile POST, so no secret leaves the server). Reconcile also returns /
  logs a count of still-unbound roster members so any residual gap is observable
  rather than silent.
- **Demote path 2a to an explicit "sponsor an outside collaborator" action**,
  visually separated from "add a lab member", since sponsoring someone who is NOT
  in your data folder is a real but rare case and should not look like the primary
  enroll.

The net effect is "one front door, one roster, billing always follows" without
pretending the two planes can be written atomically.

## The decision (RESOLVED)

Grant chose LAZY + HARDENED on 2026-06-13. The build scope is the four hardening
bullets above (resync endpoint + member-side trigger, reconcile retry, unbound
visibility, APP_BASE_URL guarantee), plus the roster-with-billing-chip view which
folds into the PI-Mode People surface. No Neon schema change. Recorded for context,
the fork that was decided:

When a PI adds a member, should billing sync be:

- **Eager (head-client drives both).** The head's finalize step appends to the
  data log AND immediately calls billing to enroll, so the roster is consistent
  the instant the PI adds someone. Webhook becomes a backstop. More client code,
  and it duplicates the pubkey -> email-hash resolution, but the PI sees instant
  consistency.
- **Lazy, hardened (recommended).** Keep the DO -> reconcile webhook as the one
  sync path, but make it reliable (APP_BASE_URL guaranteed, retry, periodic
  resync, no-binding handling) and unify the roster view. Less code, honest to the
  architecture, eventually-consistent within seconds.

Both deliver "one roster, billing follows." The fork is instant vs
eventually-consistent, and how much new client code we take on.

## Out of scope here

The shared-pool payer-resolution math (free tier is per-lab not per-user) is
already specced in `LAB_SHARED_BILLING_POOL.md` and partly shipped. This doc is
only about converging the two MEMBERSHIP systems, not the pricing math.
