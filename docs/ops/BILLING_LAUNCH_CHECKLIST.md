# Billing launch checklist

Status: PROCEDURE. 2026-06-09. Owner: Grant.
Related: LAB_SHARED_BILLING_POOL.md, COLLAB_STORAGE_D1_DO_MIGRATION.md,
project_stripe_setup, project_llc_business_ops.

House style: no em-dashes, no emojis, no mid-sentence colons.

## What flipping BILLING_ENABLED does

`BILLING_ENABLED=true` in Vercel is the MASTER switch for the entire paid system
(17 files gate on it, fail-closed like SHARING_ENABLED). Turning it on at once:

- activates real Stripe checkout + charging, AND
- starts ENFORCING every per-owner cap and throttle on real users (over storage
  cap or over the monthly activity allowance -> their cloud writes pause; the
  local-first app keeps working and edits stay safe on-device).

It is a launch event, not a config tweak. Everything built so far is dormant
behind it, so the flip is safe to delay indefinitely and nothing charges anyone
until it is on. The global cost breaker + per-doc caps are ALWAYS active
(independent of this flag), so cost is bounded even while billing is off.

## Order of operations (do not flip until all green)

1. DEPLOY THE CODE FIRST. These routes are committed but not on the current prod
   deploy, and billing is wrong/incomplete without them:
   - `/api/collab/activity` (per-owner activity tally feed)
   - `/api/billing/lab/reconcile` (invite-link enrollment into the lab pool)
   - `/api/admin/grants` + the GiftPoolsPanel (gift pools)
   - the owner-state activity check + the lab-pool storage logic
   Deploy from clean main (a normal Vercel deploy), then confirm the routes
   answer (a 401 without the relay bearer is the healthy signal, same as
   breaker-state/doc-size today).

2. CONFIRM THE COMPANION FLAGS. Billing without sharing + labs is moot:
   - `SHARING_ENABLED=true` (directory / relay / profiles)
   - `LAB_TIER_ENABLED=true` (lab create + join + the shared pool)
   - `RELAY_BREAKER_SECRET` set on BOTH relay and Vercel (already done), and the
     relay redeployed so APP_BASE_URL points at research-os.app (already done).
   - `BUSINESS_INGEST_SECRET` set in Vercel prod ONLY IF you move the Accountant
     inbox bot to post against production (it posts to localhost today, so this
     is not needed for the local bot). Use a FRESH random value, NOT the local
     one in frontend/.env.local. Generate: `echo "ros_ingest_$(openssl rand -hex 24)"`.
     The ingest endpoint is dark until SHARING_ENABLED is on, so this only matters
     once sharing is live in prod.

3. STRIPE LIVE READINESS (project_stripe_setup):
   - Live keys actually present in the prod env (not the test placeholders).
   - The launch price id wired (`price_1Tf6PcPKbbOKkcGaMdgSkrvt` was held for
     launch).
   - CPA sales-tax category check resolved (still open per the LLC notes).
   - Mercury payout account confirmed receiving (test a real low-value charge).

3b. RECONCILE PUBLIC COPY (the site currently says there is no paid tier). At
   launch, several pages assert "no paid tier" which becomes false:
   - /wiki/trust/how-we-fund-it, replace the "No paid tier" bullet with the
     feature-paywall framing (every feature free, only optional cloud storage is
     paid) and add the "why it costs so little" section.
   - Land the pricing-transparency content (docs/proposals/PRICING_TRANSPARENCY.md)
     so the suspiciously-low price comes with its honest economic reason.
   - The /thanks GitHub-Sponsors tiers were already renamed off the billing names
     (Backer/Patron/Benefactor); mirror those names in the GitHub dashboard.

4. SEED GIFT POOLS (optional, recommended before launch). Issue beta testers a
   gift pool on /admin/business so they are not capped the moment enforcement
   turns on. Grants can be seeded NOW (dormant) and take effect at the flip. A
   grant on a lab head lifts the whole lab pool.

5. POSITIVE-PATH TEST (only possible with BILLING_ENABLED on). With two real
   accounts on prod (behind the maintenance gate if needed):
   - Storage: push a pool past its cap, confirm MSG_SYNC_BLOCKED "quota" ->
     "Storage limit reached", and that edits still fan out + stay local.
   - Activity: exceed the monthly write allowance, confirm "Monthly activity
     limit reached".
   - Gift: issue a gift pool to one account, confirm its ceiling rises and the
     block clears.
   - Lab pool: confirm a member's usage counts against the PI's single allowance,
     not a per-member free tier.

6. FLIP IT. Set `BILLING_ENABLED=true` in Vercel prod, redeploy (env changes
   need a new deployment to take effect), lift the maintenance gate.

## Rollback

Set `BILLING_ENABLED` back to unset/false and redeploy. Enforcement goes dormant
immediately (owner-state returns over:false), so caps stop blocking; no data is
affected. Stripe subscriptions, if any were created, persist and would need
separate handling, so prefer to validate fully in step 5 before charging anyone.

## Not part of the flip (already safe / independent)

- The global cost breaker, per-doc 8 MB cap, and per-doc write throttle are
  always on and bound catastrophic cost regardless of BILLING_ENABLED.
- Provider hard caps (Vercel Spend Management $25, Neon limits) are the outer
  backstop and should stay set.
