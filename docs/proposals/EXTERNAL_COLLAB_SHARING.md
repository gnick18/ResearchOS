# External live-collaboration sharing

Status: PROPOSAL (design pass, no code yet). 2026-06-06.
Author: orchestrator.
Builds on the Option B server-canonical collab now running on the Durable Object (see `COLLAB_STORAGE_D1_DO_MIGRATION.md` and `project_unified_model_phase3`).

## Goal

Let a ResearchOS user collaborate in real time on a note with another ResearchOS user who is NOT in their folder. Same seamless feel as in-lab collab (open the note, you are editing together), but across folder boundaries.

## What this is NOT (already exists)

"Send outside" (the share dialog's Outside tab) is a one-time, end-to-end-encrypted COPY sent by email. The recipient gets a frozen snapshot, not a live document. That is a different model and is already built. This proposal is the LIVE, editable version.

## The foundation we already have

- Collab runs on the Durable Object (Option B: the DO holds the canonical doc, server-readable, encrypted at rest). Live + durable, verified on prod.
- The DO is addressed by `collab_doc_id` (UUID) -> `sessionId` (HKDF). The client adopts the canonical via `GET /snapshot` and live-syncs over the WebSocket.
- Directory: email-bound Ed25519/X25519 identities; a researcher search surface (`/researchers`).
- Auto-refresh (FileSystemObserver) keeps the local workspace fresh when files change.

## The core problem

In-lab collab works because both members point at the SAME shared folder, so the note file (sidecar) is physically shared. An EXTERNAL recipient has NOTHING locally. So external sharing has to answer: where does the recipient's copy live, and how do they discover + open it?

## KEY DECISION 1 (needs Grant): where the recipient's copy lives

- Option A, server-only: the recipient's shared docs live ONLY on the DO. They open from a "Shared with me" list and read/write the DO directly, no local file. Simpler. But cloud-dependent (no offline for shared docs) and breaks "own your data" for the recipient (no local exportable copy).
- Option B, materialize-to-folder (RECOMMENDED): on accept, the recipient's client fetches the DO snapshot and writes a local sidecar into their own folder (e.g. `users/<recipient>/shared/<id>.loro` or a "Shared with me" notebook). From then on it behaves like any collab note (auto-connects, syncs through the DO, exportable, offline-capable). Keeps local-first intact for the recipient; only slightly more work than A (a one-time materialize on accept, then the existing collab path).

Recommendation: Option B. It is the local-first-aligned choice and reuses the collab path we already have (adopt-from-DO + live session). The "Shared with me" surface lists these materialized notes.

## KEY DECISION 2 (needs Grant): where membership lives + DO access control

Today the DO is open: anyone who knows the doc id can connect. Fine in-lab (the id only travels inside the shared folder), NOT fine for granting a specific outside person. So the DO needs access control (this is "chunk 3" of the storage migration).

- Store the member list IN the DO's SQLite (RECOMMENDED): the DO owns its own access list. A grant is a signed request to the DO ("owner adds <email> as a member"); the DO verifies the owner's Ed25519 directory signature and records the member. On connect, the DO verifies the connector's signed identity and checks it against its member list before serving/accepting. Self-contained, no external dependency.
- Alternative: store membership in D1/Neon and have the DO query it. More moving parts.

Recommendation: members in the DO. It makes the DO fully self-contained and is the natural home now that the DO is the collab store. (This also completes the migration's chunk 3.)

## Architecture (assuming Decisions = B + members-in-DO)

1. Owner grant flow. In the share dialog, an "outside collaborator" path: search the directory for a ResearchOS user (by email / name), then send a signed grant to the DO that adds their email as a member of this doc (minting the `collab_doc_id` if absent). The grant is signed with the owner's directory identity.
2. Discovery / notification. The recipient needs to learn they were granted. Reuse the existing relay inbox concept (a per-user server inbox the client polls) OR a lightweight "pending shares" list keyed by the recipient's email-hash that their client polls on open. The notification carries the `collab_doc_id` + a title + who shared it.
3. Recipient accept + consent. The recipient sees "X shared a note with you" in a "Shared with me" view. They ACCEPT (the consent step Grant wanted, to prevent unwanted shares from strangers). On accept, the client materializes the doc locally (fetch DO snapshot -> write sidecar) and it becomes a normal collab note.
4. Live collab. From there it is the existing path: auto-connect to the DO by `collab_doc_id`, adopt the canonical, live-sync with cursors. The DO enforces membership on connect.
5. Revoke / stop sharing. The owner can remove a member from the DO; the DO drops them and refuses further connects. The recipient's local materialized copy can stay (their snapshot) or be removed per a decision below.

## Dependencies

- DO access control (chunk 3): the DO verifies the connector's Ed25519 directory-email signature and checks membership. Grant earlier picked "DO verifies the signature itself." Needs the member-grant path + the connect-time check.
- Registered directory identities on BOTH users (the owner to sign the grant, the recipient to prove who they are on connect). Identity registration is Settings -> Sharing (a separate agent may be on the passkey side of this; coordinate).
- A notification/discovery channel (relay inbox or a pending-shares poll).

## Open questions for the build

- Decision 1 (copy location) and Decision 2 (membership home) above.
- Revoke behavior: does revoking delete the recipient's local materialized copy, or leave them their last snapshot (read-only)? Leaning leave-their-snapshot (they keep what they had, lose live updates), matching how local-first export works.
- Notification mechanism: reuse the relay inbox vs a new pending-shares table.
- Abuse / consent: only allow grants between users who can find each other in the directory; the recipient must accept; consider a block/report path (Grant: "prevent weird stuff or bad actors").

## Phased build plan (after the decisions)

1. DO access control: signed member-grant to the DO + connect-time membership check (chunk 3). Backfill the in-lab path to keep working (in-lab members auto-granted, or in-lab stays open and only external requires membership, TBD).
2. Owner grant flow in the share dialog (directory search -> signed grant to the DO).
3. Recipient discovery (pending-shares) + "Shared with me" view.
4. Accept + materialize-to-folder + auto-connect.
5. Revoke + consent/abuse guards.

## Non-goals

- Not changing the in-lab collab path (it keeps working).
- Not the one-time "Send outside" E2E path (already exists, unchanged).
- Not changing local-first: the recipient gets a real local copy (Decision B).
