# Experiment Hub — pull / read / place / push phone-note embeds (the no-Loro design)

Status: spec, 2026-06-15. Owner: MobileUI lane. This supersedes the read-only-only Phase 2c with a richer model AND deliberately replaces the real-time Loro CRDT approach for this use case (see docs/proposals/2026-06-15-mobile-realtime-loro-collab.md — that stays a "deferred, not needed for this" reference, not the plan).

## The model in one line
The phone PULLS a snapshot of the experiment's notes/results, lets you READ + scroll, lets you INSERT note blocks anywhere between existing lines, and on PUSH each inserted block lands in the laptop doc as a self-contained "phone note" embed at that position. No live sync, no CRDT on the phone, no character-level merging.

## What this deliberately is NOT (and why that is the whole point)
- **No Loro on the phone.** The phone renders a pulled markdown snapshot and stages local inserts. It never runs a CRDT.
- **No WebView editor.** No CodeMirror. The phone shows the doc as a native list of blocks/lines with insertion points between them; composing a note is a native TextInput. (Read rendering is the Phase 2c markdown renderer.)
- **No live transport.** No Durable-Object WebSocket. It is pull (a snapshot, existing pattern) + push (a sealed command, existing pattern).
- **No merge/conflict engine.** The phone NEVER edits existing characters. It only INSERTS new, self-contained blocks at line boundaries. So there is nothing to merge at the character level.

This collapses what would have been a multi-week real-time project into roughly Phase 2c (read) + a positioned-insert command + a phone-note embed. Days-to-a-week.

## User flow
1. Open the experiment hub. Tap "Notes" (or "Results"). The phone fetches/refreshes the doc snapshot (one-time on open + a manual refresh button).
2. Read + scroll the rendered doc.
3. Tap an insertion point BETWEEN two lines/blocks (insertion affordances live only at line boundaries). Type a note in a native composer. It appears inline where placed (optimistic, local-only). Repeat to place several.
4. Tap Push. Each staged note is sent to the laptop with its anchor. The laptop inserts each as a phone-note embed block at that position.
5. Re-pull (or next open) shows the canonical laptop doc with your embeds in place.

## The one constraint and why it is exactly right
A note can only be inserted ON A NEW LINE (between blocks), never mid-sentence. This is not an apology, it is the safety mechanism: because every inserted note is a WHOLE-LINE, SELF-CONTAINED block, any anchoring imprecision is purely COSMETIC (the note lands a paragraph off) and can NEVER corrupt text (it cannot split a word or break a sentence). The constraint is what lets us skip the CRDT.

## Architecture

### Pull / read (reuse Phase 2c)
A sealed `experiment-notes` snapshot `{ taskId, owner, experimentName, notes: {markdown, anchors[]}, results: {markdown, anchors[]} }`, built + published by the laptop (mirrors method-snapshot), fetched by the phone on open + refresh. `anchors[]` = a stable reference per block (see Anchoring). Rendered by the Phase 2c markdown renderer.

### Edit UI (native, no WebView)
Render the doc as an ordered list of blocks (split markdown on blank-line/block boundaries). Between every pair of blocks (and at top/bottom) show a subtle "+ note here" affordance. Tapping it opens a native TextInput; the typed block renders inline as a pending phone-note card. A staged-edits tray shows count + Push/Discard. No existing text is editable.

### Push (generalize append-line to a positioned insert)
Today `append-line` only appends at the END of the doc. Add a positioned variant, e.g. sealed command `insert-note-block { taskId, owner, tab, anchor, block, clientId }`:
- `anchor` = the stable reference of the block to insert AFTER (or a sentinel for top/end).
- `block` = the phone-note markdown (see format below).
- `clientId` = idempotency key (dedupe re-sends / offline flush).
Unknown command type is left un-acked by the poller = backward-compatible. Multiple notes in one push = multiple commands (order-independent, they are blocks).

