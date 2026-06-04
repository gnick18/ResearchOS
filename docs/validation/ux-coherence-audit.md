# Sequence editor UX coherence + visual audit

Read-only audit of the alignment and auto-annotation features. Driven against a
production build (`next build` + `next start -p 3091`) in fixture mode
(`/demo` then `/sequences?wikiCapture=1`), system Chrome via Playwright, on the
three demo plasmids (pEGFP-N1, pEGFP-N1-TRAP1, pGEX-3X). No product code was
changed. Screenshots live in `~/Desktop/ux-audit/` and are referenced by filename
throughout.

Note on the brief: the brief mentioned a "CMV mammalian vector" as the third
demo. The actual third fixture is pEGFP-N1-TRAP1 (a TRAP1 fusion in a CMV-driven
mammalian vector), not a separately named CMV vector. Everything else lined up.

---

## 1. Discoverability map

| Feature | Current entry point | Reach (clicks) | Rating | Note |
| --- | --- | --- | --- | --- |
| Compare / Align two sequences | Library header button "Compare" | 1 click | obvious | Lives at the library level, not in the editor. Sensible (it is a two-molecule operation), and the icon + label read clearly. Screenshot `compare-dialog-empty`, `compare-alignment`. |
| Dotplot | Checkbox inside the Compare dialog ("Show dotplot", on by default) | inside dialog | obvious | Renders in the top-right of the result. See visual issues (cramped). |
| Detect common features | Editor toolbar -> Feature menu -> "Detect common features..." | 2 clicks | buried | Strong feature (DNA + protein + closest-ORF), but a new user scanning the toolbar would never guess that an auto-annotation engine lives under a menu named "Feature". `detect-features`, `detect-features-scrolled`. |
| Annotate from reference | Feature menu -> "Annotate from Reference..." | 2 clicks | buried | Same problem as Detect. Both are analysis actions hiding inside an edit-CRUD menu. `annotate-reference`, `annotate-reference-result`. |
| Add / Edit / Duplicate / Remove Feature | Feature menu (Edit/Dup/Remove disabled until a feature is selected) | 2 clicks | obvious | Standard CRUD; correctly gated on selection. `menu-feature`. |
| Show / hide feature types | Bottom of the Feature menu, after a divider, as bare rows "cds / gene / source" with eye toggles | 2 clicks | hidden | No section label. The type rows look like more menu commands, not a visibility panel. A user will not connect "cds" in the Feature menu with "hide the CDS layer on the map". `menu-feature`. |
| Add Primer | Primer menu -> "Add Primer..." | 2 clicks | buried | Reasonable once you find the Primer menu. `primer-add`. |
| SDM / mutagenesis primer design | A TAB ("Mutagenesis") inside the Add Primer dialog | 3 clicks (menu -> Add Primer -> Mutagenesis tab) | hidden | This is the single worst discoverability gap. Site-directed mutagenesis is a top-tier cloning task and it is a sub-mode of "Add primer". Nobody looking for "make a point mutation" will open Primer -> Add Primer -> Mutagenesis. `sdm-empty`, `sdm-designed`. |
| Primer specificity / off-target check | Primers TAB (bottom tab bar) -> "Check" sub-tab -> paste primer -> "Check specificity" | 3-4 clicks | hidden | Excellent 3-tier output (on-target / local library / NCBI Primer-BLAST), but it lives in a sub-tab of a sub-view. The Primer toolbar menu does not point to it at all. `specificity-trustchecks`, `specificity-result`. |
| Edit / Duplicate / Remove Primer | Primer menu (gated on a selected primer) | 2 clicks + prior selection | buried | The primer must first be selected in the Primers tab; the Primer menu items stay disabled otherwise. `menu-primer`. |
| Restriction cut sites toggle | Enzyme menu -> "Cut sites" | 2 clicks | obvious | Also mirrored as a rail layer. `menu-enzyme`. |
| Choose enzymes | Enzyme menu -> "Choose enzymes... (12)" | 2 clicks | obvious | Opens the full picker. `enzyme-picker`. |
| Find (DNA / Name / Protein) | Cmd+F, or Edit menu -> "Find..." | 1 keypress | obvious | Mode pills are inline and clear; close-match fallback is automatic. `find-dna`, `find-name`, `find-protein`, `find-closematch-hit`. |
| Export (GenBank / FASTA / map image / send to note) | Export menu | 2 clicks | obvious | Well grouped, file-type badges on each row. `menu-export`. |
| Edit Feature dialog (segment / exon diagram) | Features tab row -> inline pencil icon, or Feature menu -> Edit Feature | 2 clicks | buried | Inline row icons have no aria-label and only a hover tooltip, so the edit affordance is easy to miss. `feature-editor`, `feature-editor-segments`. |
| Edit Primer dialog | Primer menu -> Edit Primer (after selecting in the Primers list) | 2 clicks + selection | buried | The primer LIST row has NO inline edit icon (unlike feature rows), so the only path is select-then-menu. Inconsistent with features. `primer-editor`. |
| Linear map ruler / navigator / jog wheel | Map tab, then rail "Show as linear" for a circular molecule | 2 clicks | obvious-ish | The measuring-tape ruler, the "Scroll" jog wheel (top-right), and the bottom whole-molecule navigator are all present and behave well. `map-linear`, `map-linear-zoomed`, `map-ruler-jog`. |

