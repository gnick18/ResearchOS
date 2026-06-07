# Subscription cancellation in a local-first world

Status: design, not yet built (2026-06-07)
Author: HR (orchestrator)
Related: billing (`lib/billing/*`), collab (`lib/collab/*`), metered storage, durable file storage (R2), `COLLAB_STORAGE_D1_DO_MIGRATION.md`

## The reframe

The first instinct for cancellation is the SaaS default, a grace window, then the
server deletes the customer's data. That instinct is wrong for ResearchOS,
because ResearchOS is local-first. Every note, experiment, and shared document a
user touches is continuously synced into their own data folder as a local Loro
replica. The copy on the server is a mirror that exists to power real-time sync,
not the system of record.

Crucially, the paid plan buys STORAGE HEADROOM, not collaboration.
Collaboration is a free, universal feature, every user can collaborate in real
time with anyone, inside their lab or outside it, bounded only by their storage
budget (1 GB free). So a subscription is just more server storage for bigger or
more numerous shared docs.

That makes cancellation a quota reduction, not a capability revocation. When a
subscription ends:

- Collaboration is NOT switched off. The user keeps collaborating on whatever
  fits inside the free 1 GB allowance, exactly like any free user.
- Their storage quota reverts from the paid blocks back to the 1 GB free
  allowance.
- Only the SERVER content above that 1 GB freezes. Those shared folders become
  static local copies, a frozen snapshot of the last synced state that the user
  still fully owns and can read and edit locally.

The only thing the server gives up is redundant bytes above the free quota. The
hard rule below makes sure "redundant" is actually true before anything is
removed.

## What actually lives on the server

Inventory of server-side state tied to a subscriber, and its local mirror:

| Server state | Where | Local copy exists? | On cancel |
| --- | --- | --- | --- |
| Collab Loro doc snapshots + update log | Durable Objects SQLite | Yes, by construction (every collaborator holds a synced replica) | Freeze to static, purge server copy after grace |
| Durable file attachments | R2 | Usually (the local folder is the source), but a user could have offloaded | Purge after grace ONLY if a local copy is verified |
| Transient relay bundles | R2 | N/A, ephemeral and self-expiring | Unaffected, not tied to the subscription |
| Directory entry (email hash, identity key) | D1 | N/A, identity not content | Kept unless the user also deletes their account |

The takeaway matches the intuition in the title. For collab docs a local copy
always exists, so freezing is safe by default. The one genuine deletion risk is
data that lives ONLY on the server, which today is essentially just files a user
deliberately offloaded to cloud storage to save local disk.

## The hard rule: never delete the only copy

Before the purge job removes any server bytes for a canceled owner, it must
confirm a local copy exists. For collab docs this is satisfied by construction
once a final sync completes. For R2 files it requires a positive signal:

- The client reports, per file, that the bytes are present and hash-verified in
  the local folder, OR
- The grace window expires and the user was warned, repeatedly, that specific
  server-only files will be deleted, with a one-click "download all" path.

If neither holds, those specific bytes are retained past the grace window in a
cold, no-longer-synced state (and surface on `/admin` as orphaned bytes the
operator can reason about) rather than being silently deleted. We would rather
pay a few cents of storage than destroy a user's only copy.

## What a static copy is

When a shared folder goes static on cancellation:

- The local Loro document is detached from the relay. No further updates are sent
  or received.
- It becomes an ordinary local note or folder, fully readable and editable on
  that machine, indistinguishable from any other local-only content.
- Presence, cursors, and the "shared" badge are gone. The UI marks it "shared
  copy (collaboration ended)" so the user understands it no longer tracks the
  group.
- Re-subscribing re-attaches it. Because the local replica is intact, reactivation
  re-uploads from local and live collaboration resumes where it left off.

## Grace window and notifications

A 7-day grace window from the cancellation effective date. The point of the
window is NOT to hold the user's data hostage. It is to (a) guarantee every
participant has completed a full local sync before the server mirror is dropped,
and (b) give anyone with server-only offloaded files time to pull them down.

Notification cadence (in-app banner + email via the user-facing mailer):

- T0, on cancel: "Your collaboration features end now. Your data is safe on your
  computer. Shared folders are now static local copies." Lists any server-only
  files that need downloading, if any.
- T+1d, T+3d, T+6d: reminders, only if server-only files still lack a verified
  local copy. If everything is already mirrored locally, these are suppressed,
  most users get one calm message and nothing more.
- T+7d: the purge job runs. It removes redundant server mirrors and retains
  (does not delete) any still-unverified server-only bytes per the hard rule.

Reactivation at any point before or after the purge restores collaboration from
the local replicas, so the window is a convenience, not a deadline with teeth.

## Lifecycle

