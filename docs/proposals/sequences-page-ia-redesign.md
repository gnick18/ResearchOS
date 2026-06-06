# Sequences page IA redesign (the bioinformatics workbench)

Author: sequence editor master, 2026-06-05. Status: DESIGN PROPOSAL (research-backed,
awaiting Grant sign-off). Grant: the sequences page grew powerful tools that got
buried in a junk-drawer "Analyze" menu; rework the whole layout so the bioinformatics
capability is discoverable, while KEEPING the right-click system we built (the
context-menu framework, the smart editor menus, the universal list-row actions).

## The diagnosis (why it feels buried)

Our editor menu bar is organized by MECHANISM: Edit / Feature / Primer / Analyze /
Enzyme / Export. "Analyze" became the catch-all for every capability that lacked an
obvious home, seven unrelated tools in one dropdown (Detect features, Annotate from
reference, Align, Protein properties, Enrich from NCBI, Explore the tree of life,
Look up an organism). The full tool set is only glanceable on the LAUNCHER (no
sequence open); the moment you open a sequence it all collapses into dropdowns and
vanishes. This is the textbook "junk drawer" anti-pattern: grouped by how the code
works, not by what the scientist is trying to do.

## What the research said (3 streams: Benchling/SnapGene, Geneious/ApE/UGENE, NN/G IA)

- KILL THE MECHANISM BUCKET; group by OBJECT + INTENT, cap groups at ~5 and
  disclosure at 2 levels (NN/G P1/P12).
- A FIXED SPATIAL SKELETON where each edge has a stable meaning users learn once:
  left = library/views, right = inspector + operations, top = global actions + view
  toggles (Figma/Photoshop/Blender/VS Code).
- THE SINGLE BIGGEST UNBURIAL MOVE: a CONTEXTUAL, selection-driven right inspector,
  so when you select a region/feature the tools that act on it surface automatically
  ("the tool comes to you" instead of "go hunt"). (Figma UI3, NN/G P3.)
- GENEIOUS'S category-launcher model is the best fit: a small set of named
  operation-category buttons (Align, Tree/Phylogenetics, Cloning, Primers,
  Annotate, BLAST) that fan out by dropdown. Our feature set IS that bucket set.
- UGENE'S Options Panel: surface the marquee operations as VISIBLE SIDE-ICONS on the
  canvas that open an inline configure-and-run panel (operations become affordances,
  not remembered menu items). Highest-leverage discoverability device.
- SnapGene's "ACTIONS vs TOOLS" intent split (DO/simulate vs ANALYZE/learn), its
  bottom-tab canvas switcher (one file, many lenses), and a side toolbar of
  DISPLAY toggles kept SEPARATE from operations.
- Benchling's persistent right-rail of labeled icon-panels (glanceable) + a rich
  empty state that advertises where sequences come from + live-updating property
  panels.
- Cmd-K is a SUPPLEMENT for the informed, never the discoverability fix (a newcomer
  cannot search "tree of life" if they have never seen it).
- RIGHT-CLICK = focused, object-scoped, secondary actions, an accelerator that
  DUPLICATES visible actions, never the sole path; and it needs a signifier (a hover
  affordance) because right-click is invisible to non-power users.
- RESULTS AS SAVED ARTIFACTS with history (pairs with our version control).

## The proposed layout (fixed skeleton)

Three stable regions, each with one meaning:

