# Cloning + protein-properties UX coherence sweep

UX/copy coherence audit across the cloning workspace (now four methods, each
added by a different bot) and the two protein-properties doors. Headless audit
(port 3000 was busy, so no live browser pass), driven by reading the components
plus `tsc --noEmit` (0 errors) and `vitest run src/components/sequences
src/lib/sequences` (47 files, 753 tests, all pass after the changes).

Scope rule for this sweep: fix the clear, mechanical, behavior-neutral issues in
place using the existing component patterns; defer every genuine design or
direction decision to this doc for the lead's morning review. No cloning/engine
behavior was touched; edits are UI/copy only.

Files touched:
- `frontend/src/components/sequences/CloningWorkspace.tsx`
- `frontend/src/app/sequences/page.tsx` (Assemble button tooltip + comment)

---

## FIXED (mechanical, behavior-neutral, already applied)

| # | Issue | Where | Fix |
| --- | --- | --- | --- |
| F1 | Celsius rendered as a bare `C` in the cloning workspace, while the rest of the sequence UI (PrimerEditorDialog, PrimerDialog, SequencePrimersPanel, SequenceSelectionReadout) uses `°C`. The cloning surface was the lone outlier, so primer Tm readouts looked different depending on which dialog you opened. | CloningWorkspace: the overlap Tm input unit, the junction Tm line, the oligo-list footnote (`~50 C`), and the PrimerCell anneal readout. 4 occurrences. | Bare `C` -> `°C` in all 4 spots. Display only; the `"—"` empty-value placeholder convention was left alone (it is app-wide, 16 files). |
| F2 | The warning panel header read "Assembly warnings" in the overlap review step but "Notes" in both the Gateway and cut-ligate steps. Same amber warning-list component, three methods, two different labels. | CloningWorkspace overlap review step (warning list header). | Unified the overlap header to "Notes" so all three result panels label the same component identically (minority conforms to the existing 2-of-3 majority; not a new wording invention). Updated the adjacent code comment to match. |
| F3 | The library "Assemble" button tooltip claimed only "Gibson / NEBuilder HiFi overlap assembly", but the workspace now offers four chemistries. A user hovering the entry point was told the tool does less than it does. | `app/sequences/page.tsx` Assemble button Tooltip (and the stale code comment above it). | Tooltip now reads "Assemble a new construct from fragments (Gibson overlap, restriction, Golden Gate, or Gateway)." Comment updated to match. |
| F4 | Stale file-level doc comments from the incremental build: the top-of-file comment still described CloningWorkspace as "the STANDALONE overlap-assembly workspace (Gibson / NEBuilder HiFi)" and named only `cloning.ts` as the engine; the method-tabs inline comment listed only three of the four methods. | CloningWorkspace header comment + method-tabs comment. | Rewrote the header comment to describe the four-method workspace and all three engine libs; added `gateway` to the method-tabs comment. Comments only, no behavior. |

Copy-rule scan result (no violations found in the three audited UI files):
no emoji, no prose em-dashes (the `—` glyphs present are the app-wide
empty-value placeholder, not prose), no mid-sentence colons in copy (the `:`
occurrences are line-start label-terminators like `overlap:` / `junctions:` or
`className=`), no native `title=` (all icon-only controls already use the
`<Tooltip>` component), and the type tokens are already semantic
(`text-meta` / `text-body` / `text-title`) with no arbitrary `text-[Npx]`.

The two protein-properties doors (Lab calculators `ProteinTab` and the editor
`ProteinPropertiesDialog`) already render the shared `ProteinPropertiesView`,
share the `NonStandardNotice`, and use consistent tokens and copy. No drift to
fix there; they are the model the cloning methods should aspire to.

---

## FOR-LEAD-REVIEW (genuine design / direction calls, NOT implemented)

Each item has a crisp recommendation so it can be decided quickly.

### L1 - The four methods read as four bolted-on panels, not one tool (result-step structure)
The pick step is well unified (shared fragment list, shared library rail, shared
review button). The *review* steps diverge structurally because three bots built
them independently:
- Overlap uses a styled `PreviewBox` component for the product (header row with
  bp + %GC, framed) plus a junction list and an oligo-order table.
- Cut-ligate uses a raw inline `<pre>` for each product, a radio-select list, and
  a "Digested pieces" table.
