# Rich selector redesign: method picker + widget palette

Author: selector-redesign design bot (for HR), 2026-05-29

Design only. No code here ships. The goal is one shared visual language for
two pickers that currently feel like flat lists, so a user gets a "snapshot of
what each thing is" before committing to it.

## 1. Why this is worth doing

Grant flagged two selectors as "not good": the method picker (attach a method
to an experiment) and the widget palette ("+ Add widget" on the dashboard).
Both ask the user to pick from a roster of things they may not recognize by
name alone. A method named "qPCR fakeGFP expression" or a widget titled
"Activity by area" means little until you see what it contains. The fix is the
same in both cases: replace name + checkbox rows with cards that preview the
thing.

The two selectors are at very different starting points, and the doc treats
them honestly rather than pretending they are symmetric:

- The **widget palette** really is a bare list today: a 72px-wide dropdown of
  title + one-line description + a checkbox square (`SnapshotCanvas.tsx:359-438`).
  This is the one Grant's "title + checkbox" description fits exactly.
- The **method picker** is further along than the brief assumed. It is NOT a
  checkbox list; it is a two-pane master/detail: a left rail of grouped rows
  (`MethodPicker.tsx:364-472`) and a right preview pane that renders the actual
  method content, including live markdown and an embedded PDF iframe
  (`MethodPicker.tsx:506-685`). The weakness is the left rail: the rows are
  thin (name + a small type badge + tags, `MethodPicker.tsx:435-466`), there is
  no category-aware grouping beyond raw `folder_path`, no own-vs-shared split,
  and no treatment for forks. So the method work is "upgrade the rail into
  cards and add fork/category structure", not "build from scratch".

## 2. The shared rich-selector pattern (one language for both)

A single card shape used by both selectors so they read as one component
family:

```
+-----------------------------------------------------+
| [hero/preview region]                  [type badge] |
|                                                     |
| Name of the thing                                   |
| One-line description / context                      |
|                                                     |
| [meta chips: owner / category / forks]   [+ Add ]   |
+-----------------------------------------------------+
```

Anatomy, fixed across both selectors:

1. **Hero / preview region** (top). This is the load-bearing differentiator
   from the old list. For widgets it is a live or static mini-render; for
   methods it is a content excerpt or type-specific glyph. Fixed aspect so the
   grid stays even.
