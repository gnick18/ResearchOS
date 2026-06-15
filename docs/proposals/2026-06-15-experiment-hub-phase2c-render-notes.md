# Experiment Hub Phase 2c — render an experiment's existing Notes & Results (read-only)

Status: spec, 2026-06-15. Owner: MobileUI lane. Follows Phase 1 (hub), 2a (photo->notes/results), 2b (text->notes/results). This is the READ half: show what is already on an experiment's Notes/Results tabs. It is the on-ramp to Phase 3 (live embeds).

## Goal
On the experiment hub, show the experiment's existing **Notes** and **Results** content, rendered (markdown), read-only. So the phone is no longer append-blind: a researcher can SEE what is on the experiment before/after adding to it.

## Current state (grounded)
- The phone renders **nothing** of an experiment's existing notes. The hub shows methods only; Phase 2a/2b only append.
- The Notebook tab fetches only **stubs** (`NotebookEntryStub` = id/title/date) to pick a routing destination, never the body.
- Notes/results are plain markdown on the laptop: `users/{owner}/results/task-{id}/notes.md` and `results.md` (per `taskResultsBase`, `frontend/src/lib/tasks/results-paths.ts`). Attachments resolve relative to per-tab `notes/` and `results/` subdirs.
- **No markdown renderer exists on mobile** (verified: no react-native-markdown dep; method-detail renders plain Text via per-type readers). This feature adds one.
- There is a clean per-target snapshot pattern to copy: `method-snapshot.ts` builds + seals + `publishSnapshot`s a projection; the phone `fetchSnapshot('method')`s it on focus.

## Architecture

### Data source
Read `notes.md` and `results.md` (+ optionally the per-tab subdir listing for attachments) at `taskResultsBase(task)` for the target experiment. These are the same docs `append-line` writes to, so what the phone shows is exactly what the phone appends to.

### Publish / fetch (mirror method-snapshot)
- **Laptop:** a new `experiment-notes-snapshot` builder that, for a given `{taskId, owner}`, reads `notes.md` + `results.md`, packages `{ taskId, owner, experimentName, notes: { markdown, updatedAt }, results: { markdown, updatedAt } }`, seals it, and `publishSnapshot`s it (same E2E path as method/today snapshots — only ciphertext on the relay).
- **Phone:** the hub `fetchSnapshot('experiment-notes')` (or a taskId-scoped variant) on focus and renders it.

### Freshness model (two options; recommend both, phased)
1. **MVP (push-on-focus):** the laptop publishes the notes snapshot when the experiment is opened / "View on phone" is triggered — exactly how the method snapshot already works. Phone shows the latest published. Simple, reuses the existing pattern. Limitation: shows the last-published experiment, not arbitrary ones (same constraint the method viewer has today).
2. **Refinement (on-demand request):** the phone sends a sealed `publish-experiment-notes` command `{ taskId, owner }` (new command type in the existing channel, unknown-type-un-acked = back-compat); the laptop builds + publishes that experiment's notes; the phone fetches. This makes ANY experiment's notes viewable from the hub, not just the focused one. This is the same gap (and the same fix) as per-experiment method content.

### Mobile rendering
- Add a markdown renderer. Candidate: `react-native-markdown-display` (maintained, themeable) or a thin custom renderer. Must honor the app's design tokens (fonts, surface colors, dark mode) and the house no-emoji/typography rules.
- **Embed seam (Phase 3):** wrap the renderer so embed syntax (per the locked markdown-embed-hybrid design) can later resolve refs to live rich visuals. For Phase 2c, embed refs render as their portable `[name](/path#ros=view)` link/placeholder; Phase 3 upgrades them in place. Keep the renderer pluggable on a per-node basis so Phase 3 is additive.

## UX on the hub
- Add **Notes** and **Results** read sections to the experiment hub, below the methods list and above (or merged with) the "Add to this experiment" composer, so read + append sit together.
- Each section: the rendered markdown doc (scrollable within the page), with an empty state ("No notes yet. Add one below."). Long docs: show the full doc (the hub is already a scroll view) or cap with a "show more"; recommend full doc for v1, revisit if perf bites.
- Pull-to-refresh re-fetches (and, with the on-demand refinement, re-requests publish).
- After a Phase 2a/2b append succeeds, refresh the section so the new line/photo appears (closes the loop: append -> see it land).

## Explicit scope boundaries
- **Read-only.** No in-place editing, no cursor, no CRDT on mobile. Editing an experiment's note is out of scope (that is the large "mobile Loro collab" effort, separately research-gated).
- **No Loro on the phone.** The phone renders a published markdown snapshot. The collaborative Loro doc stays laptop-side; the phone reads a projection of it, it does not join the CRDT. (Appends from the phone still flow into the Loro doc via the existing laptop append-line live path.)
- **Embeds deferred to Phase 3** but the renderer is built as the seam.

## Security / E2E
Same as every other snapshot: the notes/results markdown is sealed to the user's capture keys and only ciphertext sits on the relay. Note this means experiment note BODIES now ride to the phone (they did not before) — confirm that is acceptable under the data model (it is consistent with method bodies already being published, but notes can be more free-form/sensitive, so call it out).

## Phasing within 2c
1. **2c.1** laptop notes snapshot + phone fetch + plain markdown render of Notes & Results on the hub (push-on-focus freshness). Verifiable: render on emulator with a seeded snapshot; round-trip on a paired device.
2. **2c.2** on-demand `publish-experiment-notes` request command so any experiment's notes load from the hub.
3. **2c.3** post-append auto-refresh (append -> see it).
Then Phase 3 (embeds) upgrades the renderer in place.

## Open questions
- Freshness: ship 2c.1 push-on-focus first, or go straight to the on-demand request (2c.2)? Recommend 2c.1 first to reuse the proven method-snapshot path, then 2c.2.
- Payload size: cap very large notes docs in the snapshot? (Method snapshots are bounded; notes can be long.) Suggest a size cap with a "open on laptop for the full note" fallback.
- Attachments/images inside notes: render inline (needs the per-tab `notes/` images to ride along or be fetchable) or show as links in 2c, full render in Phase 3? Recommend links in 2c, inline in Phase 3.

## Verification
Markdown render verifies on the emulator with a seeded experiment-notes snapshot fixture (add to demo-fixtures). The publish/fetch round-trip verifies on a paired device against a running laptop (same constraint as method-detail + Phase 2a/2b).