### Anchoring (good, not perfect — and that is fine)
- **Baseline (always works): content-anchor.** Each block in the pulled snapshot carries an anchor = a hash/normalized-text of that block (and its heading context). The phone references "insert after anchor A." The laptop locates the block whose anchor matches and inserts after it. If A no longer exists (edited/deleted on the laptop since pull), fall back to the nearest surviving anchor, else append at end. A miss is cosmetic (whole block, attributed) — never corrupting.
- **Precision when the editor is open: Loro cursor (laptop-only).** When the experiment is open on the laptop the doc is a live Loro doc, and Loro Cursors are stable positions that survive concurrent edits. The snapshot can carry a Loro position per block; the laptop resolves the anchor exactly via Loro. The phone still touches no Loro — this is purely laptop-side precision.

### Phone-note embed format
Insert the note as a SELF-CONTAINED, portable markdown block so the content lives in the doc (no separate object to store/sync), and the embed-hybrid renderer styles it as a phone-note card. Recommended: an attributed callout block, e.g.
```
> [!phone-note] Grant · 2026-06-15 17:40 · from phone
> Colonies looked good at 16 h, slightly more on plate B.
```
`RenderedMarkdown` (which already renders `#ros=` embeds and image embeds) gains a `[!phone-note]` callout renderer drawing the phone-note card (phone glyph, author, timestamp, body). Degrades to a plain blockquote in any other markdown tool (portable, per the embed-hybrid invariant). Alternative considered: a reference embed `[Phone note](/...#ros=phonenote&id=...)` pointing to a stored object — rejected for v1 because it adds an object store + sync for what is just text; the literal block is simpler and portable.

### Laptop handler (poll.ts dispatch)
On `insert-note-block`: resolve `anchor` -> position (Loro cursor if open, content-match in the `.md` if closed); insert `block` at that position via the SAME dual path append-line already uses (live Loro insert + window event when open; `.md` splice when closed); de-dupe on `clientId`; fire the existing `notebook:append-line`-style event so an open editor live-updates; ack.

## Conflict / drift handling
- The phone view is a SNAPSHOT IN TIME. If the laptop changes after the pull, the phone will not see it until you re-pull (the refresh button). Explicit, accepted tradeoff.
- Inserts are optimistic locally; the canonical state is the laptop doc after push + re-pull.
- Worst-case drift = a phone note lands a block away from intended. Cosmetic; the user can re-pull and, if needed, the laptop user moves it. No data loss, no text corruption.

## Security / E2E
- The notes snapshot is sealed to the user's capture keys (only ciphertext on the relay), same as every snapshot. NOTE: experiment note bodies now ride to the phone (they did not before) — consistent with method bodies already doing so, but notes are free-form; confirm acceptable.
- The `insert-note-block` command is sealed to the user's X25519 key, same as append-line / route-capture.

## Scope boundaries
- **Insert-only.** The phone inserts NEW blocks; it never edits or deletes existing text. (Editing existing text is the thing that would need a CRDT — explicitly out.)
- **New-line / whole-block only.** No mid-sentence insertion.
- **Snapshot-in-time, not live.** Refresh is manual.
- Real-time Loro editing remains a separate, deferred project (its feasibility doc stands); this design intentionally does not need it.

## Sub-phasing
1. **P1 — read** (= Phase 2c.1): `experiment-notes` snapshot + native markdown render of Notes/Results on the hub + refresh button. Verifiable on emulator with a seeded fixture.
2. **P2 — place + push at end/boundaries**: block-list edit UI + `insert-note-block` command + the `[!phone-note]` callout renderer on the laptop. Start with content-anchor.
3. **P3 — Loro-cursor precision** when the editor is open (laptop-side anchor resolution).
4. **P4 — polish**: offline staging via the existing outbox, post-push auto-refresh, multi-note trays.

## Open questions
- Anchor granularity: per top-level block is simplest; do we need sub-list / table-row anchoring? (Recommend top-level block for v1.)
- Snapshot size cap for very long notes docs (+ "open on laptop for the full doc" fallback)?
- Phone-note card affordances on the laptop (jump-to-source, who/when) — reuse embed-hybrid header controls.

## Verification
Read + the block-list/insert UI verify on the emulator with a seeded `experiment-notes` fixture. The pull + push round-trip (note appearing in the laptop `.md` / open editor at the right anchor) verifies on a paired device against a running laptop, same constraint as method-detail + Phase 2a/2b.
