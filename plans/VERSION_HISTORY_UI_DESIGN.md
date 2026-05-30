# Version History Viewer, UI design

Author: version-history-ui design bot (for HR), 2026-05-29
Status: design only. No app code, no installs. Models the viewer on Google Docs version history (right sidebar, in-place colored diff, restore as a new version).

---

## 0. TL;DR

ResearchOS has the *attribution* and *trash* halves of version control shipped, but the
*per-version history* half (the backing delta log, the timeline UI, the in-place diff, and
revert) does not exist in code yet. The data this UI needs to read is not being written today.

So this doc does two things:

1. Calls out, with file:line citations, exactly what is built vs only designed, and names the
   one hard prerequisite: the per-version edit-history log (VCP phases R4 and R5) must exist
   before the viewer has anything to show.
2. Designs the viewer itself, a Google-Docs-style right sidebar, against the locked VCP data
   model so that when the history engine lands, the UI is ready to consume it.

Recommended panel shape: right sidebar (matches Google Docs, matches the app's existing
full-height popups). Recommended diff approach: reuse and extend the in-house
`diffMarkdownLines` segment model for the markdown surfaces, color-coded per editor; fall back
to scalar old/new rows for short fields. jsdiff (locked in VCP for the *storage* delta format)
is a write/read-engine concern, not a render concern; the viewer renders from reconstructed
states, not raw unified-diff text.

One honest correction up front: Grant said "tree." The backing model is **linear per record**
(VCP non-goals, no branches/merges). The "tree" the user perceives is a *time grouping*
(by day / session), not a branch graph. This doc designs the linear-with-grouping shape and
flags the wording in the open questions.

---

## 1. Verified current state (built vs only designed)

I read both proposals in full and verified each pillar against the code. Citations are
`path:line` in `frontend/`.

### 1a. What is BUILT

**Attribution stamps (VCP R3): shipped, last-edit-only.**
- `last_edited_by` / `last_edited_at` are stamped on every update path in
  `src/lib/local-api.ts` (the `buildAttributionStamp` helper at `src/lib/local-api.ts:153-164`
  is spread into ~10 update call sites: lines 326, 796, 1850, 2101, 2946, 3233, 3381, 3470).
- The `<AttributionChip>` + `<StampsRow>` primitive exists at
  `src/components/AttributionChip.tsx` (PI-badge resolution, relative + absolute time, wrapped
  in `<Tooltip>` per house rule), consumed by `NoteCard.tsx`, `NoteDetailPopup.tsx`,
  `TaskDetailPopup.tsx`, `HighLevelGoalModal.tsx`, `ExperimentResultCard.tsx`,
  `WorkbenchExperimentsPanel.tsx`, `app/links/page.tsx`.
- **The gap:** these are *single-slot* fields, one editor + one timestamp per record
  (`src/components/AttributionChip.tsx:39-49`). They answer "who touched this last," NOT
  "who made each historical edit." A version-history tree needs **per-version** attribution,
  which only exists once the history log writes a row per save. So R3 gives us the *latest*
  row's actor for free, but every older row's actor has to come from the (not-yet-built) log.

**Trash / soft-delete (VCP R1 + R2): shipped.**
- Full subsystem under `src/lib/trash/`: `trash-types.ts`, `trash-writer.ts`, `trash-reader.ts`,
  `trash-index.ts`, `trash-paths.ts`, `trash-settings.ts`, `migrate-notes-trash.ts`, with tests
  under `src/lib/trash/__tests__/`.
- A `/trash` route (`src/app/trash/`) and trash components (`src/components/trash/`) ship,
  plus a wiki page at `src/app/wiki/features/trash`.
- The `_trash` on-disk shape (`TrashedEntity<T>` + `_index.json`) matches VCP 3a/3b exactly
  (`src/lib/trash/trash-types.ts:77-117`), including the 30-day default
  (`DEFAULT_CLEANUP_DAYS = 30`, line 120) and the `Never` sentinel (line 117).
- **Implication for revert:** "undo a delete" is ALREADY solved by the trash Restore button.
  The history viewer's revert is the *other* kind, reverting an edit to a field, which is not
  built.

