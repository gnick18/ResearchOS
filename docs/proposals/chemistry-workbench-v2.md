# Chemistry Workbench v2: phased roadmap

Status: proposal, not started
Author: HR / chemistry workbench
Date: 2026-06-11

## Context

Chemistry v1 shipped and is live in production (flag `NEXT_PUBLIC_CHEMISTRY_ENABLED`, non-sensitive, on). v1 is a client-side cheminformatics surface with no backend: a molecule library (`.mol` source of truth plus `.meta.json` sidecar per molecule), a Ketcher structure editor, RDKit-in-browser identity (formula, MW, canonical SMILES, InChIKey), PubChem import, a free SciFinder-style literature and patent companion (PubChem xrefs, Europe PMC, SureChEMBL), file import, a project Molecules section, and molecule object-references that deep-link from notes.

This doc sequences the agreed v2 wishlist into phases ordered so that implementation stays clean and regressions to the shared lab surfaces (notes, methods, experiments, results) are minimized. The wishlist, all of which we want to reach:

1. Inline molecule picker in the note / method / experiment editors (no copy-paste)
2. Reagents and products on experiments, and structures as result figures
3. Backlinks (where is this molecule used)
4. Molecule to inventory-reagent link
5. Computed properties (logP, TPSA, Lipinski, H-bond donors/acceptors)
6. Structure search of your own library (substructure and similarity)
7. Reactions and a stoichiometry calculator
8. Robustness parity: molecule trash, structure version history, bulk-select

## Design principles

- **Local-first and additive.** Every new field is an optional addition to an existing record or a new sidecar file. Old data normalizes on read. No required-field migrations.
- **Reuse the systems we already have.** Trash, file-backed delta history, the object-reference and ObjectChip pipeline, the method-attachment pattern, the project-doorway pattern, the bulk-select pattern, and the per-user `_schema_migrations.json` marker all exist and are battle-tested. We mirror them rather than invent.
- **One flag, gated phases.** Everything sits behind `CHEMISTRY_ENABLED`. Higher-risk sub-features get their own nested flag so a half-built phase can land on main inert.
- **Order by blast radius.** Build the work that touches only chemistry first (near-zero regression surface), then the shared markdown editor (additive), and touch the core experiment record last and most carefully.
- **Verify the way we verify redesigns.** UI-heavy phases get an interactive before/after mockup for review before build, and intricate phases get the 3-verifier loop (mechanics, spec-compliance, fresh-eyes) after build.

## Why this order minimizes regressions

The recurring risk is the **core experiment (Task) record**. Its read path runs `normalizeTaskRecord` (backfill plus orphan-filter), its write path enforces the method-attachment invariant, and it flows through export/import canonicalization, version history, and cross-owner sharing. Anything that adds a field there has a wide blast radius. So we keep that for late, after the patterns are proven on safe ground.

Blast-radius tiers, lowest to highest:

- **Tier A (chemistry-only):** trash, version history, computed properties, bulk-select, library structure search. Touch only `lib/chemistry/*` and the hub. Cannot regress notes/methods/experiments.
- **Tier B (shared markdown editor, additive):** the reference-insertion picker and backlinks. Touch the shared editor and a read-only reverse scan. They add an affordance and a panel; they do not change any record shape.
- **Tier C (core records):** experiment reagents/products on the Task record, then results-figure export and the inventory link. These touch `Task`, results image paths, and `InventoryItem`.
- **Tier D (new subsystem):** reactions and stoichiometry. Largest new surface, built last on a mature foundation.

The phases below follow A, B, C, D.

---

## Phase 1: Chemistry-only foundation (Tier A)

Goal: bring the workbench to parity with sequences on robustness, and surface the chemistry we already compute. Zero shared-surface risk.

### 1a. Molecule trash (parity with notes and sequences)

Today `moleculesApi.remove` hard-deletes both files with no recovery (the v1 audit flagged this; notes and sequences get a 30-day trash).

