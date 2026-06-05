# ResearchOS roadmap, future ideas

A running backlog of ideas worth doing later. Entries here are NOT scheduled and NOT in progress. They are captured so good ideas are not lost. Moving an item into active work means writing a real proposal/design first (see docs/proposals/).

Status legend, `idea` (captured, unscoped), `scoping` (proposal being written), `building` (active), `done` (shipped).

---

## Reference and citation management

Status, `idea`
Raised by, Dylan Duerre (beta feedback, 2026-06-04)

The ask, the ability to read in and open papers, input a DOI or other unique identifier, and manage citations. Citation management would be a nice-to-have.

What this could include:
- Open and read papers inside ResearchOS (a PDF reader surface, the app already stores PDF attachments and bundles source PDFs with method-catalog templates, so the viewing primitive is partly there).
- Add a reference by unique identifier (DOI, PMID, arXiv id) and auto-fetch its metadata (title, authors, journal, year) instead of typing it by hand.
- A reference library, store references, attach the PDF, and link a reference to the experiments / notes / methods that cite it.
- Generate citations and a bibliography in common styles, and export (BibTeX, RIS, formatted text).

Why it fits ResearchOS, references are the connective tissue between a lab's protocols/experiments and the published literature, and a local-first reference library (PDFs + metadata living in the user's own folder) matches the project's storage model and NIH data-management positioning. It also pairs naturally with the existing notes, methods, and attachment systems.

Early technical notes (not a commitment):
- DOI metadata lookup is browser-direct and CORS-friendly via Crossref (api.crossref.org) and DataCite, similar to the Zenodo deposit path already proven in the sharing work, so no server proxy is needed. PubMed (E-utilities) and arXiv have public APIs for PMID / arXiv ids.
- PDFs and metadata can live in the user's data folder as ordinary files plus a sidecar, consistent with how sequences and method source PDFs are stored.
- Citation formatting is a solved problem with the open citation-style ecosystem (CSL), worth reusing rather than rebuilding.

Open questions for whenever this gets scoped, where references live (per-project vs a folder-wide library vs both), whether references are shareable cross-boundary like the other entities, and how tightly to couple a reference to the things that cite it.

---

## Lab instrument and equipment manuals

Status, `idea`
Raised by, Dylan Duerre (beta feedback, 2026-06-04)

The ask, a place for common lab instruments and equipment manuals.

What this could include, a shared library of equipment manuals (PDFs) attached to the instruments a lab actually uses, so the manual for the qPCR machine or the plate reader is one click away instead of buried in someone's email. Could extend the existing method-catalog pattern (templates already bundle source PDFs) and tie a manual to the methods/instruments that reference it. Likely overlaps with the reference library primitive above (PDF + metadata + linking), so the two ideas may share machinery.

## Shared instrument calendars

Status, `idea`
Raised by, Dylan Duerre (beta feedback, 2026-06-04)

The ask, shared calendars for booking lab instruments.

What this could include, a booking/scheduling surface so lab members can reserve shared instruments (who has the confocal at 2pm, is the centrifuge free), see conflicts, and avoid double-booking. This is inherently a SHARED, multi-user feature, so it leans on the lab/sharing model (and possibly the cross-boundary or future collaborate infrastructure) rather than the single-user local store. Worth scoping against the local-first constraint, a calendar that everyone reads and writes is closer to the live-collaboration problem than the copy-on-send model.

## Experiment planner

Status, `idea`
Raised by, Dylan Duerre (beta feedback, 2026-06-04)

The ask, an experiment planner.

What this could include, a way to plan an experiment ahead of running it, steps, timeline, the methods and instruments it needs, and the resources/reagents to have on hand. ResearchOS already has experiments (tasks), methods, and a Gantt chart, so this likely builds on those rather than starting fresh, the planner would be the forward-looking, pre-run view that complements the existing record-keeping. Worth checking against the beta de-bloat work so it adds planning value without adding click-heavy complexity.

## Simulate overlap extension PCR (assembly and overhang check)

Status, `idea`
Raised by, Justin Eagan (beta feedback, 2026-06-04)

The ask, simulate overlap extension PCR so the editor can check a user's primer overhangs and confirm the fragments will assemble into the intended construct in the correct orientation. Justin noted this is currently a paid-tier SnapGene feature.

What this could include:
- Given two or more fragments plus the primers that carry the complementary overhangs, predict the assembled product and verify that the overlapping ends are truly complementary and long enough to anneal.
- Check orientation, confirming each fragment joins in the intended 5-prime-to-3-prime direction so the construct is not assembled backwards.
- Surface failure modes before the bench, mismatched or too-short overlaps, unintended secondary annealing, or a fragment that can go in two orientations.
- Render the predicted junction sequence so the user can eyeball the seam.

Why it fits ResearchOS, this sits squarely in the sequence-editor / cloning-engine arc already in flight (the SnapGene-style surface), and overlap extension PCR (also called SOEing PCR) is a common primer-driven assembly method that pairs with the primer-design and specificity tooling the sequence work is building. Catching a bad overhang in silico saves a failed bench reaction.

Early technical notes (not a commitment):
- The core check is local string and alignment work on the fragment ends and the primer overhangs (complementarity, overlap length, Tm of the overlap), the same class of pure-function sequence logic already validated on the transparency page (Tm, alignment, digest, translation).
- Builds on the cloning engine the sequence-editor initiative is already scoping rather than a standalone tool.

Open questions for whenever this gets scoped, how the user inputs the fragments and primers (pick from the sequence library vs paste), how many fragments to support in one assembly, and whether to unify this with other assembly methods (Gibson, Golden Gate) under one assembly-simulator surface rather than an overlap-extension-only tool.