```
active (paid blocks, large/many shared docs)
   |  Stripe customer.subscription.deleted / downgrade
   v
canceled-grace (quota = 1 GB; ALL collab still live; sync-down in progress)
   |  T+7d purge job, after verified local copies
   v
free (collab continues within 1 GB; only the over-quota folders go static;
      their redundant server bytes are gone)
   |  re-subscribe (any time)
   v
active (local replicas re-upload, the static folders rejoin live collaboration)
```

The subscription state already lives in `billing/db.ts`
(`getSubscription`/`upsertSubscription`) and `quotaBytesForOwner` already drops
the paid bytes when status is not active. The new states are a thin layer on top:
a `grace_until` timestamp and a `purge_done` flag.

## Edge cases

- Owner of a shared folder cancels: only folders that no longer fit the 1 GB
  budget freeze. If the owner's surviving shared content fits in 1 GB, it keeps
  collaborating normally. For a folder that does freeze, sync stops for everyone
  in it and each collaborator keeps their own local snapshot; they are notified
  the owner's storage for that folder lapsed.
- A collaborator (not the owner) cancels: nothing happens to the shared folders
  they are in, because the OWNER's storage budget hosts them, not the
  collaborator's. The collaborator only loses headroom for docs THEY own. This is
  worth calling out, joining someone's shared folder does not consume your budget.
- Partial local sync: a collaborator who never fully synced a large folder is
  force-synced during the grace window before freeze, or warned that unsynced
  parts will not be retained locally.
- Over the free allowance after cancel: the user's local data is untouched (the
  free allowance only governs SERVER bytes). Server content above the new quota is
  what gets frozen and purged, oldest or largest first, never the local copy.
- External / cross-boundary collaborators: a recipient who materialized a shared
  copy into their own folder already holds it locally, so they simply go static
  too. The relay access token is revoked.
- Server-only offloaded files: the one case the hard rule exists for. Retained,
  not deleted, until a local copy is verified.

## Implementation sketch

1. Webhook (`api/billing/webhook`): on `customer.subscription.deleted` (and on a
   downgrade that lowers blocks), beyond the existing `syncSubscription`, set
   `grace_until = now + 7d` and enqueue the cancellation flow.
2. Down-quota + freeze: mark the owner's collab docs above the new quota as
   freeze-pending. The collab server stops accepting their pushes for those docs
   but keeps serving reads during grace so a final sync can complete.
3. Local-copy verification: the client reports per-doc and per-file local presence
   (hash) on next launch; the server records it as the green light to purge.
4. Notifications: a small user-facing mailer (mirror the directory OTP mailer; the
   business mailer is admin-only) plus the in-app banner, on the cadence above.
   Suppressed when nothing is at risk.
5. Purge job (cron): at `grace_until`, delete verified-redundant server bytes from
   Durable Objects and R2, set `purge_done`, and leave unverified server-only
   bytes in a cold-retained state surfaced on `/admin`.
6. Reactivation: on a new `invoice.paid`, clear `grace_until`/freeze flags and let
   the client re-upload local replicas to re-establish sync.

## Decisions and open questions

DECIDED (Grant, 2026-06-07): the free tier includes full collaboration with
anyone, in-lab or outside, bounded only by the 1 GB storage budget. The paid plan
sells storage headroom, not collaboration. So cancellation freezes only the
over-quota content, never collaboration as a whole.

Open:

1. When a canceled owner is over quota (say 5 GB of server collab dropping to a
   1 GB budget), WHICH content stays live and which freezes? Options: keep the
   most recently active and freeze the rest, keep smallest-first to maximize the
   number of live folders, or let the user explicitly pick which folders to keep
   live within the 1 GB. Recommend letting the user pick during grace, with
   most-recently-active as the default if they do nothing.
2. Is server-side file offloading (data that lives ONLY on R2, not the local
   folder) ever allowed? If we forbid it, the "only copy on the server" risk
   disappears entirely and the hard rule becomes a belt-and-suspenders check
   rather than a real code path.
3. Grace window length: 7 days proposed. Shorter saves a trivial amount of
   storage; longer is friendlier. Recommend 7.
4. On full account deletion (distinct from a subscription cancel), do we also drop
   the directory entry and identity key, or keep identity so they can return?
5. Attribution: a shared doc's server bytes count against the doc OWNER's budget,
   not each collaborator's. This follows from today's `quotaBytesForOwner(ownerKey)`
   and means joining a folder never costs you, only owning shared content does.
   Confirm this is the intended model (the alternative, splitting bytes across
   participants, is far more complex and punishes collaboration).

## Out of scope

- Refunds and proration (Stripe handles billing; this doc is about data and
  features).
- Full account deletion and GDPR-style erasure (related but a separate flow).
- The metered-storage billing wiring itself (see
  `metered-storage-billing-wiring.md`).