- Mirror the sequence delete path. Sequences are already the "special two-file case" in the trash system, which is exactly the molecule shape (`.mol` plus `.meta.json`).
- Add `"molecule"` to `TrashEntityType` (`lib/trash/trash-types.ts`).
- Route `moleculesApi.remove` through `trashEntity({ owner, entityType: "molecule", id, deletedBy, sessionId })`; expose restore through the existing `restoreEntity` and the shared Undo toast.
- Data shape: a new `_trash/molecule/` folder and index entries. Additive, no existing record changes.
- Regression risk: very low (new entity type in an existing system). Verify: delete, restore, 30-day cleanup pass, two-file integrity.

### 1b. Structure version history (file-backed, like sequences)

- Use the file-backed delta engine (the sequences model, `lib/history/engine.ts`), not Loro. Molecules are file pairs with explicit Save and no real-time collaboration, identical to sequences.
- New `lib/chemistry/molecule-history.ts` mirroring `sequences-history.ts`. Define `MoleculeTrackedState = { name, formula, mol_weight, smiles, inchikey, molfile-canonical }`. Append a delta row after each `moleculesApi.create`/`update` that writes a molfile.
- Surface a History tab in `MoleculeEditorPopup` (the editor already has an Identity tab and a Papers tab) with diff and restore, reusing the sequence history panel pattern.
- Data shape: new `_history/molecules/{id}.jsonl`. Additive. Behind the existing `HISTORY_ENGINE_ENABLED`.
- Regression risk: very low. Verify: save creates a checkpoint, restore round-trips, compaction at threshold.

### 1c. Computed properties (cheap RDKit win)

- RDKit's `get_descriptors()` already returns more than we read. The editor identity already shows exact mass, heavy atoms, rings, rotatable bonds. Extend `MoleculeIdentity` (`lib/chemistry/rdkit.ts`) to also capture logP, TPSA, H-bond donors, H-bond acceptors, aromatic rings, and a Lipinski Rule-of-Five pass/fail.
- Surface them in `MoleculeDetail` and the editor identity rail, with a calm Lipinski badge.
- Data shape: extend `MoleculeIdentity` (compute layer) and optionally fold a few into `MoleculeMeta` if we want them searchable later (decide in Phase 2). Pure compute, no on-disk change required for display.
- Regression risk: near zero (additive read of existing wasm output). Verify: known compounds against reference values in a unit test (aspirin, caffeine, resveratrol).

### 1d. Bulk-select in the library

- Copy the sequences `checkedIds: Set<number>` pattern (tri-state header, prune-on-data-change, action bar, shared Undo toast). Molecule ids are strings, so `Set<string>`.
- Actions: bulk delete (through 1a trash), bulk link-to-project.
- Regression risk: low (hub-local state). Verify: select-all-visible, filter does not clear selection, bulk delete routes through trash.

Phase 1 ships entirely behind `CHEMISTRY_ENABLED` and touches no shared record.

---

## Phase 2: Library intelligence (Tier A)

Goal: make the library searchable by structure, not just by name. Still chemistry-only.

- **Substructure and similarity search of your own molecules.** RDKit MinimalLib already supports Morgan fingerprints, Tanimoto similarity, and `has_substructure_match`; none are used yet. Add `lib/chemistry/fingerprints.ts`.
- Extend the hub search box: a "search by structure" mode that takes a drawn fragment or a SMILES/SMARTS and ranks the library by Tanimoto or filters by substructure. This is the local complement to the existing SureChEMBL patent search.
- Optional: a duplicate-on-import warning (fingerprint the incoming structure against the library before save).
- Data shape: an optional fingerprint cache sidecar (`_index/molecule-fingerprints.json`) for large libraries, rebuildable from the molfiles, so it is never a source of truth. Additive.
- Regression risk: low. Verify: a substructure query returns the expected subset; similarity ranking is stable; cache rebuild matches a cold compute.

---

## Phase 3: The insertion seam and backlinks (Tier B)

Goal: kill the copy-paste. This is the integration the wishlist centers on, done without touching any record shape.

### 3a. Reference-insertion picker in the markdown editor

The wire format already exists: an object reference is a markdown link `[name](/chemistry?molecule=14)` that `RenderedMarkdown` upgrades to an `ObjectChip`. Notes, methods, and experiments all render through the same pipeline, so a reference pasted into any of them already becomes a chip. The only missing piece is insertion UI; today the sole path is the chemistry-side "Copy reference for a note" plus a manual paste.