**Markdown diff utilities: built, in-house, single-consumer.**
- `src/lib/methods/markdown-line-diff.ts` is a hand-rolled line-level LCS diff returning
  `DiffSegment[]` (`same` / `add` / `remove` runs). Its own header comment
  (`markdown-line-diff.ts:1-6`) says it deliberately avoids a jsdiff dependency and to
  "swap this out for jsdiff (Phase 2C+)" if a second consumer appears, the version-history
  viewer is exactly that second consumer.
- `src/lib/methods/diff-display.ts` holds the shared color conventions
  (`ADDED_ROW_CLASSES` green, `REMOVED_ROW_CLASSES` red + line-through, amber "modified").
- The only renderer today is `src/components/methods/MarkdownMethodTabContent.tsx`
  (the `DiffView` component, lines ~61-77), which renders `same` runs through ReactMarkdown
  and `add`/`remove` runs as colored blocks. This is the diff renderer to reuse and extend.

**Manual-save model: live.** The editor is explicit-save, not auto-save-on-blur, exactly as
VCP OQ2 locked. `NoteDetailPopup.tsx` tracks `unsavedContentRef`, lights a "Save note" button,
handles `onExplicitSave` (Cmd+S), and guards navigation with a `beforeunload`
(`NoteDetailPopup.tsx:128-298`, esp. the `useUnsavedChangesGuard` at line 273). Confirmed:
**each manual Save is intended to be exactly one version.** That is the natural hook point for
a history row.

**User identity conventions for the timeline:** `UserAvatar.tsx` (gradient bubble keyed on
`useUserColors`) and `useUserColor` (`src/hooks/useUserColor.ts`, exports `useUserColors`,
`useUserColor`, `useUserColorMap`) plus `src/lib/colors.ts` give us avatar + per-user color.
The viewer reuses these so each version row is color-coded by editor with zero new color logic.

### 1b. What is ONLY DESIGNED (not in code)

**The per-version edit-history engine: does not exist.** Verified by absence:
- No `src/lib/history/` directory (the VCP R4 deliverable path). Only `src/lib/undo/value-history.ts`
  exists, that is the in-memory editor undo stack, explicitly NOT the persistent log
  (VCP §9 flags this exact confusion).
- No `_history` path is written anywhere in `src/` (the one `_history` substring match is an
  unrelated variable in `src/lib/users/propagate-rename.ts`).
- No `HistoryRow`, `appendLine`, `boundary_snapshot`, `createTwoFilesPatch`, `reversePatch`,
  or `applyPatch`-from-jsdiff anywhere (the only `applyPatch` hit is a React state setter in
  `src/app/settings/StreaksSection.tsx`).
- `diff` (jsdiff) is NOT in `frontend/package.json` dependencies. The VCP-R4-prep install
  (`diff@9.0.0`) has not happened.

**Revert / restore-a-version: does not exist.** No `revert_undo_window`, no "undo-revert", no
restore-version handler in `src/`. VCP §3l (backward-walk revert) and §3m (24h undo window) are
designed but unimplemented. (Trash Restore is separate and shipped, see above.)

**The "History" tab on popups: does not exist.** No detail popup has a History tab today; the
VCP §2a timeline is paper-only.

### 1c. The GAP this UI design must assume

The viewer cannot ship before its data exists. Concretely, **the per-version history log
(VCP R4 for Notes, R5 for the rest) is a hard prerequisite.** Until a history row is written
per Save:

- There are zero historical versions to list (only the live record + its single
  `last_edited_by` stamp).
- There is no per-version actor, so the timeline can show "who" only for the latest edit.
- There is nothing to diff against (no prior state on disk).
- Revert has no target to restore.

Therefore this document designs the UI **against the locked VCP history schema** (the
`HistoryRow` jsonl shape, the jsdiff delta storage, the boundary-snapshot compaction) and
treats "build the history engine" as Phase 0, the dependency, not part of the viewer itself.
Where the viewer needs something the engine must provide, it is called out as an engine
requirement, not a UI feature.

