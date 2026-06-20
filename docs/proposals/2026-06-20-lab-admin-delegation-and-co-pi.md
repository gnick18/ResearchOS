# Lab admin delegation now, co-PI later (phased)

Status: SPEC LOCKED (Grant, 2026-06-20). Phase 1 is build-ready. Touches the
head-signed membership log (a data-shape change), so it stayed doc-first per the house
rules. Decisions: role is named "Lab Manager"; Phase 1 INCLUDES propose-and-ratify for
member adds/removes; no hard cap on managers per lab (head-controlled).

## The question this answers

Can a lab have two lab heads, or should a head be able to delegate admin power to a
member? Today neither exists. A lab has exactly one `head` and everyone else is a flat
`member` ([lab-membership.ts:114](../../frontend/src/lib/lab/lab-membership.ts)), and
there is no intermediate role. Grant chose to ship the delegated-admin role first and
design true co-PI as a later phase.

## The crucial distinction the code already draws

Two things are conflated in the phrase "lab head," and only one of them is actually
singular.

- **Data access is already shared.** Every lab-key generation is sealed to every
  member's encryption key, not just the head's
  ([lab-key.ts:172](../../frontend/src/lib/lab/lab-key.ts)). Every member can already
  read and write all lab data. Co-access is not the blocker.
- **Authority is singular.** Exactly one identity, the head's Ed25519 signing key, is
  the cryptographic root of trust. The membership log verifies only against
  `record.head.ed25519PublicKey`, the code forbids rotating the head out
  ([lab-key.ts:317](../../frontend/src/lib/lab/lab-key.ts)), and only the head holds a
  device-independent recovery wrap
  ([lab-key.ts:410](../../frontend/src/lib/lab/lab-key.ts)). Billing and the lab slug
  are each keyed to one `owner_key`.

So the cheap, near-term win is delegating the powers that are pure app-level permission
gates (write lab data with the already-shared key) without touching the single-signer
trust model. The expensive part, a second independent signer, is what true co-PI needs.

## Phase 1, app-level admin / lab manager (build-ready, no signer change)

Goal: a head can promote a trusted member to Lab Admin, who then gets the PI operational
powers that do not require cryptographic signing authority. The head stays the sole
signer, sole billing owner, and sole recovery holder.

### Data shape (the one flagged change)

Add an optional field to `LabMember`:

```ts
/** Head-granted operational delegation. Absent for the head and plain members.
 *  Set/cleared only by a head-signed "role" log entry. Does NOT grant signing
 *  authority over the membership log; it is an app-permission capability. */
admin?: true;
```

This rides inside the head-signed roster, so it is tamper-evident, and because it is
optional and omitted when absent, every pre-existing signed roster stays byte-identical
(the exact pattern `emailHashEnc` already uses,
[lab-membership.ts:51](../../frontend/src/lib/lab/lab-membership.ts)). Verification is
unchanged, still single-signer.

Add one log event type, `"role"`, to `LabLogEventType`. A promote/demote appends a
head-signed entry whose `subject` is the affected member and whose `roster` carries the
updated `admin` flag. It does NOT bump `keyGeneration` and does NOT reseal the lab key,
because admin status changes no crypto access (the member already holds the key). This
keeps the change off the rotation path entirely.

### Materialization and capability

`lab-roster-materialize.ts` keeps `account_type` as `"lab_head" | "member"` (so no
churn across the dozens of `account_type === "lab_head"` gates), and additionally
surfaces a capability, `isLabAdmin`, for admin members. Head-gated UI surfaces that are
safe to delegate switch their check from `account_type === "lab_head"` to
`account_type === "lab_head" || isLabAdmin`.

### Powers the admin GETS (app-level, no signing)

- Approve / decline lab purchase requests.
- View the PI audit trail and lab-overview ops dashboards.
- Manage the lab-site / companion-site content (already lab-key writes).
- Other PI-copilot read/ops surfaces that write lab data with the shared key.

### Powers the admin does NOT get (stay head-only, single-signer)

- Sign roster changes directly: add or remove members mint head-signed log entries, so
  they require the head's private key. Phase 1 ships PROPOSE-AND-RATIFY: a manager queues
  an add/remove and the head's device signs it to apply (the head stays the only signer,
  so this is not a crypto change, just a proposal queue). Letting the manager sign
  unilaterally is the Phase 2 multi-signer problem and stays out of scope.
