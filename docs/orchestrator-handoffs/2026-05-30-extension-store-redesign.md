# Handoff: Extension Store redesign

To: orchestrator (main bot)
From: orchestrator (this session)
Date: 2026-05-30
Subject: Status of the widget store + method library "marketplace" redesign

## One-line state

Phases A-D are MERGED to local main; the enablement-race fix is MERGED. The
build arc is COMPLETE. The 3-verifier loop (mechanics + spec + fresh-eyes) is
DISPATCHED. One follow-up (compound catalog entries) is HELD pending
coordination with the parallel catalog/kit session (see Compound coordination
hold below).

## Verifier loop results (2026-05-30)

- SPEC: PASS on all 8 locked decisions (cited file:line). Two house-style nits:
  em-dash in compound-template-detail.ts:20 (FIXED inline, commit on main) and
  6 pre-existing emoji in CreateMethodModal.tsx (predate the redesign) FIXED
  via modal-emoji-cleanup bot (merged 9a797d5d).
- FRESH-EYES: 7 findings. Triage:
  - #1 HIGH bug: widget store card button copy/Tooltip/aria say "Add/Remove
    from canvas" but actually toggle palette enablement, contradicting the
    detail pane and misleading screen readers. Dual-context: same WidgetCard is
    used in the canvas palette where the copy IS correct. QUEUED widget-card-copy
    bot (context-aware fix, do not break the canvas palette).
  - #4 naming + #2 empty-state: Grant decided "Kit" as the user-facing word and
    "orienting copy + 3-column grid" for the empty store. Folded with #3
    (Standard/Structured jargon), #5 (use-template destination visibility), and
    #6 (Loading skeleton) into QUEUED store-polish bot.
  - #7 (My Methods page wastes ~60% desktop width): out of scope; flagged as
    methods-page-width bot follow-up (design proposal first).
- MECHANICS: PASS, no bugs. Both stores' interactive paths verified end to end
  (search/categories/enabled-only/detail/live-preview/footer-toggle, the two
  segments, read-only template renders, Use-template gating + viewer from both
  entry points, builder declutter, responsive + two-stage Escape). Non-bug
  flags: no compound templates in the live manifest yet (CompoundTemplateDetail
  fixture-only until lc-ms-templates-work lands -> targeted re-verify then);
  manifest is now 88 templates (catalog session still adding; store is dynamic).

VERIFIER LOOP COMPLETE: spec PASS, mechanics PASS, fresh-eyes triaged. No
correctness defects.

Chip status (2026-05-30):
- widget-card-copy: MERGED (8964d993), verified 18/18 on main.
- methods-page-width: MERGED. Grids bumped to the app-standard xl:grid-cols-4;
  the fresh-eyes "narrow column" was below-convention column cap + demo single-
  method folders. Option 3 (pack sparse bands 2-up) DECLINED as a demo-data
  artifact (real libraries with many methods/folder do not show it) and because
  it diverges from the card-grid convention + touches drag-drop. Revisit only
  if Grant asks.
- store-polish: MERGED. Kit rename (registry label "Kit" + sweep), store
  empty-state (3-up + collapsed detail), Standard/Structured caption,
  use-template destination line, lazy-mount skeletons. Merge had 3 overlapping
  files vs widget-card-copy + methods-page-width (stale base 2d8396ce); verified
  all invariants survived (actionKind + skeleton coexist, palette copy, 4-col
  grid). 133 tests green.
  - PROCESS NOTE: the catalog session's compound loader (090a35bc) had left main
    tsc-RED since it merged: it added the "compound" union arm but
    MethodLibraryDetail's payload switch was non-exhaustive (TS2322). Undetected
    because 090a35bc came from another chat between my merges. FIXED with a
    compound case returning null (the modal renderDetail branch, contract step 3,
    does the real rendering). Lesson: run tsc after sibling-session merges land,
    not only after my own.
  - RESIDUAL (store-polish flag): some in-view widget tiles still show their OWN
    React-Query "Loading..." text (AnnouncementsWidget, LabComments, etc.), not
    the store fallback. Masking needs either a preview-mode skeleton threaded
    into every tile or a fade-on-ready overlay in the preview boundary. Deferred
    as minor cosmetic; queue a contained overlay-fix chip only if Grant wants it.
