# BeakerSearch v2 proposal

Written 2026-06-07 by the sequence editor master, after v1 shipped website-wide
(provider + redesign + global object search + the generic per-page contract + all
seven page sources + Step 4 hover-as-context, all on `main`, 302 tests green).

v1 made BeakerSearch reach everything. v2 makes it FINISH everything, the actions
that v1 punted out to a page surface now complete inside the palette, and a few
capabilities that the one-shot v1 model could not express. Voice, no em-dashes, no
en-dashes, no emojis, no mid-sentence colons.

---

## 0. The shape of v2

One new primitive unlocks most of the debt, the **in-palette sub-flow**. Almost
every v1 simplification is the same shape, "the action needs a second choice (a
task, a project, an assignee, a funding account) and v1 had no way to ask for it
inside the palette, so it opened the page instead." Build the sub-flow once and
the pickers fall out for every page.

v2 is then, in priority order:

1. The sub-flow framework (the centerpiece, section 1).
2. Clear the five v1 debts on top of it (section 2).
3. New capabilities the one-shot model could not do (section 3).
4. Global object search v2 entities (section 4, Notes is locked first).

Each is independently shippable. Nothing here changes v1 behavior until its chunk
lands.

---

## 1. The centerpiece, in-palette sub-flows

### 1.1 The problem

