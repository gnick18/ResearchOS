# Methods Expansion v1 — Wiki Handoff

**To:** Wiki manager
**From:** Methods-expansion manager
**Date:** 2026-05-15
**v1 final commit:** `98e45aaa` (§8 v1-complete refresh) on top of merge `3e07dc9b` (Phase 2D landing)

---

## TL;DR

The Methods Expansion v1 arc shipped four new method-related capabilities. Three are new structured method types that need their own wiki pages; one is a cross-cutting markdown UX change that probably folds into the existing methods page. All four are reachable in fixture mode (`?wikiCapture=1`) on alex's account — most via fixture task 10 ("Set up growth curves in YPD/glucose"), which now has PCR + LC + Plate + Cell culture all attached as a multi-tab demo.

This doc gives you the per-type description, fixture access paths, key affordances worth capturing, and a screenshot recipe table you can lift into `scripts/capture-wiki-screenshots.mjs`. Voice + style reminders at the bottom.

---

## What landed (one-liner per item)

1. **LC gradient** (Phase 1a) — HPLC/LC-MS method type. recharts dual-Y line chart of solvent A/B percent over time + flow rate, plus column metadata, detection wavelength, ingredient table with role discriminator. Per-task snapshot + diff display vs source.
2. **Plate layout** (Phase 2C) — Generic well-plate annotation widget. 12/24/48/96 sizes, click-paint UX with brush palette (Blank / Sample / Control / N/A / Custom). Per-task per-well annotation snapshot, diff-vs-source highlighting.
3. **Cell culture passaging** (Phase 2D) — Schedule + media + cell-line template. Hand-rolled SVG timeline strip showing planned events. **Distinctive feature:** per-task `actual_events` log with quick-action buttons (+Feed / +Split / +Observe / +Harvest) for "mark things along the way" documentation.
4. **Markdown diff-overlay** (Phase 2B) — Cross-cutting UX. When a user edits a markdown method on the experiment page, the edit lands in a per-task `body_override` (the source method stays untouched), and the experiment-page view shows a red-strikethrough / green-underline diff against the source. Reset-to-source button restores the no-override view.

Plus three architectural primitives that aren't user-facing but are worth knowing exist:

- **`methodTypeRegistry`** at `frontend/src/lib/methods/method-type-registry.ts` — single source of truth for per-type cosmetics (label, badge color, icon, picker grouping). Adding a v2+ method type is one registry entry.
- **Per-task snapshot pattern** — every structured method type now carries a `<type>_snapshot: string | null` field on `TaskMethodAttachment`. Edits on the experiment page write to the snapshot, not back to the source. Universal across PCR / LC / Plate / Cell culture / markdown (via `body_override`); PDF stays variation-notes-only.
- **`diff-display.ts`** — shared visual conventions (`MODIFIED_CHIP_TEXT` = "Modified from source", amber badge classes, red strikethrough for removed, green underline for added). Every structured type's diff display reads from this module so the visual language is consistent.

---

## Wiki pages needed

### 1. LC gradient — NEW page at `frontend/src/app/wiki/features/lc-gradient/page.tsx`

**Concept-first opener:** What is an LC gradient method? Why would a lab user want to capture one as a reusable template? (Reverse-phase HPLC peptide separation, LC-MS proteomics, small-molecule analysis — the same gradient gets run across many samples in a campaign.)

**Affordances to demonstrate** (one screenshot per affordance):
- The LC method opened in the page-level viewer (`LcViewer.tsx`) — shows the chart, gradient steps table, column fields, wavelength, ingredients
- Editing a gradient step in the editor (`LcGradientEditor.tsx`) — chart updates live as the user changes percent_a / percent_b / flow_ml_min
- The recharts dual-Y axis (left = solvent %, right = flow rate) — call this out as a deliberate design choice; LC methods care about both axes
- The ingredient table with role discriminator (solvent_a / solvent_b / buffer / additive) — explain the four roles + when to use each
- The per-task snapshot UX — open task 10's LC tab, show the editor with no override, then with a sample edit + the "Modified from source" chip

**Fixture access:**
- Method record: alex's method 6 = `[Demo protocol] Reverse-phase HPLC — flbA peptide quantification`
- Source protocol: `users/alex/lc_gradients/1.json`
- Attached to: alex task 10 (Set up growth curves in YPD/glucose) as method 6
- Page-level view: `/methods` → click the "Reverse-phase HPLC" card
- Tab view: `/?wikiCapture=1` → workbench → task 10 → Method tab → LC sub-tab

**Voice notes:** mention that LC ingredients have a `role` field that drives the editor's grouping; mention that the chart's `isAnimationActive={false}` is a deliberate choice for screenshot determinism (relevant if Grant ever asks about chart polish).

### 2. Plate layout — NEW page at `frontend/src/app/wiki/features/plate-layout/page.tsx`