- compound-wiring (contract step 3): MERGED (merge a5c4b3ca). resolveCatalog-
  CompoundComponents + CompoundTemplateDetailLoader + modal renderDetail compound
  branch with all-types gating. The bot branched off cf92434c (BEFORE store-polish
  + my stub), so the merge overlapped MethodLibraryDetail.tsx / MethodTemplate-
  LibraryModal.tsx / the test. ONE conflict (the duplicate compound case in the
  payload switch, my stub vs the bot's); resolved keeping the bot's comment.
  Verified post-merge: no markers, tsc clean, 148 tests green, and all invariants
  coexist (compound resolver + modal branch + store-polish destination line + both
  helper resolvers). STORE-SIDE BUILD IS COMPLETE.
- kit-card-gate: MERGED (5d6b7942, on top of compound-wiring). Kit cards now show
  a neutral "View kit" affordance (no inline Use) that opens the detail pane,
  where Use is correctly gated on the resolved component types. Single-type cards
  unchanged. Verified: wiring present, compound renderDetail branch intact, tsc
  clean, tests green. Browser-exercisable only after step 4 (unit-tested now).

STORE-SESSION ARC FULLY COMPLETE (2026-05-30). All store-owned chips merged:
A, B, C, D, enablement-race, widget-card-copy, methods-page-width, store-polish,
compound-wiring, kit-card-gate. Verifier loop was clean. Only optional deferred
item on our side: the residual in-tile "Loading..." polish (fade-on-ready
overlay), not queued unless Grant asks.

REMAINING: contract steps 4 + 5, REASSIGNED to the store session by Grant
(2026-05-30).
- STEP 4: QUEUED as lcms-kit-entries bot. 3 LC-MS compound (kit) combination
  templates + manifest entries (pairings/orderings per the contract; titles use
  "(kit)"). Prereqs verified: all 6 leaf templates exist on disk + in manifest;
  no combo entries yet; no in-flight combo branch. Manifest-race precaution:
  isolated worktree, append-only to manifest, prompt merge. The files coverage
  test requires manifest title/category/method_type to match each template file.
- STEP 5: HELD until step 4 merges (needs live compound entries). Then run the
  3-verifier loop on the LIVE compound path: kit detail shows both component
  badges, Use gates until lc_gradient AND mass_spec enabled, kit card shows
  "View kit". Closes the arc.
Once both land, the build is done; the contract's step-5 verifier loop runs on
the live compound path after the catalog session adds step-4 entries.

## Compound coordination: RESOLVED (2026-05-30)

The catalog session authored plans/COMPOUND_COMBINATIONS_CONTRACT.md (Grant-
locked) and landed the compound union LOADER (commit 090a35bc): union + parser
+ instantiation branch, no manifest entries. The contract resolves the apparent
model conflict: single-method + PDF attachment is the LEAF model; compound +
components is the COMBINATION model; they are LAYERS, not alternatives. LC-MS =
lc_gradient + mass_spec. User-facing word is "kit" (matches our store-polish
rename). The contract splits ownership: catalog session owns the loader (done)
and the 3 LC-MS combination templates + manifest entries (step 4, AFTER our
wiring); the STORE session owns step 3 (the Phase D files). Per the contract,
CompoundTemplateDetail needs no change; Phase D built the right shape.

QUEUED compound-wiring bot (contract step 3): resolveCatalogCompoundComponents
adapter (slug -> ResolvedCompoundComponent) in compound-template-detail.ts +
MethodTemplateLibraryModal renderDetail branch for method_type "compound" with
all-types-enabled gating. Fixture-tested (no live compound entry until catalog
step 4).

SEQUENCING: compound-wiring and store-polish both edit compound-template-detail.ts
and MethodTemplateLibraryModal.tsx. RUN store-polish FIRST, then compound-wiring
off the updated main, never concurrent. After compound-wiring merges and the
catalog session lands step 4 entries, run the contract's step-5 verifier loop on
the live compound path.

## Superseded: original compound hold (kept for history)

Phase D built and fixture-tested the compound (combination) detail renderer,
but it is not reachable live: no compound catalog entry exists, and making one
needs the method-catalog.ts payload union extended to accept method_type
"compound". Grant directed: confirm the parallel catalog session is not already
working this before firing any chip.

Findings (2026-05-30):
- Heavy active catalog/template branch work in flight: kit-method-templates,
  kit-templates-clean, lc-ms-method-templates, lc-ms-templates-work,
  method-catalog-integration(-v2), plus per-domain template branches. The live
  frontier on method-catalog.ts is kit Phase 1 (67d91a6d, source_pdf schema).
- No branch has `compound` in the catalog union yet, so the exact extension is
  unstarted.
- DESIGN CONFLICT, not just a collision: the kit-templates project chose a
  single-method + attachment model and explicitly NOT compound. Phase D's
  combination path assumes compound + components. Before any compound catalog
  work, the catalog owner must agree LC-MS combinations should be compound
  entries vs their attachment model. Until then, the compound renderer stays
  fixture-only (correct, harmless).

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
- 2026-05-30: enablement-race fix MERGED (a3970478 / bdae7a7d settings-store
  serialization, 24d2551d setters routed through it). Approach: functional
  updater (updateUserSettings) PLUS a per-user chained-promise write queue in
  user-settings.ts, since async read/write can interleave under a functional
  updater alone. patchUserSettings also routes through it. Verified on main:
  queue present, both setters route through updateUserSettings, enablement
  tests 37/37 green. Bot caught and corrected an incomplete first merge (only
  user-settings.ts landed initially); follow-up confirmed applied via grep.
  Note: a separate "Method catalog kit Phase 1" (67d91a6d, source_pdf schema)
  also landed on main from another chat; D branches off main so it inherits it.

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
