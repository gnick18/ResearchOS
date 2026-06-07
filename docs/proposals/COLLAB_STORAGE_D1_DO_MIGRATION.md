# Collab + sharing storage migration: Neon to D1 + Durable Object

Status: ACTIVE build plan. Approved 2026-06-06 (Grant: implement now, not defer; reasoning = the data is the smallest it will ever be, and billing/scaling are being built now, so build on the right foundation while migration is cheap).
Author: orchestrator.
Complements the Option B persistence model in `UNIFIED_MODEL_PHASE3C_SHARED_COLLAB.md`.

## Goal

Move every job off Neon Postgres (the compute-metered, most expensive service we run) onto cheaper Cloudflare primitives we already use, WITHOUT losing any feature. End state:

```
Per-doc collab: live sockets + canonical Loro bytes  ->  Durable Object SQLite
Directory + catalog + membership + cross-doc search   ->  Cloudflare D1
Billing status + other relational                     ->  Cloudflare D1
Large opaque blobs / attachments                      ->  R2 (already used)
Neon                                                  ->  decommissioned at the end
```

This is preserved explicitly: local-first / own-your-data (server only ever holds shared-doc copies; private notes never upload), and the Option B cross-doc search/AI future (the D1 catalog + search index is what keeps it possible once the per-doc bytes live in DO silos).

## Hard rules

1. Phased, never big-bang. One job moves at a time.
2. Dual-write then cut over per phase: write to both old (Neon) and new, read from old, compare, then flip reads to new, then stop writing old.
3. Verify each phase on prod before starting the next (same discipline as the collab launch).
4. Never sweep the parallel quota-enforcement working-tree changes into a commit.

## Locked decisions (2026-06-06)

- Start with collab -> Durable Object (cleanest, least data, deletes the relay+Neon duplication and a bug class, proves the pattern before auth-critical systems).
- Convert this proposal to an active build plan first (this doc).
- DO backup: periodic snapshot of each doc to R2 as a disaster-recovery safety net. YES.

## Decisions resolved 2026-06-06 (clickable questions)

