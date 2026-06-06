# Durable shared-file storage and the per-owner storage quota

Status: LOCKED design decision (Grant, 2026-06-05). Not yet built. This is the
record to build against when shared experiments (or any shared content) start
carrying durable file attachments.

## The decision

When shared content carries durable file attachments, the file bytes go to
Cloudflare R2, never into Neon. Neon holds only the CRDT document plus metadata
plus a reference (key) to the file. The per-owner metered storage quota (the 1 GB
free allowance plus purchased blocks) meters the owner's durable storage, which
is dominated by those R2 file bytes plus the tiny Neon doc bytes. The Neon
per-owner collab gate (the appendUpdate ceiling the billing quota now feeds) stays
as a safety wall, not the primary metered surface.

## Why

The economics of the two stores are very different, so where a byte lands matters.

- Neon Postgres: $0.35/GB-month, 0.5 GB free tier. Expensive, tiny free tier.
  Right for small structured data (CRDT docs, metadata), wrong for files.
- Cloudflare R2: $0.015/GB-month (about 23x cheaper), 10 GB free tier, no egress
  fees. Right for file blobs.

Notes are tiny (Loro snapshots are tens of KB), so Neon stays small as long as
file bytes never enter it. Putting a file into Neon would blow the 0.5 GB free
tier with a single attachment and cost 23x more than necessary. R2 is where the
relay already stores encrypted bundles, so the pattern exists.

This also keeps the numbers consistent. The 1 GB free allowance is correctly
sized against R2 (where the heavy bytes live), Neon stays tiny so the 400 MB
`/admin` survival gauge remains a meaningful "Neon collab data is growing more
than text should" alarm, and no constant needs changing now.

## Durable shared-file storage is NOT the transient relay

They both use R2 but are different concepts and need separate accounting.

- The relay (sharing/relay) is transient. A pending share sits in a recipient's
  inbox with a 30-day TTL and a flat per-recipient inbox cap (FREE_STORAGE_BYTES,
  1 GB). It is a staging area, swept automatically.
- Durable shared-file storage is permanent (until the owner deletes it),
  attached to shared content, owned by the sender/owner, and metered against the
  per-owner quota. It does not TTL away.

So a shared experiment's attachments are durable owner storage, not a pending
relay bundle, even if both live in R2.

## What to build (when the feature ships, not now)

1. Route durable file attachments to R2 (a durable prefix/bucket distinct from
   the transient relay objects), with the CRDT doc holding only the key + size +
   content hash, never the bytes.
2. Per-owner durable R2 accounting: sum an owner's durable file bytes. Combine
   with the owner's Neon doc bytes for the total checked against
   quotaBytesForOwner(ownerKey) (lib/billing/db.ts, 1 GB free + paid blocks).
3. Enforce the quota at file-write time (refuse or prompt-to-buy past the
   ceiling), the same way the collab Neon gate now enforces it for doc updates.
4. Surface durable usage in the billing status (GET /api/billing/status) and the
   Settings storage card, so a lab sees file storage against its quota.
5. Garbage-collect orphaned R2 objects when a doc reference is removed (no TTL
   here, so deletion must be explicit).

## What stays unchanged now

- FREE_ALLOWANCE_BYTES = 1 GB (lib/billing/config.ts). Correct for R2-backed
  files. Not lowered.
- The collab Neon per-owner gate (appendUpdate, reading quotaBytesForOwner) stays
  the safety wall. It should rarely fire while Neon holds only text.
- The 400 MB Neon survival gauge stays. Treat a trip as a signal that Neon is
  growing more than text-only should, which is itself useful.
- The relay's flat per-recipient inbox cap stays a flat cap.
