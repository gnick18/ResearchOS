# Notebooks Generalization (personal + shared, one container) Proposal

Author: orchestrator (master bot), 2026-06-06
Status: DRAFT, design forks answered by Grant (2026-06-06). Not dispatched. No
code until Grant signs off on this doc.

Supersedes the container shape in `SHARED_NOTEBOOKS_PROPOSAL.md` (the 1:1
PI<->student notebook). That proposal stays the reference for the sharing
semantics and the weekly-tasks-in-a-notebook behavior; this doc only
generalizes the container so personal (unshared) notebooks and shared notebooks
are the same object.

## Motivation

Grant: notes can get out of hand once a user has hundreds floating around. We
already have shared notebooks (the locked 1:1 PI<->student workspace). The gap
is a way for a single user to make their OWN notebook and sort notes into it
(the "a class" example), without losing the free-floating sticky/quick note that
belongs to no container. The Notes page should make all three feel like one
coherent system rather than a shared-notebook switcher bolted next to a flat
note grid.

## The model (three tiers, one container concept)

- FLOATING NOTES. A note with no `notebook_id`. Unchanged behavior, the
  sticky/quick-note purpose. This is preserved deliberately, it is a first-class
  state, not a fallback.
- PERSONAL NOTEBOOK. A notebook with exactly one member (you). Lives only in
  your folder, never shared. Used to group notes (a class, a topic, a side
  project).
- SHARED NOTEBOOK. The same notebook record with more members. The current 1:1
  PI<->student notebook becomes the two-member special case of this.

## Locked design forks (Grant, 2026-06-06)

1. ONE UNIFIED Notebook record. Generalize `SharedNotebook` into a single
   `Notebook` with a `members` list (1 = private, 2+ = shared). We migrate the
   locked 1:1 shape rather than maintaining two near-identical types.
2. NOTEBOOKS ARE THEIR OWN AXIS. A note can be unfiled, in a project, in a
   notebook, or in both a project and a notebook. Notebooks are a grouping layer,
   not a replacement for project filing. `notebook_id` and `project_id` are
   independent.
3. LIGHT UI. A left-rail switcher inside the existing Notes tab. Not a separate
   route, not heavyweight notebook widgets/popups in v1. (The built-out
   notebook surface stays a possible later phase, see Open questions.)

## Data model (additive, one breaking rename)

The current `SharedNotebook` (types.ts) is `{ id: string, members: [string,
string], created_by, created_at, title?, owner, shared_with }`.

Proposed `Notebook`:

```
export interface Notebook {
  id: string;                 // crypto.randomUUID, globally unique (unchanged)
  members: string[];          // was [string, string]; now 1..N. members[0] = creator
  created_by: string;         // = owner = members[0]
  created_at: string;
  title?: string;
  owner: string;              // = created_by
  shared_with: SharedUser[];  // pairingSharedWith generalized to N members.
                              // length 0 when members === [owner] (private)
}
```

Key points:
- `members.length === 1` => private notebook. `shared_with` is empty, so the
  unified `canRead`/`canWrite` give only the owner access. No special-casing in
  the sharing engine.
- `members.length >= 2` => shared. `shared_with` = every member except the owner,
  at "edit" (generalize `pairingSharedWith` to `membersSharedWith(members)`).
- `Note.notebook_id` already exists (types.ts:2310) and is unchanged. A floating
  note simply omits it. A note's `shared_with` continues to be derived from its
  notebook membership for notebook notes, exactly as the 1:1 proposal does.
- `project_id` and `notebook_id` coexist on a note (fork 2).

Store: keep the existing thin string-keyed per-user store
(`lib/shared-notebooks/store.ts`), rename the entity to `notebooks`. The on-disk
shape is `users/<owner>/notebooks/<uuid>.json`.

## Migration (the only non-additive piece)

The locked 1:1 notebooks already on disk are `SharedNotebook` with
`members: [a, b]`. Under the generalized shape they ARE valid `Notebook`
records (two-member array, owner = members[0]). So the migration is a
lazy-normalize on read per the AGENTS.md field-migration pattern:

- `normalizeNotebookRecord` at the read boundary: accept both the old
  `[string, string]` tuple and the new `string[]`, coerce to `string[]`. No
  on-disk cutover.
- Rename the entity folder from `shared_notebooks` to `notebooks`. To avoid a
  flag-day, the read path checks both folder names during a transition window
  (read old, write new), OR we keep the folder name `shared_notebooks` to dodge
  the rename entirely and only rename the TYPE in code. RECOMMEND keeping the
  on-disk folder name and renaming only the TS symbol, since the folder name is
  invisible to users and a rename buys nothing but migration risk.

This is a data-shape change. FLAG before merge per AGENTS.md.

## Notes page revamp (light, left-rail switcher)

Today `NotesPanel` has an `activeNotebookId` switcher that is a small section
listing "Personal" + each shared 1:1 notebook (NotesPanel.tsx:119). Generalize
it into a left rail:

- ALL NOTES (everything the viewer can see, current default grid)
- UNFILED (notes with no `notebook_id`, the floating notes)
- MY NOTEBOOKS (personal, members === [me])
- SHARED (notebooks with other members)

Selecting a rail entry filters the main pane. "New note" can target the active
notebook (creates with that `notebook_id`) or stay floating when ALL/UNFILED is
active. A note can be moved into / out of a notebook from its card context menu
and from inside `NoteDetailPopup`. The existing scale controls (grid/list, sort,
group-by, show-more) stay and apply within the selected rail entry.

Lab Mode keeps its existing separate shared-notes browser untouched, exactly as
the 1:1 proposal scoped it.

## Phasing (proposed, dispatch after sign-off)

- Phase 1 (data + API): rename `SharedNotebook` -> `Notebook`, widen `members`,
  add `normalizeNotebookRecord`, generalize `pairingSharedWith` ->
  `membersSharedWith`, add create-private-notebook + add/remove-member +
  move-note-to-notebook to the notebooks API. Verify, FLAG the data shape.
- Phase 2 (Notes page rail): the left-rail switcher + filtering + move in/out.
- Phase 3 (polish): personal-notebook create dialog, rename/delete, empty
  states. Optional later: the built-out notebook surface (cover, description,
  pinned notes, popup) if Grant wants the heavier feel.

## Locked decisions, round 2 (Grant, 2026-06-06)

4. EXACTLY ONE notebook per note. Keep `notebook_id` as a single id, no
   `notebook_ids[]`. Moving a note into a notebook removes it from any prior
   notebook.
5. PROMOTION FLIP WITH A WARNING. Adding a member to a notebook shares every
   note already inside it with the new member. We show a confirm dialog before
   the flip so it is never a surprise. (No "only future notes" mode, the
   "which notes are shared" question must stay trivially answerable: all of
   them.)
6. NO personal-notebook home-page widget in v1. Personal notebooks live only in
   the Notes-page left rail. The shared-notebook home widget already specced in
   `SHARED_NOTEBOOKS_PROPOSAL.md` stays as-is.
7. HEAVIER NOTEBOOK SURFACE DEFERRED. v1 stays light (rail + filtering + move
   in/out + create/rename/delete). Cover image / description / pinned notes /
   popup view are a later phase, revisited once the basic structure proves out.
