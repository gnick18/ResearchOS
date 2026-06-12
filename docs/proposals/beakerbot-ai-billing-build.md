# BeakerBot AI billing build (design doc, for sign-off)

Author: BeakerAI manager, 2026-06-12. For Grant's review before any code. House voice throughout, no em-dashes, no emojis, no mid-sentence colons.

## Why this exists

BeakerBot (the paid AI assistant) must not ship until its billing is real and linked to accounts. No free-for-everyone beta. The pricing is already decided (see below), the gap is that it is all fixtures today (`lib/usage/usage-fixtures.ts`), with no token ledger, no usage recording, no enforcement, and no Stripe top-up. This doc is the plan to build the real system, reusing the storage-billing rail that already exists, and to keep the AI flag dark until it is live.

## The decided model (do NOT change these, implement them)

- New account gift, about 25 cents worth of tokens, roughly 750,000 tokens, no card needed to start. At the decided cost of about a penny per full analysis (~30,000 tokens), that is about 20 to 25 analyses.
- A full analysis is about 30,000 tokens, a quick question about 7,500. Per task token cost is visible to the user.
- Top up packs, $10 / $25 / $50 (the $25 pack is the recommended default). The packs are illustrative as analysis counts today (~700 / 1,800 / 3,600), the real token-per-dollar rate is derived from provider cost plus a thin buffer (one config constant, below).
- Framing is cost recovery, not profit, and the privacy story is the cost story (only compact results cross to the model, never the user's files). Source, `docs/proposals/beakerbot-economics-for-billing.md` and `docs/branding/BILLING_FACTS.md`.

## What already exists and is reused (no reinvention)

- Neon Postgres billing DB, `frontend/src/lib/billing/db.ts` (the `getSql()` lazy Neon client off `DATABASE_URL`, `ensureBillingSchema()` idempotent table creation, `billing_events` as a webhook idempotency guard).
- Account identity, `frontend/src/lib/billing/owner.ts` `ownerKeyForEmail(email)` returns the peppered email hash. The AI balance is keyed on the SAME owner_key as storage billing, so one account, one identity, both meters.
- Stripe, `frontend/src/lib/billing/stripe.ts` `getStripe()` + `getWebhookSecret()`. The LLC is already the merchant of record, banking + Stripe live.
- The proxy, `frontend/src/app/api/ai/chat/route.ts`, a thin server-only relay that holds `AI_API_KEY` and forwards to the Fireworks OpenAI-compatible endpoint. The provider response carries a standard `usage` object (prompt_tokens, completion_tokens, total_tokens), so this is the one place that both ENFORCES balance and RECORDS usage.
- The UI shell, `frontend/src/components/settings/sections/AiUsageSection.tsx` already renders balance, recent task costs, and the top-up blocks from fixtures. We swap the fixture source for real reads.

## Architecture

### 1. Identity, AI requires a signed-in account

The proxy today is anonymous (keyed only on the server `AI_API_KEY`). To bill a task we must know WHICH account is calling. So BeakerBot requires the user to be signed in with their OAuth account (this is the "links to accounts" requirement). The browser attaches its authenticated session to each `/api/ai/chat` call, the proxy resolves session -> email -> `ownerKeyForEmail` -> balance. No session, no AI (the local-first notebook and free on-device BeakerSearch are unaffected, they never call the proxy).

LOCKED (Grant, 2026-06-12), the proxy reads the EXISTING NextAuth session server-side (the same OAuth sign-in the researcher directory + sharing identity already use), no separate signed assertion. Least new machinery.

### 2. Token ledger (two new Neon tables, same DB)

- `ai_balances`, one row per owner_key, `tokens_remaining bigint`, `gift_granted boolean` (so the 750k starter is granted exactly once), `updated_at`. Seeded with the starter grant on first use.
- `ai_ledger`, append-only transaction log, one row per event, `owner_key`, `kind` (grant | usage | topup | adjustment), `tokens_delta bigint` (negative for usage), `task_id text`, `prompt_tokens int`, `completion_tokens int`, `usd_micros bigint` (the real cost at record time, for our accounting), `stripe_event_id text` (for topups, idempotent), `created_at`. The visible per-task cost and recent-tasks list read from here.

Balance is denominated in TOKENS (the showcase shows a token balance and per-task token cost). One tunable config constant, `AI_TOKEN_PRICE_USD` (dollars per token, = provider blended rate + thin buffer), derives everything else, the starter grant tokens = 0.25 / price, each pack's token amount = pack price / price. Set it once from real Fireworks rates, change it in one place.

LOCKED (Grant, 2026-06-12), the starter grant lands on FIRST BeakerBot use, not on account creation. A user who never opens the AI never gets a `ai_balances` row, so they cost nothing to carry and the gift maps to real intent to try it. The grant is keyed to the peppered email hash, so deleting and recreating the same account cannot re-mint the gift.

### 3. Enforcement + recording in the proxy

Wrap the existing pass-through:
- Before forwarding, resolve owner_key, read balance. If balance is at or below zero (or below a small per-turn floor), return a structured 402-style error ("out of credits") that the agent loop surfaces as a friendly top-up prompt, and do NOT call the provider.
- Forward as today. For non-streaming (the agent loop), read `usage` from the provider JSON. For streaming (the chat panel), set `stream_options: { include_usage: true }` so the final SSE chunk carries `usage`, and tee the stream to capture it without changing what the browser receives.
- After the response, deduct `total_tokens` from `ai_balances`, append a `usage` row to `ai_ledger` (with the real usd cost), all in one transaction. Deduction is post-call (we cannot know exact tokens until the model answers), so a single turn can dip slightly negative, acceptable, the next turn is then refused.
- Task grouping, the browser passes a per-task id (one BeakerBot task = several proxy turns), so the ledger sums turns into the "last task cost" the UI shows.

### 4. Stripe top-up (one-time packs, not a subscription)

- Three Stripe Products / Prices, the $10 / $25 / $50 packs (Grant creates these in the live + test dashboards, the price ids go in config like `stripePriceId(plan)` does for storage plans).
- A new route `POST /api/ai/topup` creates a Stripe Checkout Session (mode, payment) for the chosen pack, success + cancel URLs back to settings.
- The existing Stripe webhook handler gains a `checkout.session.completed` branch for AI packs, on receipt it credits `ai_balances` with the pack's tokens and appends a `topup` ledger row, idempotent via the recorded `stripe_event_id` (reuse the `billing_events` / claimEvent guard).

### 5. UI

- `AiUsageSection.tsx`, swap the three fixture imports for real reads (balance, recent tasks) via a new `lib/billing/ai-client.ts` (mirrors `billing/client.ts`), and wire the top-up blocks to `/api/ai/topup`.
- BeakerSearch / BeakerBot, a low-balance hint and a clear out-of-credits state (the agent loop already has an approval bridge, the 402 becomes a friendly "top up to continue" card with a button).
- A visible per-task cost readout after each task (the ledger already has it).

### 6. Gating until live

- `AI_ASSISTANT_ENABLED` stays dark in prod until everything below is built and tested end to end in Stripe TEST mode.
- Even with the flag on, the proxy refuses any call without a signed-in account AND a positive balance, so there is no path to a free or unbilled AI call.
- The existing cost circuit breaker (`feature_cost_circuit_breaker`) plus a Grant-set Fireworks-side hard spend cap are the runaway guards.

## Phases (each independently verifiable, build behind the dark flag)

1. Schema + ledger lib, the two tables in `ensureBillingSchema`, a `lib/billing/ai-ledger.ts` (grant, getBalance, recordUsage, credit), unit-tested against a test Neon URL. No user-visible change.
2. Proxy enforcement + recording, identity resolution, pre-call balance check, post-call deduction, streaming usage capture. Tested with a stub provider response carrying a `usage` block.
3. Stripe top-up, the `/api/ai/topup` route + the webhook branch, tested with Stripe CLI test events.
4. UI, real reads in `AiUsageSection`, the out-of-credits card in BeakerBot, the per-task cost readout.
5. End to end in TEST mode, a full dogfood, sign in, spend the starter grant, hit the wall, buy a test pack, confirm the credit, confirm the per-task costs match the provider usage. Only then is flipping the prod flag even on the table.

## What only Grant can do (flagged up front)

- Create the three AI credit-pack Products / Prices in Stripe (test first, then live), hand me the price ids for config.
- Set the real `AI_TOKEN_PRICE_USD` from current Fireworks gpt-oss-120b rates (pull live rates, do not trust a remembered number), and instrument 5 to 10 real tasks to confirm the tokens-per-task assumption before we publish pack analysis counts.
- Set a hard monthly spend cap on the Fireworks account (provider-side guard).

## Locked decisions (Grant, 2026-06-12)

1. Proxy auth, the existing NextAuth session (not a separate signed assertion).
2. Starter gift, granted on FIRST BeakerBot use (not on account creation), keyed to the peppered email hash so it cannot be re-minted.
3. Top-up tokens, NEVER expire (prepaid at cost, matches the cost-recovery framing).
4. Labs, PER-PERSON AI balances for v1. Lab-pooled AI (PI funds one shared balance) is a fast follow on the same ledger keyed by the lab owner_key.

## Not in this doc

The non-billing showcase fixes (BeakerBot verbalizing Cohen's d + the assumption card, primer self-complementarity, the PubChem property set, the experiment dependency-locking reword) are tracked separately, they are independent of billing and do not gate AI shipping.