- Add an insert affordance to `LiveMarkdownEditor` / `InlineMarkdownEditor` (CM6): a slash-command ("/ref" or "/molecule") and a toolbar button, mirroring the existing code-block insertion hook (`onRequestCodeBlock` / `insertRef`).
- It opens a searchable picker across molecules (and, for free, sequences and methods, since they share the ref system) and inserts the markdown link at the cursor.
- Because methods and experiments use the same editor and the same render pipeline, this lights up molecule insertion in all three surfaces at once.
- Data shape: none. This is purely an editor affordance over the existing reference format.
- Regression risk: medium only because the editor is shared by every note/method/experiment. Mitigation: the change is purely additive (a new command and button), no change to parsing, rendering, or storage. Mockup for review first, then the 3-verifier loop on the editor.

### 3b. Backlinks (where is this molecule used)

- No reverse index exists today. Add a "Used in" panel to `MoleculeDetail` that scans note/experiment/method markdown bodies for `/chemistry?molecule=<id>` and lists the references.
- Start with an on-demand scan (cheap for typical libraries). If it gets slow, add a rebuildable reverse-index sidecar later (same pattern as the fingerprint cache).
- Data shape: optional sidecar later; none required for v1 of the feature.
- Regression risk: low (read-only). Verify: a molecule referenced in two notes shows both; a deleted reference drops off.

---

## Phase 4: Experiment reagents and products (Tier C, highest care)

Goal: make a molecule a first-class part of an experiment, the way a method already is. This is the deepest lab integration and the highest-risk phase, so it comes after the patterns are proven.

- Mirror `method_attachments` exactly. Add an optional `molecule_attachments?: Array<{ molecule_id: string; owner: string | null; role: "reagent" | "product" | null; quantity?: string | null; notes?: string | null }>` to the `Task` record (parallel to `method_attachments`, ids are per-user strings so `owner` disambiguates cross-owner molecules, identical to method attachments).
- Reuse the full method-attachment machinery: the `normalizeTaskRecord` backfill (add `molecule_attachments: []` for old tasks), the read-time orphan filter and write-time invariant prune, and `addMolecule`/`removeMolecule` helpers mirroring `addMethod`/`removeMethod`.
- Surface: a Reagents/Products section in the experiment (Task) detail, and a project "Reagents" doorway in `ProjectDetailPopup` following the exact doorway recipe (extend `InnerView`, compute `glance.hasMoleculeAttachments`, add the show flag, the Doorway button, and the view branch). Gate the doorway on `CHEMISTRY_ENABLED`, as the Molecules doorway already is.

This phase touches the core record, so it carries the explicit checklist:

- **FLAG (data-shape):** new optional array on `Task`. Pre-flag before any commit.
- **Touch points to update in lockstep:** `normalizeTaskRecord` backfill, `tasksApi.update` invariant prune, `tasksApi.create` input type, export/import canonicalization (register the new field, additive), the history/diff canonicalizer, and cross-owner sharing routing.
- **Migration:** none required (optional array, backfilled on read), but record a `_schema_migrations.json` marker id if we choose to backfill on disk.
- **Verification:** the 3-verifier loop plus targeted tests on `normalizeTaskRecord` (old task with no field, task with orphan attachment), the update invariant, an export/import round-trip, a history diff with the new field, and a shared-project read.

Nested flag (for example `CHEMISTRY_EXPERIMENT_LINKS`) so the Task-record change can land inert before the UI is finished.

---

## Phase 5: Result figures and the inventory link (Tier C)

Goal: close the loop into results and supplies.

### 5a. Structure as a result figure

- `MoleculeThumbnail` already renders a self-contained RDKit SVG. Add "Add structure to results" that writes a PNG/SVG into the experiment's results images folder (`users/{owner}/results/task-{id}/results/Images/`) with an auto `{filename}.json` sidecar, landing it in the existing `ResultsGallery` (annotations come for free via the `.annot.json` layer).
- Data shape: a normal results image plus sidecar. Additive, uses the existing image path and gallery.
- Regression risk: low to medium (writes into the results tree). Verify: the figure appears in the gallery, carries its caption sidecar, and is annotatable.

### 5b. Molecule to inventory-reagent link

