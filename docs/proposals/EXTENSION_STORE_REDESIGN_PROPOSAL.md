# Extension Store Redesign Proposal

Author: orchestrator (master bot), 2026-05-29
Status: design locked (2 forks signed off by Grant), ready to brief

## Motivation

Two complaints from Grant, on two different surfaces that look similar but are not:

1. The New Method modal (the builder) shows method types the account has NOT
   enabled, greyed out with an "Enable" link. They take up grid space and
   defeat the point of the library, which is to declutter the builder.
2. The widget store and method library (the two "stores") are skinny
   center dialogs with flat card grids. They are not searchable, clicking a
   tile does not open a richer explanation, and they waste screen width. They
   should feel like a real add-ons marketplace (VS Code extensions, browser
   add-on managers).

## Surfaces (do not conflate)

| Surface | File | Role |
|---|---|---|
| New Method modal (builder) | `frontend/src/components/methods/CreateMethodModal.tsx` + `MethodTypePicker.tsx` | Pick a type, fill fields, create. Should show ONLY enabled types. |
| Method library (store) | `frontend/src/components/methods/MethodTemplateLibraryModal.tsx` | Discover, enable/disable types, browse + preview protocol templates. |
| Widget store (store) | `frontend/src/components/lab-overview/WidgetStoreModal.tsx` | Discover, enable/disable widgets, live preview. |
| Add widget palette (picker) | inline popup in `frontend/src/components/lab-overview/SnapshotCanvas.tsx` | Already filters to enabled widgets. No change needed. |

Enablement state already exists for both:
- Methods: `enabledMethodTypes` in user settings, resolved by
  `frontend/src/lib/methods/method-type-enablement.ts`, hook
  `useEnabledMethodTypes`.
- Widgets: `enabledWidgets`, resolved by
  `frontend/src/lib/lab-overview/widget-enablement.ts`, hook
  `useEnabledWidgets`.

Both catalogs are static and small, so search and filtering are pure
client-side. No backend, no data-shape change except the optional
`previewImages` field in Phase 5 (pre-flag before commit).

## Locked design decisions (Grant, 2026-05-29)

- Layout: LEFT-RAIL MASTER/DETAIL. Searchable category rail on the left,
  result list in the center, persistent detail pane on the right. The detail
  pane stays visible while browsing. It is a modal (not a full page route).
- Builder: HIDE un-enabled method types ENTIRELY from the New Method picker.
  Add a small "Manage method types in your library" link that opens the store.
  No in-place "Enable" tiles in the builder anymore.

## Information architecture: types, templates, compounds (locked 2026-05-29)

Three concepts, not two. The store must keep them distinct but linked.

1. METHOD TYPES = capabilities (the editor shapes: pcr, lc_gradient, plate,
   mass_spec, etc.). Enable/disable acts on these (`enabledMethodTypes`).
   `compound` is the hidden, always-on bundling type.
2. TEMPLATES = prebuilt starter content. A manifest entry
   (`frontend/public/method-catalog/manifest.json`) declares one `method_type`
   plus a typed `payload` (see the discriminated union in
   `frontend/src/lib/methods/method-catalog.ts`).
3. COMPOUNDS / KITS = a COMBINATION. A method with `method_type: "compound"`
   and a `components` graph bundling sub-methods of other types
   (`frontend/src/lib/methods/compound-graph.ts`). This is how "LC + MS = an
   LC-MS kit" is expressed. LC-MS combination templates live on the unmerged
   `lc-ms-method-templates` / `lc-ms-templates-work` branches.

Relationship: a template DEPENDS ON its type(s). A combination template depends
on all of its component types. The current modal already gates a template
behind "Enable <Type>" when the underlying type is disabled; preserve that.

LOCKED decisions:
- ENCODING of combination templates: reuse the `compound` method_type +
  `components` graph. A combination template is a catalog entry with
  `method_type: "compound"` and a components graph; the detail pane reads
  component types off the graph. Do NOT add a parallel `method_types[]` array.
  This is the least new surface area and matches how kits already work; align
  the unmerged LC-MS branch to this shape when it lands.
  FLAG: extending the catalog payload union (`method-catalog.ts`) to accept a
  compound entry is a data-shape touch. Pre-flag before commit.
- SEPARATION in the UI: ONE store shell with a Types | Templates segment at the
  top of the left rail (replaces the current two tabs). Cross-links + type
  badges connect the two views:
    - Types view: enable/disable here. A type's detail pane lists "Templates
      built on this type" as clickable cross-links.
    - Templates view: "Use template" here. A template's detail pane shows the
      type badge(s) it is built on; a combination template shows ALL component
      type badges and gates the action until ALL are enabled.