**Concept-first opener:** What is a plate layout method? Why is it more useful than just a markdown table? (Bacterial plating, transformation, transfection, growth curves, dose-response, ELISA, qPCR plates — any plate-based experiment benefits from a structured well-by-well annotation. The widget is intentionally decoupled from any one assay type.)

**Affordances to demonstrate:**
- Plate sizes: 12 / 24 / 48 / 96 — show the picker dropdown with all four
- The brush palette (Blank / Sample / Control / N/A / Custom) — color-coded chips, paint-as-you-click UX
- Conditional inputs per brush — picking "Sample" shows a sample-identifier field; picking "Custom" shows a free-text label field
- Click-and-drag to paint multiple wells — multi-select rectangle
- Row-letter / column-number buttons that fill the whole row/column with the current brush
- Shift+click to erase
- Per-task annotation snapshot — open task 10's Plate tab, paint a few wells, save → "Modified from source" chip + diff highlighting

**Fixture access:**
- Method record: alex's method 7 = `[Demo protocol] 96-well bacterial growth curve (DemoStrain inducer titration)`
- Source protocol: `users/alex/plate_layouts/1.json`
- Layout: column 1 = 8 media blanks, columns 2-7 = 48 sample wells (inducer titration), columns 8-12 = 40 negative-control wells
- Attached to: alex task 10
- Page-level view: `/methods` → click the plate card
- Tab view: task 10 → Method tab → Plate sub-tab

**Voice notes:** lead with the genericness ("not just plate readers — any plate-based workflow"). Per-well custom labels are the escape hatch for assays that don't fit the four base roles. The 1×1 region projection (editor flattens region_labels into per-well annotations on save) is an internal detail; don't surface it in the wiki.

### 3. Cell culture passaging — NEW page at `frontend/src/app/wiki/features/cell-culture/page.tsx`

**Concept-first opener:** What's distinctive about a cell-culture passaging method vs. just writing the schedule in markdown? (Two things: structured schedule visualization, and per-task **actual-event logging** for mid-execution documentation. "Fed Monday, looking 80% confluent Wednesday, split 1:5 Thursday" lives on the experiment, not the canonical method.)

**Affordances to demonstrate:**
- Cell-line metadata block (name / species / tissue / notes)
- Media composition (base medium, serum %, supplements table with concentration + units)
- Planned events list with day-offset + event type (feed / split / observe / harvest) + split-ratio when relevant
- Hand-rolled SVG timeline strip — visual planned schedule
- The **quick-log buttons** (+Feed / +Split / +Observe / +Harvest) on the experiment-page tab — this is the magic; one click stamps current time + adds a row
- An actual_events log with the pre-seeded entries from fixture (Mon "plated 5e5 cells, ~30%" + Wed "cells healthy ~70%")
- Per-task snapshot diff: edit a planned event → "Modified from source" chip

**Fixture access:**
- Method record: alex's method 8 = `[Demo protocol] HeLa passaging — weekly 1:5 split`
- Source protocol: `users/alex/cell_culture_schedules/1.json`
- Attached to: alex task 10
- Pre-seeded actual_events: 2 entries (Mon plate-down at 30% confluence, Wed feed at 70%)
- Page-level view: `/methods` → click the cell culture card
- Tab view: task 10 → Method tab → Cell culture sub-tab

**Voice notes:** lead with "documentation along the way" — this is Grant's framing for why this type earned a spot in v1. The quick-log buttons are the differentiating UX; mention them by name.

### 4. Markdown diff-overlay — folds into existing `frontend/src/app/wiki/features/methods/page.tsx`

This isn't a new method type; it's a UX change to how markdown methods behave on the experiment page. Probably best as a new section ("Documenting per-experiment variations") on the existing methods wiki page rather than a separate page.

**Affordances to demonstrate:**
- The "Edit body" button on the markdown tab
- Editor mode → user types changes
- Save → "Modified from source" chip appears, "Reset to source method" button appears
- The diff visualization: removed lines red-strikethrough on amber bg, added lines green-underline on amber bg, unchanged lines plain
- Reset → no-override view restored

**Voice notes:** position this as the unification of the snapshot pattern — every method type now lets users document per-experiment variations without modifying the canonical method. PDFs use the existing `variation_notes` markdown box (universal fallback); structured types use their per-type snapshot field; markdown now uses `body_override`. Variation notes still work alongside as the universal prose channel.

**Fixture access:**
- Find any task with a markdown method attached. Task 2 (Yeast transformation) attaches alex's method 1 (markdown method). Task 10 also has a markdown attachment. Either works.
- Reload caveat: `?wikiCapture=1` re-seeds the in-memory mock on every page load, so the override won't survive a reload — that's a fixture-mode artifact, not a feature defect. Within-session is the testable claim.

---

## Screenshot recipe table

For copy-into `scripts/capture-wiki-screenshots.mjs`. Routes assume `?wikiCapture=1`. Use existing `<Screenshot>` component conventions from PCR's wiki page as a template.