One nuance from the storage choice (VCP OQ10, locked to jsdiff text-diff deltas): a history row
stores a *delta*, not a full snapshot. To preview or diff version K the engine must
**reconstruct** state K by walking deltas (forward from the boundary snapshot, or backward from
HEAD per VCP §3l). The viewer consumes reconstructed `{ before, after }` state pairs from a
reader API; it never parses unified-diff text itself. This keeps the render layer simple and
lets it reuse `diffMarkdownLines` on real strings.

---

## 2. The Version History Viewer

### 2a. Entry point (the affordance)

A version-history button on every version-tracked surface. "Version-tracked" = every entity the
VCP history writer covers (all eight shareable types). Enumerated entry points, with the
existing component to hang the button on:

| Surface | Component | Button placement |
|---|---|---|
| Standalone Note | `NoteDetailPopup.tsx` | header action row, next to Share / Comments |
| Experiment Lab Notes + Results | `TaskDetailPopup.tsx` (task_type "experiment") + `ExperimentResultCard.tsx` | header action row |
| Task | `TaskDetailPopup.tsx` | header action row |
| Method write-up | `MarkdownMethodTabContent.tsx` (and the structured method tabs) | next to the existing "Modified from source" chip |
| Project | Project detail popup | header action row |
| Purchase item | Purchase item popup | header action row |
| High-level goal | `HighLevelGoalModal.tsx` | header action row |
| Lab link | `app/links/page.tsx` | per-row action |

The button is **icon-only, wrapped in `<Tooltip label="Version history">`** (house rule: never
native `title=`). Icon is an inline SVG (house rule: no emoji, no lucide), a clock-with-counter-
arrow "history" glyph, mirroring the StreakBadge / AppShell inline-SVG pattern. It sits beside
the existing `<StampsRow>` so "last edited by Morgan 2h ago" and "see all versions" live
together, exactly the Google Docs pattern where the "Last edit was..." text is itself the link
into history.

The button is shown to anyone with **read** access (VCP OQ14: history is part of read access).
The Restore action inside the panel is gated to **write** access (and to the PI passcode for
cross-owner restores, VCP OQ12).

### 2b. The panel: right sidebar (recommended)

**Recommendation: a right sidebar, not a popup.** Rationale:

- It is the Google-Docs convention the brief asks us to model.
- The whole point is *in-place* diff: the document stays visible on the left while the version
  list sits on the right and the selected version's diff renders into the same document column.
  A modal popup would cover the document and break the "see the edit where it happened" goal.
- The app already renders full-height detail popups, so a right rail docked inside the popup
  (or sliding over its right third) fits the existing layout language.

Behavior:

- Opening the sidebar splits the detail popup: document/diff on the left, version list on the
  right (~320px). On narrow widths it becomes a full-width overlay list; tapping a version
  swaps the document column to that version's diff (mobile Google Docs behavior).
- The document column enters a **read-only preview mode** while the sidebar is open (editing is
  disabled; an "Exit history" affordance returns to the live editable record). This prevents
  the confusing state of editing a historical preview.

**Version list contents (newest-first), per row:**

- A small `<UserAvatar size="xs">` for the editor, color-coded via `useUserColors`, plus the
  resolved name (reuse `resolveDisplayName` from `AttributionChip.tsx` so the "(PI)" badge and
  departed-user fallback are identical to the rest of the app).
- Timestamp: **relative for recent, absolute on hover** via `<Tooltip>` (reuse
  `formatRelative` + `formatFullDate` from `AttributionChip.tsx` so wording matches the chips).
- A one-line summary of what changed ("edited Lab Notes", "changed title", "3 fields"),
  derived from the row's field set.
- The currently-selected row is highlighted; the live HEAD row is labeled "Current version".

**The "tree" / grouping (this is where many-versions-per-record is tamed):**

The manual-save model still produces many versions on a busy day, so the list groups them the
way Google Docs does:

- **Group by day** (collapsible day headers: "Today", "Yesterday", "May 27"), and within a day
  optionally **by session/editor run** (a contiguous run of saves by one editor within a short
  window collapses into one expandable group showing "Morgan, 9:01-9:40 AM, 7 versions").