- Collab auth at the DO: (A) the DO verifies the Ed25519 directory-email signature itself on connect. (The DO fetches the member's directory public key, from Neon in phase 1, D1 later.) Implemented in chunk 3.
- Live transport: PLAINTEXT over TLS (drop the E2E seal for collab). Matches the Option B server-readable decision, unblocks DO compaction and future cross-doc search. Private notes still never upload.
- Build chunk 1 now.

## Sequencing note (important): relay protocol change is client-coupled

The plaintext + typed protocol is a coupled client+relay change, so it cannot dual-run on one relay. Therefore: chunk 1 (relay code) is COMMITTED but NOT `wrangler deploy`-ed. Prod keeps serving live collab on the CURRENTLY-deployed blind relay until the chunk-2 client also speaks the new protocol; then we deploy relay + ship client together and re-verify. The Neon persistence dual-run (compare DO vs Neon) still happens after that, independently, before the chunk-5 cutover. Chunk 1 is validated locally with `wrangler dev` + a typed-protocol 2-client test.

## Spike RETIRED 2026-06-06: loro-crdt runs in the Workers runtime

Confirmed loro-crdt 1.12.3 runs in workerd. A throwaway worker created a doc,
exported an update (101 B), imported + compacted it server-side into a snapshot
(301 B), and a fresh reader rebuilt the text (roundtrip true). So the DO can do
its own compaction; the raw-append fallback is NOT needed.

THE RECIPE (the plain `import { LoroDoc } from "loro-crdt"` FAILS in workerd
with "Invalid URL string" because loro has no exports map and resolves to the
Node build, whose async init does `new URL('loro_wasm_bg.wasm', import.meta.url)`):

```ts
import wasm from "loro-crdt/web/loro_wasm_bg.wasm"; // wrangler -> WebAssembly.Module
import { initSync, LoroDoc } from "loro-crdt/web/index.js";
initSync({ module: wasm }); // sync init at module top level, before any use
```

Use the `web` build (sync `initSync(module)`) and pass the wasm as an explicit
module. Verified under `wrangler dev --local` (GET / -> 200, the round-trip JSON).

## Phase 1: collab -> Durable Object

The relay DO already receives every update and fans it out, then forgets it. We make it remember. Because Option B already makes shared docs server-readable, collab can send plaintext Loro updates over TLS (the E2E seal becomes optional for collab), which is what lets the DO persist canonical bytes.

Chunks:

1. **DO storage core + typed protocol (server).** `relay/src/worker.ts` CollabRoom gains SQLite (a doc snapshot row + an append-only update log). Replace the blind byte passthrough with a small typed WS protocol: on `{kind:"update", bytes}` fan out to peers AND append to SQLite (compact with loro-crdt, or raw-append per the spike fallback); on a new connection send `{kind:"catchup", snapshot, updates}` from SQLite (works even with no peers online, which is the durable + offline-reconcile win). No client cutover yet.
2. **Client transport switch (shadow / dual-run).** `relay-provider.ts` / `use-collab-session.ts` speak the new plaintext protocol to the DO and import catch-up from it, while the existing Neon HTTP path still runs. Compare DO catch-up against Neon to confirm parity before trusting the DO.
3. **Access control at the DO (needs the open auth decision).** The DO authorizes the connecting member before accepting/serving. Membership source in phase 1 is still Neon (moves to D1 in phase 2).
4. **R2 snapshot backup.** Periodic per-doc snapshot to R2 (the locked safety net).
5. **Cutover + cleanup.** Reads fully from the DO; stop writing collab to Neon; delete `/api/collab/{open,push,grant,revoke}`, the `collab_docs`/`collab_doc_updates`/`collab_doc_members` tables in `server/db.ts`, and `limits.ts`. Verify on prod (the Manny + Sharron flow), including close/reopen durability and offline reconcile.

After phase 1: Neon no longer touches collab; the relay is the full collab backend.

## Phase 2: directory -> D1

Move the directory tables to D1. Dual-read (D1 with Neon fallback) first; this is auth-critical and holds Grant's live identities, so it is the most careful phase. Add the cross-doc registry + search index tables here (built with, not ahead of, the search/AI feature).

### Phase 2 scoping findings (2026-06-06, before building)

Mapped the directory before starting. It is a substantial migration, not a swap, and its cost urgency is LOW now that collab (the expensive high-write tenant) already left Neon. Findings:

- D1 cannot be bound from a Vercel function. The directory routes (`frontend/src/app/api/directory/*`) are Vercel/Next routes. To use D1 they must run on a Cloudflare Worker (recommended end-state) or call the D1 REST API (throwaway half-measure). Chosen direction: relocate to a dedicated Worker with a native D1 binding, frontend unchanged via a Vercel rewrite of `/api/directory/*` to the Worker (no CORS/client churn).
- NextAuth coupling: 4 of 9 routes (verify, search, profile, oauth-bind) import the Vercel auth session. The Worker must re-verify the NextAuth v5 JWT cookie itself (signed with AUTH_SECRET, verifiable anywhere). Self-contained routes (lookup, signup, recover, rotate, researcher) port first; the coupled ones need the JWT-verify shim.
- Postgres-specific search: `directory_profiles` has `idx_profiles_search` (Postgres search). SQLite has no equivalent index type; the search route must be reworked to SQLite FTS5. Port the non-search tables first; do search last.
- Surface: 6 tables (directory_identities, directory_key_history, directory_orcid_links, directory_profiles, directory_email_log, directory_event_log) + ~20 functions in `lib/sharing/directory/db.ts` (23 KB), plus Worker provisioning, secrets (DIRECTORY_HMAC_PEPPER, AUTH_SECRET), a one-time backfill of live identity rows, dual-read, then cutover.

CONCLUSION: phase 2 is a multi-session project with real complications and low immediate payoff (directory is cheap on Neon). Recommended sequencing: bank the actual remaining cost win first (collab chunk 5 cutover, after Grant's verification test), then do phase 2 as its own focused initiative. Phase 2 chunk 1 when it runs = provision D1 + port the schema to SQLite-compatible DDL (FTS5 for search) + stand up the Worker skeleton (no traffic), then self-contained read routes dual-read, then the JWT-coupled routes, then writes + backfill + cutover.

## Phase 3: billing + remaining relational -> D1

Repoint billing status/metadata (Stripe stays the source of truth; the DB only stores status) and any remaining relational tables (analytics, admin tracker) to D1. Since billing is actively being built, prefer building NEW billing routes directly on D1 rather than migrating then rewriting.

## Phase 4: decommission Neon

Once every job has moved and verified, remove `DATABASE_URL` usage, drop the Neon project (or downgrade to nothing). Confirm no route reads it.

## Risks / open questions

- loro-crdt in workerd (spike above).
- DO per-object storage cap (fine for one note; confirm for whole-project-folder docs).
- D1 per-database size cap and single-writer write throughput (directory is read-heavy, fits; confirm registry write rate in phase 2).
- Postgres-to-SQLite portability for the directory (data types, a few functions; no extensions in use).
- Migrating live prod data (the registered identities + the one test collab doc) needs a careful copy step per phase, not just a code swap.

## Non-goals

- Not changing local-first or the privacy model.
- Not building the D1 search index ahead of the search/AI feature.
- Not a big-bang rewrite.