| Screenshot key | Route + action | Highlight target | Suggested wiki page |
|---|---|---|---|
| `lc-gradient-viewer.png` | `/methods` → click "Reverse-phase HPLC" card | The recharts chart + gradient table | LC gradient page (hero) |
| `lc-gradient-editor.png` | `/methods` → open LC method → click Edit | Gradient steps table + column fields | LC gradient page |
| `lc-gradient-tab-on-task.png` | `/?wikiCapture=1` → task 10 → Method tab → LC sub-tab | The whole LC tab content | LC gradient page |
| `lc-gradient-modified-chip.png` | LC tab on task 10 → edit a step → save | The "Modified from source" chip | LC gradient page |
| `plate-viewer-96well.png` | `/methods` → click bacterial growth curve plate | The 96-well grid with regions | Plate layout page (hero) |
| `plate-editor-brush.png` | New method dialog → Plate → 96-well | The brush palette + grid | Plate layout page |
| `plate-tab-painted.png` | Task 10 → Method tab → Plate sub-tab → paint a few wells | The grid mid-painting | Plate layout page |
| `cell-culture-viewer.png` | `/methods` → click HeLa passaging | The cell-line + media + timeline strip | Cell culture page (hero) |
| `cell-culture-quick-log.png` | Task 10 → Method tab → Cell culture sub-tab | The +Feed / +Split / +Observe / +Harvest buttons | Cell culture page |
| `cell-culture-actual-events.png` | Cell culture sub-tab on task 10 | The pre-seeded actual_events log | Cell culture page |
| `markdown-diff-modified.png` | Task 2 → Method tab → markdown method → Edit body → make a change → Save | The "Modified from source" chip + diff visualization | Methods page (new section) |
| `methods-picker-grouped.png` | `/methods` → click "+ New method" | The Standard methods + Structured methods sections (all 6 tiles) | Methods page (existing — refresh) |

All routes safe under `?wikiCapture=1`. None require real-user data.

---

## Nav entries needed

Three new nav nodes in `frontend/src/lib/wiki/nav.ts` (`WIKI_NAV`), under the existing "Features" branch:

- LC gradient: `/wiki/features/lc-gradient` (sibling of `/wiki/features/pcr`)
- Plate layout: `/wiki/features/plate-layout`
- Cell culture: `/wiki/features/cell-culture`

The existing `/wiki/features/methods` page picks up the markdown diff-overlay in-place (no new nav node).

**`APP_ROUTE_TO_WIKI` check:** the new structured method types do NOT add new top-level app routes (they're tabs inside `/methods`), so the wiki coverage gate at `prebuild` won't complain. No `EXCLUDED_PREFIXES` change needed.

---

## Voice + style reminders (per HR memory `feedback_wiki_voice.md`)

- **Concept-first, screenshot-heavy.** Each new wiki page should open with "what is this and why would I use it" before getting to "click here, then click there." Annotated screenshots beat numbered step lists.
- **Anti-pattern to avoid:** flat feature-inventory bullets (the Gantt page was the example — don't replicate that shape). The PCR page is the working precedent for voice + structure.
- **No em dashes**, no semicolons except in code, use `(e.g., …)` / `(i.e., …)`, contractions throughout, brand names properly capitalized.
- **Real-data hygiene** (HR memory `feedback_screenshot_privacy.md`): ALL screenshots use fixture mode. Fixture seeds are believable-but-fake (Waters BEH C18 column, "DemoStrain ΔADE2" inducer titration, "fake-flbA peptides" — all already in the fixture).
- **Use the existing `<Screenshot>`, `<Callout>`, `<Steps>`/`<Step>`, `<Kbd>` primitives** from `frontend/src/components/wiki/`. `<Callout>` has `info|tip|warning|danger` variants; there's no separate `<Tip>` / `<Warning>` component.

---

## Files NOT to touch

Nothing in this handoff requires the methods-expansion side to write code in your territory. Per existing carve-outs:

- The fixture data the wiki captures rely on lives in `frontend/src/lib/file-system/wiki-capture-fixture.ts` and `scripts/generate-demo-data.mjs`. Methods-expansion already added all 4 new method types' fixture seeds (`generate-demo-data.mjs` is the source; `wiki-capture-fixture.ts` is regenerated). You can re-regenerate via `npm run demo:data && npm run demo:images && npm run demo:zip` if you change anything in the seed.
- `scripts/capture-wiki-screenshots.mjs` is yours — add the recipe rows from the table above.

---

## Coordination

- Master noted you're already standing by for the security manager's `/wiki/security` page draft request — that's independent of this handoff. Tackle whichever order works for you.
- If anything in this doc is ambiguous or you want a screenshot demonstrated live before drafting, ping master and I'll provide whatever's needed. Standing by.

— methods-expansion manager