- Collapsed groups show the net diff of the whole run; expanding reveals each constituent save.
  This maps onto the VCP compaction model: the recent-verbatim window (last 100 rows) expands
  fully; rows folded into a boundary snapshot show as a single "earlier versions (compacted)"
  group with day-granularity only, with copy that says intermediate saves were summarized (VCP
  R4-prep §2d lossiness note). This is the honest UI for the linear-with-compaction backing.

This grouping IS the "tree" the user sees: a time hierarchy (day -> session -> save), not a
branch graph.

### 2c. Diff rendering (in place, Google-Docs-style, per-editor color)

Selecting a version renders its diff **in the document column, in place**, comparing the
selected version against its immediate predecessor (Google Docs default), with a toggle to
"compare against current" for the long view.

**Markdown surfaces (Note entries, Method write-up, experiment Lab Notes):**

- Reuse `diffMarkdownLines(before, after)` to produce `DiffSegment[]`, then render with the
  existing `DiffView` pattern from `MarkdownMethodTabContent.tsx`: `same` runs through
  ReactMarkdown, `add` runs highlighted (green, `ADDED_ROW_CLASSES`), `remove` runs struck
  (red + line-through, `REMOVED_ROW_CLASSES`) from `diff-display.ts`.
- **Per-editor color:** the green/red insert/delete coloring stays (it signals add vs remove),
  but each changed run is **left-bordered / tinted with the editor's user color** (from
  `useUserColors`) and carries a small avatar at the run's start, so "who wrote this line" is
  visible the way Google Docs tints suggestions per collaborator. When the engine matures to
  word-level granularity, extend `markdown-line-diff.ts` to a word-level pass (its header
  comment already anticipates the jsdiff swap); v1 ships at line granularity, which is what the
  utility produces today.

**Scalar / structured fields (title, due_date, tags, sub-task toggles):**

- Render the VCP §2a inline old/new row: red-struck old value, green new value, with the
  human-readable field path ("title", "entries[0].content" prettified). For arrays/objects use
  the structural `+`/`-`/` ` line-prefix diff. These read from the row's reconstructed
  field-level before/after, no markdown diff needed.

The render layer always consumes reconstructed *values* (strings/objects) from the history
reader, never raw jsdiff patch text. The reader owns delta application (VCP R4-prep), the
viewer owns presentation.

### 2d. Restore (revert to a version)

A **"Restore this version"** button on the selected version (write-access only). UX mirrors
Google Docs:

- Confirm step: a small confirm ("Restore this version? Your current version stays in history
  so you can switch back."). For per-field reverts the confirm names the field(s) explicitly
  (VCP §8b: "Restore 'title' to its May 14 value, other fields unchanged").
- On confirm, the engine performs the VCP §3l backward-walk revert and writes the result as a
  **new history row** at HEAD (`kind: "revert"`). Google-Docs-identical: restoring does not
  delete the versions in between; it appends a new current version. The version list simply
  grows a new top row "Morgan restored the May 14 version".
- After restore, the live record gains the VCP §3m `revert_undo_window` (24h). The popup shows
  an **"Undo restore"** affordance for 24h (write-access + unexpired). This is the one-click
  safety net; after 24h the version is still reachable through the list, only the one-click
  button disappears.
- PI cross-owner restore requires the Phase 5 passcode unlock and writes to the PI audit log
  (VCP OQ12). When a PI views across owners without an active unlock, the Restore button is
  disabled with a `<Tooltip>` explaining the unlock requirement (VCP §8d).
- Read-only viewers never see Restore (VCP OQ14).

### 2e. Local-first + performance

- **All on disk, no server.** The reader streams `_history/<type>/<id>.jsonl` from the user's
  folder (VCP §3c). The viewer adds no network surface.
- **Pagination.** The list pages at 50 rows newest-first (VCP §2a / edge case 8). "Load older"
  appends the next 50. The reader reads from the file tail so a 1000+-row history still paints
  the first page instantly.
- **Reconstruction cost.** Previewing version K applies deltas from the nearest anchor (boundary
  snapshot or HEAD) per VCP §3l / R4-prep §2. Typical previews touch a few rows and are cheap;
  deep previews into a compacted region resolve to the boundary granularity. The viewer caches
  the last-previewed reconstructed state so toggling between adjacent versions is instant.
- **Compaction is invisible-but-honest.** Folded rows render as a single "earlier versions"
  group (see 2b) rather than silently vanishing, so the user understands why row-by-row stops
  at the boundary.
- **Shared / edited-by-others attribution.** Each row already carries `actor` + `owner`
  (VCP §3c). PI cross-owner rows resolve to "(PI)" via the same `resolveDisplayName` path the
  chips use, so a version edited by Morgan in Mira's folder reads correctly with no special
  case. Departed-user rows fall back to the stored username (VCP, AttributionChip behavior).

### 2f. Accessibility + house style

- The sidebar is a focus-trapped region; opening it moves focus to the version list, Esc closes
  and returns focus to the trigger button.
- Version rows are a keyboard-navigable list (Up/Down to move selection, Enter to preview,
  the preview updates the document column live). Restore is a real `<button>` reachable by Tab.
- Every icon-only control (the entry button, Restore, Undo restore, day-group collapse) wraps
  in `<Tooltip>`; no native `title=`.
- All icons inline SVG; **no emoji** anywhere in the surface.
- **No em-dashes** in any visible copy (commas / colons / parens / period splits).
- Color is never the only signal: insert/delete also carry +/- prefixes and struck text, so the
  diff reads for color-blind users and the per-editor tint is supplementary.

---

## 3. Phasing + open questions

### 3a. Phased plan

- **Phase 0 (prerequisite, the VCP history engine):** build `src/lib/history/` (writer, reader,
  jsdiff `diff@9.0.0` install, the `HistoryRow` jsonl per Save, Genesis backfill, the
  boundary-snapshot compaction). This is VCP R4 (Notes) then R5 (the rest). The viewer is
  blocked on at least R4. No viewer pixel ships until a Save writes a history row.
- **Phase 1 (pilot, read-only viewer for Notes):** the right-sidebar version list + in-place
  markdown diff on `NoteDetailPopup.tsx`, grouped by day/session, reusing `diffMarkdownLines` +
  `DiffView` + `UserAvatar` + `resolveDisplayName`. No Restore yet. **Pilot surface: standalone
  Notes**, they already host `AttributionChip`/`StampsRow`, have the manual-save model wired,
  and are the VCP canary for every prior phase.
- **Phase 2 (Restore for Notes):** "Restore this version" + the 24h "Undo restore" window, wired
  to the VCP §3l/§3m revert engine and the PI passcode gate.
- **Phase 3 (roll out to all surfaces):** extend the entry button + sidebar to Experiments/Tasks,
  Methods, Projects, Purchases, High-level goals, Lab links, following the same component, as
  R5 lands the per-entity history logs.

### 3b. Open questions for Grant

1. **"Tree" vs linear.** The backing model is linear-per-record (VCP non-goal: no branches). The
   "tree" becomes a day -> session -> save *time grouping*, not a branch graph. Confirm that
   time-grouping is the intended "tree", or does Grant actually want branchable versions (a much
   larger change to the locked VCP model)?
2. **Sidebar vs popup.** This doc recommends a right sidebar (Google Docs parity, keeps the
   document visible for in-place diff). Confirm, or prefer a centered popup?
3. **Version granularity in the list.** Per-save, per-session, or per-day as the default
   grouping the user sees first? (Engine stores per-save; this is purely how aggressively the UI
   collapses by default.)
4. **Named / manual versions.** Google Docs lets users "Name this version" to pin a milestone.
   Worth a "Name this version" affordance (a labeled, never-compacted row), or auto-only for v1?
5. **Pilot surface.** This doc picks standalone Notes. Confirm, or pilot on the Method write-up
   (also markdown, also has a diff renderer already)?
6. **Compare-against.** Default to "diff vs previous version" (Google Docs) with a "vs current"
   toggle, or always diff against current? Affects the reconstruction the reader must do.
7. **Retention / compaction surfacing.** VCP locked 500 rows / 100 recent verbatim with
   day-granularity below the boundary. Is surfacing "earlier versions were summarized" copy
   acceptable, or does Grant want a setting to keep more rows verbatim (VCP R4-prep FU3)?

---

Signed: version-history-ui design bot, 2026-05-29
