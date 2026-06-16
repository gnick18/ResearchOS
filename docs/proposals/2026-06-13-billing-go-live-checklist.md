# Billing go-live checklist (beta, real payments)

Status: live-prep. 2026-06-13. Grant wants real payments on for the beta because live testing is the real bug harness (test mode has already surfaced 3 bugs). This is the pre-flight so the flip is safe, not a guess. Owner tags: [me] orchestrator can do, [you] Grant only, [done].

> UPDATE 2026-06-15 (Grant): GO for billing-live-during-beta. Sales-tax blocker (#4) is RESOLVED by turning on Stripe Tax (auto-computes + collects + remits responsibility deferred to Stripe), so no manual WI-nexus decision needed. All customer-facing "free during the beta" copy is now FLAG-DRIVEN (it flips to live pricing automatically when the flags flip): server pages (`/pricing`, `/terms`, `/wiki`) read `isBillingEnabled()` / `isAiBillingEnabled()` from `lib/billing/config.ts`; the client Welcome page reads `NEXT_PUBLIC_BILLING_LIVE` (a build-baked mirror of the server `BILLING_ENABLED`). Provisional Plus/Pro sticker prices are STILL not published (billing-copy-facts guardrail unchanged) — the labeled calculators stay. Remaining = flip the prod flags below.

## What is verified (test mode)

- [done] AI billing: ledger (grant-once + idempotency), top-up -> webhook -> credit (real Checkout), proxy enforcement (402 fail-closed) + streaming usage capture. Bug fixed: creditTokens partial-index ON CONFLICT (was pay-but-no-credit), verified live.
- [done] Dept/Institution procurement billing: card + Net-30 round-trip, two bugs fixed (invoice subscription field move, double-booking dedup).
- [done] Deploy status: the 3 money-path fixes are already on origin/main.

## Hard blockers before any LIVE charge

1. [you] Set the real `AI_TOKEN_PRICE_USD` from live Fireworks gpt-oss-120b rates. It is a `0.25/750k` PLACEHOLDER today, so every token/dollar number (gift size, pack token amounts, per-task cost) is provisional. Pull live rates, do not trust a remembered number. One config constant in `lib/billing/ai-config.ts`.
2. [you] Create the LIVE Stripe products/prices for the three AI packs ($10/$25/$50), get the live price ids -> set `STRIPE_AI_PRICE_10/25/50` in Vercel prod env. (The test prices I made are test-mode only.)
3. [you] Set the LIVE Stripe secret key (`sk_live_...`) + register the LIVE webhook endpoint in the Stripe dashboard at `https://<prod-domain>/api/billing/webhook`, copy its `whsec_...` into Vercel as `STRIPE_WEBHOOK_SECRET`. Test-mode `stripe listen` does not cover prod. For the dept tier, select `invoice.paid` (NOT both invoice.paid + invoice.payment_succeeded; the dedup fix covers it either way, but cleaner).
4. [done 2026-06-15] Sales tax: Stripe Tax is ON (auto-computes + collects), so tax handling is deferred to the processor. No manual WI-nexus decision needed. (Was the last hard blocker.)
5. [you] Provider spend caps: a Fireworks hard monthly cap + Stripe Spend Management, as the runaway guards (the app-side cost circuit breaker already exists).

## Flags to flip on prod (after the blockers)

- [you] `BILLING_ENABLED=true` (storage + org billing path; currently dark in prod).
- [you] `AI_BILLING_ENABLED=true` (AI proxy enforcement + recording).
- [you] `NEXT_PUBLIC_BILLING_LIVE=1` (client mirror for the Welcome page copy; flip it WITH `BILLING_ENABLED`; NEXT_PUBLIC bakes at build so it needs a redeploy). The server pages (`/pricing`, `/terms`, `/wiki`) follow `BILLING_ENABLED` / `AI_BILLING_ENABLED` directly and need no separate flag.
- [you] `NEXT_PUBLIC_AI_ASSISTANT_ENABLED=true` (the BeakerBot UI; rebuild needed, NEXT_PUBLIC bakes at build).
- [you] The tier flags (`NEXT_PUBLIC_DEPT_TIER_ENABLED`, `_INSTITUTION_TIER_ENABLED`) if org billing is part of the beta launch.
- Note: NEXT_PUBLIC_* vars bake at build, so flipping them needs a redeploy, not a live toggle.

## Still to exercise (not blocking the flip, but do before real users lean on it)

- [me+you] AI spend + 402 wall: a real BeakerBot turn decrements the balance + logs usage + shows per-task cost; spend to zero -> the out-of-credits card. (One browser step, I verify the ledger.)
- [me, done] AI usage UI reachable off the cloud session (was hidden behind local caps.mode). Commit 9fb1d45cc, local-ahead, ship with the next push.
- [you] Instrument ~5-10 real tasks to confirm the tokens-per-task assumption before publishing pack "analysis counts" as marketing copy.

## Recommended sequence (lowest risk)

1. Push local main (carries the UI-gating fix) so origin/prod is current.
2. [you] Set real AI price + create live AI products + live keys + live webhook.
3. [you] Stripe Tax on (or decide) + provider caps.
4. Flip `AI_BILLING_ENABLED` first, watch real AI-pack purchases for a few days (smallest, simplest path, one-time payments).
5. Then flip the storage + org (`BILLING_ENABLED`, tier flags) once the AI path is proven live.

Turning ONE path live first (AI packs) gets the real-testing benefit with the smallest blast radius, rather than flipping everything at once.

## Keep current

- `docs/branding/BILLING_FACTS.md` is the canonical customer-copy billing source. Update it whenever pricing/tax/packs change.
