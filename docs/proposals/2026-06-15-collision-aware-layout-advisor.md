# Collision-aware layout advisor — "BeakerBot fixes a crowded figure"

**Date:** 2026-06-15
**Origin:** Grant, glancing at the Phase 4 smart-binding overlay render in BeakerBot chat ("this is awful, WAY too many things on top of each other"). Surfaced in `/phylo` but he named it as a problem on **all the data pages**.
**Lanes:** phylo (Tree Studio) where it surfaced + cross-lane (Data Hub plots, Figure Composer) + BeakerAI (the chat front door). Coordinate before building shared pieces.
**Status:** DESIGN CAPTURE, not built. Decisions below are OPEN pending Grant.

---

## The problem (two kinds of collision)

Data pages let users stack many layers — phylo tree overlays (heat/bars/dots/strip + legends + tip labels), Data Hub plots, Figure Composer panels. When elements overlap:

1. **Visual collision** — glyphs, axis/legend keys, and text labels draw on top of each other and the figure becomes illegible. Concrete trigger: the Phase 4 wizard's "Add N overlays" added several overlays (and in the observed case multiple geoms of the SAME column, e.g. MIC as heat + bars + dots), each adding its own colorbar legend, and the legends piled over the tip labels (C–H).
2. **Interaction collision** — overlapping hit targets stop registering clicks (Grant: "icons not registering if it is overlapping enough"). Same family as the inspector-overflow-behind-the-search-bar snag (`task_b849ab45`): an element is visually present but un-clickable because something sits on top.

## The vision (Grant, locked direction)

When overlap crosses a legibility threshold, **BeakerBot proactively pops up with concrete, parameterized fix suggestions AND shows a live render preview of the fixed figure before applying.** Suggestions are specific and actionable, e.g.:
- increase the column gap / spacing ('x')
- shrink a column's width
- tilt / rotate text labels (so long labels stop colliding)
- columnize or relocate the legends off the plot
- drop a redundant duplicate overlay (same column, multiple geoms)
- increase canvas height / tip spacing

Each suggestion shows **what the new version would look like** (a real preview render), so the user picks with their eyes, not by guessing parameter values.

## Architecture — one engine, two front doors (house pattern)

Mirror the Phase 4 / `[[project_beakerbot_record_set_widget]]` discipline:

- **Deterministic engine (pure module):** detect overlaps (bounding-box intersection of rendered glyphs / legends / labels from the same render geometry that draws them), classify the collision type, and enumerate candidate fixes as concrete parameter deltas. For each fix, produce the inputs to re-render a preview. The engine computes everything; the model never invents a number (`[[feedback_beakerbot_no_interpretation]]`).
- **Front door A — inline GUI:** a quiet, dismissable banner/affordance on the data page ("This figure has overlapping labels and 2 redundant overlays — fix?") that opens the suggestion list with previews. Non-modal, no soft-lock (`[[feedback_no_soft_locks]]`).
- **Front door B — BeakerBot:** a tool (coordinate with BeakerAI, owner of `src/lib/ai/tools/*`) that calls the SAME engine, narrates the suggestions in prose, and renders the SAME preview widget inline in chat. The model justifies/walks through; the engine measures and previews.

Scope order: **phylo render first** (where it surfaced and where the render geometry is mine), then the shared `FigureSource` / render seam for Data Hub plots + Figure Composer.

## Near-term concrete fix (phylo, my lane, independent of the big feature)

The Phase 4 multi-add overlap is a real bug regardless of the advisor:
- the "Add N overlays" path should NOT stack multiple geoms of the same column on top of each other (dedupe at add-time, or lay each in its own column);
- per-overlay colorbar legends should not collide with the tip labels — when legends exceed the reserved right column they must columnize/relocate, not overdraw labels (render.ts already has legend columnization constants ~L208-213; the wizard is exceeding them).

This is the first, smallest slice and a good forcing function for the engine's overlap detector.

## Decisions — LOCKED (Grant 2026-06-15)

1. **Aggressiveness:** threshold-gated BOTH — a quiet, dismissable in-figure banner for minor overlap, escalating to a BeakerBot popup for severe illegibility / click-eating. Must be **silenceable per-plot** ("don't show again on this plot", persisted on the figure).
2. **Apply model:** HYBRID — (a) a one-click **magic-wand** button (Apple Photos metaphor) that auto-moves the setting toggles to fix the figure and is **reversible** (click the wand again to revert, plus an explicit Back/Revert), AND (b) a **menu of individual fixes each with its own live preview** so the user can pick + adjust. Wand for speed, menu for control, always undoable.
3. **Prevention vs. cure:** PREVENT AT ADD-TIME for the duplicate-overlay case — the wizard defaults to one overlay per column and warns before a 2nd geom on the same column (warn, not block). **SHIPPED** (geom-step inline warning). The advisor still cures other overlap kinds.
4. **Threshold:** still TBD ("overlapping enough" — likely a % bbox-overlap / illegibility heuristic, tuned during the engine build).

## Build status (2026-06-15)
- SHIPPED: legend dedupe (`36d318843`) + the Q2 add-time multi-overlay warning — the first prevent/cure slices.

### Toggle inventory (the wand can only move settings that EXIST)
A 2026-06-15 grep of the phylo render/spec shows which of the example fixes are already settable vs. need a new field first:
- **Drop duplicate overlay** — EXISTS (remove a panel).
- **Shrink font** — EXISTS (the labels panel's font-size option, Wave 1).
- **Increase canvas height / width** — EXISTS (`spec.height` / `figureWidthIn`).
- **Shrink a column width** — PARTIAL (`panel.width` honored for msa + some kinds; not all).
- **Increase column spacing ('x')** — MISSING: `PANEL_GAP` is a module CONSTANT, not a per-figure field. Needs a new settable gap.
- **Tilt / rotate tip labels (rectangular)** — MISSING as a user toggle: rotation exists in render (circular auto-rotate, `rot` at render.ts:359) but there is no rectangular label-tilt setting.
- **Relocate / size the legend** — MISSING: legend columnization is automatic, no manual control.

### Build phases (revised by the inventory)
1. **Add the missing settable toggles** — DONE 2026-06-15: column spacing (`columnGap`, `29e59981c`), rectangular label tilt (`5de3ffd36`), legend right|bottom placement (`c6d1605a8`). Every wand lever now exists, so `suggestFixes` marks all fixes `available`.
2. **Geometry source** — DONE (`785dd2fc3`): `render.ts` emits a `LayoutManifest` (exact bboxes) via an optional out-param + `renderTreeWithManifest`. Single source of truth, rectangular v1.
3. **Deterministic engine** — DONE (`785dd2fc3`): `layout-collision.ts` `detectCollisions` + `suggestFixes`, unit-tested incl. a real-render integration test.
4. **UI (NEXT):** the magic-wand one-click (reversible) + the per-fix preview menu + the per-plot silence; quiet banner -> BeakerBot popup gating. The engine + toggles it drives are all in place.
5. **Generalize** to the shared `FigureSource` seam (Data Hub plots + Figure Composer).

Phylo first throughout. Phases 1-3 shipped; phase 4 (the wand/menu UI wiring `suggestFixes` -> the now-available toggles) is the next piece. Browser-verify the 3 new toggles on a real crowded figure before/with the wand UI.

## Related
`[[project_phylo_phase4_smart_binding]]` (the trigger), `task_b849ab45` (interaction-collision instance), `[[project_figure_composer_styling]]` + `[[project_datahub_v2_stats]]` (the other data pages this must reach), `[[feedback_beakerbot_no_interpretation]]`, `[[feedback_no_soft_locks]]`.
