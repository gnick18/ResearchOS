# Onboarding — per-surface DEEP demo scripts

**Date:** 2026-06-14
**Lane:** BeakerAI · companion to `docs/proposals/2026-06-14-llm-onboarding-tutor.md`
**Status:** DRAFT for Grant markup. Builder-facing choreography for each on-page DEEP demo.

This is the script layer under the locked design. The onboarding is a **presentation**: Beaker navigates to each real surface and works it with a **presenter cursor he controls**, using the existing move/morph animation to reveal results in the main screen. The chat panel appears ONLY for the one AI demo. Everything here runs against the **ephemeral demo layer** (`seed-ephemeral.ts`) — nothing is written to the user's folder.

---

## Shared rules (every DEEP demo obeys these)

1. **Five phases, always in this order:** `ARRIVE → SEED → ACT → REVEAL → HANDOFF`.
   - **ARRIVE** — Beaker navigates to the surface (real route). A nav-morph (existing page transition) carries the user in; the surface mounts with the field-personalized ephemeral data already present.
   - **SEED** — the relevant ephemeral object is on screen (table/sequence/tree/etc.), badged `● SAMPLE DATA · nothing saved`.
   - **ACT** — the presenter cursor moves to a real control and clicks it (a `clickring` pulse marks the click). Beaker NEVER fakes a button; he uses the real one via `guide_to_element` resolution.
   - **REVEAL** — the result animates in via the existing morph (card scales/flies to its placed position, panel appears, etc.).
   - **HANDOFF** — a one-line coach bubble names the takeaway as a *capability that exists*, then auto-advances (user can pause/replay/skip at any time).
2. **Narration = floating coach bubble** anchored on the page, mini-Beaker + one short line. NOT the chat panel. House voice: calm, no em-dashes, no emojis, no mid-sentence colons. Each line states a capability ("You can do X here"), never interprets data or claims a result is good/bad.
3. **Presenter cursor** is a distinct visual (dark arrow, white outline, soft shadow) that the user clearly reads as "Beaker's hand, not mine." It moves with easing, pauses before each click.
4. **Timing** ~30–45s per DEEP demo. Hard budget: if the token cap is near, the director converts the remaining DEEP demos to montage cards (never cuts memory/recap).
5. **Skip / pause / replay** are always live (no soft-lock). Skipping a demo jumps to the next director beat.
6. **Field personalization** — the seed object matches the user's stated field (see the seed table at the bottom). The choreography is identical across fields; only the sample data changes.

---

## DEEP demo scripts (one per surface)

### 1. Data Hub — "a table becomes a publication plot"
- **Route:** `/datahub` · **Page-driven** (no chat)
- **SEED:** an ephemeral `resistance_assay`-style table (field-personalized), open as a card.
- **ACT:** cursor → the table's **Plot** control → click.
- **REVEAL:** the table card **morphs** (scales + flies) into a grouped-bar publication plot in the canvas; axis labels settle in.
- **HANDOFF:** *"Click once and a table becomes a figure you could drop straight into a paper. Your own data works the same way."* Optional micro-beat: cursor brushes the **Analysis** chip, a stats summary slides up, *"There's a real stats engine back here too, for when you need it."*
- **Awareness:** data lives in Data Hub; one-click figures; validated stats engine.

### 2. Phylo / Tree Studio — "style and export a real tree figure"
- **Route:** `/phylo` · **Page-driven**
- **SEED:** an ephemeral 8-tip tree already open in the Studio.
- **ACT:** cursor → **Shape** tab → toggles a layout; → **Layers**, recolors a clade; → **Export**.
- **REVEAL:** each control's effect animates on the tree (layout morph, clade tint), then the Export panel shows a publication page-frame with the tree placed in real units.
- **HANDOFF:** *"You can shape a tree and export it at the exact size your figure needs."*
- **Awareness:** Tree Studio styling + publication-grade export. (Overlaying *data* on the tree is the AI demo below, not here.)

### 3. Methods — "take a protocol to the bench on your phone"
- **Route:** `/methods` · **Page-driven**
- **SEED:** an ephemeral method with a few steps + a checklist.
- **ACT:** cursor opens the method → clicks **View on phone**.
- **REVEAL:** a phone frame slides in from the edge showing the step reader (the real mobile projection), one step highlighted.
- **HANDOFF:** *"Once a protocol's written, you can follow it on your phone at the bench, one step at a time."*
- **Awareness:** method library + phone projection + checklists.

### 4. Sequences — "annotate a sequence and read its Tm"
- **Route:** `/sequences` · **Page-driven**
- **SEED:** an ephemeral sequence (field-personalized: a gene/primer/protein).
- **ACT:** cursor selects a region → clicks **Annotate**; then hovers a primer.
- **REVEAL:** an annotation track morphs in over the selection; a Tm chip pops on the primer.
- **HANDOFF:** *"You can annotate a sequence and check a primer's Tm right where you're working."*
- **Awareness:** sequence import/annotate/primer/Tm tools.

