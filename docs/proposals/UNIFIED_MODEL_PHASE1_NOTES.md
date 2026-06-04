# Unified Data Model, Phase 1 build scope (Notes pilot)

Status, DRAFT for Grant sign-off (2026-06-04). This is the detailed build spec for Phase 1 of the unified data model, the single-user Loro notes store. It expands the roadmap into a buildable plan. The parent design (locked) is `UNIFIED_DATA_MODEL.md`, read that first. No production code lands until this scope is approved, and the persisted-data-shape decisions in section 9 need explicit sign-off because they freeze an on-disk contract.

## 1. Goal and non-goals

Goal, stand up the unified in-memory Loro store behind backends (a) the readable mirror and (b) the CRDT sidecar (design doc section 10), wired to ONE entity type (notes) behind the existing `LORO_PILOT_ENABLED` flag. When the flag is off (the default) the app behaves exactly as today. When it is on, a note opens from its Loro sidecar, edits flow through the Loro doc, and every save writes both the sidecar and the readable mirror.

This phase proves the store works end to end for a single user editing locally, which is the foundation every later phase plugs into. It ships NO relay, NO live collaboration, NO version-control UI, NO structured records.

Non-goals (deferred to later phases, do NOT build them here):
- The Durable Object relay and any live-collab path (Phase 3).
- Version-control surfaces derived from Loro history (Phase 2). Phase 1 writes the history-bearing sidecar but ships no VC reader on top of it.
- Methods, experiments, project folders, attachments (Phase 5).
- The file-watcher daemon. Phase 1 handles external edits detected at open time (the file changed while the app was closed), not a live filesystem watcher. Live watching is a Phase 4 hardening item.

## 2. Where Phase 1 sits against today's notes storage

Today a note persists as `users/<owner>/notes/<id>.json` (the whole `Note` record, including `entries[]`), and the live VC Phase 0/1 history engine appends `users/<owner>/_history/notes/<id>.jsonl`. Both stay exactly as they are. Phase 1 is ADDITIVE.

- The readable mirror backend writes the SAME `users/<owner>/notes/<id>.json` the app already reads, so listings, sharing, search, and a full rollback are all unaffected. The mirror IS the legacy file. Deleting the Loro sidecar returns the note to pure legacy mode with zero loss (design doc section 9).
- The CRDT sidecar is net-new, written to `users/<owner>/.researchos/notes/<id>.loro` (the hidden-dir idiom, like `.git/`). This is the new persisted-data-shape and the thing section 9 of THIS doc asks Grant to sign off.
- The existing `_history/notes/<id>.jsonl` engine keeps running unchanged. It is NOT extended (design doc rule) and NOT read by the Loro store. It is the legacy VC engine that Phase 2 eventually retires once Loro-native history proves out. Two history records coexisting during the pilot is intentional and harmless (one is flag-gated off by default).

## 3. Module layout

All new code under `frontend/src/lib/loro/`. Concrete files:

- `config.ts` (exists), the `LORO_PILOT_ENABLED` flag. Phase 1 keeps it default-off.
- `note-doc.ts`, the Loro document schema for a note (section 5) plus the typed read/write helpers (get title, set entry content, list entries).
- `seed.ts`, the deterministic seed builder (`legacyNote -> seedBytes`, section 6). The single most important file in the phase.
- `sidecar-store.ts`, backend (b), load a `LoroDoc` from `.researchos/notes/<id>.loro`, persist it back atomically via `fileService`. Rebuild-from-mirror when the sidecar is missing or unreadable.
- `mirror.ts`, backend (a), project a `LoroDoc` to the readable `Note` JSON and write it on every save (reuses the existing `notesApi` write path so atomic-write and owner-routing behavior is identical).
- `external-edit.ts`, the B-plus-graceful-C ingestion (section 7), invoked at open when the mirror's `updated_at` is newer than the sidecar's last-known projection.
- `marks.ts`, the Peritext marks helpers (section 8), bold/italic/link as sidecar marks keyed to Loro text positions, never markdown control chars inside the Loro Text.
- `store.ts`, the small reactive facade the UI calls (open a note, subscribe to changes, commit). This is the tldraw-shape single store that later phases attach the relay backend to.

`LoroNoteEditor.tsx` (exists) gets rewired from its current throwaway onChange to talk to `store.ts` (section 10).

## 4. The store facade (the seam later phases extend)

`store.ts` exposes a tiny surface so the relay backend can attach later without the UI changing:

- `openNote(id, owner) -> NoteHandle`, loads the sidecar (or seeds from the mirror), returns a handle wrapping the live `LoroDoc`.
- `NoteHandle.bindEditor(view)`, returns the `LoroExtensions` wiring for the active entry's Text container.
- `NoteHandle.subscribe(cb)`, fires on any committed change (for the mirror writer and, later, the relay).
- `NoteHandle.commit(message?)`, debounced-to-idle commit that (1) writes the sidecar, (2) projects and writes the mirror. Later this same commit is what the relay fans out.
- `NoteHandle.close()`, flush any pending commit, destroy the editor binding.

Local edit and (later) remote edit are the same change applied to this one handle. That invariant is the whole point, so the facade must not bake in any single-user assumption.

## 5. The Loro doc schema for a note

One `LoroDoc` per Note (the entity), NOT one per entry. A running-log note holds many entries whose ordering and membership must merge, so entries are a container the doc owns, matching design doc section 4 (the container-doc pattern).

Schema inside the doc:
- A root Map `meta` with LWW scalars, `title`, `description`, `is_running_log`, `created_at`. These are independent scalars (design doc section 5), LWW with conflict surfaced later.
- A Movable List `entries`, each element a Map holding `id`, `title`, `date`, `created_at`, `updated_at`, plus a Text container `content` for the markdown body. Movable List so reordering and concurrent insert/delete of entries merge predictably.
- The editor binds to the ACTIVE entry's `content` Text container. Because `LoroExtensions` defaults to a fixed text key (`codemirror`), Phase 1 either (a) passes a custom `getTextFromDoc` that resolves the active entry's Text, or (b) rebinds the editor on entry switch. Recommend (b), rebind on entry switch, simpler and the entry switch already tears the editor down today.

OPEN DECISION for Grant, flagged in section 9, note-as-one-doc (recommended, above) vs entry-as-its-own-doc. One-doc keeps entry ordering mergeable and matches the design doc; per-entry-doc would simplify the editor binding but fragments a single note across many sidecars and loses mergeable entry ordering. Recommendation, one-doc.

## 6. The deterministic seed builder (the load-bearing file)

`seed.ts` turns a legacy `Note` into the initial Loro document bytes such that two devices seeding the SAME legacy note produce BYTE-IDENTICAL docs (design doc section 9, the fork pitfall). Without this, two users who both already have the note fork instead of merging.