## Phase A: Builder declutter (ship first, standalone)

Root cause: `CreateMethodModal` passes `onEnableType` into
`MethodTypeCategoryPicker`. In `MethodTypePicker.tsx`, `visibleForPicker`
keeps disabled tiles visible whenever an enable affordance is present.

Fix:
- Stop passing `onEnableType` from `CreateMethodModal` so `visibleForPicker`
  falls into the filter branch and disabled types are removed from the picker.
  Keep passing `enabledTypes` so filtering is active.
- Add a quiet footer link under the picker: "Manage method types in your
  library" opening `MethodTemplateLibraryModal`. Keeps the enable path
  discoverable without clutter.
- The `disabled && onEnableType` branch in `MethodTypePicker.tsx` stays in the
  code (the library modal may still use it); it just stops being reached from
  the builder.

Scope: UI-only, no data shape. One component behavior change plus a link.
Merge to local main on report. No verifier loop required (unit test the
picker filtering is enough).

## Phase B: Shared StoreShell (master/detail frame)

Extract `frontend/src/components/store/StoreShell.tsx` (new dir) that both
stores render into. Responsibilities:
- Wide modal: `w-[92vw] max-w-6xl h-[88vh]` (current is `max-w-4xl`, ~896px).
- Left rail (~260px): search box at top, category list below with per-category
  counts, an "All" entry, and an "Enabled only" filter toggle.
- Center column: scrollable result list/grid, filtered by search + category.
- Right detail pane (~40% width): empty state until a card is selected.
- Responsive: below `lg`, rail collapses to a filter chip row and the detail
  pane opens as a full-screen overlay on tap.

Props the shell takes (each store supplies its own renderers):
- `categories`: `{ id, label, count }[]`
- `items`: opaque list the store filters
- `renderCard(item, { selected, onSelect })`
- `renderDetail(item)`
- `searchPredicate(item, query)`
- request-a-new-one footer slot (both stores already have this stub)

No enable/disable logic moves into the shell; the stores keep owning that.

## Phase C: Search + categories

- Widgets: categories come from `groupByTool` (already in `WidgetStoreModal`).
  Search over `title`, `description`, `toolId`.
- Methods: the rail's top-level split is the Types | Templates SEGMENT (see the
  information-architecture section). Within Types, categories are the registry
  `category` field (Standard / Structured). Within Templates, categories are the
  manifest `category` field (Molecular biology, Analytical chemistry, etc.).
  Search over type `label` + `description` in the Types view, and template
  title + tags in the Templates view.

## Phase D: Detail pane (richest piece)

Widgets first (live preview already exists):
- Large live `SnapshotTile` preview (the card renders one at 0.62x today; the
  detail pane renders it bigger), inside the existing `WidgetPreviewBoundary`.
- "What it does / when to use it" blurb from `helpText` + `description`.
- Metadata: Tool it opens, supported surfaces, member/PI visibility.
- Footer action: the On/Off enable toggle (same setter as today).

Methods second (respect the Types | Templates segment and cross-links from the
information-architecture section):
- For a method TYPE: describe the structured editor and show a sample
  rendering; list "Templates built on this type" as clickable cross-links;
  footer action enables the type.
- For a single-type TEMPLATE (catalog under `frontend/public/method-catalog/`):
  render the template content read-only (markdown or structured recipe), show
  the one type badge it is built on; footer action is "Use template" (or
  "Enable <type>" first if that type is disabled).
- For a COMBINATION (compound) template: show ALL component type badges read
  off the `components` graph, render the bundled steps, and gate "Use template"
  until ALL component types are enabled.

Unify the use-template post-action (interim inconsistency from Phase A): the
standalone library on /methods opens the new method in the viewer, but the
library opened from inside the New Method builder currently just closes the
create flow and refetches. Phase D should make "Use template" behave the same
from both entry points (open the created method in the viewer).

After Phase D lands, run the standard 3-verifier loop (mechanics +
spec-compliance + fresh-eyes) against this doc.

## Phase E (optional): hand-authored demo screenshots

Add `previewImages?: string[]` to the widget definition for curated demo
captures where the live preview is not enough. FLAG: this is a data-shape
touch on the widget definition; pre-flag before commit. Captures MUST use
fixture mode (`?wikiCapture=1`), never real user data.

## Sequencing

1. Phase A (declutter) now, standalone.
2. Phase B (StoreShell + sizing).
3. Phase C (search + categories).
4. Phase D (detail pane), widgets then methods, then verifier loop.
5. Phase E optional.

Phases B through D are pure frontend but touch shared structure; B and C have
no behavior change, D does.
