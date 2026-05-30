# Handoff: Extension Store redesign

To: orchestrator (main bot)
From: orchestrator (this session)
Date: 2026-05-30
Subject: Status of the widget store + method library "marketplace" redesign

## One-line state

Phases A, B, and C are MERGED to local main. Phase D (store-detail bot) is
QUEUED. A separate enablement-race fix bot is QUEUED (parallel, disjoint files).
The arc closes with a 3-verifier loop after D.

## Update log

- 2026-05-30: Phase C merged (merge fd8c52da). Verified on the integrated tree
  AFTER a large 81-template catalog integration (3df8fe30) landed from another
  chat: C's filter modules are pure over passed-in entries with their own
  fixtures, so they were unaffected; tsc clean, 37/37 targeted tests pass.
  Queued enablement-race fix bot (lost-update race in setMethodTypeEnabled /
  setWidgetEnabled, surfaced by store-search bot). Fired Phase D (store-detail
  bot), reconciled against C and warned about the now-large catalog incl LC-MS
  pairs that exist as separate lc + ms entries (not compound-bundled yet).
  OPEN: D's verification must exercise the full 81-template catalog live; the
  store-search bot only browsed the old 7-template manifest.

## Why this work exists

Grant flagged two problems on the New Method modal screenshot:
1. The New Method BUILDER showed method types the account had not enabled
   (greyed-out "Enable" tiles), cluttering the picker.
2. The widget store and method library (the two "stores") were skinny center
   dialogs with flat card grids: not searchable, no detail-on-click, wasted
   width. He wants a real add-ons marketplace (VS Code / browser add-on feel).

## Design source of truth

- docs/proposals/EXTENSION_STORE_REDESIGN_PROPOSAL.md (full design, phases A-E,
  locked decisions, information architecture).
- docs/proposals/EXTENSION_STORE_PHASE_CD_BRIEFS.md (ready-to-fire C and D
  spawn prompts, reconciled against B's merged API).

## Locked decisions (signed off by Grant)

- Layout: LEFT-RAIL MASTER/DETAIL shell, shared by both stores. It is a modal,
  not a route. Wide: w-[92vw] max-w-6xl h-[88vh].
- Builder: HIDE un-enabled method types entirely; a "Manage method types in
  your library" link opens the store.
- Information architecture: THREE concepts, not two.
  - Method TYPES = capabilities (editor shapes); enable/disable acts here.
  - TEMPLATES = prebuilt content built on one type (manifest + payload).
  - COMBINATIONS = compound methods bundling several types via a `components`
    graph (e.g. LC-MS = LC gradient + mass spec).
- Combination encoding: REUSE the `compound` method_type + `components` graph.
  Do not add a parallel method_types[] array. Extending the catalog payload
  union (method-catalog.ts) to accept compound is a DATA-SHAPE touch: pre-flag
  before commit; align with the unmerged lc-ms-method-templates branch.
- Separation in UI: ONE store, a Types | Templates SEGMENT in the rail
  (method library only), connected by type badges + cross-links.

## What is done

### Phase A: builder declutter (MERGED, commit 47b64e89)
store-declutter bot. CreateMethodModal stopped passing onEnableType to the
picker (kept enabledTypes), so disabled types are filtered out of the builder
entirely. Added the "Manage method types in your library" link opening the
library modal in place. MethodTypePicker untouched (its disabled+enable branch
still serves the library). New MethodTypeCategoryPicker.test.tsx. UI-only.
Interim quirk recorded for Phase D: using a template from the builder-embedded
library closes the create flow + refetches, whereas the standalone /methods
library opens the new method in the viewer. Phase D unifies this.

### Phase B: shared StoreShell (MERGED, merge commit be90201d)
store-shell bot. New frontend/src/components/store/StoreShell.tsx: generic,
dumb master/detail frame (wide modal, ~260px rail with search slot + category
list + counts + "All" + Enabled-only toggle, scrollable center via renderCard,
~40% detail pane, responsive collapse to chip row + full-screen detail overlay
below lg). Both stores adopt it. Enable/disable behavior preserved.
MethodTemplateLibraryModal external API unchanged so Phase A's link still works.
StoreShell.test.tsx (9 frame tests).

Key API facts for downstream phases: StoreShell is generic over T, requires
getItemKey(item), and has NO built-in segment (B used flat rail categories
"All / Method types / Protocol templates"). Optional props: allLabel,
detailEmptyHint, emptyState, cardGridClassName, closeAriaLabel, footerSlot.

Merge rationale: B is UI-only and additive; merged rather than branch-stacked
so Grant can debug on local main and so C/D branch off main cleanly. Note B
branched off a stale anchor (9d840390); merge was clean only because B's four
files were disjoint from main's advances (Phase A + a separate rich-card method
picker, 4a368d4f, that landed from another chat). Downstream bots are told to
branch off CURRENT main.

Post-merge verification on the integrated tree: targeted vitest 17/17 (store +
both modals + picker); tsc clean on the three Phase B files.

## What is in flight / queued

### Phase C: search + Types/Templates segment (store-search bot, QUEUED)
Branch off current main, isolated worktree (cp -c -R node_modules, not symlink).
Adds an optional railHeaderSlot to StoreShell for the real Types | Templates
segment (method library only; widget store stays single-kind, no segment).
Wires live client-side search, real category filtering with live counts, and
the Enabled-only toggle. No detail content (that is D). Reports back before
merge; orchestrator merges after a quick review.

### Phase D: detail pane (store-detail bot, DRAFTED, waits on C)
Rich detail pane: large live widget previews (SnapshotTile in the existing
WidgetPreviewBoundary + useInViewport), method-type editors with "Templates
built on this type" cross-links, single-type template content read-only with
"Use template" / "Enable <type>" gating, and compound-template component badges
+ all-types-enabled gating. Unifies the use-template post-action (open the
viewer from both entry points). The only data-shape touch is the optional
catalog-union extension for compound entries: pre-flag before commit.

## Next actions for the main bot

1. When store-search bot reports: review (segment switches category set, search
   filters live, counts correct, Enabled-only works, Phase A link still opens),
   then merge C to main.
2. Reconcile the Phase D draft against C's final code (segment + list shape),
   then fire store-detail bot.
3. After D merges: run the standard 3-verifier loop (mechanics +
   spec-compliance + fresh-eyes) against the proposal doc; add persona
   break-bots if the onboarding tour touches these surfaces.
4. Watch the compound catalog-union data-shape touch in D; it must be
   pre-flagged to Grant before commit, and aligned with the unmerged
   lc-ms-method-templates branch.

## Loose ends (not blocking)

- 17 pre-existing tsc errors in unrelated test files (calendar PTO, onboarding
  cleanup, dep-semantics, remark-underline, VC engine). Orthogonal to this arc;
  a cleanup chip could be spun separately if Grant wants the typecheck green.
- The unmerged lc-ms-method-templates / lc-ms-templates-work branches carry the
  first real combination templates; they should land on the compound +
  components shape and dovetail with Phase D's combination detail renderer.

From the orchestrator (master bot).