Requirements:
- Fixed actor id for the seed (a constant, not a random peer id). The first real edit on a device uses that device's real actor id; only the seed is fixed.
- Fixed logical timestamps for the seed operations (derive from the note's own `created_at`, never wall-clock-at-seed-time).
- Canonical ordering, insert entries in a deterministic order (by entry `id`), insert map keys in a fixed key order, insert text content in one operation per Text container.
- Anchor each doc by the note's existing stable `id` so a re-seed of the same note reuses the same identity.
- Unit-tested byte-equality, seed the same fixture note twice (and across two simulated devices) and assert the exported snapshot bytes are equal. This test is the gate, if it ever goes red the fork pitfall is back.

## 7. External-edit policy (B plus graceful-C), open-time only

At `openNote`, compare the mirror file's `updated_at` against the sidecar's recorded last-projection marker. If the mirror is newer, the readable file was edited outside ResearchOS while the app was closed. Ingest it as ONE external-edit commit (design doc section 3), never by reverse-engineering keystrokes:

- Cleanly followable change (the entry content text changed, structure intact), apply the new text to the Loro Text as one commit tagged `external-edit`, so the version tree shows a normal diff across that boundary.
- Not cleanly followable (the JSON was reshaped, fields added or retyped, structure whacked), store a FULL-COPY snapshot of the new content as that commit and set a `external-edit-uncleandiff` flag on the commit so the (later) VC UI can warn "edited outside ResearchOS, no clean diff across this point." History before and after stays granular; the boundary is a coarse step.
- Concurrent case (the sidecar ALSO has uncommitted in-app changes pending AND the mirror changed), do not force a merge. Write a conflict copy (`<id> (external edit).json` mirror + its own sidecar) and surface a warning, same model as attachment conflicts. The user reconciles.
- Rebuild-from-mirror, if the sidecar is missing or unreadable entirely, seed a fresh doc from the mirror via `seed.ts` (graceful degradation, no error to the user).

Phase 1 ships the detection-at-open and the three branches. The live file-watcher (detect an external edit while the app is open) is explicitly deferred to Phase 4.

## 8. Marks in the sidecar (Peritext)

Bold, italic, and links never live as markdown control characters inside the Loro Text (design doc section 3 hard constraint, concurrent edits corrupt them). `marks.ts` stores them as Loro text marks (Peritext-style) keyed to character positions. The readable-mirror projection (`mirror.ts`) renders marks back to markdown control characters in the `content` string so the on-disk `.json` stays plain readable markdown. The round-trip gate (section 11) asserts marks survive mirror-out then seed-back.

Phase 1 scope for marks is the three the current editor produces (bold, italic, link). Headings, lists, and code fences remain plain markdown in the text layer (they are not concurrency-fragile inline marks); they round-trip as text.

## 9. Persisted-data-shape decisions for Grant (sign-off gate)

These freeze an on-disk contract, so they need explicit approval before code (per the house rule, flag data-shape changes before committing).

1. New hidden sidecar path `users/<owner>/.researchos/notes/<id>.loro` (binary Loro snapshot). Confirm the path and that `.researchos/` is the chosen hidden-dir name (matches the design doc's `.researchos/` idiom).
2. Note-as-one-doc schema (section 5), entries as a Movable List inside the note doc. Confirm vs entry-as-its-own-doc.
3. The external-edit conflict-copy naming (`<id> (external edit).json`). Confirm the convention (it mirrors attachment conflict-copy naming).
4. The seed's fixed actor-id constant and timestamp-derivation rule (section 6). Confirm the approach; the exact constant is an implementation detail.
5. Coexistence stance, the legacy `_history/notes/<id>.jsonl` engine keeps running untouched alongside the Loro sidecar during the pilot. Confirm we are NOT retiring it in Phase 1.

## 10. Wiring LoroNoteEditor to persist

Today `LoroNoteEditor` seeds an empty in-memory doc and its `onChange` routes into the old save flow (a throwaway proof). Phase 1 rewires it:
- It no longer creates its own `LoroDoc`. It receives a `NoteHandle` from `store.openNote` and calls `handle.bindEditor(view)`.
- Edits commit through `handle.commit` (debounced to idle), which writes the sidecar and the mirror. The mirror write reuses `notesApi`/`ownerScopedNotesApi` so owner-routing and the lab-head audit path are unchanged.
- The flag conditional in `NoteDetailPopup` stays exactly as it is (both the running-log and single-note branches), no further popup surgery.

## 11. Testing strategy

- Seed byte-equality test (the fork-pitfall gate), section 6. Highest priority.
- Round-trip non-lossy test, legacy `Note` -> seed -> mirror-out -> compare to original (normalized). Migrate only if equal; otherwise stay legacy and log (design doc section 9).
- Marks round-trip test, bold/italic/link survive mirror-out then seed-back (section 8).
- External-edit branch tests, one per branch (clean diff, full-copy-uncleandiff, conflict copy, rebuild-from-mirror), section 7.
- Flag-off inertness test, with `LORO_PILOT_ENABLED` false, `NoteDetailPopup` renders the legacy `LiveMarkdownEditor` and writes no `.researchos/` files. This guards the cherry-pick to main being a runtime no-op.
- All run via `vitest` FROM `frontend/` (the `@` alias lives in `frontend/vitest.config.mts`).

## 12. Work breakdown (sub-bot-sized, in dependency order)

1. `note-doc.ts` schema + `seed.ts` + the seed byte-equality and round-trip tests. (No persistence yet, pure in-memory + bytes. This is the riskiest piece, do it first and verify before anything depends on it.)
2. `sidecar-store.ts` + `mirror.ts` (the two backends) + rebuild-from-mirror + flag-off inertness test.
3. `marks.ts` + the marks round-trip test.
4. `external-edit.ts` + its four branch tests.
5. `store.ts` facade + rewire `LoroNoteEditor` + an integration test (open a fixture note from a sidecar, type, assert both files updated).

Each chunk is one sub-bot in an isolated worktree off live main, verified with `tsc` + `vitest` from `frontend/`, cherry-picked onto local main. Chunk 1 must be green before 2 starts (everything depends on the seed). After chunk 5, run a manual flag-on smoke test in the real app on a scratch folder before reporting Phase 1 done.

## 13. Exit criteria for Phase 1

- Flag-on, a real note opens from its Loro sidecar, edits persist to both the sidecar and the readable mirror, the readable `.json` stays byte-clean markdown.
- Closing and reopening the app restores the note from the sidecar with full edit history present in the Loro doc (even though no VC UI reads it yet).
- An external edit made while the app was closed ingests cleanly per the three branches.
- Deleting `.researchos/` returns the note to pure legacy behavior with zero data loss.
- Flag-off, the app is byte-for-byte unchanged from today.
- All section 11 tests green.

When these hold and Grant has eyes on the flag-on smoke test, Phase 2 (VC-from-native-history) can scope, and the Cloudflare provisioning for Phase 3 can proceed in parallel.
