# Bioinformatics tools: information architecture (hub tab vs under Sequences)

Author: sequence editor master, 2026-06-05. Status: DESIGN DRAFT for Grant.
Question Grant raised: as the molecular-biology tooling grows (cloning, align,
primers, protein properties, domain annotation, NCBI import, an on-device HMMER
engine), should it live under a NEW top-level "Bioinformatics hub" tab, or stay
under the existing Sequences area?

## Decisions (Grant, 2026-06-05)

- KEEP under Sequences; DEFER a separate Bioinformatics hub tab until 3+ genuinely
  standalone tools exist (the trigger below).
- BUILD an in-page tool launcher / overview inside `/sequences` (Edit / Assemble /
  Align / Detect / Annotate domains / Get from NCBI) for discoverability.
- ENRICH the in-page Sequences identity (a subtitle framing it as the
  molecular-biology workbench); keep the nav label "Sequences".
- Sequencing note: the launcher touches the `/sequences` surface, so it is built
  AFTER the in-flight on-device-HMMER WebWorker wiring lands, to avoid two parallel
  edits to the same page. The "Get from NCBI" launcher entry is forward-looking
  until the NCBI Datasets import ships (show it as available-soon or omit until
  then).

## The question, sharpened

It is an information-architecture call, not a feature. The tools work regardless
of where they are reached from; the choice is about NAVIGATION, DISCOVERABILITY,
and IDENTITY, weighed against the de-bloat ethos and the wiki-coverage gate (a new
top-level route needs a wiki page).

## Tool inventory (the deciding fact)

Almost everything is SEQUENCE-BOUND. It operates ON a sequence and is reached from
inside the editor, so it cannot meaningfully be pulled OUT of the editor.

Sequence-bound (lives inside `/sequences`):
- the editor (view / edit DNA / RNA / protein, the map + base views)
- cloning workspace (Assemble: overlap / restriction / Golden Gate / Gateway)
- align / compare (dotplot, identity)
- primer design + Tm + specificity (local + NCBI BLAST handoff)
- restriction enzymes / digest
- Detect Features / Annotate from reference
- protein properties (the CDS drawer)
- domain annotation (EBI InterProScan + the on-device HMMER engine, in flight)
- mutagenesis primer designer
- NCBI Datasets download (proposed: a library action)
- export (GenBank / FASTA / PNG / SVG)

Standalone (NOT sequence-bound), few:
- lab calculators (the global modal: Scientific / Molarity / Dilution / Serial /
  Primer Tm / Nucleic / Protein / Buffer)
- the transparency tests page (`/transparency`)
- FUTURE candidates that would be standalone: a codon optimizer, a taxonomy
  browser, batch annotation, phylogenetics. None exist yet.

The ratio is the point: ~11 sequence-bound surfaces, ~2 standalone. `/sequences`
is ALREADY the bioinformatics hub; the name just undersells what it has become.

## Options

A. KEEP UNDER SEQUENCES (+ discoverability). The tools stay attached to the
   sequences they act on. The standalone tools stay as global utilities (the
   calculators modal is reachable everywhere already). Add a small in-page TOOL
   LAUNCHER / overview so users discover cloning / align / domains / NCBI without
   hunting, and optionally reframe the Sequences identity so it reads as the
   molecular-biology workbench. NO new top-level nav.

B. NEW "BIOINFORMATICS" TOP-LEVEL HUB TAB. Group the tools under a new top-level
   area, editor as centerpiece. More prominent and a clear "this is our science
   suite" statement. But it SPLITS the tools from the sequences they operate on
   (most are sequence-bound), adds a top-level nav item (against de-bloat), and
   needs a wiki page. Today it would be a tab whose only true standalone resident
   is the calculators.

C. AN IN-PAGE HUB LANDING (a middle path). A "tools overview" surface as the entry
   to `/sequences` (a launcher / dashboard of every capability), so the hub is
   CONCEPTUAL, reached through the existing Sequences nav, with no new top-level
   route. This is option A's discoverability piece taken a little further.

## Tradeoffs

- DE-BLOAT. The project trimmed nav and killed the widget dashboard; a new
  top-level tab cuts against that. A favors it, B fights it, C is neutral.
- COHERENCE. Sequence-bound tools belong next to their sequence. B separates them,
  which is the weakest part of B today.
- DISCOVERABILITY. The real problem worth solving is that users may not know all
  the tools exist inside `/sequences`. A launcher (A's add-on or C) solves this
  WITHOUT new nav. A bare top-level tab (B) helps discovery but at the cost above.
- IDENTITY / NAMING. "Sequences" undersells a full molecular-biology workbench.
  Options: keep "Sequences" in the nav (clear, low-risk) but enrich the in-page
  identity; or rename the nav entry (risky, and "Workbench" is taken by the
  tasks / experiments surface). Recommend keeping the nav label and enriching the
  in-page surface.
- WIKI GATE. B needs a new wiki page; A / C extend the existing Sequences page.

## Recommendation

Option A now, with the C-style launcher as its discoverability piece. Concretely:
- Keep `/sequences` as the home of the molecular-biology tools; do not add a
  top-level tab yet.
- Add a small, calm TOOL LAUNCHER inside `/sequences` (a "what can I do here"
  overview surfacing Edit / Assemble / Align / Detect / Annotate domains / Get
  from NCBI), so the breadth is discoverable.
- Enrich the in-page identity (a one-line subtitle that says this is the
  molecular-biology workbench) without renaming the nav entry.
- Leave the calculators where they are (global, reachable everywhere).

DEFER option B until the STANDALONE tools accumulate. The trigger to revisit: once
there are roughly three or more genuinely standalone, non-sequence-bound tools
(e.g. codon optimizer + taxonomy browser + batch annotation), a hub grouping THOSE
and linking the editor earns its top-level slot. We are not there yet, and
building the tab now would mostly relabel an existing surface.

## When to revisit (the standalone-tool threshold)

Re-open this when EITHER: (a) we have 3+ standalone tools that do not belong inside
the editor, OR (b) user feedback shows people cannot find the tools that already
exist inside `/sequences` even with the launcher. Until then, keep it under
Sequences.

## Open questions for Grant

1. Build the in-page tool launcher / overview now (the discoverability piece), or
   leave `/sequences` as-is for now?
2. Enrich the Sequences identity copy (subtitle / framing), or keep it minimal?
3. Agree to defer a separate Bioinformatics tab until the standalone-tool
   threshold, or do you want the tab now regardless?

## Risks

- Under-selling the surface: if we keep it under Sequences but do nothing for
  discoverability, the breadth stays hidden. The launcher mitigates this.
- Over-building: a top-level tab now adds nav + a wiki page for little gain while
  the tools are sequence-bound. Deferring mitigates this.
