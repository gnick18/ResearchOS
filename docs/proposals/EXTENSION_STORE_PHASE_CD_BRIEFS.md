# Extension Store: Phase C and D draft briefs

Author: orchestrator (master bot), 2026-05-29
Status: DRAFT, ready to fire once Phase B (store-shell bot) reports.

These are the spawn_task prompt drafts for Phase C (search + navigation) and
Phase D (detail pane) of docs/proposals/EXTENSION_STORE_REDESIGN_PROPOSAL.md.

RECONCILED against B's merged API (orchestrator, 2026-05-29):

Phase B is MERGED to main (commit be90201d). C and D branch off main, no branch
stacking. The actual `StoreShell` prop API (frontend/src/components/store/
StoreShell.tsx) matches the draft prop names, PLUS:
  - `getItemKey(item): string` is required (React keys + selection compare).
  - Optional polish props exist: `allLabel`, `detailEmptyHint`, `emptyState`,
    `cardGridClassName`, `closeAriaLabel`.
  - There is NO built-in Types | Templates segment. B folded the method kinds
    into FLAT rail categories ("All / Method types / Protocol templates") over
    one heterogeneous item list. The locked IA wants a real SEGMENT that
    switches the category SET (Types view: Standard/Structured; Templates view:
    domain categories). C must add a small optional `railHeaderSlot?: ReactNode`
    prop to StoreShell (rendered above the search slot in both the rail and the
    mobile chip row) and pass the segment control there from the method library
    only; the widget store passes nothing (single kind, no segment).

Dependency: C depends on B (merged). D depends on C (needs the segment + real
list so a selected item exists to render). Run C then D, not in parallel.

---

## Phase C brief (queue as "store-search bot")

From the orchestrator (master bot). This is Phase C of
docs/proposals/EXTENSION_STORE_REDESIGN_PROPOSAL.md (read it first, especially
the "Information architecture" and "Phase C" sections). Phase B already built
and merged the shared StoreShell; read
frontend/src/components/store/StoreShell.tsx and its prop API before you start,
and match it exactly.

Goal: make the shell's navigation REAL. B left the rail presentational; C wires
search, the Types | Templates segment, real category filtering, and the
"Enabled only" toggle. No detail-pane content yet (that is Phase D); the detail
pane stays B's placeholder.

Required:
1. Types | Templates SEGMENT at the top of the left rail, but ONLY for the
   method library (the widget store has no types/templates split, it stays a
   single kind). The segment switches the rail's category set and the center
   list between the two kinds:
     - Types view: categories are the registry `category` field (Standard /
       Structured). Items are method types from the registry, filtered by the
       account's enabled set when "Enabled only" is on.
     - Templates view: categories are the manifest `category` values
       (Molecular biology, Analytical chemistry, Cell biology, etc.) read from
       frontend/public/method-catalog/manifest.json via the existing catalog
       loader. Items are templates.
2. SEARCH box in the rail's searchSlot, caller-owned state, filtering the
   center list live:
     - Widgets: match `title`, `description`, `toolId`.
     - Methods Types view: match type `label` + `description`.
     - Methods Templates view: match template `title` + `tags`.
   Pure client-side filter over the static catalogs. No backend, no fetch
   changes beyond what the catalog loader already does.
3. Category filtering actually narrows the center list, with per-category live
   counts in the rail (counts reflect the current search + enabled-only state).
   An "All" entry shows everything in the current kind.
4. "Enabled only" toggle: when on, the list shows only enabled
   widgets / enabled types. Templates whose underlying type is disabled still
   SHOW (so the user can discover and enable them), but Phase D handles the
   gated action; for C they just remain listed.
5. Preserve the existing enable/disable toggles and template actions that B
   carried over. C changes navigation, not the curation writes.

Constraints (project memory):
- No em-dashes anywhere (UI copy, comments, commits). Commas / colons / periods.
- No emojis in UI: every icon is a custom inline SVG (mirror existing patterns
  like the EnablementBadge dot). No lucide-react.
- Tooltip component for icon-only buttons; never native title=.
- Keep enablement logic in widget-enablement.ts / method-type-enablement.ts and
  their hooks. C holds none of it.

Scope: pure frontend, no data-shape change. Touches the two store modals
(WidgetStoreModal.tsx, MethodTemplateLibraryModal.tsx) and possibly small
additions to StoreShell for the segment slot. Build in your own isolated
worktree off main (do not edit files shared with concurrent siblings).