- Gateway uses a per-product card with its own inline `<pre>`, an att-site grid,
  and a per-card Save button.

So the same concept (the assembled product preview) is drawn three different
ways. **Recommendation:** extract one shared `ProductPreview` block (the
`PreviewBox` header pattern is the best of the three) and have all three review
steps use it for the product readout. This is a moderate refactor with real
visual payoff; it is behavior-neutral but big enough to want the lead's nod
first. Low risk, high coherence return.

### L2 - The Save action model is inconsistent across methods
- Overlap and cut-ligate have a single bottom Save button ("Save construct" /
  "Save product") in a shared footer row with the Back button and error text.
- Gateway has no shared footer Save; instead each product card carries its own
  "Save clone" / "Save byproduct" button, and the footer holds only Back.

The verbs also differ: "Save construct" vs "Save product" vs "Save clone" /
"Save byproduct". The Gateway per-card model is *intentional* (it lets you save
the byproduct separately), so this is not purely mechanical. **Recommendation:**
keep Gateway's per-product save (it is correct for that chemistry) but align the
footer so every method shows the same Back-plus-error footer affordance, and
standardize the primary verb to "Save <noun>" where the noun is the product type
(construct / product / clone). Decide whether cut-ligate's multiple products
should also become per-card saves for symmetry, or stay single-select. This is a
direction call about the save UX, not a mechanical fix.

### L3 - Method-selector label length and the "tabs" framing
The selector renders the full `METHOD_LABEL` strings as pill tabs: "Overlap
(Gibson / NEBuilder)", "Restriction + ligation", "Golden Gate (Type IIS)",
"Gateway (BP / LR)". On a narrow window these four long pills can crowd the row,
and parenthetical chemistry hints inside a tab label are unusual. **Recommendation:**
either shorten the tab labels to the method name (Overlap / Restriction / Golden
Gate / Gateway) and surface the chemistry hint in the header subtitle that
already changes per method, or group them (see L4). This is a naming/IA call the
lead should bless rather than a sweep bot renaming methods unilaterally.

### L4 - Should the four methods be grouped / categorized?
Overlap and Gateway are sequence-homology / recombination methods; restriction +
ligation and Golden Gate are enzyme-cut methods. They currently sit as a flat
four-pill row. **Recommendation:** leave flat for now (four is still scannable),
but if a fifth method lands, group into "Overlap & recombination" vs
"Enzyme-based" so the row does not become an undifferentiated wall of pills. Flagged
so the lead can decide the grouping convention before the next method is added.
Pure IA/direction; not implemented.

### L5 - Gateway and cut-ligate empty states are terser than overlap
When a method produces no product, overlap shows "Add at least two fragments to
assemble."; cut-ligate shows "No assembled product from these fragments and
enzyme(s)." plus a warning list; Gateway shows "No recombination product from
these substrates." plus a warning list. The tone is consistent enough, but the
overlap empty state does not echo the engine warnings the way the other two do.
**Recommendation:** minor, optional. If unifying, have the overlap empty state
also surface `result?.warnings` like the others. Left for the lead because it
nudges what the overlap engine surfaces, and the sweep brief said stay off
engine behavior.

### L6 - Discoverability: the workspace is reached only from the library "Assemble" button
The cloning workspace is a full-surface overlay reachable from one place (the
`/sequences` library header "Assemble" button). It is not in the editor's Analyze
menu the way protein properties is, and not a top-nav item. That is a reasonable
deliberate choice (it is a multi-molecule, library-level operation), and the
tooltip is now accurate (F3). **Recommendation:** keep the single entry point;
no change. Flagged only so the lead can confirm the intent rather than have a
later bot "fix" the missing editor entry. No action needed unless the lead wants
a second door.

---

## Verification

- `tsc --noEmit` from `frontend/`: 0 errors.
- `vitest run src/components/sequences src/lib/sequences` from `frontend/`: 47
  files, 753 tests, all pass. No test asserted the copy that was changed, so no
  test edits were needed.
- Live browser pass: NOT run. Port 3000 was busy (Grant's dev server), and the
  brief said headless-only in that case. The fixes are display-string and
  comment edits with full tsc + test coverage; they are low risk to render.

Signed off, cloning ux sweep bot.