v1's `EditorCommand.run()` and `PaletteNavItem.onRun()` are terminal, they do the
thing and close the palette. An action that needs a SECOND choice ("assign this to
WHICH member", "move this to WHICH project") cannot ask, so v1 opened the owning
surface (the TaskModal, the popup, /purchases) and let the page collect the rest.
That works but breaks the keyboard-only promise, the user leaves the palette.

### 1.2 The mechanism

A command or nav item may declare a `subflow` instead of (or in addition to) a
terminal run. Running it does NOT close the palette, it PUSHES a new palette view
onto a stack:

```ts
interface PaletteSubflow {
  title: string;              // breadcrumb, e.g. 'Assign "PCR optimization" to...'
  placeholder?: string;       // input hint for the picker, e.g. "type a member"
  items: PaletteNavItem[];    // the choices, fuzzy-filtered by the live input
  // selecting an item either completes the action or pushes ANOTHER subflow
  onPick: (item: PaletteNavItem) => void | PaletteSubflow;
  // optional free-text completion (a date, a new category name) when the query
  // does not match an item, mirrors interpretQuery but scoped to this stage
  onSubmitRaw?: (query: string) => void | PaletteSubflow;
}
```

- The provider keeps a `subflowStack`. The active view is the top of the stack (or
  the page source when empty). The input filters the active view's items.
- Breadcrumb header shows the stack ("Gantt / Assign to..."), Escape and a back
  affordance POP one stage, a second Escape closes.
- `onPick` returning a `PaletteSubflow` chains (pick task, then pick assignee).
- Returning void completes, runs the real handler, closes.

This is purely additive to the contract, a command without `subflow` behaves
exactly as v1. The palette gains a view stack and a breadcrumb, the source
builders gain the ability to attach a picker to a command.

### 1.3 What it unblocks (the v1 picker debts)

Every "open the surface instead" from v1 becomes a real in-palette pick:

| Action | v1 (today) | v2 sub-flow |
| --- | --- | --- |
| Assign a task (Gantt, Lab Overview) | opens the assignee surface | pick task -> pick member -> `assignTask` |
| Flag a record for review (Lab Overview, Purchases) | opens the flag composer | pick record -> pick flag -> `setFlagForReview` |
| Change a task's project (Gantt, Purchases) | opens the detail popup | pick project (+ Standalone) -> `tasksApi.update` |
| Set funding account (Purchases) | opens the editor | pick account -> per-item `purchasesApi.update` |
| Add a dependency (Gantt) | opens the popup, user drags | pick child experiment -> pick dep type -> `dependenciesApi.create` |
| Move a method to a category (Methods) | follow-on picker (partial) | pick category (+ free text) -> `ownerScopedMethodsApi.update` |
| Move a note to a notebook (Workbench) | opens the move menu | pick notebook -> `moveNoteMutation` |
| Link an event to a task (Calendar) | the EventModal picker (UI never built) | pick task -> `eventsApi.update({ task_id })`, also finishes the long-deferred event-to-task UI |

The handlers ALL already exist (v1 wired them, just behind the surface). v2 only
changes the LAST mile, collect the second choice in the palette, then call the
same handler.

---

## 2. Clearing the five v1 debts

### 2.1 In-palette pickers (section 1, the big one)
Covered by the sub-flow framework above. This is the bulk of the debt.

### 2.2 Workbench live selection
v1's Workbench source names the LAST PALETTE-OPENED entity as `selection`, not the
card you actually clicked, because each panel owns its popup state privately and
v1 did not lift it. v2 fix, a tiny per-panel reporter, each panel calls a
`reportWorkbenchSelection({ kind, key })` on its own setSelectedTask /
setSelectedNote / setSelection / setSelectedId, into a lifted page state the
source reads. This is the same "lift the open intent" pattern v1 already added for
the cross-tab jump (`pendingOpen` + `initialOpen`), extended to REPORT the
selection back up, not just push it down. Then the context card and Suggested name
the thing you actually have open. Hover-context (Step 4) already covers the
pointed-at case, this closes the clicked-at case.

### 2.3 Links, the board filter and the real preview
- `activeCategory` is palette-managed local state in v1, the BOARD itself stays
  unfiltered. v2 lifts the filter to the page so selecting a category in the
  palette actually filters the visible board (a `categoryFilter` page state the
  Links grid reads, mirroring how Gantt's `projectFilterMode` works).
- `getPreview` is a stub today (returns no image). v2 wires a real link-preview
  fetch (server-side metadata scrape or an oEmbed/opengraph read), feeding both
  the card thumbnail and a small inline preview in the palette result row (section
  3.3). This is the one v2 item that needs a backend touch, scoped as its own
  chunk with the CORS / fetch story spelled out.

### 2.4 Lab Overview, surface approvals as palette entities
v1 only routes to /purchases for approvals because the page renders no pending
LIST (just a count). v2, the Lab Overview source reads `["lab","purchase-items"]`
(it already does for the count) and exposes each pending item as a NAVIGATE entity
("Pipette tips x10, alex, $89, pending"), so the PI can approve / decline / flag a
SPECIFIC item inline via the per-record confirm, the spec's original 3.3 set,
without leaving for /purchases. Optionally also render an in-page pending list, but
the palette path is the cheaper win and does not touch the page layout.

### 2.5 The per-record PI confirm is fine, document it
v1 correctly adapted from the retired timed edit-session to the per-record PI edit
confirm. No change needed, but v2 should make the confirm legible in the palette,
a greyed approve row reads "confirm edit-as-lab-head on first approve" rather than
silently confirming, so the PI knows the first action is the gate.

---

## 3. New capabilities (what the one-shot model could not do)

### 3.1 One action source, two surfaces (the unification)
Each page's per-entity action set lives inside its source builder today. Extract it
into a pure `actionsForEntity(entity, ctx): EditorCommand[]` per page, consumed by
BOTH the palette Suggested AND any future surface (the right-click menus already on
Workbench / Gantt / Purchases could converge on it later). One source of truth, so
the keyboard path and the mouse path never drift. This also makes the sub-flow
pickers trivial, the picker's onPick just runs the same command.

### 3.2 Frecency ranking + tuning
v1 ranks objects by fuzzyScore + a fixed type-weight + a recency boost. v2 learns,
a per-user frecency store (localStorage, like the MRU) counts how often each record
is opened / jumped-to and blends frequency + recency into the score, so the records
you actually use float up. The fixed type-weight constants (Task +3 > Project +2 >
...) get tuned from this signal rather than guessed. Pure, testable, no new data
plumbing (it rides the same jump events the MRU already records).

### 3.3 Inline result previews
A result row can carry a small preview, a link thumbnail (from 2.3's real
getPreview), a sequence mini-map glyph, a method type chip (already there). Cheap,
opt-in per item, makes a long result list scannable.

### 3.4 Quick-filter tokens
Typed tokens narrow the search the way `/search` already filters, `type:experiment`,
`project:Mito`, `shared:`, `overdue`, `@alex`. Parsed out of the query before the
fuzzy pass (reuse the matchesMethodSearch / search-page token logic), so "overdue
type:list" surfaces only overdue list tasks. Power-user reach without leaving the
one input.

### 3.5 Result row sub-actions (peek without drilling)
A result row exposes its top action inline, a right-arrow / a secondary key on a
highlighted task reveals "Mark complete / Open / Assign" as a quick sub-menu
(itself a one-level sub-flow), so you act on a search hit without first opening it.
Reuses 3.1's action source.

### 3.6 Multi-select + bulk
Shift / Cmd-click (or a select key) marks several result rows, then a bulk action
runs across them, "approve all selected", "mark complete", "move to project X"
(the move is a sub-flow). The lab-head approval queue and list-task triage are the
obvious wins.

---

## 4. Global object search v2 entities

v1 indexes Tasks / Projects / Methods / Sequences. The locked v2 order (per
`beakersearch-global-search-decisions.md`) adds NOTES first, then the rest. Each
needs a merged loader + a clean deep-link, the moment a candidate needs a new
loader or deep-link it was correctly v2:

- NOTES (locked first), prerequisites `fetchAllNotesIncludingShared` (own + shared
  notebook notes, deduped) + an `?openNote=<key>` deep-link. Then notes join the
  cross-app index and the MRU.
- Then, lower value, lab links, calendar events, purchase line items, lab members,
  notebooks, 1:1s, artifacts, as each earns a merged loader + deep-link.

This is additive to the chunk-1 `buildGlobalIndex` (it already maps a flat
GlobalIndexEntry[], a new type is a new mapper + loader).

---

## 5. Rollout (chunks, each shippable + mockup-reviewed where UI-visible)

1. **Sub-flow framework** (section 1), the palette view-stack + breadcrumb + the
   `PaletteSubflow` contract, with ONE consumer wired as the proof (Gantt "assign a
   task"). Mockup the stacked-view UX first.
2. **Picker debts** (section 2.1), wire the rest of the assign / flag / project /
   funding / dependency / move / link-event pickers onto the framework, one page at
   a time, reusing v1's handlers.
3. **The lifts**, Workbench live selection (2.2), Links board filter (2.3a), Lab
   Overview pending entities (2.4).
4. **Real link preview** (2.3b), the one backend-touching chunk, its own design for
   the fetch + CORS story.
5. **One action source** (3.1), the refactor that de-duplicates and powers 3.5.
6. **Ranking + previews + tokens** (3.2 to 3.4), the search-quality pass.
7. **Sub-actions + bulk** (3.5, 3.6), the power-user pass.
8. **Global entities, Notes** (section 4), then the long tail.

Chunks 1 to 3 clear the debt, 4 to 8 are the "and more". Each UI-visible chunk gets
the interactive before/after mockup review before it is treated final.

---

## 6. Open questions for Grant (need a steer before chunk 1)

1. **Scope of v2.** All of this, or debt-only (chunks 1 to 3) first and the "and
   more" later? The debt is the user-visible promise (keyboard-only actions), the
   "and more" is polish + power.
2. **Sub-flow UX.** A pushed full-view stack with a breadcrumb (proposed), or a
   lighter inline expansion under the command row? The stack scales to multi-step
   (pick task then assignee), the inline is calmer for one-step picks.
3. **Link preview backend.** Worth a server-side metadata fetch (a small Vercel
   function or a Worker, respecting the no-4.5MB-proxy rule), or keep previews to
   the favicon / hostname we can derive client-side? This is the only non-local
   piece.
4. **Quick-filter tokens (3.4).** Power-user nicety or scope creep? It overlaps
   /search's job, the line between the inline palette and the full faceted page is
   worth drawing deliberately.
5. **Multi-select + bulk (3.6).** Genuinely useful for the lab-head queue, or a
   complexity sink? It is the heaviest interaction model change.

No build starts before this file is reviewed and these are answered, same posture
as the v1 global-search decisions doc.

---

## 7. Decisions (Grant, 2026-06-07)

1. SCOPE, **debt-only first**. The first v2 push is chunks 1 to 3, the sub-flow
   framework + every in-palette picker + the Workbench live-selection, Links
   board-filter, and Lab-Overview pending-entity lifts. The "and more" (section 3
   beyond the lifts, and section 4) is deferred to a later pass, NOT this build.
2. SUB-FLOW UX, **HYBRID** (Grant, from the mockup). Option B (inline expansion)
   is the DEFAULT for a single-step pick, the picker opens under the command row
   and nothing else moves. A MULTI-STEP flow uses Option A (the pushed view-stack
   with breadcrumb + Back), because chained picks nest awkwardly inline. So the
   framework supports BOTH and chooses per flow:
   - One-stage sub-flows render INLINE (B), assign-task (pick member),
     change-project (pick project), set-funding (pick account), move-note (pick
     notebook), move-method-category (pick category), link-event-to-task (pick
     task), pin/visibility quick-picks.
   - Multi-stage sub-flows render as the STACK (A), add-dependency (pick child
     experiment -> pick dep type), flag-a-record (pick record -> pick flag), and
     any flow whose first `onPick` returns another `PaletteSubflow`.
   - The presentation is inferred (single stage -> inline, chained -> stack) with
     an optional explicit `presentation` override on the PaletteSubflow. A flow
     that STARTS inline and then chains promotes to the stack on the second stage,
     so the user is never stuck nesting inline.
3. LINK PREVIEW, **client-side only**. Favicon + hostname derived in the browser,
   no backend, no metadata-scrape function. Ships with the Links board-filter lift.
4. QUICK-FILTER TOKENS, **skipped for v2**. The inline palette stays about fuzzy
   reach, structured / faceted filtering remains `/search`'s job (the "Search
   everything" handoff already bridges there).
5. MULTI-SELECT + BULK, **skipped for v2**. v2 stays one-entity. Bulk is a separate
   initiative if it earns its weight later.

So the LOCKED v2 build is, the sub-flow framework (UX pending), the picker debts
(assign / flag / change-project / set-funding / add-dependency / move-note /
move-method-category / link-event-to-task), and the three lifts (Workbench
selection, Links board filter + client-side preview, Lab-Overview pending
entities). Frecency ranking, inline previews beyond favicons, result sub-actions,
the one-action-source refactor, tokens, bulk, and the global Notes entity are all
explicitly OUT of this push.

All decisions are now LOCKED. Chunk 1 (the sub-flow framework, supporting both the
inline and stacked presentations per the hybrid rule) is ready to build.