2. **Name** (the existing `title` / `m.name`).
3. **Short description** (widget `description`; for methods, a content excerpt
   or the type's registry `description`).
4. **Type / category badge**, reusing the existing color-coded pills.
   Methods already have `getMethodTypeMeta(m.method_type)` returning
   `{ shortLabel, color: { bg, text } }` (`method-type-registry.ts:46-73`); the
   method picker rail (`MethodPicker.tsx:440-447`) and the methods page
   (`methods/page.tsx:695-704`) both already render exactly this pill, so the
   card inherits it for free.
5. **A clear add/select affordance**: an explicit button (`+ Add`,
   `Attach`, or a checkmark toggle when already chosen) in a fixed corner, not
   a whole-row click target that hides what it does.

Selection state lives ON the card: an unselected card shows the add button; a
selected/mounted card shows a filled checkmark and a subtle ring (the widget
palette already encodes mounted-state this way at
`SnapshotCanvas.tsx:402-422`, we lift that into the card corner).

Visual tokens to keep both consistent: `rounded-xl`, `border-gray-200`, white
card on a `bg-gray-50/40` grid, hover `ring-1 ring-blue-200`, selected
`ring-2 ring-blue-400`. These mirror the method picker shell
(`MethodPicker.tsx:327-331`) and the snapshot tile chrome already in use.

Both selectors stay **popups/overlays** (Grant: keep the widget one a popup;
the method picker is already a full-screen modal at `MethodPicker.tsx:317-326`).

## 3. Widget selector design

### What it is today
`showPalette` toggles a 288px dropdown anchored under "+ Add widget"
(`SnapshotCanvas.tsx:359-439`). It maps `canvasCatalog` (the account-filtered,
surface-filtered catalog from `visibleCatalog(WIDGET_CATALOG, accountType,
surfaceKey)`, `SnapshotCanvas.tsx:147-154`) to rows of: checkbox square +
`widget.title` + truncated `widget.description`. Clicking toggles add/remove.

### Available metadata per widget (from `registry.ts` + `WidgetDefinition`)
- `id`, `title`, `description`, `helpText` (longer copy, currently only used
  for the lab-overview tooltip badge).
- `surfaces` (`{ canvas, sidebar, home }`) and account gating
  (`memberVisible`, `labHeadVisible`, `labHeadVisibleOn`).
- **`SnapshotTile`**: a real React component that renders live data via React
  Query, already mounted on the canvas at `SnapshotCanvas.tsx:531`
  (`<Tile surface="canvas" />`). It takes only `{ surface }`
  (`types.ts:138-140`).

### Recommendation: LIVE `SnapshotTile` mini-preview

Render each catalog entry's `SnapshotTile` as the card's hero. Rationale:

- The component already exists for every widget and already takes a `surface`
  prop, so there is no new per-widget art to commission.
- It is genuinely a "snapshot of what each thing is" with the user's real data
  ("you have 3 overdue tasks", "burn rate chart"), which is exactly Grant's
  ask and far more informative than an icon.
- React Query dedupes by query key (`types.ts:41-43`), so the palette tile and
  the eventual canvas tile share one fetch. Showing N previews in the palette
  warms the cache rather than doubling work.

Guardrails the design must respect (these are the reasons to NOT do this
naively):

- **Render the tile non-interactively.** Wrap it in a `pointer-events-none`,
  `aria-hidden` container and clip it to the hero box so its internal
  click-to-open and popups cannot fire from inside the palette. The card's own
  add button is the only interactive element.
- **Lazy / capped mount.** A members's home palette can list a dozen widgets;
  mounting a dozen live-querying tiles at once is heavy. Mount previews only
  for cards in/near the viewport (the popup scrolls), and show the registry
  `description` + the widget's type glyph as the placeholder until the tile
  resolves. This degrades to the static path automatically.
- **Fallback to static.** If a `SnapshotTile` throws or has no data yet, fall
  back to a static illustration: the widget's category glyph + `description`.
  So the recommendation is "live preview with a static fallback", not "live
  only".

Static-only (icon + description) was the alternative considered. It is simpler
and cheaper but throws away the single best asset this codebase already has
(working live tiles) and gives the user nothing they could not read from the
title. Rejected as the primary path; kept as the fallback layer.

### Grouping + account-awareness
- Keep the existing account/surface filter verbatim: feed the card grid from
  `canvasCatalog` so members never see PI-only widgets (`metrics`,
  `lab-purchases*`) and the per-surface lab-head carve-outs
  (`sidebar-upcoming`, etc.) keep working. No new gating logic; the palette
  already does this right, we are only changing how each surviving entry is
  drawn.
- Group cards by a light category derived from the Tool family (variants of
  one `toolId` such as the three `purchases` variants, or the task variants,
  cluster together). A small section header per group; this turns a 12-item
  flat scroll into 3-4 scannable clusters. Grouping is presentation-only and
  reads `toolId` which already exists on every entry.

### How "+ Add widget" opens it
Unchanged trigger. Keep the button auto-entering edit mode first
(`SnapshotCanvas.tsx:298-306`, the break-bot Bug 3 fix) so the affordance never
silently no-ops. The dropdown grows from a 288px list into a wider popover
(say `w-[640px]`, 2-3 cards per row, `max-h-[70vh]` scroll). It stays anchored
to the button and stays a popup, not a route.

### Single vs multi
**Stay one-at-a-time toggle.** Confirmed against code: `handleAddWidget` /
`handleRemoveWidget` each persist one id and re-read the layout
(`SnapshotCanvas.tsx:240-258`). The card's add button toggles mounted state in
place; the palette can stay open so a user adds several in a row, but each
click is its own add. No multi-select "apply" step. This matches the mental
model "I pin widgets one by one and watch them appear".

## 4. Method picker design

### What it is today (corrected from the brief)
Two-pane modal. Left rail rows are grouped by `folder_path` with pinned
"Recently used in this project" / "Recently used" sections
(`MethodPicker.tsx:164-247`), each row = name + type pill + tags
(`MethodPicker.tsx:435-466`). Right pane previews the highlighted method's real
content (`MethodPicker.tsx:506-685`). Keyboard nav already works (arrows / enter
/ esc, `MethodPicker.tsx:298-315`).

### Available metadata per method (`Method`, `types.ts:729-758`)
`id`, `name`, `source_path`, `method_type`, `folder_path`,
**`parent_method_id`** (the fork pointer, already on the type),
`tags`, `is_public`, `created_by`, `owner`, `shared_with`,
`is_shared_with_me`, `shared_permission`, `components` (compound children),
`last_edited_by` / `last_edited_at`.

### Card content
Upgrade the left rail from thin rows into cards (keep the right preview pane as
the deep view; the card is the "is this the one?" glance):

- **Name** + **type badge** (`getMethodTypeMeta`, already wired).
- **Owner / sharing line**: for a shared method show the owner (or "Lab" for
  the public namespace) using the existing `sharedOwnerLabel(method)` helper
  (`library-sections.ts:128-131`) and a "Public" / "Shared with me" chip,
  matching the methods page (`methods/page.tsx:705-714`).
- **Content snapshot / excerpt** (the hero). For markdown, the first ~2 lines
  of the file (a short excerpt, NOT the full render the preview pane already
  does). For structured types (PCR, plate, LC, cell culture, etc.) a one-line
  type summary, the picker's preview pane already has this exact copy per type
  (`MethodPicker.tsx:627-650`) and we lift the first line onto the card. For
  PDF, the type glyph + page-1 thumbnail if cheap, else the glyph.
- **Tags** (existing).
- **Last edited by / when** when present (`last_edited_by`,
  `last_edited_at`), small and muted.

### Grouping: category + own-vs-shared, consistent with the methods page
Replicate the methods-page structure so the picker feels like the same
library:

1. Partition with `partitionMethodsByOwnership(methods, currentUser)`
   (`library-sections.ts:86-100`).
2. **My Methods**: group by `folder_path` via `groupOwnMethodsByFolder`
   (`library-sections.ts:109-119`). One section per category.
3. **Shared with Lab**: group by owner via `groupSharedMethodsByOwner` /
   `sharedOwnerLabel` (`library-sections.ts:128-150`), NOT by the owner's
   private folder names (that leak was the bug the methods page fixed). These
   helpers are pure and unit-tested; the picker can import them directly so the
   two surfaces never drift.
4. Keep the existing pinned "Recently used in this project" / "Recently used"
   sections above everything (`MethodPicker.tsx:181-211`), they are high-value
   and already work.

`matchesMethodSearch` (`library-sections.ts:158-166`) should replace the
picker's narrower inline name/tag filter (`MethodPicker.tsx:168-175`) so search
covers name + tags + path + folder identically to the page. Search collapses
the grouping into a flat ranked list, as it does now.

### Forks: forward-looking treatment

Forking is **partly built**, not hypothetical. The data and API already exist:
- `Method.parent_method_id` is the fork pointer (`types.ts:735`).
- `rawMethodsApi.getChildren(id)` returns forks via
  `m.parent_method_id === id` (`local-api.ts:1867-1870`).
- `methodsApi.fork(...)` creates a fork with `parent_method_id: id`
  (`local-api.ts:1891-1906`); `DeviationModal.tsx:52` calls it; the methods
  page renders a "Forked" chip when `parent_method_id` is set
  (`methods/page.tsx:710-714`). TaskModal copy already says "fork a new method"
  (`TaskModal.tsx:976-979`).

So the picker can show forks today. Recommended treatment: **parent card with a
"forks" disclosure**.

- A method that has forks (its id appears as some other method's
  `parent_method_id`) renders as the parent card with a small count chip,
  e.g. a "2 forks" pill next to the type badge.
- Clicking the chip expands an inset, indented list of fork cards nested under
  the parent (a disclosure, not a separate section), so the parent/version
  relationship is visually obvious. Each fork card carries a **version chip**
  ("fork", or a vN label once versioning exists) and its own owner line.
- A fork whose parent is NOT in the current list (parent is private to someone
  else, or deleted) renders top-level with a muted "forked from ..." caption
  instead of nesting, so it never disappears.
- Selecting (attaching) works on parent and fork cards identically; nesting is
  organizational only.

### Data gaps to add when forking is fully built
The pointer exists but the picker would be doing O(n) scans and has no rich
lineage. To make the fork UI cheap and complete, add:

1. **A reverse index / fork count.** Today finding forks is an O(n) filter
   (`getChildren`). For a picker rendering many parents this is N x M. Add
   either a denormalized `fork_count` / `fork_ids: number[]` on the parent, or
   a one-pass `Map<parentId, Method[]>` built once when the picker loads.
   (The latter needs no schema change and is the cheaper first step.)
2. **A version label / ordinal.** `parent_method_id` says "this is a fork" but
   not "fork #2 of 3" or a semantic version. Add an optional
   `fork_version` / `forked_at` so the version chip can show order, not just a
   generic "Forked" badge. `last_edited_at` exists and can stand in for recency
   ordering until then.
3. **Method content excerpt.** There is no stored excerpt; the card would have
   to read the file (the preview pane does this lazily per highlight via
   `filesApi.readFile`, `MethodPicker.tsx:528-533`). Rendering an excerpt on
   EVERY card means N file reads. Add a persisted `excerpt` / `summary` (first
   ~140 chars, written on save) so cards are cheap. Until then, only fetch the
   excerpt for the visible/hovered card and show the type description as the
   resting state.
4. **(nice-to-have) fork provenance**: who forked it and the deviation note
   captured at fork time (`MethodForkRequest.deviations` exists at
   `types.ts:1504-1508` but is not stored back on the fork as a field). Storing
   it would let the fork card show "forked to capture deviation: ...".

### Single vs multi
Confirmed against code: the picker is effectively **single-select per open**.
`onSelect(methodId, methodOwner)` fires once and the caller closes the modal
(TaskModal at `TaskModal.tsx:984-988`) or the row click attaches one
(`MethodPicker.tsx:430`). MethodTabs supports attaching MANY methods to a task,
but does so by reopening the picker per method (`MethodTabs.tsx:233-248`,
`excludeMethods` hides the already-attached ones).

Recommendation: **keep single-select-per-open, but add an explicit "Attach"
button on the card** (replacing the implicit whole-row click) and, for the
multi-attach context (MethodTabs), let the modal STAY OPEN after an attach so
the user can attach several without re-triggering "+ ". The just-attached card
flips to a "Attached" checkmark + stays visible (or moves to a small "attached"
tray), the `excludeMethods` machinery already knows what is attached. This
gives multi-attach ergonomics without changing the single-`onSelect` contract.
In the single-link context (TaskModal "Link a method (optional)"), attaching
one closes the modal as it does today.

## 5. Accessibility

This is a Chromium (Electron) app, so we can rely on modern CSS and standard
DOM focus, but keyboard reach is non-negotiable because the existing method
picker is fully keyboard-driven and we must not regress it.

- **Cards are buttons, in a grid.** Each card's primary affordance is a real
  `<button>` (the add/attach control); the card container is focusable. Use
  arrow-key roving focus across the grid (the method picker already does
  arrow/enter/esc at `MethodPicker.tsx:298-315`, extend it from 1-D list to
  2-D grid; the widget palette gains the same).
- **Enter / Space** activates the add button; **Esc** closes the popup
  (widget palette currently relies on outside-click only, add Esc).
- **Fork disclosures** are `aria-expanded` toggles; nested fork cards are in
  the tab order only when expanded.
- **Live previews are `aria-hidden` and non-focusable** (see widget guardrails)
  so a screen reader hears the name + description + type, not the tile internals.
- Preserve `data-tour-target` anchors. The walkthrough depends on
  `experiment-attach-method-picker-first-method` and `...-method-{idx}`
  (`MethodPicker.tsx:417-428`, referenced in `targets.ts:199-203`) and on the
  `home-widget-*` anchors (`SnapshotCanvas.tsx:307-399`). The redesign must keep
  these stamped on the equivalent new card nodes or the §6.6 cursor demo and the
  §6.2b home-widgets tour wedge.
- Keep the existing keyboard-hint footer (`MethodPicker.tsx:478-500`).

## 6. Phased build recommendation

**Build the widget selector first.** Reasons:

1. It is the one that is actually a bare title + checkbox list, so it has the
   most to gain and the clearest before/after.
2. The hero asset (`SnapshotTile`) already exists for every widget, so the card
   is mostly wiring, no new data shape, no schema change.
3. It is lower-risk: the catalog is small and account gating is already correct.
   It lets us prove the shared card pattern on the easy surface before applying
   it to the method picker, which carries fork data design and tour anchors.

Then:

- **Phase 1 (widget palette):** new card grid in the popover, live `SnapshotTile`
  hero with static fallback, Tool-family grouping, keyboard grid nav. No data
  changes.
- **Phase 2 (method picker, no schema change):** upgrade the left rail rows into
  cards reusing the `library-sections.ts` partition/group helpers and
  `matchesMethodSearch`; own-vs-shared sections; keep the existing preview pane;
  build the fork map in-memory (`getChildren`-equivalent one-pass) and render the
  "N forks" disclosure. Excerpts fetched lazily per visible/hovered card.
- **Phase 3 (method picker, with the data gaps closed):** add `excerpt`,
  `fork_count`/reverse index, and `fork_version` so cards are cheap and the
  version chips are meaningful; slot the eventual full forking feature into the
  disclosure that Phase 2 already shipped.

## 7. Open questions for Grant

1. Live widget previews vs. cheaper static glyph: confirm we want the live
   `SnapshotTile` hero (richer, heavier) over a static icon + description for
   the first cut, given members may see a dozen widgets in the palette.
2. Multi-attach methods: OK to keep the method modal OPEN after each attach in
   the MethodTabs (experiment) context, instead of close-per-attach? It changes
   a small habit but enables fast multi-add.
3. Fork display depth: nest only one level of forks under a parent (forks of
   forks flatten under the nearest in-list parent), or recurse? One level is
   simpler and matches the current one-level-deep fork model.
4. Excerpt source: is it acceptable to persist a short `excerpt` on method save
   (a tiny data-shape addition) so cards are cheap, or must the picker stay
   read-only against existing files and fetch lazily?
5. Compounds (kits): a compound method bundles children (`components`,
   `types.ts:746-751`). Should the method card preview the kit's children
   inline (like a mini fork-disclosure) or just badge it "Compound" and defer to
   the preview pane?
