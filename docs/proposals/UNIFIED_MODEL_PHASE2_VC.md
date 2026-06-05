# Unified Data Model, Phase 2 build scope (version control from Loro history)

Status, DRAFT for Grant sign-off (2026-06-04). This is the detailed build spec for Phase 2 of the unified data model, deriving the notes version-control surface from Loro's native history instead of the paused bespoke delta engine. Parent design is `UNIFIED_DATA_MODEL.md` (section 7 is the VC thesis). Phase 1 (the single-user Loro notes store) is DONE and live-verified. No production code lands until this scope is approved, and the persisted-data-shape items in section 8 need explicit sign-off.

## 1. Goal and non-goals

Goal, when `LORO_PILOT_ENABLED` is on, the notes version-history surface (the right-sidebar version list, the in-place diff, restore, day and session grouping) is driven by the note's Loro history, not the legacy `_history/notes/<id>.jsonl` delta engine. Every debounced Loro commit is already a version; this phase reads that history, attributes it, groups it, diffs it, and restores from it.

The whole point of section 7 of the design doc, the version-control features map onto the substrate's native history, so most of this phase is reading and presenting history Loro already keeps, not building a second history system.

Macro context (Grant, 2026-06-04), the end state is EVERY editable entity on Loro (notes, methods, experiments, sequences, project folders), and the legacy world (value-in/value-out, JSON sidecars, AND the `_history` delta engine) fully retires, because collab is impossible for anything not on the CRDT. The chosen order is DEPTH-FIRST, finish the whole notes vertical (store done, VC this phase, collab next), then replicate the proven store+VC+collab pattern to the other entities one at a time. So this VC engine is built ENTITY-AGNOSTIC (it reuses the existing per-entity-adapter pattern), and the legacy `_history` engine retires entity-by-entity as each entity migrates, gone entirely when the last one moves. Phase 2 is notes only because notes are the only entity on Loro today.

Non-goals (deferred, do NOT build here):
- Touching the legacy engine for tasks, projects, or sequences. Those are not Loro-bound, so they keep the `_history/` delta engine. Phase 2 only swaps the NOTES surface when the flag is on.
- Compaction and retention windows (design doc section 7). The Loro data-model spike showed history is cheap (5000 commits compress to a 22KB snapshot loading in 1.45ms), so retention tuning is deferred until real growth is measured. Phase 2 keeps full history.
- Collaboration and multi-actor attribution UI. The attribution MECHANISM is built (section 5) because version rows need an editor, but cross-user attribution display is exercised in Phase 3.
- Cross-entity (project-folder) history. Notes only.

## 2. What Loro's history gives us (the API)

Verified against loro-crdt 1.12.3 types. Every VC feature has a native primitive:

