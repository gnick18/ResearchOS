# Experiment Hub Phase 2b — add a TEXT note / result entry to an experiment from the phone

> UPDATE 2026-06-15: SHIPPED (commit 71c9b0871), and SIMPLER than this doc assumed. The new `create-experiment-entry` command below turned out to be UNNECESSARY: the existing **`append-line`** command (poll.ts, "Phase 2", emitted by `lib/calc-export.ts` `postAppendLine`) already appends arbitrary text to an experiment's notes/results markdown doc by taskId+owner+tab, live-or-on-disk, with a laptop handler already live. Phase 2b reused it — a text composer (field + Notes/Results toggle + Send) on the experiment hub calling `postAppendLine`. No new relay command, no laptop work. The design below is retained for history; ignore the new-command part. Round-trip still verifies on a paired device.

Status: design (superseded by the append-line reuse above), 2026-06-15. Owner: MobileUI lane. Follows Phase 2a (photo -> experiment notes/results, shipped d34c81f5c). Grant chose "Both" (photo now, text as a follow-up); this is the text follow-up. Cross-surface (mobile + relay command + laptop handler).

## Goal
From the experiment hub, let a researcher write a TEXT note or result entry at the bench and have it land as a fresh entry on that specific experiment's Notes or Results tab on the laptop, independent of laptop focus, mirroring how Phase 2a routes a photo.

## Why this needs new plumbing (the gap)
The sealed-command channel (`frontend/src/lib/mobile-relay/poll.ts`) already has many command types, but none create a fresh text entry on an experiment tab:
- `route-capture` / `route-capture-note` — route an uploaded IMAGE capture to an experiment tab. Image-only.
- `append-note-text` — appends text to an EXISTING `noteId` entry. Requires a pre-existing note; does not create one, and is keyed to a notebook entry, not an experiment tab.
- `add-variation` — appends a method variation to an experiment's method, not a notes/results entry.

So a fresh "new text note on experiment X's Notes tab" has no command + handler today.

## Proposed command contract (additive, safe)
New sealed command, same pattern as the others (phone seals JSON to the user's X25519 key via `sealToUser`, posts via `postCommand`; laptop polls + decrypts + dispatches by `type`; the text rides INSIDE the sealed command, no relay object needed):

```
{ type: "create-experiment-entry",
  taskId: number,        // the experiment's numeric task id (snapshot id)
  owner: string,         // experiment owner username (already on the snapshot, Phase 2a)
  tab: "notes" | "results",
  title?: string,        // optional entry title
  body: string,          // the note text (plain markdown)
  clientId: string }     // phone-generated idempotency key (dedupe re-sends)
```

Backward-compat: unknown command types are intentionally left un-acked by the poller, so an older laptop simply ignores this and the phone retries later. No version gate needed.

## Laptop handler (poll.ts dispatch)
On receiving `create-experiment-entry`:
1. Resolve the experiment by `taskId` (+ `owner` for shared/lab records).
2. Create a NEW entry on the named tab (`notes` | `results`) with `title` + `body`.
3. De-dupe on `clientId` (skip if an entry with that clientId already exists) so retries are idempotent.
4. Fire the existing `note:routed` window event (the same one `route-capture-note` uses) so an open notebook/experiment view live-switches to the new entry.
5. Ack the command.

Open design point: what a "result entry" IS on the laptop vs a "note entry" (do both tabs accept a free text/markdown entry, or is Results structured?). Resolve with whoever owns the laptop Results model before building the handler.

## Mobile side
- Hub action: alongside Phase 2a's photo buttons, add a text path, e.g. "Write a note" that opens a compose screen (reuse the `app/note.tsx` quick-note pattern) pre-targeted with `{ taskId, owner, tab, experimentName }`.
- On send: emit `create-experiment-entry` (seal + postCommand). Show inline status (sent / queued-offline / sent-no-routing) exactly like Phase 2a.
- Degrade: unpaired -> hold/queue; no X25519 key -> fall back to the plain inbox note (existing `sendTextNote`) so the text is never lost.
- The notes-vs-results choice can reuse the same two-button affordance as Phase 2a (Lab Notes / Results), with the text composer as the second step.

## Idempotency + reliability
The phone owns a `clientId` per composed entry; resends (offline flush, retry) carry the same id; the laptop de-dupes. This avoids duplicate entries on a flaky relay, the main risk for a "create" (vs idempotent "route an already-uploaded capture") command.

## Verification
Mobile UI + command emission verify on the emulator; the create-on-laptop round-trip verifies only on a paired device against a running laptop (same constraint as Phase 2a). Build the laptop handler + mobile emitter together so the round-trip can be tested end to end on Grant's paired device.

## Sequencing note
This is the natural bridge to Phase 3 (live embeds): once a text entry can be created on an experiment tab from the phone, the `body` is the place where embed syntax (per the locked markdown-embed-hybrid design) would eventually render. Keep `body` plain markdown now so it is forward-compatible.
