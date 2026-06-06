# Collab storage migration: Neon to D1 + Durable Object

Status: PROPOSAL, build deferred. Decision recorded 2026-06-06 (Grant: "write the proposal, defer the build").
Author: orchestrator.
Supersedes nothing. Complements the Option B persistence model in `UNIFIED_MODEL_PHASE3C_SHARED_COLLAB.md`.

## One-paragraph summary

Collab persistence currently lives on Neon Postgres, the single most expensive service ResearchOS runs on (it bills for compute time, not just storage). The live transport already runs on a Cloudflare Durable Object (the relay we deployed 2026-06-06). This proposal collapses collab's two server systems (the relay DO plus the Neon tables and their Vercel routes) into Cloudflare-native primitives. The per-document canonical Loro doc moves into the same Durable Object that fans out live edits, and the cross-document concerns (identity, doc registry, membership, future search) move to Cloudflare D1. Neon leaves the collab path entirely. We keep every feature, including local-first and the future cross-doc search/AI that Option B was chosen to enable. We do NOT build this now. We capture it here and execute at a defined trigger point.

## Why (the case)

Two reasons, both real.

### Cost

Pricing pulled live 2026-06-06 (verify again before executing):

- Neon bills for compute (CU-hours at $0.14/CU-hour) plus storage. Compute is the cost driver, and it accrues whenever the database is active. Storage is $0.30/GB-month (first 50 GB).
- Cloudflare D1 has no compute or hourly charge at all. It bills per operation (reads $0.001/M rows, writes $1.00/M rows) plus storage ($0.75/GB-month above a 5 GB free allowance), with large included allowances on the $5/month Workers Paid plan we already pay for the relay.
- Durable Object SQLite is also covered by the Workers plan, with no compute-hour meter.

For a bursty, low-volume workload like ours, "pay per query" beats "pay for uptime." The savings are ~$0 today (we are on free tiers) and grow with sustained traffic, where Neon's compute meter runs continuously and the Cloudflare per-op model stays cheap.

Sources: developers.cloudflare.com/d1/platform/pricing, developers.cloudflare.com/durable-objects/platform/pricing, neon.com/pricing, neon.com/blog/new-usage-based-pricing.

### Simplification

Today every collab edit travels two separate paths with two auth mechanisms:

1. Live path: client to the relay DO (`relay/src/worker.ts`), which fans sealed bytes to peers and then forgets them.
2. Durable path: the same client POSTs the update to a Vercel function (`/api/collab/push`), signed with the directory email, which writes to Neon (`collab_doc_updates`) and periodically compacts.

The relay stands next to every edit and throws it away, which is the only reason a second system has to remember it. Most of the 400/404 bugs we fought during launch lived in that second path. Letting the DO persist what it already sees deletes that whole path.

## Current architecture (three systems)

- Relay Durable Object: live WebSocket fan-out, stateless, per `?session=<id>` room.
- Neon Postgres tables: `collab_docs`, `collab_doc_updates`, `collab_doc_members` (see `frontend/src/lib/collab/server/db.ts`), plus the budget enforcement in `frontend/src/lib/collab/server/limits.ts`.
- Vercel routes: `/api/collab/{open,push,grant,revoke}` (signed-request auth via `server/auth.ts`).

The directory (identity, email-to-key bindings) also lives on Neon (`directory_identities`) and is shared by the relay inbox, cross-boundary sharing, and admin metrics.

## Target architecture (two purpose-fit systems)

```
Identity + doc registry + membership + cross-doc search index  ->  Cloudflare D1     (the global, queryable brain)
One collab doc: live sockets + canonical Loro bytes            ->  Durable Object SQLite (per-doc workspace)
Large opaque blobs / attachments                               ->  R2               (cheap bulk storage, already used)
Neon                                                           ->  removed from the collab path
```

The split principle: per-document bytes live in the DO that already serves them live; questions that span many documents live in D1, because a DO is a silo by design and cannot see its neighbors.

### Durable Object as canonical store

