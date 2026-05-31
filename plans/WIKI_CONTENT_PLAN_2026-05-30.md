# Wiki content plan: the features that shipped this session

Author: wiki-content design pass (for HR), 2026-05-30. A content plan (pages + concept-first outlines + screenshot lists + compliance tie-ins), NOT the pages. Voice = concept-first, annotated-screenshot-heavy, fixture mode only (?wikiCapture=1). No existing wiki coverage for the Extension Store, the catalog, compound combinations, or version history.

## Ground-truth caveats (must be honest in copy)
- Version History flips a documented LabArchives "edge": both compliance pages today say per-entry edit history is "Partial / Roadmapped." This feature flips that row. The compliance edits are the SINGLE highest-value docs deliverable.
- Scope honestly: Phase 1 viewer is ON for the Notes pilot; Phase 2 restore/undo is a separate DEFAULT-OFF flag. Catalog is 91 templates, 33 with bundled PDFs (rolling out, not all 84). The editor is the "inline/live" mode ("Typora" is an internal codename, do NOT use it in user copy).

## Feature 1: Version History (HIGHEST priority)
- NEW page /wiki/features/version-history (after "The Markdown Editor" in the Features nav).
- UPDATE /wiki/compliance/labarchives-comparison: flip the "per-entry edit history with revert" row from Partial to Yes (scoped "Notes pilot, rolling out"); revise the "where LabArchives is still ahead" bullet.
- UPDATE /wiki/compliance/nih-data-management: the "edit history on the roadmap" Callout -> "now shipping (Notes pilot)"; cite version history in the provenance/integrity row.
- LIGHT cross-links from /wiki/features/trash (deleted vs edited) + /wiki/features/markdown-editor (saving).
- Outline: what a version is -> where (Notes pilot, right sidebar) -> day/session grouping -> in-place per-editor-tinted diff + compare toggle -> who sees it / it is local + private -> restore (Phase 2) -> 24h undo -> compliance bridge.
- Screenshots: sidebar w/ grouping, in-place diff w/ tinting, compare toggle, restore button, undo button (all need NEW fixture: a note with multi-version, multi-editor, multi-day history + Phase 2 flag on).

## Feature 2: Bulletproof kit templates / template library (HIGH)
- NEW page /wiki/features/method-catalog ("Template Library"), nested under Methods.
- UPDATE /wiki/features/methods: add a "Start from a template" section + recapture the stale methods-library.png.
- Outline: what a template is + why -> what is in the library (by lab-task category) -> THE VERIFIABLE SOURCE PDF (33 of 91 today, the bulletproofing: verify any value against the vendor insert) -> how to use one -> 384-well plates -> provenance/open formats (compliance bridge).
- Screenshots: library/picker cards, a structured template detail, the SOURCE-PDF-open shot (the money shot: verify against the original insert), a 384-well plate.
- Compliance tie-in: bundled PDFs = verifiable provenance (NIH provenance/integrity + open-formats).

## Feature 3: Compound combinations (MEDIUM)
- FOLD into the template-library page as an "LC-MS combination templates" section (3 of 91), unless the Extension Store warrants its own page (the OPEN QUESTION below).
- Outline: what a combination is (LC gradient + mass spec as one unit) -> why LC-MS -> where (Extension Store kit cards) -> using one.
- Screenshots: the compound/kit card, the combination attached to an experiment (both sub-editors).

## Feature 4: inline (live) editor mode (MEDIUM-LOW)
- UPDATE /wiki/features/markdown-editor: extend "the two modes" -> three, add the inline/live mode as opt-in (Notes pilot). Reconcile the nav blurb ("Three modes") vs the body ("two").
- Outline: what inline/live mode is (continuous WYSIWYG vs block-by-block hybrid) -> opt-in + Notes pilot -> how it differs from hybrid -> what is the same (saving/images/shortcuts). Do NOT say "Typora."
- Screenshots: a note in inline mode mid-edit, the three-way mode toggle. Needs enableInlineMode on at capture.

## Sequencing (by trust-story value)
1. Compliance updates for version history (prose-only, ship before screenshots; the trust-flip closing its last conceded gap). 2. The version-history feature page. 3. The template-library page + the source-PDF section + Methods-page update. 4. Compound combinations (section). 5. Inline editor (section).

## Fixture seeding (blocking for screenshots)
Version history (biggest lift): seed a note with a multi-version history file (several saves, 2+ days, 2 editors) + Phase 2 flag on. Template library: source-PDF shot needs one of the 33 bundled templates reachable in fixture mode. Inline editor: enableInlineMode on. Recommend pairing the fixture-seeding chip with the version-history page chip.

## Open question for Grant
Standalone /wiki/features/extension-store page vs fold compound combinations into the template-library page. Depends on how much of the Extension Store (the unified dashboard + store that shipped earlier) is itself undocumented. Lean: fold, unless the Extension Store has enough independent undocumented surface.