What a new user would NOT find on their own: site-directed mutagenesis (buried as a dialog tab), the specificity checker (a sub-tab three levels down), the feature-type visibility toggles (unlabeled rows in the Feature menu), and the two analysis engines (Detect features / Annotate from reference) hiding in the Feature menu.

---

## 2. Visual issues

Severity key: high = looks broken / blocks reading, med = noticeably off, low = polish.

- **Linear map dead space (med).** `map-linear`, `map-linear-zoomed`. In linear Map view the strand + feature track pin to the top and the bottom navigator pins to the bottom, leaving roughly 50-60% of the canvas empty in the middle. It reads as an unfinished layout. Either center the content band or pull the navigator up under it.
- **Duplicated "Whole molecule (4,733 bp)" label (med).** `map-bottom-navigator`. Two near-identical "Whole molecule (4,733 bp)" lines stack at the bottom: the navigator caption (faint) and a crosshair "fit/reset" button below it. Reads as a rendering duplicate. Collapse to one.
- **Dotplot is cramped (low/med).** `compare-alignment`. The dotplot is squeezed into a small top-right box while the alignment text dominates. For the headline visual of a Compare result it deserves more room, or a toggle to enlarge.
- **Compare result count vs button mismatch (low).** `annotate-reference-result`. The Annotate-from-reference footer says "10 of 12 mappable features selected" while the action button says "Add 12 features". The button label should track the selected count (it appears to count all rows, including the two "not found" rows that are unchecked and disabled).
- **Enzyme picker is the densest surface in the editor (low).** `enzyme-picker`. Three columns (filters / enzyme list / live digest) packed into one modal. It is well organized and nothing overflows, but it is a sharp tonal break from the calm minimalism of every other dialog. Flagged for awareness, not a bug.
- **"Map view" badge looks like a label, not a control (low).** `map-ruler-jog`. The "Map view" pill sits between the tag icon and the zoom slider. It is styled like an interactive pill but reads as a static mode caption; its role is ambiguous next to the live zoom controls.
- **Feature row action icons have no aria-label (low, a11y).** Confirmed in `FeaturesPanel.tsx` (the eye / edit / duplicate / delete buttons rely only on a hover Tooltip). Screen-reader and keyboard discoverability suffer. NOTE only, not fixed.
- **Detect / Annotate dialogs ignore Escape (low).** Observed while driving: pressing Escape did not dismiss the Detect-features and Annotate dialogs; only Cancel / the X close them. Minor, but inconsistent with a typical modal.

No broken layouts, no overflow, no contrast failures, no wrong-token text sizes were observed. The dialogs share a consistent header / body / footer pattern and the type scale looks uniform across surfaces.

---

## 3. Naming / consistency

- **"Feature" menu is overloaded.** It mixes CRUD (Add/Edit/Duplicate/Remove), two analysis engines (Detect / Annotate), and a layer-visibility list (cds/gene/source). Three different kinds of action under one verb.
- **"Detect common features..." vs "Annotate from Reference..." capitalization.** "Reference" is title-cased; "common features" is not. Pick one (sentence case fits the rest of the app).
- **Primer Edit path asymmetry.** Feature rows expose inline edit/dup/delete icons; primer rows do not. Same conceptual object, two different interaction models.
- **SDM is called "Mutagenesis"** inside the dialog but is never named at the menu level, so the term never appears where a user would look for it.
- **Specificity is named three ways.** The sub-tab is "Check", the button is "Check specificity", and the result panel header is "Local-library specificity". The "Check" tab label alone does not say what it checks.
- **Two "Compare"-adjacent verbs in the library header** (Assemble, Compare) read consistently; no issue there.
- **Map view badge wording.** "Map view" duplicates the bottom "Map" tab name, so the same words label both a tab and an in-canvas pill.