- LEFT, the LIBRARY: the sequence list + collections (today's left panel). The
  launcher / empty state lives here when nothing is open.
- CENTER, the CANVAS: ONE live, switchable view of the open sequence, with view
  TABS across the top (Map / Sequence / Features / Primers / History). Map (circular
  + linear) and Sequence are the same live canvas, never a generated artifact. A
  thin DISPLAY strip holds the "what is drawn" toggles (features, primers, enzymes,
  translations, linear vs circular) kept SEPARATE from operations.
- RIGHT, the TOOLS + INSPECTOR: the heart of the fix. Two layers:
  1. A persistent OPERATIONS RAIL (labeled icons on the right edge) for the marquee
     bioinformatics operations, each opening an inline configure-and-run panel in
     place: Primers, Cloning, Restriction / Digest, Align, Protein (properties +
     domains), Tree of Life / Taxonomy, Detect / Annotate. The rail makes the
     capability VISIBLE at all times.
  2. A CONTEXTUAL INSPECTOR that, on a selection or a clicked feature, surfaces the
     tools for THAT object (translate selection, primers here, restriction in
     selection, domains for this CDS, taxonomy for this organism). Even minimized,
     a selection re-opens the relevant panel.

- TOP, the GLOBAL BAR: create / import actions (New, Assemble, Import, Download from
  NCBI), a slim intent-grouped menu (or just the rail + palette), and the Cmd-K
  COMMAND PALETTE entry.

## Menu reorganization (intent over mechanism)

Replace the junk-drawer "Analyze" with the rail above, and split the remaining menus
by SnapGene's clean intent line:
- DESIGN / "Actions" (do at the bench): Cloning / Assemble, Primers, Mutagenesis,
  Restriction digest.
- ANALYZE / "Tools" (learn about a sequence): Align, Protein properties, Domains,
  Tree of Life / Taxonomy, Detect features, Enrich from NCBI.
- EDIT stays the bases menu; EXPORT stays. Feature / Primer object actions move into
  the contextual inspector + the right-click menu (where they belong).
Every operation also reachable via Cmd-K.

## How our existing features map in

- Tree of life + Look up an organism + Enrich from NCBI -> the EXPLORE / Tree
  operation on the rail + the contextual inspector (a sequence's organism surfaces
  its taxonomy tools).
- HMMER protein domains + Protein properties + Translate -> the PROTEIN operation on
  the rail; on a CDS selection they surface contextually.
- Cloning / Assemble, Primers, Restriction, Align -> their own rail operations.
- Detect features / Annotate from reference -> the ANNOTATE operation.
- Export, GenBank/FASTA/image -> the Export menu (unchanged).
- THE RIGHT-CLICK SYSTEM stays as the object-scoped accelerator that duplicates the
  rail/inspector actions; add a hover signifier so it is discoverable. The universal
  list-row actions stay on the library.

## Phased rollout (the whole layout is on the table, but ship in coherent slices)

- PHASE 1 (the unburial, additive, lowest risk): the RIGHT OPERATIONS RAIL of
  labeled icons opening inline panels for the marquee operations (Primers, Cloning,
  Restriction, Align, Protein, Tree of Life, Annotate). This alone fixes "buried"
  because every capability becomes glanceable. Wire each icon to the EXISTING dialog
  / flow (no new engines). Retire the Analyze junk drawer in favor of the rail.
- PHASE 2: the DISPLAY strip (separate what-is-drawn toggles from operations) + the
  CANVAS VIEW TABS (Map / Sequence / Features / Primers / History as one live
  canvas).
- PHASE 3: the CONTEXTUAL INSPECTOR (selection-driven tool surfacing) + working-state
  teaching cues (empty inspector sections that explain themselves) + the right-click
  signifier.
- PHASE 4: the Cmd-K COMMAND PALETTE (fuzzy, grouped, shows shortcuts, biased by
  selection), as the supplement.
- PHASE 5: RESULTS AS ARTIFACTS (alignments, trees, domain scans persist with
  history) + the richer empty state.

Phase 1 is the high-value, low-risk start; the rest is sequenced so each slice is
coherent and shippable on its own.

## What may need building NEW (Grant asked "what from scratch")

- The OPERATIONS RAIL component + the inline inspector-panel container (a reusable
  right-docked panel host).
- The CONTEXTUAL surfacing layer (a small registry mapping a selection/feature kind
  to the operations that apply, feeding both the inspector and Cmd-K ranking).
- The Cmd-K palette (a registry of operations with labels, groups, shortcuts,
  context predicates).
- Possibly a results/artifact model if operations should persist (ties to version
  control).

## Risks + open calls

- BIG SURFACE: doing all phases at once is risky; Phase 1 first, validate, continue.
- MODES question (NN/G P4): do our tasks partition into distinct modes (design vs
  analyze), or do users interleave freely? If interleave, skip hard modes and rely
  on the contextual inspector. RECOMMEND no hard modes for v1; one canvas, strong
  contextual surfacing.
- FEATURE-SPLIT data: which operations earn a permanent rail slot vs the long tail
  should ideally come from usage; absent telemetry, a quick card-sort of the
  bioinformatics tools + a couple of task walkthroughs sets the initial hierarchy.
- The right-click system is preserved throughout (Grant's constraint); the redesign
  adds VISIBLE surfaces that duplicate it, it does not replace it.

## Open questions for Grant

1. The rail's marquee set (which ~7 operations get a permanent right-rail icon):
   recommend Primers, Cloning, Restriction, Align, Protein (properties + domains),
   Tree of Life / Taxonomy, Detect / Annotate. Confirm or adjust.
2. Hard modes (Design vs Analyze workspaces) vs one canvas + contextual inspector.
   Recommend one canvas + contextual.
3. Start with Phase 1 (the operations rail) now, or design the full visual mockup of
   all phases first. Recommend ship Phase 1, it is the unburial and it is additive.
