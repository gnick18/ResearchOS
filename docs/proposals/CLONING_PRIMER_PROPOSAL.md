# In-Silico Cloning and Primer Design: Design Proposal

Status: draft for review (Grant). Created 2026-06-03.

This proposal scopes adding in-silico cloning and a real primer-design surface to
the ResearchOS sequence editor. It is grounded in a deep-research audit of APE,
Benchling, SnapGene, Primer3 / Primer3Plus, and NCBI Primer-BLAST (run
wf_2549b28e-0ed, 25 claims, all unanimously verified), plus first-hand feedback
from a molecular biologist (praised APE's in-silico tool as very user friendly,
found Benchling's primer design unintuitive, uses Primer-BLAST and primer3 plus).

## 1. Goal and principles

Build a cloning and primer-design feature set that a bench scientist finds
genuinely useful and pleasant, while keeping ResearchOS calm and uncluttered.
Principles, in priority order:

1. Client-side only. ResearchOS has no backend. Everything runs in the browser
   against the user's local files.
2. Calm by default. Sensible defaults visible, advanced parameters tucked away,
   a clear review step before anything is committed. APE is the positive model.
3. Useful over exhaustive. Ship the smallest feature set that covers most real
   work. Defer or skip the long tail.
4. Trustworthy. Surface the checks that make a scientist believe a result
   (Tm, secondary structure, dimers) without forcing them to configure those checks.

## 2. Research basis

Key verified findings (full report and citations in the wf_2549b28e-0ed transcript):

- APE performs all four target cloning workflows (restriction-ligation, Golden
  Gate, Gibson/overlap, Gateway/recombinase) as a free no-backend desktop app.
  This proves the cloning math fits in a thin client and defines the canonical
  feature surface to mirror. (Davis and Jorgensen, Front. Bioinform. 2022.)
- Overlap assembly (Gibson/NEBuilder) has a directly transferable model: the user
  sizes the homology overlap by a fixed length or a target Tm, and the tool
  auto-designs per-junction primers by extending the 5' end until the overlap
  reaches a minimum Tm, then shows a junction review with the new primers and the
  assembled construct. (SnapGene Gibson guide; APE paper.)
- A minimal trustworthy primer parameter set is small: min/max length, Tm target,
  percent GC, and a 3' GC clamp, plus filters for self-, adjacent-, and 3'-end
  hybridization. This is exactly what APE's "Find Primers" exposes. (APE paper.)
- Primer3's no-input defaults are the field standard and ship-ready: length min
  18 / opt 20 / max 27 bp; Tm min 57.0 / opt 60.0 / max 63.0 C. (Primer3 manual,
  Primer3Plus help.)
- ResearchOS's existing Tm already matches the industry model. Primer3 (and
  therefore Primer-BLAST, which uses Primer3 for candidate generation) defaults to
  SantaLucia 1998 nearest-neighbor thermodynamics, which is what our `primer.ts`
  computes. Our numbers will agree with Primer3 and Primer-BLAST out of the box.
  (Primer3 manual; Ye et al. 2012, BMC Bioinformatics 13:134.)
- The trust checks Primer3 performs are computable in-browser: self-complementarity,
  3'-end complementarity (dimer risk), hairpin (default max 47.0 C), pair
  cross-complementarity, 3' GC clamp, and a poly-X homopolymer limit. (Primer3 manual.)
- True specificity checking (Primer-BLAST style) cannot run purely client-side. It
  BLASTs candidate primers against multi-gigabase RefSeq genome and transcriptome
  databases, refined with Needleman-Wunsch alignment. This is server-side by nature.
  (Ye et al. 2012; NCBI Primer-BLAST workshop 2023.)
- primer3-py is not browser-runnable (compiled C, no Pyodide/emscripten wheel), so
  we reimplement the small, well-documented primer3-style scoring in JavaScript
  rather than embed the engine. (libnano/primer3-py.)

## 3. What we already have (client-side substrate)

- `frontend/src/vendor/bio-parsers` (TeselaGen, MIT): GenBank / FASTA / SnapGene
  parsing and serialization, including multi-segment `join` locations.
- SeqViz enzyme dataset (~236 NEB enzymes) and `digest()` cut computation, reused
  in `lib/sequences/enzyme-filters.ts`.