- List versions, `doc.getAllChanges()` returns `Map<PeerID, Change[]>`. A `Change` carries `{ peer, counter, lamport, timestamp, message, deps, length }`. Flattening and ordering these (by lamport) is the version list. Each debounced commit (Phase 1's ~600ms idle commit, plus the `metadata-sync` / `reconcile-entries` / `external-edit` commits) is one change with a timestamp, an actor (peer), and a message.
- Reconstruct a version, `doc.checkout(frontiers)` time-travels the doc to any version; `doc.frontiers()` reads the current version. We checkout on a CLONE of the doc (loaded fresh from the sidecar bytes) so the live editing doc is never disturbed, then `projectToNote` gives the full note state at that version.
- Diff, `doc.diff(from, to)` returns container-level diffs, but the simplest path reuses the existing text-diff UI, checkout to version A then B on the clone, project each to its markdown, and diff the two strings (which `VersionDiffView` already does today). No new diff renderer.
- Commit messages, `getChangeAt({ peer, counter }).message` reads the tag we already set (`seed`, `external-edit`, `metadata-sync`, etc.), which becomes the row's change-kind label.

## 3. Architecture, keep the UI, swap the engine

The existing VC stack is cleanly layered, and only the bottom layer is bespoke-to-the-old-engine:

- The UI, `EntityVersionHistorySidebar` + `VersionDiffView`, driven by `{ entityType, id, adapter }` props. KEEP.
- The grouping, `entity-viewer.ts`, a pure React-free day to session grouper plus the "earlier versions summarized" fold. KEEP.
- The adapter, `notesAdapter` (`notes-viewer.ts`), projects a reconstructed canonical Note string to the diffable slice and a one-line change label. KEEP (it consumes a canonical Note string, which the Loro engine can also produce via projectToNote).
- The engine, today the jsonl delta store (`engine.ts`) that lists versions and `reconstructState(versionIndex)`. This is the ONE layer Phase 2 replaces with a Loro-backed engine.

So the build is a Loro history engine exposing the two operations the viewer consumes (a version list with metadata, and reconstruct-state-at-version), produced from a note's Loro doc. The grouping, adapter, and UI then work unchanged. This mirrors the Phase 1 "one store, swappable backends" shape.

New module, `frontend/src/lib/loro/history.ts`:
- `listVersions(owner, noteId): Promise<LoroVersionEntry[]>`, load the sidecar into a fresh doc, flatten `getAllChanges()` to an ordered version list, each entry carrying the version index, the frontiers, the timestamp, the actor identity (section 5), and the change message.
- `reconstructNoteAt(owner, base, versionIndex): Promise<Note>`, on a fresh clone, `checkout` to that version's frontiers and `projectToNote`. Returns the note state at that version (the canonical string the adapter wants is the pretty-printed projection).
- A thin adapter shim so `NoteVersionHistorySidebar` can hand the existing `EntityVersionHistorySidebar` a Loro-backed version source. Prefer matching the existing engine's consumed interface so the grouping + notesAdapter need zero changes.

## 4. The six VC features mapped to Loro

Per design doc section 7:
- Auto snapshot, FREE. Every Phase 1 debounced commit is already a version. No new write path.
- Diff vs previous, checkout-and-project two adjacent versions on the clone, diff the markdown (existing `VersionDiffView`).
- Restore, section 6.
- Attribution, section 5.
- Group by day, the existing grouper buckets by the change timestamp. Loro `Change.timestamp` feeds it directly.
- Group by editing session, the existing grouper clusters contiguous same-editor runs. Loro `Change.peer` (mapped to identity) is the editor key; consecutive same-peer changes within the time gap form a session. The grouper already does this; we just feed it Loro-derived rows.

## 5. Attribution and the per-user peer id (the one real new mechanism)

Version rows need an editor ("you", or a collaborator later). Loro attributes every change to a `peer` id. Two pieces:

- A STABLE per-DEVICE peer id for live edits. Phase 1 seeds the doc with a FIXED peer (`BigInt(0)`) for determinism, and `loadOrRebuild` imports into a `new LoroDoc()` whose peer id is RANDOM per load. That means live edits currently carry a random, per-session actor, which breaks session grouping. Phase 2 sets a stable per-device peer id on the doc at `openNote`, a random non-zero u64 generated ONCE and persisted in the browser (localStorage), reused across loads on this device. It is deliberately per-device, NOT derived from the username, because two devices (or a reinstall) sharing one username-derived peer id would later collide in collab (two different edits sharing one Loro operation id corrupts the merge). The fixed seed peer (`BigInt(0)`) stays seed-only.
- A peer-id to identity map. A small sidecar index mapping Loro peer ids to ResearchOS identities (username now, and later the directory identity the sharing feature already has). This is what resolves a per-device peer back to "you" / the user for display and session grouping. In Phase 1 single-user this has one entry (the local device + user), but the mechanism must exist so Phase 3 collaborators attribute correctly. The map entry is written at `openNote` when the device's peer first acts.

This is the genuinely new build in Phase 2; the rest is reading history.

## 6. Restore, non-destructive (checkout then re-apply)

Per design doc section 7, restore is NOT a destructive rewind. To restore version N, reconstruct the note state at N (checkout + project on the clone), then re-apply that content to the LIVE doc as a NEW commit (message `restore-vN`), so the restore is itself a mergeable history entry and the timeline keeps moving forward. This reuses the Phase 1 content-write path (`setEntryContent` + the debounced commit + `persistNote`). The existing 24h undo-restore window affordance (`RevertUndoWindow`, the legacy VC Phase 2 feature) maps cleanly, the undo of a restore is just another forward commit.

## 7. Migration, retire the legacy notes history when the flag is on

When `LORO_PILOT_ENABLED` is on, the Loro engine is the sole notes history source, mirroring the Phase 1 save-path unification:
- `NoteVersionHistorySidebar` reads versions from the Loro engine, not `notesAdapter` over the jsonl store.
- The legacy `recordNoteHistory` (the `_history/notes/<id>.jsonl` writer) is suppressed for notes when the flag is on, so we do not keep two histories. Flag-off keeps the legacy engine exactly as today.
- The legacy engine stays fully intact for tasks, projects, and sequences (not Loro-bound).
- Existing `_history/notes/<id>.jsonl` files are left in place (not migrated, not deleted); a note opened under the flag simply starts presenting Loro history. Pre-flag history stays readable if the flag is turned off.

## 8. Persisted-data-shape decisions (sign-off gate)

1. The stable per-DEVICE peer id (section 5). A random non-zero u64 generated once and persisted in localStorage, reused across loads, mapped to the username in actors.json. Per-device (not username-derived) so multi-device collab cannot collide on operation ids. This writes a real peer id into the CRDT ops, so it is a data-shape contract.
2. The peer-id to identity map sidecar, its path and shape (proposed `users/<owner>/.researchos/actors.json`, a `{ peerId: { username } }` map). Confirm path + that it lives under the existing `.researchos/` dir.
3. The restore commit message convention (`restore-vN`) and that restore is a forward commit, never a history rewrite.
4. Suppressing the legacy `_history/notes/` writer when the flag is on (vs keeping both). Recommend suppress, single source of truth.

## 9. Work breakdown (chunks, in dependency order)

1. The stable per-user peer id at `openNote` + the actors.json map (section 5). Small, but everything attributed depends on it, so it goes first. Unit-test that two loads by the same user produce the same actor and that a change attributes to it.
2. `history.ts` listVersions + reconstructNoteAt on a clone (section 3), with tests that a seeded-then-edited note produces an ordered version list and that reconstructing an older version returns the older content.
3. The adapter shim so `EntityVersionHistorySidebar` consumes the Loro version source with the existing grouping + notesAdapter unchanged. Verify the day/session grouping renders from Loro timestamps + actors.
4. Restore on Loro (section 6), checkout + re-apply as a forward commit, with the 24h undo window.
5. Wire `NoteVersionHistorySidebar` to pick the Loro engine when the flag is on, suppress legacy `recordNoteHistory` for notes under the flag, and keep flag-off identical.

Each chunk is one sub-bot in an isolated worktree off live main, verified with tsc + vitest from `frontend/`, cherry-picked onto local main. After chunk 5, a live in-browser pass (open a note's history, see the versions you just typed, diff two, restore one) closes Phase 2, since the WASM history path cannot be exercised in jsdom.

## 10. Exit criteria

- Flag-on, a note's right-sidebar version list shows the real versions from your editing (debounced commits), grouped by day and session, attributed to you.
- Selecting a version shows the in-place diff vs the live record.
- Restore brings an older version's content back as a new forward version, with the 24h undo affordance.
- The legacy `_history/notes/` writer does not run for notes under the flag (no double history).
- Flag-off, the notes history surface is byte-for-byte the legacy engine as today; tasks/projects/sequences history is untouched in both modes.
- All chunk tests green, tsc clean, plus the live pass.

## 11. Open questions for Grant

1. Attribution display now. Phase 1 is single-user, so every version is "you". Show a plain "you / <date>" row for now and defer collaborator avatars to Phase 3, or invest in the identity-directory display now. Recommend defer.
2. Pre-flag history. Leave old `_history/notes/<id>.jsonl` untouched and just switch the surface (recommended, reversible), or write a one-time importer that seeds the Loro history from the old jsonl rows. Recommend leave-and-switch; the old rows stay readable if the flag flips off.
3. Retention. Confirm Phase 2 keeps full history and defers compaction until growth is measured (recommended, matches the spike findings).
