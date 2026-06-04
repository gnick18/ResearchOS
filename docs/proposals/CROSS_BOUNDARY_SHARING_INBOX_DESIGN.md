# Unified Inbox and the Receive Flow (Phase 2b-iii)

A design pass on folding cross-boundary received shares into the existing inbox, and on the review-then-import flow a recipient walks when something arrives. Grant locked two decisions up front, received items are reviewed then imported (never auto-filed into the folder), and the received shares live in the existing inbox rather than a separate nav item, with the understanding that the inbox likely needs a real rework to hold two arrival types and stay intuitive.

This doc is the design contract before any 2b-iii code.

---

## What exists today

The inbox is a single-purpose photo triage tool.

- `InboxBadge.tsx` counts images in `users/{username}/inbox/Images` and opens the panel.
- `InboxPanel.tsx` lists those photos (with Telegram-album grouping, multi-select, a context menu) and files them into a task's Lab Notes or Results, or into the active note, via `moveImageBetweenBases` / `attachImageToNote`.

Everything is image-shaped, thumbnails, captions, image events, duplicate resolution. There is no concept of a sender, a typed payload, or an import target beyond image folders.

## What a received share is

A different animal. A received share is an encrypted bundle sitting in the relay, addressed to this user's key. Each one carries, a sender identity (email plus key fingerprint), an entity type (note or method), a title, a size, a created date, and a 30-day expiry. The relay client (`relay/client.ts`) already exposes `listInbox`, `receiveShare` (fetch plus decrypt plus parse), and `ackShare` (delete-on-pickup after the data is safely filed locally).

The row shape and the actions diverge so far from a photo (sender attribution, a decrypt-and-preview step, an import-into-a-project target) that interleaving the two in one flat list would force every row to be a confusing hybrid. So the design separates them by type while keeping one entry point.

---

## The structure, one inbox, two segments

Keep the single badge and the single panel (one mental model, "things that arrived for me"), and split the panel body into two segments, **Shared with me** and **Photos**. The badge count is the sum of both pending counts. The panel opens on whichever segment has pending items, preferring Shared with me when both do.

This preserves the existing photo triage untouched under its own segment, and gives received shares a home with the right chrome, without merging two incompatible row types into one list.

### Shared with me segment

One row per received bundle, showing,

- Sender, email plus a short key fingerprint, with a small verified indicator (ResearchOS checked the bundle came from that identity's key).
- A type badge, Note or Method.
- The title, the received date, the size, and an expiry countdown ("expires in 12 days").

Primary action per row, **Review**, which opens the review-and-import modal. Secondary action, **Decline**, which acks the relay (removing it server-side) without importing. Expiry is shown so a user understands the item is not stored forever.

Empty state, "Nothing has been shared with you yet."

Identity gate, the segment only functions if the current user has claimed a sharing identity (a `_sharing_identity.json` sidecar plus a local key). If not, the segment shows a short "Set up sharing to receive" prompt that launches the existing `SharingSetupWizard`. This is the intent-triggered claim from the identity-interaction doc (D4), the user only sets up identity when they reach for sharing.

### Photos segment

The current `InboxPanel` behavior, unchanged, moved under its segment. No regression to the Telegram triage flow.

---

## The review-then-import flow

When the user clicks Review, the client has already fetched, decrypted, and parsed the bundle (`receiveShare`). The modal shows,

- A provenance header, "From {email}, fingerprint {fp}. ResearchOS verified this came from that identity."
- A read-only preview of the content, the note body, or the method steps.
- The attachments, names and sizes, so the user sees exactly what lands.

Then a **target picker**, where does this go. A note imports into a chosen project's notes, a method imports into the method library. Reuse the existing destination pickers where they fit.

Buttons,

- **Import**, writes the note or method plus its attachments into the chosen location, stamps a provenance marker on the imported entity ("received from {email} on {date}") so imported items stay traceable and are never silently merged, then calls `ackShare` (the relay deletes its copy), then drops the row from the inbox.
- **Cancel**, leaves the item pending in the inbox.
- **Decline**, acks without importing (same as the row-level decline).

The ack-after-write order matters, the relay copy is only deleted once the data is safely on the user's disk, so a crash mid-import never loses the bundle.

---

## Refresh and counts

Shares arrive asynchronously through the relay with no push channel, so the badge polls. On panel open, on window focus, and on a modest interval (e.g. every few minutes) the badge calls `listInbox` and updates the pending-shares count. Photos keep their existing event-driven refresh. Keep the poll gentle to respect the free-tier backend.

---

## Scope boundary for the 2b-iii build

In scope, the segmented inbox shell, the Shared-with-me list, the review-and-import modal, the provenance marker on imported entities, the badge count and polling, the identity gate that launches the wizard. Out of scope for this piece, the send entry points (2b-ii, separate), and the sign-in-to-unlock login change (D1, deferred).

---

## The one fork for Grant, DECIDED

**How should the two arrival types be separated inside the one inbox?**

Status, DECIDED (Grant, 2026-06-03), segmented tabs. Two tabs in the panel header, "Shared with me" and "Photos", each with its own list and its own actions. The badge sums both pending counts. The photo triage flow stays as-is under its tab, received shares get the sender-attributed review-and-import chrome. The interleaved single-list alternative was rejected, the row shapes and actions diverge too far to mix without hurting clarity.