- On edit: the DO fans the update out to peers (as today) AND appends it to its own SQLite update log. Compaction runs inside the DO on its own data. This is trivially safe because a DO is single-threaded and single-writer, which removes the "capture max id before import" concurrency dance the Neon path needs.
- On open / offline reconcile: the client connects to the DO, and the DO replays its stored snapshot plus outstanding updates straight down the socket. This is the catch-up we already do, sourced from the DO's own durable storage instead of a Neon round-trip.
- Access control: the DO checks membership on connect (see auth below).

What this deletes: the four `/api/collab/*` Vercel routes, the three Neon collab tables, and `limits.ts` budget enforcement (DO storage is cheap and self-contained, though a per-doc size guard stays sensible).

### D1 as the global brain

D1 holds the cross-cutting, queryable data:

- Identities: email hash to public keys (migrated from Neon `directory_identities`).
- Doc registry: which collab docs exist, owner, title, the DO id, timestamps.
- Membership: doc id to member, role (so "every doc this user can open" is one query).
- Search index: denormalized, server-readable content over shared docs, the thing Option B exists to enable. This is BUILT WITH the search/AI feature, not before it.

### R2 for blobs

Unchanged role. If a whole-project-folder doc ever produces large snapshots, the DO can offload cold snapshots to R2 by key with a pointer row, the same pattern cross-boundary bundles already use.

## What this preserves (explicit)

- Local-first / own-your-data: UNAFFECTED. This proposal only concerns the server-side copy of SHARED docs. Private, unshared notes never reach any server system, before or after. The user's local folder remains the full exportable copy.
- Option B cross-doc features (lab-wide search, AI over shared content): preserved by the D1 search index. The DO silo would threaten these alone; D1 alongside the DO keeps them.
- All current collab behavior: live cursors, durable save, offline reconcile, member grant by email, retire-to-local.

## Migration plan (phased, when triggered)

1. Stand up D1 with the identity + registry + membership schema; dual-read identity (D1 falling back to Neon) to de-risk.
2. Extend the relay DO to persist updates to its SQLite and serve catch-up from there, while STILL writing to Neon (dual-write). Compare the two stores in shadow mode.
3. Switch reads (open / reconcile) to the DO. Neon becomes write-only shadow.
4. Stop writing collab data to Neon; drop the three collab tables and the four Vercel routes; retire `limits.ts`.
5. Migrate the directory tables to D1, repoint the relay inbox / cross-boundary / admin metrics, decommission Neon (or keep it only for anything genuinely relational that has not moved).

Dual-write before cutover means no flag-day and an easy rollback at each step.

## Risks and open questions to verify before executing

- DO backup maturity: Postgres has mature point-in-time recovery. DO SQLite is durable and Cloudflare offers recovery, but it is newer. Design a periodic snapshot-to-R2 safety net before putting sole reliance on it.
- Per-DO storage cap: irrelevant for one note (tens of KB), confirm for a whole-project-folder doc.
- D1 limits: per-database size cap and single-writer (SQLite) write throughput. The directory is read-heavy so it fits; confirm the doc-registry write rate.
- Auth shift: today the server verifies the directory-email Ed25519 signature per push. The DO must either verify that itself or trust a short-lived token minted by a D1-backed auth check on connect. Decide which.
- Postgres-to-SQLite portability: our SQL is simple (CREATE TABLE + basic queries, no extensions), but data types and a few functions differ. Audit before migrating the directory.

## Trigger point (when to execute)

Whichever comes first:

1. The Neon bill starts approaching the paid tier (sustained traffic past the free allowances), or
2. We sit down to build cross-doc search / AI over shared content, at which point we are touching this code anyway and the migration rides along for nearly free.

Until then, the launched Neon-backed collab keeps running. Migrating a freshly-shipped working system for $0 of current savings is not worth the risk.

## Non-goals

- Not changing local-first or the privacy model.
- Not migrating non-collab Neon usage that has no cheaper Cloudflare equivalent and no cost pressure.
- Not building the D1 search index ahead of the search/AI feature that justifies it.