- `lib/sequences/primer.ts`: nearest-neighbor (SantaLucia) Tm, `findBindingSites`,
  reverse-complement, GC.
- The unified sequence editor with the SnapGene-style tab bar (Map, Sequence,
  Enzymes, Features, Primers, History). The Primers tab is the natural home for
  the primer-design panel; a new Cloning surface fits the same chrome.

Conclusion: the build-first items below do not require unblocking the React-19
OVE editor spike. SeqViz rendering plus bio-parsers plus our digest and Tm
primitives are enough.

## 4. MVP scope

### Build first (high value, client-side today)

1. Primer-design panel (Primers tab).
2. Overlap assembly (Gibson / NEBuilder HiFi) cloning panel.

### Build later

3. Golden Gate / Type IIS assembly (orthogonal 4-nt overhang design).
4. Restriction-ligation cloning and site-directed mutagenesis.

### Probably skip (do not build in-house)

5. Gateway / MultiSite recombination engine (lower value for the effort; revisit
   only if users ask).
6. A genome-wide specificity engine. Delegate to NCBI Primer-BLAST instead
   (see section 7).

## 5. Build-first design: primer-design panel

The gap is not "can we compute primers" (we can). It is making the result
pleasant and trustworthy with almost no required input.

Flow:
- Entry: select a region (or a feature) in the Sequence view, then "Design
  primers" in the Primers tab or the right-click menu. One click to results.
- Defaults: ship Primer3's defaults (length 18/20/27, Tm 57/60/63). The user
  designs without touching a parameter.
- Results: a short ranked list of primer pairs (or single primers), each row
  showing length, Tm, percent GC, and a small set of trust badges: self-dimer,
  3' dimer, hairpin, GC clamp present, poly-X clean. Green when fine, amber when
  worth a look. These are shown, never required as input.
- Actions per result: add as a `primer_bind` feature (carries to GenBank and the
  map), copy the oligo, or send to specificity (section 7).
- Advanced: a single collapsed "Advanced" disclosure holds length and Tm windows,
  GC range, salt and oligo concentration, and the clamp. Hidden by default.

Trust advantage to state plainly in the UI: our Tm uses the same SantaLucia 1998
model as Primer3 and Primer-BLAST, so the numbers match those tools.

UI surface: a panel inside the Primers tab. No modal, no wizard, no Task dropdown.

## 6. Build-first design: overlap assembly (Gibson / NEBuilder HiFi)

Biology: fragments that share short homologous ends are joined seamlessly. The
in-silico job is to size the overlaps and design the primers that add them.

Flow:
- A Cloning surface (a new tab, or an action in the Sequence view) where the user
  picks an ordered set of fragments. Fragments come from the user's connected
  sequences, the current selection, or pasted sequence.
- One choice: size the overlap by length (default around 20-40 bp) or by target
  Tm. Everything else defaults.
- Auto-design: for each junction, extend the 5' end of the appropriate primer
  until the overlap reaches the target, producing a forward and reverse primer per
  fragment. This is APE's exact method and uses our existing Tm.
- Junction review: a step that shows each junction with its new primers and the
  flanking sequence, plus the assembled construct preview. The user confirms before
  anything is saved.
- Output: the assembled construct saved as a new sequence (with features carried
  and rebased across junctions), plus an oligo order list (the primers) that can be
  copied or saved as `primer_bind` features.
- Warnings: flag fragments that cannot form a valid junction, or overlaps that fail
  the Tm or uniqueness target.

UI surface: one guided panel with a fragment list and a junction-review step.
Progressive disclosure, no parameter wall.

## 7. Specificity: local-library check plus NCBI handoff

Decision (Grant, 2026-06-03): pursue the NCBI Primer-BLAST handoff if it can
auto-fill so the page opens ready, otherwise the local-library check. Research
shows the handoff is feasible, so we do both, with the local check as the
always-available baseline and fallback.

### Local-library specificity check (baseline, always on, no network)

For a designed primer, scan the user's own connected sequences and plasmids for
additional binding sites (we already have `findBindingSites`). This catches the
most common real failure, which is a primer that also primes elsewhere on the
user's own construct or library. It runs instantly in-browser and respects the
local-first model. It does not catch genome-wide off-targets, and we say so.

