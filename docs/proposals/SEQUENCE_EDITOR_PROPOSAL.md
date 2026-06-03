# Sequence Editor (SnapGene / Benchling-style molecular biology) Proposal

Author: orchestrator (master bot), 2026-06-02
Status: DESIGN DECISIONS LOCKED by Grant (2026-06-02), and the PHASE 0 SPIKE HAS
PASSED (2026-06-02, all three checks green; see "Phase 0 spike result" below).
The plan is validated end to end. Ready to start Phase 1 (persistence + read
view) on Grant's greenlight. No build phase dispatched yet.

## Phase 0 spike result (2026-06-02, branch `seqviz-spike` @ a2f2bb02, not merged)

All three gate questions answered favorably, empirically, inside our app:
- (a) REACT 19: PASS, zero console/page errors under React 19.2.3 / Next 16.1.6
  (Turbopack). No React-version fixes needed (SeqViz already targets `^19`). Full
  circular + linear viewers drew a 5,000 bp plasmid with all 6 annotated features.
- (b) EDIT SPLICE-ABILITY: CONFIRMED cleanly splice-able, days not weeks. The
  single-base insert/delete prototype touched ZERO vendored render files. The edit
  lived entirely in host React state feeding the `seq` prop; SeqViz's
  `componentDidUpdate` recomputed complement / annotations / cut-sites / layout on
  every change, and length-changing edits (5000 -> 5002 -> 5001) recomputed cleanly
  with no errors. Caveat for the full build: a true IN-CANVAS caret (vs an external
  index control as in the prototype) needs wiring through `SelectionHandler` -
  additive, not a rewrite.
- (c) THE LOOK: clean, calm, Benchling/SnapGene-spirit render inside our app
  (screenshots produced). This is SeqViz mostly-default; our typography / spacing /
  toolbar polish still layers on top, but the base aesthetic is confirmed right.

VENDORING was clean: 4 small files touched, 3 external deps shimmed
(`react-resize-detector` -> a ResizeObserver hook, `seqparse` stubbed since we pass
`seq` directly, `csstype` + `webfontloader` + `react-dom/server` imports removed).
NO `npm/pnpm install` was run; source was vendored. Integration note for the real
build: ~40 implicit-`any`/strict-mode `tsc` warnings in the vendored third-party
source (strictness mismatch, not React 19); exclude the vendor dir from the app's
strict typecheck or relax `strict` for that path.

## Motivation

A lab member pointed out that a true "one stop shop" research tool would also
cover what scientists today open SnapGene or Benchling for: looking at a DNA
sequence, drawing a plasmid map, annotating features, finding restriction
sites, designing primers, and planning a cloning reaction. Today a ResearchOS
user has to leave the app entirely for any of that. Grant's instinct was to
avoid reinventing the wheel and lean on the open-source community instead. A
verified research pass (2026-06-02, 19 sources fetched, 25 claims triple-checked
adversarially, 24 confirmed) says that instinct is correct: the hard, correctness
-critical biology is recyclable, MIT-licensed, fully client-side code that fits
the no-backend model natively.

## The key finding: this splits into two halves, and only one is a build

"A Benchling/SnapGene alternative" is really two very different asks:

1. THE ELN HALF (lab notebook, methods, protocols, inventory). ResearchOS
   already has most of this (notes, results, methods library, PCR builder).
   Every open-source ELN/LIMS (eLabFTW, SciNote, openBIS) is a server + database
   application (PHP / Rails / Java + MySQL / Postgres). NONE of it ports into a
   no-backend React app. The architecture mismatch is total. Verdict: build
   nothing here, reuse nothing here. It is largely already done.