- Rotate the lab key, promote/demote another admin, or change billing.
- Recovery: the admin gets no independent recovery wrap.

### Surfaces to build

- A "Make lab manager / Remove manager" control on the People roster
  ([People page is BUILT+merged], PI Mode arc), head-only, that fires the head-signed
  `"role"` append.
- The capability thread (`isLabAdmin`) through materialization + the delegated gates.
- A propose-and-ratify queue: a manager-side "Request to add/remove member" action that
  writes a pending proposal (lab-key encrypted, so it is a normal lab write), and a
  head-side ratify card on the roster that signs the actual add/remove log entry on tap
  (a "Maybe later" / dismiss escape so it is never a soft-lock).
- Settings copy explaining what a manager can and cannot do (state the why; additive, so
  no escape needed on the capability itself).

### Files

- `frontend/src/lib/lab/lab-membership.ts` (the `admin?` field, the `"role"` event type,
  canonical message unchanged shape).
- `frontend/src/lib/lab/lab-key.ts` (a `setMemberAdmin`-style head-signed append that
  does not rotate).
- `frontend/src/lib/lab/lab-roster-materialize.ts` (`isLabAdmin` capability).
- The delegated PI-gated components/pages (purchase approval, audit, ops) switch their
  gate to include `isLabAdmin`.
- Tests: a head-signed promote/demote round-trip, a verification test proving old
  rosters stay valid, and an adversarial test proving an admin flag set without a
  head signature is rejected.

## Phase 2, true co-PI (two equal owners), DESIGN SKETCH only

This is a genuine trust-model redesign, not a flag. Sketch so we know the shape:

- **Multi-signer roster.** `head: LabMember` becomes a head set, and
  `verifyMembershipLog` accepts an M-of-N signature scheme instead of one key. Every
  canonicalization and append path that assumes one signer changes.
- **Co-recovery.** Each co-head needs an independent device-free recovery wrap, so the
  backup-blob format and recovery flow change
  ([lab-key.ts:410](../../frontend/src/lib/lab/lab-key.ts)).
- **Departure.** Today the head cannot be rotated out
  ([lab-key.ts:317](../../frontend/src/lib/lab/lab-key.ts)); co-PI needs a rule for one
  co-head leaving while the lab survives.
- **Billing + slug co-ownership.** `lab_owner_key` and the slug registry are single
  `owner_key` today; co-PI needs either co-ownership or a designated billing principal
  with the other as co-signer.

Recommendation: defer Phase 2 until a real two-PI lab needs it. Phase 1 covers the
common case (a PI delegating ops to a lab manager) without any of this.

## Decisions (locked, Grant 2026-06-20)

1. Role name: "Lab Manager".
2. Propose-and-ratify member adds/removes: IN scope for Phase 1.
3. Manager cap per lab: none (head-controlled).
4. Delegated powers: purchase approval, audit viewing, lab overview / ops, the
   BeakerBot PI copilot, and companion-site content.
5. Proposal storage: reuse the lab-requests / Lab Inbox substrate.

## Build status (branch claude/lab-manager-role, 2026-06-20)

DONE + verified (tsc 0, full node test project 12916 passing, 5 commits):
- Crypto core: setMemberAdmin head-signed "role" entry, no rotation, adversarial tests.
- Capability: settings.lab_manager + useIsLabManager / useHasPiPowers, materialized.
- End-to-end promote/demote: relay "role" accept + appendRoleRemote +
  setLabManagerForHead + the People-page head control + a "Manager" badge.
- Delegated powers wired: purchase approval, lab overview / ops, the BeakerBot PI
  copilot, and audit viewing (reachable via the now-manager-gated Lab Overview).

NOT yet built (each has a gate or a decision):
- The relay "role" accept needs a SEPARATE relay deploy to go live.
- Companion-site content: enforced server-side on the lab owner_key, so delegating
  it needs a backend authz change (verify manager status against the signed roster),
  not a client gate switch. FLAGGED.
- Propose-and-ratify queue: needs a UX decision on WHERE a manager proposes member
  changes (the People page is head-only today, so managers have no roster surface).