### NCBI Primer-BLAST handoff (on demand, genome-wide)

Feasibility (verified): Primer-BLAST's form submits via POST to
`https://www.ncbi.nlm.nih.gov/tools/primer-blast/primertool.cgi`, and it has a mode
that checks user-supplied primers against a chosen database given a template. A
client-side auto-submitting POST form (a hidden HTML form with the template and
primer fields, `target="_blank"`, submitted on click) navigates the browser
straight to Primer-BLAST with our data filled in. Because it is a form navigation
and not a fetch, there is no CORS problem, and because the browser makes the
request from the user's machine, there is no backend. This satisfies the
"auto-fills when the page opens" requirement.

Risk and mitigation: NCBI's form field names are not officially documented and
could change. We confirm the exact field names from the live form's HTML during
implementation, and if a field name breaks we degrade gracefully to opening
Primer-BLAST unfilled. The local-library check always works regardless, so
specificity never fully depends on NCBI's markup.

UI surface: a "Check specificity" action on a primer. Local result inline; a
"Check genome-wide on NCBI" button that opens the prefilled Primer-BLAST tab.

## 8. UX principles

Positive model, APE:
- Progressive disclosure. Sensible defaults are visible, advanced parameters are
  tucked away.
- A review step. Junctions and candidate primers are shown before anything is
  committed.
- Trust checks as signals, not inputs. Dimers, hairpins, and Tm are surfaced as
  readouts, not required configuration.

Anti-pattern, Benchling (from documentation and first-hand feedback):
- The primer tool is buried behind several clicks (toolbar icon, then Create
  Primers, then Wizard, then a Task dropdown) before any design happens.
- It fronts many parameters at once (Tm, GC content, length, GC clamp, amplicon
  length, and more), which intimidates rather than guides.
- The wizard lags or fails on large sequences and whole-genome targets.

Translated to rules for ResearchOS: design from a selection in one click, show a
small ranked result with good defaults, keep the parameter set tiny and collapsed,
and never block the common case behind configuration. Note: the Benchling reading
is documentation-based plus first-hand; a hands-on pass would sharpen it, but the
rules above hold regardless.

## 9. Build-later designs

- Golden Gate / Type IIS. The core task is choosing mutually orthogonal 4-nt
  overhangs (fusion sites) so junctions assemble correctly, and emitting the PCR
  primers that add them. APE uses a random-walk search for a maximally orthogonal
  set. This is finite combinatorics, client-side feasible. Same Cloning surface,
  a method choice alongside overlap assembly.
- Restriction-ligation and site-directed mutagenesis. Digest with chosen enzymes
  (we already compute cut sites), choose fragments to ligate, and for mutagenesis
  apply a point, insertion, or deletion edit and design the primers that introduce
  it. UI is a simple digest-and-ligate flow and an "edit and make primers" action.

## 10. Probably skip

- Gateway / MultiSite recombination. APE supports it, but it is lower value for
  the effort relative to overlap and Golden Gate. Revisit only on demand.
- An in-house genome-wide BLAST. Server-side by nature. Use the NCBI handoff.

## 11. Technical notes and risks

- Reimplement primer3-style scoring in JavaScript (small and documented), or reuse
  APE-style first-pass filtering. Do not attempt to embed primer3-py.
- Reuse bio-parsers for construct assembly and serialization, and our existing
  digest and Tm. No OVE editor dependency for the build-first items.
- Feature rebasing across cloning junctions reuses the coordinate-shift logic the
  editor already has.
- The NCBI field-name fragility is the main external risk; mitigated as in
  section 7.

## 12. Decisions

Locked (Grant, 2026-06-03):
- Scope of methods researched: all four. MVP builds overlap first.
- Next step: this proposal.
- Specificity: NCBI handoff (auto-fill confirmed feasible) plus local-library
  baseline.

Pending Grant review:
- Confirm the build-first order (primer panel first, then overlap assembly, or
  the reverse).
- Confirm "probably skip" for Gateway is acceptable.
- Whether a hands-on Benchling pass is wanted to sharpen the anti-pattern rules.