---

## 4. Proposed reorganization

Goal: make the analysis / annotation actions findable without adding chrome. The
app's ethos is calm and minimal, so this proposes consolidation, not more menus.
Net menu count stays the same (five) because we retire nothing structural, we
just move three items and relabel two.

### Recommended toolbar menu structure

- **Edit** — leave exactly as is. Clipboard, selection, Find, Go To. Coherent today.
- **Feature** — shrink to true feature CRUD only: Add / Edit / Duplicate / Remove. Move the type-visibility list OUT (see Map/rail below). Move Detect + Annotate OUT (see Analyze).
- **Primer** — keep Add / Edit / Duplicate / Remove Primer, and ADD two pointers: "Site-directed mutagenesis..." (opens the Add Primer dialog pre-switched to the Mutagenesis tab) and "Check specificity..." (jumps to the Primers > Check view). These are primer actions; they belong in the Primer menu, not buried.
- **Analyze** (new, or rename if you prefer "Tools") — the home for cross-cutting analysis: "Detect common features...", "Annotate from reference...", and "Compare / align sequences..." (the same dialog the library-header Compare opens, so it is reachable from inside the editor too). One calm menu that answers "what can ResearchOS tell me about this molecule".
- **Export** — leave as is.

Rationale: today "annotation intelligence" is scattered across the Feature menu
(Detect, Annotate), the library header (Compare), a dialog tab (SDM), and a
sub-tab (specificity). Pulling the molecule-level analysis verbs under one
"Analyze" menu gives a single obvious answer, and surfacing SDM + specificity as
named Primer-menu items fixes the two worst hidden features without inventing new
surfaces. Compare stays in the library header too (it is genuinely a
library-level, pick-two operation); the Analyze entry is an additional door, not
a move.

### What to LEAVE where it is

- **Compare in the library header** — correct home for a two-sequence pick. Just add a second door from the editor's Analyze menu.
- **Find as Cmd+F / Edit menu** — already obvious; do not move.
- **Enzyme menu (Cut sites + Choose enzymes)** — fine; enzymes are a map layer and a focused two-item menu reads cleanly.
- **The Primers tab (List / Design / Check)** — keep the tab; just add the menu pointer to Check so it is not the only door.
- **Feature-type visibility** — do NOT keep it in the Feature menu. It is a map-layer concern; relocate it to the left ViewControlRail (where the Features/Translation/Primers layer toggles already live) under a labeled "Feature types" group, or to a labeled subsection if it must stay in a menu. Either way it needs a header so the bare "cds / gene / source" rows stop looking like commands.

### Minimal copy fixes (independent of the reorg)

- Relabel the Primers "Check" sub-tab to "Specificity" (or "Check primer").
- Sentence-case "Annotate from reference...".
- Make the Annotate footer button read the selected count ("Add 10 features").
- De-duplicate the linear-map "Whole molecule" label.

---

## 5. Screenshots

All in `/Users/gnickles/Desktop/ux-audit/`:

- Overview: `01-sequences-overview.png`
- Toolbar menus: `menu-edit.png`, `menu-feature.png`, `menu-primer.png`, `menu-enzyme.png`, `menu-export.png`
- Compare / align: `compare-alignment.png`
- Detect features: `detect-features.png`, `detect-features-scrolled.png`
- Annotate from reference: `annotate-reference.png`, `annotate-reference-result.png`
- SDM: `sdm-empty.png`, `sdm-designed.png`
- Specificity: `specificity-trustchecks.png`, `specificity-result.png`
- Find modes: `find-dna.png`, `find-name.png`, `find-protein.png`, `find-closematch-hit.png`, `find-closematch-zoom.png`
- Enzyme picker: `enzyme-picker.png`
- Feature editor + exon diagram: `feature-editor.png`, `feature-editor-segments.png`, `features-tab.png`
- Primer editor + list: `primer-editor.png`, `primers-tab.png`, `primers-list-populated.png`
- Linear map: `map-circular.png`, `map-linear.png`, `map-linear-zoomed.png`, `map-ruler-jog.png`, `map-bottom-navigator.png`

---

Signed: UX audit bot