- `InventoryItem` already carries `cas`, `vendor`, `catalog_number`, `name`, `category` but no structure. Add an optional `molecule_id?: string | null` plus `molecule_owner?: string | null` to `InventoryItem` (inventory owns the FK), so a stocked reagent can show its structure and a molecule can show "stocked as reagent X (lot, vendor, amount left)."
- Later, the reverse FK on `MoleculeMeta` (`inventory_item_id`) if we want molecule-to-suppliers lookup.
- Data shape: optional FK fields, additive on both records.
- Regression risk: low (optional fields). Verify: link and unlink, the molecule detail shows the linked stock, the inventory item shows the structure thumbnail.

---

## Phase 6: Reactions and stoichiometry (Tier D)

Goal: the deepest chemistry feature, built last on a mature foundation.

- Ketcher already draws reaction arrows. Capture a reaction (reactants, products, conditions) as its own record type or as a specialized molecule attachment on an experiment.
- A stoichiometry calculator: given the reaction plus amounts, compute limiting reagent, equivalents, theoretical and percent yield. This leans on the Phase 4 reagents/products link and the Phase 1c computed properties (MW).
- Data shape: a new reaction record (own store, mirroring the molecule store) or an extension of `molecule_attachments`. Decide at design time for this phase.
- Regression risk: contained (new subsystem). This is a full feature arc and would get its own sub-proposal before build.

---

## Consolidated data-shape change inventory

Every change is additive and optional. Ordered by phase.

| Phase | Record / file | Change | Risk |
| --- | --- | --- | --- |
| 1a | `_trash/molecule/*`, trash index, `TrashEntityType` | new trash entity type + folder | low |
| 1b | `_history/molecules/{id}.jsonl` | new delta-history sidecar | low |
| 1c | `MoleculeIdentity` (compute) | extra descriptor fields | near zero |
| 1d | none (hub state only) | bulk-select state | low |
| 2 | `_index/molecule-fingerprints.json` (rebuildable) | optional fingerprint cache | low |
| 3a | none | editor affordance only | medium (shared editor) |
| 3b | optional reverse-index sidecar (later) | none required initially | low |
| 4 | `Task.molecule_attachments?` | new optional array on the core record | high (mitigated) |
| 5a | results image + sidecar | uses existing results path | low to medium |
| 5b | `InventoryItem.molecule_id?` (+ later `MoleculeMeta.inventory_item_id?`) | optional FK fields | low |
| 6 | new reaction store or attachment extension | new subsystem | contained |

## Regression-minimization strategy (cross-cutting)

- **Additive-only.** Every field optional, every sidecar rebuildable, every old record normalizes on read. No required migrations.
- **Phase flags.** `CHEMISTRY_ENABLED` plus a nested flag for Tier C phases so the core-record change lands inert.
- **The core record is touched once, late, with the full checklist.** Phase 4 is the only phase that changes `Task`; it carries the FLAG, the lockstep touch-point list, and the 3-verifier loop.
- **Mockup-before-build for UI-heavy phases** (3a picker, 4 reagents UI, 6 reactions), reviewed as interactive before/after HTML.
- **Reuse proven systems** (trash, delta history, ref/chip, method-attachment, doorways, bulk-select, migration marker) so most phases are pattern-application, not invention.

## Open design questions for review

1. Phase 4 reagents/products: store as a `Task.molecule_attachments` array (mirrors methods, recommended) or as its own per-experiment record? The array is simpler and reuses all the method machinery.
2. Computed properties (1c): display-only, or also fold a couple into `MoleculeMeta` so Phase 2 can sort/filter by them on disk?
3. Inventory link (5b): inventory-owns-FK first (recommended, lets a reagent show its structure), molecule-owns-FK later, or both at once?
4. Reactions (6): a real reaction record type, or piggyback on molecule attachments? This decision wants its own sub-proposal.

## Recommended first step

Phase 1 in full. It is entirely chemistry-only (cannot regress the shared lab surfaces), it closes the real v1 gaps (no trash, no history), it surfaces chemistry we already compute (properties), and it establishes the bulk-select and history patterns the later phases lean on. Everything from 1a to 1d is pattern-application against systems that already ship.