Verification: vitest + tsc from frontend/ (NOT repo root; @ alias lives in
frontend/vitest.config.mts). Add unit tests for the filter predicates (search
+ category + enabled-only) for both stores. Start the dev server: open both
stores, confirm the segment switches kinds (methods only), search narrows the
list live, categories filter with correct counts, and "Enabled only" works.
Confirm Phase A's "Manage method types in your library" link still opens the
library. Share screenshots: widget store searched, method library on each
segment. Because this touches shared store structure, report back before
merging rather than merging on report.

Sign your commit body and report as "store-search bot".

---

## Phase D brief (queue as "store-detail bot")

From the orchestrator (master bot). This is Phase D of
docs/proposals/EXTENSION_STORE_REDESIGN_PROPOSAL.md (read it first, especially
"Information architecture", "Phase D", and the use-template unify note). Phases
B and C are merged; read StoreShell.tsx and the two store modals as they stand
before you start, and match the renderDetail(item) contract.

Goal: fill the right detail pane with rich, type-specific content, the payoff
of the whole redesign. Clicking a card populates the pane.

Required, WIDGETS first (live preview already exists):
1. Large live preview of the widget in the detail pane: render the widget's
   SnapshotTile bigger than the card's 0.62x, inside the existing
   WidgetPreviewBoundary error boundary and the useInViewport lazy-mount so it
   does not fire queries until visible.
2. A "what it does / when to use it" blurb from the widget's `helpText` +
   `description`. Metadata rows: the Tool it opens, supported surfaces, and
   member/PI visibility.
3. Footer action: the On/Off enable toggle, same setter as the card uses today.

Then METHODS (respect the Types | Templates segment + cross-links):
4. Method TYPE detail: describe the structured editor, show a small sample
   rendering of that type, and list "Templates built on this type" as clickable
   cross-links that switch to the Templates segment and select that template.
   Footer action enables the type.
5. Single-type TEMPLATE detail: render the template content read-only
   (markdown body, or the structured recipe/gradient/plate payload rendered in
   a compact read-only view), show the ONE type badge it is built on, and a
   "Use template" footer action. If that type is disabled, the action gates to
   "Enable <type>" first (preserve current gating behavior).
6. COMBINATION (compound) TEMPLATE detail: read the component types off the
   `components` graph (see frontend/src/lib/methods/compound-graph.ts), show ALL
   component type badges, render the bundled steps, and gate "Use template"
   until ALL component types are enabled. NOTE: shipping compound entries in the
   catalog requires extending the catalog payload union in
   frontend/src/lib/methods/method-catalog.ts to accept a compound entry.
   This is a DATA-SHAPE touch: pre-flag it to the orchestrator BEFORE committing
   that change, and align with the unmerged lc-ms-method-templates branch shape.
   If no compound catalog entry exists yet in main, build the detail renderer
   against a compound METHOD (the components graph) and a small fixture so the
   rendering path is covered, and flag that the catalog entry lands separately.
7. UNIFY the use-template post-action (interim inconsistency from Phase A):
   "Use template" should open the created method in the viewer from BOTH the
   standalone /methods library and the library opened inside the New Method
   builder. Make them consistent (open the viewer).

Constraints (project memory):
- No em-dashes; no emojis (custom inline SVG only, no lucide-react); Tooltip for
  icon-only buttons, never title=.
- Screenshots for any wiki/demo capture use fixture mode (?wikiCapture=1), never
  real user data. Use a scratch/fixture account for verification, not the real
  data folder.
- Keep enablement + create logic where it lives; D renders and triggers, it does
  not reimplement curation or creation.

Scope: pure frontend EXCEPT the possible method-catalog union extension in (6),
which is the only data-shape touch and must be pre-flagged.
Build in your own isolated worktree off main.

Verification: vitest + tsc from frontend/. Add tests for the detail renderers
(widget preview mounts, type cross-links resolve, template gating reflects
enabled state, compound gating requires all component types). Start the dev
server with a fresh fixture account: click cards in both stores, confirm the
detail pane renders live widget previews, type editors, single-type template
content, and a compound template's component badges + gating. Confirm
use-template opens the viewer from both entry points. Share screenshots of:
a widget detail with live preview, a method type detail with template
cross-links, a single-type template detail, a compound template detail.

This phase completes the redesign. After it merges, the orchestrator runs the
standard 3-verifier loop (mechanics + spec-compliance + fresh-eyes) against the
proposal doc, plus the persona break-bots if the tour touches these surfaces.
Report back before merging; do not merge on report.

Sign your commit body and report as "store-detail bot".
