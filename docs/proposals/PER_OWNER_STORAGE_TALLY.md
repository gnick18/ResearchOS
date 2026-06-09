# Per-owner storage tally (DO-era metering foundation)

Status: BUILD PLAN, 2026-06-09. Author: HR (orchestrator).
Related: COLLAB_STORAGE_D1_DO_MIGRATION.md (the gate), METERED_STORAGE_PRICING.md
(the model), metered-storage-billing-wiring.md (the Stripe side).

House style: no em-dashes, no emojis, no mid-sentence colons.

## The gap

`getOwnerQuotaBytes(ownerHash)` (frontend/src/lib/collab/server/db.ts) sums an
owner's bytes from the Neon `collab_docs` / `collab_doc_updates` tables. But
collab persistence moved to the Cloudflare Durable Object (it is the canonical
store now), so those Neon tables are stale and the per-owner sum is wrong (reads
near zero). `/api/billing/status` shows the wrong footprint, and there is no
correct per-owner usage to meter or cap against. The DO only knows the doc's
`owner_pubkey` (Ed25519, set on the first grant), not the billing email-hash.

This is the metering foundation. The catastrophic-loss backstop (global breaker +
per-doc cap in the DO + the Vercel $25 hard pause) already landed; this is about
accurate PER-OWNER usage so billing can be correct and (later) enforced.

## Build (the tally + display fix)

1. Table `collab_doc_sizes` (Neon, in collab/server/db.ts): `doc_id TEXT PRIMARY
   KEY, owner_hash TEXT NOT NULL, bytes BIGINT NOT NULL, updated_at TIMESTAMPTZ`.
   `ensureDocSizesSchema()` idempotent CREATE TABLE IF NOT EXISTS, plus an index
   on owner_hash.
2. `getBindingByPubkey(pubkeyHex)` in directory/db.ts: reverse of getBindingByHash,
   returns the binding (email_hash) for a stored Ed25519 pubkey. Additive query.
3. Reporting endpoint `POST /api/collab/doc-size` (Vercel): shared-secret gated
   (reuse RELAY_BREAKER_SECRET as the relay->Vercel bearer, fail closed only when
   the secret is SET). Body `{ docId, ownerPubkey, bytes }`. Resolves
   ownerPubkey -> owner_hash via getBindingByPubkey (skip silently when no binding
   = nothing to bill yet), then upserts collab_doc_sizes(docId, owner_hash, bytes,
   now). Returns `{ ok }`. Never throws to the caller.
4. `getOwnerQuotaBytes(ownerHash)` rewritten to `SELECT COALESCE(SUM(bytes),0)
   FROM collab_doc_sizes WHERE owner_hash = $1`. Drop the stale collab_docs query.
   Keep the function signature so /api/billing/status is unchanged.
5. DO reporting (relay/src/worker.ts CollabRoom): on the existing backup alarm
   (every ~5 min, where it already snapshots to R2), also POST the current
   snapshot byteLength + owner_pubkey + sessionId to
   `${APP_BASE_URL}/api/collab/doc-size` (best-effort, fail-silent, the same
   Bearer secret as the breaker read). Only when owner_pubkey is set (an enforced
   doc has it; an open in-lab doc with no grant has no billable owner yet). Reuse
   the APP_BASE_URL + RELAY_BREAKER_SECRET env already added for the breaker.

## Out of scope (follow-up: enforcement, gated on BILLING_ENABLED)

Per-owner CAP enforcement in the DO (block persist when an owner is over their
cap) is the next layer: the DO reads the owner's cap/usage (a Vercel endpoint,
cached + fail-open like the breaker) and signals MSG_SYNC_BLOCKED "quota" when
over. It activates with BILLING_ENABLED; until then the per-doc cap + global
breaker + Vercel pause are the backstop, so this is NOT needed for the
LAB_TIER_ENABLED flip. Also out of scope: payer-resolution (lab-sponsored vs
individual) which is a billing-layer concern downstream of this owner-keyed tally.

## Verification

- Unit-test the db functions (collab_doc_sizes upsert + sum, getBindingByPubkey)
  against the dev directory/billing DB.
- Test the DO reporting against `wrangler dev` (the alarm POSTs; with no
  APP_BASE_URL it no-ops, fail-silent).
- tsc clean (frontend + relay where touched).
