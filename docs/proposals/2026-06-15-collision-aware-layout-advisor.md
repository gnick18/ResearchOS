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

## Decisions — OPEN (need Grant)

1. **Aggressiveness:** quiet inline banner only, or also a BeakerBot proactive popup the moment a crowded figure is produced (e.g. right after a Phase 4 multi-add)? Grant's wording leans proactive-popup; confirm it is not annoying on every small overlap.
2. **Apply model:** one-click "apply the recommended fix," or a menu where each suggestion has its own preview + apply (his message implies the menu-with-previews)?
3. **Prevention vs. cure:** also prevent the duplicate-overlay case at add-time in the Phase 4 wizard (block adding the same column twice / warn), or only flag it after via the advisor?
4. **Threshold:** what counts as "overlapping enough" — any bbox intersection, or a % overlap / illegibility heuristic.

## Related
`[[project_phylo_phase4_smart_binding]]` (the trigger), `task_b849ab45` (interaction-collision instance), `[[project_figure_composer_styling]]` + `[[project_datahub_v2_stats]]` (the other data pages this must reach), `[[feedback_beakerbot_no_interpretation]]`, `[[feedback_no_soft_locks]]`.