2. THE SNAPGENE HALF (sequence + plasmid tooling). This is the real gap. The
   open-source community gives us the two parts that are hard to get right: a
   clean client-side RENDERER (SeqViz) and a proven, headless set of molecular
   biology FUNCTIONS (TeselaGen's `@teselagen/bio-parsers` + `sequence-utils`).
   Verdict: recycle the renderer and the biology functions, and build the editing
   interactions and the cloning engine ourselves.

## Architecture decision (locked, Grant 2026-06-02): SeqViz is the single renderer

The crucial call. The user must see the SAME view whether they are reading a
sequence or editing it. Two different renderers (a clean viewer for reading, a
dense editor for editing) would make the map visibly morph on edit, which is a
real UX flaw. So:

- SEQVIZ IS THE ONE RENDERER for both viewing and editing. View mode and edit
  mode are the same component, so they look identical by construction. No seam,
  no second look to maintain.
- RECYCLE TESELAGEN'S HEADLESS FUNCTIONS for the biology, separately from any UI:
  `@teselagen/bio-parsers` (GenBank / FASTA / SnapGene parsing and writing) and
  `@teselagen/sequence-utils` (reverse complement, translation, ORF finding, Tm,
  restriction-site detection, digestion). These ship as standalone MIT packages,
  so we get the proven biology WITHOUT taking on OVE's interface.
- WE BUILD THE EDITING INTERACTION LAYER on top of SeqViz: caret, type-to-edit,
  drag-to-create-feature, selection-to-operation, undo/redo, and our own calm
  Benchling-style toolbar.

Why not the alternatives:
- Restyling / forking OVE to look like SeqViz: CSS cannot reshape OVE's renderer
  (feature-arrow geometry, label placement, leader lines, row wrapping are
  computed in JS and emitted as specific SVG). Matching SeqViz would mean forking
  OVE and rewriting its renderer to mimic SeqViz, i.e. reimplementing SeqViz
  inside OVE plus a permanent fork to maintain. Rejected.
- A two-renderer hybrid (SeqViz to view, OVE to edit): less work, but the map
  changes appearance between reading and editing. Rejected on the consistent-view
  requirement above.

The accepted trade: we build the editing interactions ourselves (more app code,
and one real risk, see below) in exchange for one beautiful consistent view and
no dependency on OVE's UI.

## What we recycle (verified)

- SEQVIZ, by Lattice Automation. MIT, fully client-side. A clean DNA / RNA /
  protein sequence renderer (linear + circular) with selection, search,
  annotation / primer / enzyme / translation display, and an `onSelection`
  callback. CONFIRMED read-only today: it renders what you give it and reports
  selections, with no built-in editing. It is our single renderer for both modes;
  the editing interactions are ours to add on top.
  - APPROACH (Grant 2026-06-02): VENDOR SeqViz's source into our repo and own it,
    not consume it as an arms-length npm dependency. MIT explicitly allows this;
    we take the code we need, modify it freely, and make it React-19-clean
    ourselves. License hygiene: retain SeqViz's MIT copyright header on the
    vendored files (MIT-into-AGPL is fine, we just keep the attribution).
  - Source: https://github.com/Lattice-Automation/seqviz
- `@teselagen/bio-parsers` (MIT) and `@teselagen/sequence-utils` (MIT), from the
  `TeselaGen/tg-oss` monorepo. The headless biology: file parsing / writing and
  sequence operations. Used regardless of UI.
  - Source: https://github.com/TeselaGen/tg-oss

License fit: ResearchOS is AGPLv3. MIT (SeqViz, the TeselaGen packages) is fully
compatible to incorporate. No license blocker on this path. See
[[project_sustainability_pricing_model]].

## What we explicitly do NOT use (verified, so we do not waste time)

- OPEN VECTOR EDITOR (OVE) UI (`@teselagen/ove`): the full React/Redux editor.
  We are NOT using its interface (its default UI is dense and would force the
  restyle/fork problem above). We DO use its sibling headless packages
  (bio-parsers, sequence-utils). OVE is kept only as a FALLBACK option: if the
  spike shows SeqViz cannot host editing acceptably, restyling OVE is the
  contingency. Otherwise unused.
- DnaFeaturesViewer (Edinburgh Genome Foundry): Python / Matplotlib. Wrong
  runtime, cannot run in the browser. Not reusable.
- plasmid-designer: a Rust / Tauri DESKTOP app, not a web component, negligible
  adoption. Not reusable as a library.
- JBrowse 2 (`@jbrowse/react-linear-genome-view`): MIT and client-side, but it
  is a genome browser (NGS tracks, alignments, large genomic data). Overkill and
  the wrong shape for plasmid / cloning work. Hold unless a genomics use case
  shows up later.
- splice (splice.mino.mobi): a client-side molbio toolkit that looked promising
  for cloning simulation, BUT the claim that it is MIT-licensed and reusable was
  REFUTED 0-3 by the fact-checkers. Do not assume we can vendor it. If we ever
  want it, someone has to confirm its actual repo license first.
- All open-source ELN / LIMS (eLabFTW, SciNote, openBIS): server + DB. Non-starter
  for code reuse here.

## What we build ourselves

1. THE EDITING INTERACTION LAYER on SeqViz (net-new, the consequence of the
   single-renderer decision). Caret rendering and positioning mapped to sequence
   coordinates, keyboard handling (insert / delete / replace) that mutates the
   document and re-renders, drag-to-create / edit / delete features using
   SeqViz's selection, undo / redo over our own document model, and the calm
   Benchling-style toolbar. The document model is just a GenBank-parsed object
   (via bio-parsers), so we own it cleanly. This is the layer we most want design
   control over anyway, since it carries the clean look.

2. PERSISTENCE GLUE (small, fits the model beautifully). An adapter that reads
   and writes GenBank / FASTA through the File System Access layer (using
   bio-parsers), so a plasmid becomes just another file on disk under the user's
   folder, exactly like notes and results. FLAGGED data-shape change (new on-disk
   file types): needs sign-off and a verify-before-merge gate per the field
   -migration discipline in AGENTS.md.

3. THE CLONING / ASSEMBLY SIMULATION ENGINE. Simulating a reaction (restriction
   cloning, Gibson, Golden Gate) to produce the resulting construct. No clean,
   license-safe drop-in gave us this (splice's license was refuted; pydna is
   Python / server). We build it as a pure-TypeScript `lib/` module on top of
   `sequence-utils` primitives (digestion, rev-comp), unit-tested in isolation.
   Primer design is a smaller related build (primer3 exists but is C / WASM, so
   either a WASM wrap or a JS reimplementation of the core scoring).

## Edit-surgery feasibility (investigated at source level, 2026-06-02)

A read-only investigation of SeqViz's `develop` source (v3.10.22) answers the
days-vs-weeks unknown with HIGH-CONFIDENCE: CLEANLY SPLICE-ABLE, days not weeks.
The renderer does not need rewriting. Evidence:

- SEQVIZ ALREADY MIRRORS `seq` INTO STATE AND RECONCILES ON PROP CHANGE
  (`SeqViz.tsx` `componentDidUpdate`). So a host that owns the sequence and feeds
  it down as the `seq` prop works with the grain: SeqViz re-derives complement,
  cut sites, search, and rows automatically on every change.
- A CARET ALREADY EXISTS. Selection carries `start`/`end`; a caret is simply
  `start === end`. It is updated on click, drag, and arrow keys, and it is
  already DRAWN (a 1px vertical rect in `Linear/Selection.tsx`). We do not invent
  a cursor; we read `selection.end`.
- THE RENDER PATH IS A PURE RECOMPUTE FROM `seq` with NO fixed-length assumptions,
  content-based block keys, and correct deep-equality memoization. A sequence that
  grows or shrinks redraws cleanly. The render trees (`Linear`, `SeqBlock`,
  `Circular/*`) need NO changes to support editing.
- A KEYDOWN HANDLER ALREADY EXISTS (`EventHandler.tsx`, `onKeyDown`) with
  `preventDefault`, handling copy / select-all / arrows. Printable keys and
  Backspace/Delete currently fall through and are ignored: that is the natural
  splice point. Editing is: add key cases + an `onEdit` callback threaded
  `EventHandler -> SeqViewerContainer -> SeqViz`. About three files touched.
- REACT 19 IS ALREADY A FIRST-CLASS TARGET: SeqViz's peerDeps include `^19`, its
  devDeps pin `^19`, and it uses `createRoot`. No shim expected.

The real engineering cost is NOT the renderer. It is two things, both tractable
and both OUTSIDE SeqViz:
1. COORDINATE-SHIFT LOGIC in our own document model: on insert/delete at index i,
   every feature/annotation/primer/translation with `start >= i` shifts, with
   clamping for ranges spanning the cut. Standard interval math, our code.
2. PER-KEYSTROKE RECOMPUTE COST for 5-15 kb plasmids with enzymes/search enabled,
   because `digest()` / `search()` / the deep-equality compare re-run on every
   `seq` change. Fix by debouncing digest/search and gating recompute while
   typing (SeqViz already ships a `debounce` util).

Recommended design (from the investigation): vendor the source, add the `onEdit`
callback path, keep the seq + feature model in the ResearchOS store, shift
coordinates there, feed updated `seq` / `annotations` back as props, and debounce
the enzyme/search recompute during active typing. The Phase 0 spike confirms this
empirically and measures the per-keystroke perf on a real plasmid.

## UI / UX design (locked direction, Grant 2026-06-02)

NORTH STAR: Benchling's calm, approachable feel. The goal is that a current
Benchling or SnapGene user finds ours easier, not denser. The whole point of the
single-SeqViz-renderer decision is that SeqViz already looks clean and modern, so
the calm look comes for free and stays consistent across viewing and editing.

Locked design decisions:
- DESIGN SCOPE: shared UI principles defined once, applied GREENFIELD-FIRST. The
  sequence surface is the reference implementation of the calm design language,
  and the de-bloat work ([[project_beta_debloat_initiative]]) adopts the same
  principles incrementally. No big-bang app-wide redesign mid-beta.
- POLISH CADENCE: polish THROUGHOUT, not end-only. The UI is the feature here,
  not a finish. Each phase ships against the rubric below; a small cohesion sweep
  closes the end. End-only polish is explicitly rejected.

Benchling rubric (the principles each phase is measured against):
- Labeled actions, not cryptic icons (Benchling's "Create / Analyze / Copy"). Our
  toolbar is ours to design, so this is straightforward.
- Progressive disclosure of density. Enzyme overlays, advanced tools, and side
  panels are OFF or collapsed by default and opt-in. (SeqViz's enzyme / annotation
  display is prop-controlled, so density is a default we set.)
- Document/project information architecture: calm left project list + tabbed
  open sequences.
- Generous whitespace and typography. CSS and spacing we fully own.
- One obvious primary action per view.

Honest ceiling: SeqViz's renderer is already the clean look we want, so unlike
the OVE path there is no "OVE-flavored map" compromise. The remaining design work
is the chrome, IA, toolbar, and editing affordances, all of which we own. The
realistic target is genuinely Benchling-spirit calm, consistent across modes.

## SnapGene-parity interactions (locked direction, Grant 2026-06-02)

Grant is a SnapGene fan specifically for its intuitive, safe-feeling interaction
model, and wants us to match as much of it as we can: that "feels super easy"
quality is a primary goal, not a nice-to-have. The good news from the source
investigation: all of this lands in the editing-layer we already build ourselves,
and our host-owned document model (we own the seq + features + coordinate-shift)
is exactly what makes the annotated clipboard behaviors clean. This is additive
to Phase 2 scope, not new architecture.

Target feature set, with recycle-vs-build and effort:

SELECTION + KEYBOARD (SeqViz already provides click-to-place caret, drag-select,
arrow-key caret movement, select-all):
- Type-to-insert at caret, Backspace/Delete to remove. BUILD, easy (the `onEdit`
  hook through `EventHandler`).
- Shift+arrows extend selection, double-click selects a feature/word. MOSTLY
  there, light build.
- Cmd+Z / Cmd+Y undo/redo over our own document model. BUILD, moderate.

CLIPBOARD (the SnapGene headline; the meatiest build, reuses our coord-shift):
- Copy/cut a plain selection to the SYSTEM clipboard as text (bases), for interop
  with email and other tools. BUILD, easy (Clipboard API `writeText`).
- Copy an ANNOTATED selection into an in-app "molecular clipboard": the
  sub-sequence plus the features overlapping it, clipped and rebased to zero.
  BUILD, moderate.
- Paste at cursor, carrying annotations, after a confirmation popup ("Insert
  1,234 bp and 3 features at position 512?"). Insert + shift downstream coords +
  merge the carried features. BUILD, moderate; reuses the coordinate-shift logic.
- Cross-document paste: copy in one open sequence, paste into another. BUILD; easy
  if the molecular clipboard is an app-level store (not per-document).
- Paste plain bases from the OS clipboard (from another tool) as unannotated
  sequence. BUILD, easy.

CONFIRMATIONS (a big part of why SnapGene feels safe):
- Deleting a chunk asks "Remove N bp" and names the features it touches. BUILD,
  easy. Same pattern for paste and other large/destructive edits.

ANALYSIS + INFO (Grant specifically loves these, 2026-06-02, wanted in):
- LIVE SELECTION READOUT: highlight any region and a small info bar shows
  coordinates (start..end), length in bp, and GC% (SnapGene: "2,661,861 ..
  2,662,434 = 574 bp [47% GC]"). CHEAP WIN: SeqViz already tracks selection
  start/end (confirmed in the investigation), GC% is a trivial compute, and Tm/GC
  helpers exist in sequence-utils. Pull EARLY (Phase 1/2), do not defer; it makes
  the tool feel responsive and smart immediately.
- PRIMER DESIGN with a Tm + alignment popup (SnapGene's "Add Primer" dialog):
  enter or select a primer and see length, GC%, binding site, annealed bases,
  predicted Tm, a reverse-complement toggle, and a VISUAL ALIGNMENT of the primer
  against the template showing exactly what anneals. RECYCLE the biology (Tm from
  sequence-utils, GC trivial, binding-site = substring/complement search); BUILD
  the popup + alignment visualization as our UI on the SeqViz renderer. PROMOTED
  from a follow-on footnote into intended v1 scope per Grant.
- RESTRICTION ENZYME DISPLAY + DIGEST: show commercial restriction enzymes and
  WHERE THEY CUT on the map, with SnapGene's enzyme picker + filters (source set
  e.g. "All Commercial"; hide noncutters; cut-count filters like unique / N-cutters;
  whole-sequence vs inside-selection; recognition length; palindromic /
  nondegenerate; blunt-vs-sticky overhang) and SAVED NAMED ENZYME SETS (e.g.
  "Unique 6+ Cutters"). HIGHLY RECYCLABLE: SeqViz ALREADY renders cut sites and
  ALREADY runs the digest on change (confirmed in the investigation), sequence-utils
  does restriction-site detection, and SeqViz ships a bundled enzyme list (MIT,
  vendored already) as the base dataset. BUILD: the picker/filter UI, the filter
  logic (computed from cut results + enzyme metadata), and a small per-user store
  for saved named sets. SYNERGY: this digest infrastructure is the SAME machinery
  the Phase 3 cloning engine needs for restriction cloning, so it is foundational,
  not isolated. Open (decide at build time, not blocking): SnapGene shows ~678
  commercial enzymes vs SeqViz's smaller bundled set; matching that breadth means
  bundling a fuller REBASE-derived dataset (free for academic use, attribution).
  Grant: invaluable, wanted in.

VIEW CONTROLS + FEATURE MANAGEMENT (Grant 2026-06-02; the view-control half is the
LEVER that delivers the locked "calm by default / progressive disclosure" feel, not
just a feature):
- WHAT'S IN VIEW: show/hide feature TYPES, individual features, enzyme sites,
  translation / codons, ORFs, complement strand, ruler/index. RECYCLE-FRIENDLY:
  SeqViz is prop-driven (renders whatever annotations / enzymes / translations you
  pass), so a view-control panel we BUILD just filters the data fed to SeqViz; the
  rendering already responds. This is the concrete mechanism for the locked UI
  principle (clean default, layers toggled on demand).
  PRESENTATION (Grant 2026-06-02): present these as a compact ICON RAIL of toggle
  buttons (SnapGene's left-edge track toolbar pattern, which Grant likes), NOT a
  checklist. Use OUR custom inline-SVG icons (never emoji) + <Tooltip> on each
  (house style). Grant likes the pattern, not SnapGene's specific images. Our
  toggle-able tracks (all supported by SeqViz props): Features, Enzymes,
  Translation, ORFs, Primers, complement strand, ruler/index, circular-vs-linear
  topology. If 2c ships these as a panel/checklist instead of the rail, refine to
  the rail in a polish pass.
- FEATURES LIST = ON-DEMAND (locked, Grant 2026-06-02): the always-on right
  Features side panel is too busy. DEFAULT view = clean full-width map + the icon
  rail, NO side panel. A toolbar TOGGLE opens the feature list/index on demand
  (kept as a valuable INDEX for big multi-gene contigs: search/jump; SnapGene's
  Features-tab model). Editing a feature is via double-click on the viewer (see
  rich feature-edit popup) and adding via a toolbar action, so the list is not
  needed for those. Restructure applied after the 2c-polish chip lands.
- FEATURE MANAGEMENT: add / edit / duplicate / remove features, feature COLORS,
  feature TYPES (CDS / promoter / gene / misc; types come from parsed GenBank via
  bio-parsers, plus a manage-types UI), and MULTI-SEGMENT features. Part of the
  Phase 2 editing layer (we own the feature model, SeqViz renders it). DOMAIN NOTE:
  multi-segment features are table stakes for Grant's work, fungal genes have
  INTRONS (exon/intron segment structure), not optional polish for this user base.
- RICH FEATURE-EDIT POPUP (Grant 2026-06-02, SnapGene "Edit Feature" parity). Click
  a feature -> a popup to edit it. Phase 2c builds the CORE (name, type, strand,
  color, range). A FOLLOW-UP chip "2c2: rich feature editor" brings full parity:
  (a) the SEGMENT TABLE with Split / Merge / Delete segment + per-segment location +
  per-segment color (full multi-segment EDITING, beyond 2c's display+preserve);
  (b) a QUALIFIERS editor (`/product`, `/note`, etc., add/remove arbitrary GenBank
  qualifiers; round-trips into the .gb); (c) the per-feature "translate in sequence
  view" toggle; (d) "prioritize display in maps". ENTRY (Grant ask): DOUBLE-CLICK a
  feature ON THE VIEWER (the colored arrow on the map) opens its editor (wire SeqViz
  feature double-click -> the existing FeatureEditorDialog), plus the panel edit
  action. Dispatched AFTER the 2c-polish chip lands (both touch editor/viewer files;
  serialize), so the delta is scoped against what is on main then.
- ANNOTATION COLORS (Grant 2026-06-02, wanted): recolor annotations in the viewer
  (genes, primers, features) PER-FEATURE and PER-FEATURE-TYPE (a default
  type->color palette, e.g. CDS / promoter / primer each a color), SnapGene-style.
  RECYCLE: SeqViz colors features by their `color` prop, so a recolor just updates
  the feature's color and re-renders. BUILD: the color-picker UI + the default
  palette. PERSISTENCE: store colors so they survive export and round-trip with
  SnapGene / ApE via the de-facto GenBank `ApEinfo_fwdcolor` / `ApEinfo_revcolor`
  qualifiers (confirm bio-parsers preserves them; ties to the on-disk-format
  choice). The default palette must read well in BOTH light and dark mode (app
  theming applies).
- DETECT COMMON FEATURES (auto-annotation): scan a sequence against a database of
  known features (tags, promoters, oris, resistance genes) and auto-annotate.
  HIGHER EFFORT + DATASET-DEPENDENT: SeqViz does NOT provide this; needs a bundled
  feature database (open options exist, e.g. pLannotate-style sets). High value
  (annotates raw sequences fast) but likely POST-v1; decide dataset sourcing then.
- IMPORT / EXPORT FEATURE DATA: recycle via bio-parsers (GenBank carries features).

DEFERRED DESIGN QUESTION (decide at Phase 2, not blocking now): what "another tab"
means for annotated paste. Default plan: an IN-APP molecular clipboard (copy in
one open sequence, paste into another within our app) plus plain-text sequence
to/from the OS clipboard for interop. Going further, annotated paste BETWEEN TWO
SEPARATE BROWSER TABS of our app, is possible via the async Clipboard API with a
custom payload but is a notch more work; treat as a Phase 2 stretch. Note: full
rich-clipboard interop with the actual SnapGene desktop app is out of scope (the
formats differ); plain-sequence text is the interop surface.

## Organization and collections (locked direction, Grant 2026-06-02)

Grant prefers SnapGene's organization model over Benchling's: a left-hand working
tree backed by a flat library plus collections, with a "main collection" (SnapGene
shows this as the "All Files" view over a flat, sortable file list, with an
ephemeral "Working Set" as a separate concept). The key decision (Grant, locked):
PROJECTS ARE COLLECTIONS. We do not build a separate collection taxonomy for users
to hand-manage; the existing project structure generates the collections.

STRATEGIC NOTE (Grant, 2026-06-02): making projects hold sequences elevates a
project from "a labeled folder for notes and experiments" into a real RESEARCH
DATA + ANALYSIS HUB. The pattern generalizes: once a project can hold sequences
and their analyses, the same door opens for other data types later (gels, plates,
flow, etc.). This is a stronger reason for projects to exist than task-organizing,
and it should inform how projects evolve app-wide, not just here.

Model:
- MAIN COLLECTION = all of the user's sequences, a flat per-item store on disk
  (`users/{u}/sequences/...`), consistent with how `tasks/`, `notes/`, etc. are
  stored. This is the "All Sequences" view (the "All Files" equivalent).
- A SEQUENCE LINKS TO ONE OR MORE PROJECTS (membership is a link, e.g. a
  `project_ids: string[]` on the sequence's metadata, NOT a single on-disk folder
  home). Selecting a project in the collection selector filters the library to its
  sequences. Multi-membership is faithful to SnapGene (a file can be in multiple
  collections).
- "UNFILED" = sequences with no project link yet (loose / exploratory). "All
  Sequences" = unfiltered.
- The library view mirrors SnapGene's useful affordances: flat sortable list
  (name, type, length, added date), a list-vs-grouped toggle, search, bulk select.
- WORKING SET (ephemeral multi-select for compare / align / bulk actions) is noted
  as a later addition, not v1.
- INTEGRATION FOLLOW-ON: a project's own page can surface its linked sequences (a
  "Sequences" tab), so the connection reads both ways. Later, not v1-critical.
- Sequences participate in the existing unified sharing (`shared_with`) like other
  entities; project-scoped sharing can follow project sharing later.

On-disk format (LOCKED, Grant 2026-06-02): RAW GENBANK FILE + METADATA SIDECAR.
Source of truth is a real `sequences/{id}.gb` GenBank file (portable, opens/exports
directly in SnapGene, round-trips annotation colors via the standard `ApEinfo`
qualifiers), plus a small `sequences/{id}.meta.json` sidecar for ResearchOS
metadata (display name, `project_ids` collection links, added_at, etc.). Matches
the "a sequence is just a file" ethos. Minor cost: re-parse on read (via
bio-parsers). NOT a JSON-record-of-truth and NOT a dual-file mirror (avoids the
dual-write drift class of bug).

## App integration: entry points, linking, export (design, Grant 2026-06-02)

This is what makes it the "one stop shop" the lab member asked for rather than a
SnapGene clone bolted on the side. Guiding principle: LINKS, NOT COPIES. The
sequence file is the single source of truth; notes / experiments / projects hold
references to it.

ENTRY POINTS (three doors):
- TOP-LEVEL WORKBENCH at `/sequences` (the locked nav entry): full library, working
  tree, collection selector, editor. Primary home. Needs the `APP_ROUTE_TO_WIKI`
  entry + wiki page (coverage gate).
- PER-PROJECT "Sequences" presentation: since projects ARE collections, opening a
  project shows its linked sequences in context. NOTE (cross-arc, see coordination
  section): the de-bloat arc OWNS the Workbench projects surface and builds this
  presentation by consuming `sequencesApi.listByProject`; the sequence arc provides
  the model + API, not the project-surface UI. The "get into a collection" path from
  our side is the workbench collection selector (pick a project / Unfiled / All).
- FROM EXPERIMENTS / NOTES: linked sequences surface inline and open into the viewer.

LINKING (the connective tissue):
- A sequence is linked by reference to one or more PROJECTS (collection membership),
  and can ALSO be linked to specific EXPERIMENTS / TASKS and NOTES. Reuses / extends
  the existing linking model (lab_linksApi / references). Nothing duplicated.

IN-NOTE / IN-EXPERIMENT EMBED (Grant's "linked not duplicated" vision):
- A note or experiment can EMBED a linked sequence as a LIVE READ-ONLY SeqViz
  viewer. Because it is a reference, edits to the sequence reflect in the note.
- IN-APP + HTML EXPORT: renders directly as the live read-only viewer (SVG/DOM).
- PDF EXPORT: `@react-pdf/renderer` cannot host SeqViz's React/SVG directly, so at
  export time the viewer is RASTERIZED to an image (SVG -> PNG) and embedded. It DOES
  appear in the PDF, as a rendered snapshot of the live link at export time.
- SEND-TO-NOTE STATIC IMAGE (the simple, always-works path): export the current
  view (chosen zoom / region / selection) as an image into the note's image strip,
  reusing the existing attachment / image infra. A FROZEN figure; renders trivially
  in PDF/HTML because it is just an image.

LIVE vs FROZEN (LOCKED, Grant 2026-06-02): support BOTH. Default to a LIVE embed
(reflects the current sequence, the connected-tools magic), and also offer "insert
as static image" for a frozen figure (good for "what the experiment used at the
time"). The static-image path reuses attachments and is nearly free, so supporting
both costs little over live-only.

PHASING: the send-to-note static image is easy (reuses attachments) and can land
early. The live embed + PDF rasterization is more involved and belongs in the
integration phase (was "Phase 4 inline embeds", now expanded into this section).

## Architecture (proposed)

- A new top-level surface (working name `/sequences` or `/constructs`). Per the
  AGENTS.md wiki-coverage gate, a new top-level route needs a matching
  `APP_ROUTE_TO_WIKI` entry plus a wiki page, or the build will refuse to deploy.
- SeqViz is the single renderer, mounted client-side only (dynamically imported,
  SSR-guarded, Next.js 16 App Router). It renders both the read view and the edit
  view; an edit-mode flag toggles the editing affordances we layer on top.
- Sequences stored as GenBank / FASTA files in the user's data folder, under the
  same per-user `users/{username}/...` model, parsed / written via bio-parsers.
  They participate in the existing unified sharing (`shared_with`) like other
  entities, so plasmids can be shared between members with no new sharing infra.
- The document model is a GenBank-parsed object we own; the editing layer mutates
  it and re-renders SeqViz from it (controlled-component style).
- The cloning engine is a pure-TypeScript `lib/` module (no UI), unit-tested in
  isolation, consumed by the surface.
- Editing is a deliberate focused mode (a dedicated editor route or modal), not
  an inline flicker, so entering edit reads as "I opened the workshop."

## Locked decisions (Grant, 2026-06-02)

- ARCHITECTURE: SeqViz is the single renderer for both viewing and editing.
  Recycle TeselaGen's headless function packages (bio-parsers, sequence-utils)
  for the biology. Build the editing interaction layer on SeqViz. Do not use
  OVE's UI (kept only as a fallback if the spike shows SeqViz cannot host editing).
- SCOPE: full editable surface is the goal, delivered in phases (read view first,
  full editing next). Not viewer-only.
- CLONING ENGINE: FULL engine in v1, restriction cloning AND Gibson AND Golden
  Gate. The largest from-scratch build, in scope from the start, so v1 is a real
  SnapGene-style design tool, not just a viewer/annotator.
- TIMING: run as a parallel arc ALONGSIDE the beta de-bloat initiative, not queued
  behind it. (See the tension under Risks; concurrent per Grant's call.)
- PLACEMENT: a NEW top-level surface with its own route and nav entry, not folded
  into methods or results.
- UI: calm Benchling-spirit, shared principles greenfield-first, polish throughout.
- ORGANIZATION: SnapGene-style working tree, and PROJECTS ARE COLLECTIONS (a
  sequence links to one or more projects; main collection = all sequences; no
  separate hand-managed collection taxonomy). Working Set deferred.

The only remaining gate is the Phase 0 spike below.

## Phasing

0. SPIKE (gate, must pass first). We are VENDORING SeqViz's source into the repo
   (Grant 2026-06-02), so the spike is not "decide whether to fork" (decided: yes,
   own it). It is "vendor it and MEASURE how much we touch." Three questions,
   answered with evidence, on a throwaway branch:
   (a) CONFIRM THE EDIT-SURGERY ESTIMATE + MEASURE PERF. The source investigation
   (see "Edit-surgery feasibility" above) already answered the days-vs-weeks
   question: cleanly splice-able, days, high confidence. The spike CONFIRMS it
   empirically by vendoring the source, adding the `onEdit` path, and doing one
   live insert/delete at the caret, AND measures the one real caveat: per-keystroke
   recompute cost on a real 5-15 kb plasmid with enzymes/search enabled. If perf is
   bad, confirm debouncing digest/search fixes it.
   (b) COMPATIBILITY. Make the vendored SeqViz + the TeselaGen headless packages
   run under React 19. Since we own the source, this is ours to fix directly, not
   a peer-dependency pin to wait on.
   (c) THE LOOK. Render a real sequence in our app with our spacing / typography /
   toolbar, and show Grant the screenshot. Confirm the calm target is real in our
   own app, not just on SeqViz's demo.
   No further phase starts until all three are green.
1. PERSISTENCE + READ VIEW + LIBRARY. GenBank / FASTA read-write adapter on the
   FSA layer (via bio-parsers), a flat `sequences` store with project-link
   metadata (`project_ids`), the SeqViz read view, and the working-tree library
   (All Sequences / per-project / Unfiled, sortable list, search). Backend /
   data-shape: VERIFY before merge, do NOT merge on report. Pre-flagged.
2. EDITING LAYER + SNAPGENE-PARITY INTERACTIONS. Caret, keystroke editing, feature
   CRUD, undo/redo, and the calm toolbar on the SeqViz renderer, PLUS the
   SnapGene-parity set (see that section): selection-aware delete with "remove N bp
   / affected features" confirmation, the in-app molecular clipboard, annotated
   copy/cut/paste-at-cursor with confirmation, cross-document paste, and plain-text
   sequence interop with the OS clipboard. Save back to disk. Sharing via existing
   `shared_with`. The annotated clipboard may split into its own sub-phase (2b) as
   it is the meatiest piece; the Phase 2 design question on clipboard reach is
   resolved here. ALSO IN SCOPE (Grant loves these): the live selection readout
   (coords / bp / GC%, a cheap win, can land as early as Phase 1) and PRIMER DESIGN
   with the Tm + alignment popup (biology recycled from sequence-utils, popup is
   our UI), promoted into v1 from a follow-on footnote.
3. CLONING ENGINE. The from-scratch assembly simulation (restriction cloning
   first, then Gibson / Golden Gate) as a tested `lib/` module on sequence-utils
   primitives, then wired into the surface. (Primer design is no longer a Phase 3
   follow-on; it moved into Phase 2 per Grant.)
4. APP INTEGRATION + WIKI (see "App integration" section). Linking sequences to
   projects / experiments / notes; the send-to-note static image (easy, reuses
   attachments); the live read-only in-note embed; and PDF/HTML export rendering
   (HTML = live viewer, PDF = rasterized snapshot). Plus a dedicated wiki sub-bot
   for the new surface (per the AGENTS.md rule that `/wiki/*` belongs to a wiki
   sub-bot, not the feature bot).

## Risks and unknowns

- EDIT-SURGERY DEPTH: largely RESOLVED by the 2026-06-02 source investigation
  (cleanly splice-able, days not weeks, high confidence; the renderer needs no
  rewrite, a caret + keydown handler already exist). Downgraded from the top risk.
- PER-KEYSTROKE PERFORMANCE (the surviving real caveat). On a 5-15 kb plasmid with
  enzymes/search on, `digest()` / `search()` / deep-equality compare re-run on
  every `seq` change. Mitigation: debounce digest/search and gate recompute while
  typing. The spike measures this on a real plasmid.
- COORDINATE-SHIFT CORRECTNESS. The interval math that shifts feature/annotation
  coords on insert/delete is our code and is where edit bugs would live. Unit-test
  it hard (it is pure and very testable).
- EDITING LAYER IS NET-NEW APP CODE, but bounded: the biology is recycled
  (bio-parsers, sequence-utils) and the renderer + caret are recycled, so we build
  the edit interactions and the coord-shift model, not algorithms or a renderer.
- REACT 19 COMPATIBILITY: low risk. SeqViz already targets React 19 (peerDeps
  include `^19`, uses `createRoot`); and we own the vendored source regardless.
- BUNDLE SIZE. SeqViz is lighter than OVE, so smaller concern, but still route
  -split and dynamically import the surface.
- SCOPE CREEP toward "full Benchling." Honest framing: we match the SnapGene-style
  sequence/plasmid surface with recycled biology, NOT all of Benchling's
  enterprise LIMS. Bounded bet.
- IMPORT OF EXISTING `.dna` FILES (adoption-critical, feasibility UNVERIFIED).
  SnapGene's native `.dna` is a proprietary BINARY format. Real labs (Grant's
  included, 71 `.dna` files) have their whole library in it. GenBank / FASTA import
  is solved (bio-parsers). `.dna` import is NOT yet confirmed: need to verify a
  `.dna` parser works fully client-side (open-source `.dna` readers exist; unclear
  if bio-parsers covers it or if a vendored parser is needed). If we cannot ingest
  existing libraries, the tool is dead on arrival for current SnapGene users. Open
  design item, not yet scheduled.
- BETA DE-BLOAT TENSION. A major feature add while the de-bloat initiative trims
  surface ([[project_beta_debloat_initiative]]). Grant's call is to run it as a
  parallel arc anyway. Mitigation: keep it behind its own clearly-scoped route and
  hold the de-bloat voice/clicks goals front-of-mind in its UI so the new surface
  does not reintroduce "feels like AI / too many clicks."

## Cross-arc coordination (reply to the de-bloat / minimalism arc, 2026-06-02)

The de-bloat manager published MINIMALISM_ARC_COORDINATION.md (we share local main).
This is the sequence-editor arc's reply and our aligned plan.

PROJECT-FOLDER OWNERSHIP (their headline ask): AGREED. We land the project-link +
library foundation FIRST; they then build the Workbench projects surface to present
sequences alongside experiments and notes, consuming our model. Division of labor:
- SEQUENCE ARC OWNS: the `/sequences` workbench (library + read view + editor), the
  sequence data model (`.gb` + `.meta.json`, `project_ids: string[]` multi-membership),
  `sequencesApi` including `listByProject`, the cloning engine, the SeqViz vendoring.
- DE-BLOAT ARC OWNS: the Workbench projects surface (`app/workbench`, how projects
  display + are created), and presenting linked sequences there by consuming
  `sequencesApi.listByProject`. We CEDE the per-project "Sequences tab" presentation
  to them, we do NOT build it (was loosely implied in App integration above).
- SIGNAL: once Phase 1 lands and the project-link shape is reviewed + stable, the
  sequence arc tells the de-bloat arc, who then sequences the projects surface around
  it. The shape to expect: `sequences/{id}.meta.json` with `project_ids: string[]`.

UPDATE (2026-06-02) — DE-BLOAT ARC, THE PROJECT-LINK MODEL IS NOW STABLE ON MAIN.
Phase 1 merged to local main @ a8b7a5b7 (Grant-approved, tsc green). You can now
build the Workbench projects surface against it:
- API: `sequencesApi.listByProject(projectId)` and `listUnfiled()` in local-api.ts.
- Shape: `users/{u}/sequences/{id}.meta.json` = `{ id (number), display_name,
  project_ids: string[], added_at, seq_type }`; raw GenBank at `{id}.gb`.
- `project_ids` are the CURRENT USER's own project ids (v1). Cross-user links need
  owner-qualifying later (per-user id collision, like taskKey) when sharing lands.
- NOTE FOR YOUR APPSHELL/NAV SIMPLIFICATION: Phase 1 added a `/sequences` nav entry
  in `frontend/src/lib/nav.ts`. Please PRESERVE it (re-point onto the surviving
  sidebar) when you simplify the shell, rather than dropping it.
- SECOND APPSHELL TOUCH (2026-06-02): I added a one-branch carve-out at the top of
  the route-sidebar conditional in `AppShell.tsx` so `/sequences` renders NO left
  sidebar (full-bleed focus surface; the page has its own working-tree library, so
  the DailyTasksSidebar is redundant there). Matches your existing calendar /
  lab-overview inline-conditional pattern. PLEASE PRESERVE this `/sequences -> null
  sidebar` branch when you rework the sidebar chain. Tiny + additive; ping me via
  Grant if it conflicts with your shell redesign.

WIDGET CANVAS TEARDOWN: no impact. The sequence editor has ZERO widget / canvas
dependency. Our surface is the standalone `/sequences` route. We will not add a
widget or touch `components/lab-overview/**`.

EDITOR / ATTACHMENT SHAPES: our future integration (Phase 2 editing, Phase 4 in-note
embeds + send-to-note image) will build on the NEW shapes, not the retired ones:
inline-only `InlineMarkdownEditor`, the consolidated toolbar (`toolbarTrailing`),
Save = checkpoint (`lib/history`, `task_notes`/`task_results`), and unified
attachments (`ImageStrip`/`FileStrip` union-read + `AttachmentViewerModal`, uploads
to `Images/`/`Files/` only, no `PdfAttachmentsPanel`). Send-to-note static images go
to `Images/` via the new strip. NONE of this is in Phase 1, so no immediate
collision; when we reach it we expect to MERGE with the de-bloat arc on
`ImageStrip`/`FileStrip`/the editor (collision zone), coordinated via Grant.

APPSHELL / NAV: our `/sequences` nav entry must land on the simplified shell
(`DailyTasksSidebar`, members landing on `/workbench`), not the deleted
`CustomizableSidebar` / member Home. We add it minimally and reconcile at
integration. (Phase 1 branched off current main before the shell teardown landed, so
the orchestrator re-points the nav entry onto the surviving shell at cherry-pick
time.)

INTEGRATION HYGIENE (agreed, applied to all sequence-arc work): `git merge main
--no-edit` in the worktree first; integrate by per-commit `git cherry-pick -x`, never
a stale-anchor tree-merge; new on-disk shapes (`.gb`/`.meta.json`) are review-gated,
commit-on-branch, NO auto-merge; re-check main immediately before integrating.

### Status update (2026-06-02, orchestrator) — the timing signal

De-bloat re-pinged for the one thing they most want settled: "tell me when your
project-link model is stable." Honest status: Phase 1 (persistence + read view +
library, which is what actually builds the `project_ids` model and
`sequencesApi.listByProject`) is NOT yet dispatched. It is designed and LOCKED
but waiting on Grant's greenlight. So the project-link SHAPE is final and known
today even though the model is not on disk yet:

- `sequences/{id}.meta.json` carrying `project_ids: string[]` (multi-membership).
- read path: `sequencesApi.listByProject(projectId) -> Sequence[]`.

RESOLVED (Grant, 2026-06-02): de-bloat builds with the seam. De-bloat builds the
Workbench projects surface NOW against the locked shape; sequence Phase 1 stays
parked until separately greenlit, and sequences slot in with no rework when it
lands.

The seam is SHIPPED for de-bloat to import (owned by the sequence arc, returns
nothing until Phase 1, creates no on-disk shape so no data-shape gate yet):

- module: `frontend/src/lib/sequences/api.ts` (import path `@/lib/sequences/api`).
- `sequencesApi.listByProject(projectId: string): Promise<Sequence[]>` -> `[]`
  for now. Map over it to render a "Sequences" section; empty result renders
  nothing, so the projects surface ships today and sequences appear automatically
  once Phase 1 fills the seam in.
- `Sequence` / `SequenceMeta`: `{ id, name, project_ids: string[], added_at,
  length_bp? }`, mirroring `sequences/{id}.meta.json`.

The sequence arc still fires the explicit "shape is live + reviewed" signal the
moment Phase 1 lands; until then the import is stable and safe to build against.

## Appendix: research provenance

Verified research pass 2026-06-02 (deep-research workflow): 6 search angles, 19
sources fetched, 85 claims extracted, top 25 adversarially verified (3-vote,
2/3-to-kill), 24 confirmed, 1 killed (the splice license claim). SeqViz read-only
status and the TeselaGen headless-package split confirmed by follow-up search
2026-06-02. Primary sources: TeselaGen tg-oss (bio-parsers, sequence-utils, ove),
Lattice-Automation/seqviz, JBrowse, Edinburgh Genome Foundry/DnaFeaturesViewer,
elabftw, scinote-web, GNU GPL-3.0 text.