### 5. Chemistry — "paste a structure and it draws itself"
- **Route:** `/chemistry` · **Page-driven**
- **SEED:** an ephemeral SMILES string in the input (field-personalized molecule).
- **ACT:** cursor → **Render** (or paste affordance).
- **REVEAL:** the SMILES morphs into a drawn 2D structure; a molecular-weight chip settles below.
- **HANDOFF:** *"Paste a structure and it draws itself, ready for reactions and stoichiometry."*
- **Awareness:** chemistry structures + reactions.

### 6. Inventory / Supplies — "reorder low stock in one move"
- **Route:** `/supplies` · **Page-driven**
- **SEED:** an ephemeral inventory list with one low-stock item flagged.
- **ACT:** cursor → the low-stock item's **Reorder** → it drops into a cart.
- **REVEAL:** the item animates into a cart chip; a "scan a barcode" affordance pulses.
- **HANDOFF:** *"When something runs low, you can reorder it in a click and scan the barcode when it lands."*
- **Awareness:** inventory + reorder + barcode scan.

### 7. People / Lab — "see your lab at a glance" (PI-only)
- **Route:** `/people` · **Page-driven** · **Role-gated to PI/lab-head** (never shown to students)
- **SEED:** an ephemeral 3-member roster with workload bars.
- **ACT:** cursor opens a member card → reveals their workload + IDP.
- **REVEAL:** the roster morphs to the member detail; workload bars fill in.
- **HANDOFF:** *"This is where you keep an eye on the lab, who's working on what, and how everyone's growing."*
- **Awareness:** lab/people management (PI surface).

---

## The ONE AI demo (chat panel appears here, and only here)

The director picks the variant by the user's top interest. Same ephemeral data, same spotlight; the difference is the **chat panel is shown because the feature IS the AI**.

- **Picked trees → "overlay your data on a tree."** On `/phylo`, the chat opens; user prompt (auto-typed by the presentation) `What can I overlay on this tree?`; `suggest_tree_overlays` narrates "joins 7 of 8 tips" and the inline wizard paints MIC on the tips. HANDOFF: *"Just ask, and I'll put your data right onto the tree."*
- **Picked analysis → "ask Beaker to plan an analysis."** On `/datahub`, chat opens; prompt `Plan an analysis of this data`; the planner proposes steps. HANDOFF: *"Tell me the question and I'll lay out the analysis."*
- **Default → "make a table from this."** Chat opens; prompt `Make a table from this`; `create_datahub_table` previews the detected columns. HANDOFF: *"Paste anything and I'll turn it into a table you can use."*

The AI demo doubles as the introduction to BeakerBot itself, so the user learns the assistant exists and can *act*, not just chat.

---

## Montage flash-card spec (un-picked surfaces)

Each un-picked surface gets one card, auto-played ~3s, no cursor:
- **Layout:** surface icon + title + one factual line + a tiny static visual (a mini plot, a structure glyph, etc.).
- **Lines (factual, awareness-only):** Sequences = "Import, annotate, find primers, Tm." · Chemistry = "Structures, reactions, stoichiometry." · Inventory = "Stock, reorder, barcode scan." · People = "Roster, workload, IDPs." · Data Hub (if un-picked) = "Tables, one-click figures, validated stats." · Methods = "Protocols, checklists, phone projection." · Phylo = "Build, style, and export trees."
- **Behavior:** the montage is the first thing the token cap sheds. "Replay any section" in the Help menu re-runs any card as a full DEEP demo on demand.

---

## Field-personalization seed table (identical choreography, different sample data)

| Field | Data Hub table | Sequence | Tree | Molecule |
|---|---|---|---|---|
| Microbiology / AMR | MIC by strain (resistance_assay) | a resistance gene | *Candida*/bacterial isolates | an antifungal/antibiotic |
| Molecular biology | expression by condition | a cloned insert + primers | gene-family tree | a substrate |
| Ecology / evolution | trait by population | a marker gene (COI/16S) | species phylogeny | n/a (montage chem) |
| Biochemistry | activity by variant | a protein sequence | ortholog tree | a cofactor/ligand |
| Generic / unsure | a simple measured table | a short DNA sequence | a small example tree | caffeine |

The director chooses a row from the role/interest answers; if unsure, use the generic row. All seeds live only in the ephemeral layer.

---

## Open for Grant
- Per-surface narration wording (the coach lines above are first drafts).
- Whether the Data Hub micro-beat (stats chip) is in or cut for time.
- The exact field taxonomy for the seed table (5 rows shown; add/merge?).
- Cursor speed/easing feel (will tune live against the real morph).
