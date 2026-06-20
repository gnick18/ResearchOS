# Gift-card premium entitlement (comp a lab full premium for X months)

Status: DESIGN ONLY (no code in this change). For Grant sign-off before building.
Date: 2026-06-19
Author: DEBUG / orchestrator lane
House style: no em-dashes, no emojis, no mid-sentence colons. The mascot is BeakerBot.

## 1. Goal

Let an operator gift a lab (or any owner) FULL PREMIUM for a fixed number of months,
issued and revoked from the operator console, so a beta lab can use paid features
(publish a lab site, send and co-edit, sync) without a real Stripe plan. The first
real user is the co-founder lab (Emile Gluck-Thaler, Grant on the roster), which
needs the lab-publish entitlement to put up a real lab site from the FungalICS_Website
BYO repo plus native companion pages.

## 2. Why the current gift system is not enough

`frontend/src/lib/social/...` no, billing lives in `frontend/src/lib/billing/`.
`frontend/src/lib/billing/grants.ts` already issues operator "gift pools", but a grant
only carries `bonus_bytes` and `bonus_writes`, an ALLOWANCE bump on top of the owner's
plan. It does NOT confer a plan TIER. The lab-publish gate `isLabPublishEntitled`
(lib/billing/db.ts, wraps `getSubscription`) returns true only for an active PAID plan,
so a grant today does not unlock publishing or any premium feature. The grant comment
even notes it "only ever matters once BILLING_ENABLED is on". So "gift a lab full
premium" is a new capability, not a config of the existing grant.

## 3. Design: a comped plan tier on the grant

Reuse the existing `billing_grants` row as the single gift record, and add a comped
PLAN TIER plus an expiry. One gift can carry an allowance bump AND a comped tier, or
either alone.

### 3.1 Schema (additive, backward compatible)

Extend `billing_grants`:
- `gift_tier TEXT NULL` one of the real plan tiers (`solo` | `lab` | `dept`), or NULL
  for an allowance-only gift (today's behavior).
- reuse the existing `expires_at TIMESTAMPTZ NULL` for the "X months" window (NULL =
  permanent, same as today).
- keep `label`, `note`, `created_at` for the audit roster.

No change to existing rows, a NULL `gift_tier` behaves exactly as today.

### 3.2 Resolution (the entitlement read)

Add `getActiveCompedTier(ownerKey): "solo" | "lab" | "dept" | null` in grants.ts. It
returns the HIGHEST active (non-expired) `gift_tier` on the owner key, NULL when none.
Pure SQL, mirrors `getActiveGrant`.

Plan/entitlement resolution treats a comped tier as an active plan FOR ENTITLEMENT
PURPOSES ONLY, with no Stripe subscription and a $0 charge:
- `isLabPublishEntitled(labOwnerKey)` returns true when `getSubscription` says paid OR
  `getActiveCompedTier` resolves to a lab-audience tier (`lab` or `dept`). This is the
  one change that unlocks Emile's lab site.
- the general plan resolver (whatever the premium-feature gates read) treats the comped
  tier as the effective plan when there is no higher real plan, so the comped lab gets
  the tier's normal feature set and allowance.
- billing/Stripe is untouched, a comped plan never creates a Stripe customer or invoice.

Because grants resolve on the OWNER key and a lab pool resolves to the PI key, a comp on
the PI key lifts the whole lab, exactly like the allowance grant does today.

### 3.3 Cost safety (important)

A comped premium still incurs REAL cloud cost (storage, relay, AI). So:
- the comped tier confers the tier's normal storage/activity ALLOWANCE, and the operator
  can still add a `bonus_bytes`/`bonus_writes` bump on the same gift for a generous beta.
- the cost circuit breaker ([[feature_cost_circuit_breaker]]) and the metered storage
  guardrail still apply to a comped lab, so a comp cannot run up unbounded cost.
- AI tokens are a SEPARATE product (ai-ledger). A comped plan does NOT auto-comp AI
  tokens. If a gifted lab should also get AI, the operator issues an AI-token gift too
  (the ai-ledger already has a gift path). Open question 1.

### 3.4 Expiry and revoke

- When the comp expires (`expires_at` passes) or is revoked, `getActiveCompedTier`
  stops returning it, the lab reverts to its real plan (free/none), and
  `isLabPublishEntitled` goes false.
- A lapsed lab site then follows the EXISTING 30-day reclaim grace (the lab-domains GC),
  so the published pages stay live read-only through the grace window, never an abrupt
  takedown. Reuse the existing lapse warning UI so the lab is told before expiry.
- Revoke is the existing `revokeGrant(id)`, idempotent.

### 3.5 Operator UI (/admin/business)

The existing gift issuer gains, alongside the storage/activity bonus fields:
- a plan-tier picker (None / Solo / Lab / Dept),
- a duration (months, or "permanent"),
- the existing label/note for the audit roster.
The roster lists comped owners with their tier and expiry, and a revoke button. Operator
only (isOperator), audited, reversible. This is where Grant gifts Emile's lab `lab` for,
say, 12 months.

## 4. Scope and guardrails

- Operator-only issuance, audited (label + note), reversible (revoke), no Stripe contact.
- Additive schema, NULL `gift_tier` is byte-identical to today.
- Honors the cost circuit breaker and metered-storage guardrail.
- Does NOT change any locked pricing in `assumptions.ts` / `plans.ts` / PRICING.md, a
  comp is an operator override on top, not a price change. See [[feedback_pricing_decisions_locked]].

## 5. Decisions (Grant, 2026-06-19, LOCKED)

1. AI tokens: SEPARATE. A comped plan unlocks plan features only, never AI tokens. AI
   stays its own ai-ledger gift, so a comp never hands out unbounded AI spend.
2. Giftable tiers: ALL THREE (`solo` | `lab` | `dept`).
3. Duration: FIXED MONTHS ONLY, no permanent comps. A comped tier ALWAYS has an
   `expires_at` (the issuer must pick a month count; "permanent" is not offered for a
   comped tier). Allowance-only grants keep their existing optional-expiry behavior.
4. On expiry: the lab reverts to free and the existing 30-day lab-site reclaim grace
   applies (no special longer window for comps).

## 6. First use after sign-off

Once this ships, gift Emile's lab `lab` tier for the chosen duration, then connect
`gnick18/FungalICS_Website` as a BYO companion site and author the `starfish` + `chtc`
native pages. That is the real-account dogfood test and a real artifact for his lab.
See [[project_lab_domains_companion_sites]] and docs/proposals/2026-06-19-lab-site-network-presence.md.
