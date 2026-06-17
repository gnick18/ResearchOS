# Chrome verify — Data Hub collision-aware layout advisor (Phase 5 part 2b)

**What shipped (local main d0bb66244, unpushed):** the collision advisor now works on
Data Hub **grouped-bar** plots, the same UX as the phylo Tree Studio advisor. When the
legend piles onto the bars, a quiet amber banner offers a one-click auto-fix + per-fix
previews. Engine + lever are unit-tested (1236 green); this is the live UX pass.

This is **folder + crowded-data dependent**, so it is a live browser pass, not a
synthetic preview. Use a folder that has (or can build) a Grouped table.

## Setup
1. Dev server on a real authed folder (not demo). `/datahub`.
2. Open or make a **Grouped** table with at least 2 series (column groups) and 2+ row-
   factor levels, then add a **grouped bar** plot. To force the collision, make a series
   tall in the top-right (large values), so a bar reaches the legend zone.

## Checks
1. **Banner appears** above the plot canvas: "N layout issues in this plot" naming the
   legend overlap. (A clean plot shows NO banner, and non-grouped plot kinds show none.)
2. **Auto-fix layout** (magic-wand): one click moves the legend to a reserved right
   gutter so it clears the bars; the banner self-hides (collision resolved). The button
   had flipped to **Undo auto-fix** — but since the banner hides once clean, confirm you
   can still revert via the manual control (next check). This is the no-soft-lock guard.
3. **Manual Legend control** (in the right dock, next to Bars / Error bars): a
   **Overlay / Right** toggle. Flip Right then back to Overlay — the legend moves out to
   the gutter and back inside, live. This is the always-available escape so relocate is
   never a one-way trap.
4. **Review fixes** menu: each fix row shows a live preview **thumbnail** of the fixed
   plot + an **Apply**. Apply "Move the legend" — same effect as the wand's legend move.
   "Shrink the label font" (only if a label-crowding issue is detected) shrinks the axis
   font.
5. **Per-plot silence**: the **x** dismiss ("Don't show again on this plot") hides the
   banner; reload — it stays hidden for a SAVED plot (localStorage keyed by plot id).
6. **No console errors** through all of the above.

## Known scope (by design, not bugs)
- Only **grouped bar** emits a manifest today, so only it shows the advisor. XY / survival
  / parts-of-whole are part 2b-3.
- The only legend fix is **move to the right gutter** (the lever that exists). A
  below-the-plot placement + x-axis label rotation are future levers.
- The Figure Composer per-panel advisor is part 2b-3 (not in this build).

## Figure Composer surface (part 2b-3, same engine, second front door)
The advisor also runs on a composed panel in `/figures`, where small panel sizes make
a legend-over-data worse.
1. Add a Data Hub **grouped bar** panel to a figure page; select it. In the right
   "Selected panel" inspector, if the panel's legend overlaps its bars at that size, a
   compact amber band shows "N layout issues at this size".
2. **Auto-fix** moves the legend to the right (a panel-local override, the saved plot
   is untouched); the panel re-renders and the band self-hides.
3. The **Style > Legend** select (Overlay / Right-of-plot) in the same inspector is the
   persistent manual revert (flip back to Overlay).
4. Resize the panel smaller/larger and confirm the band re-evaluates (it is detected at
   the live composed size). The **x** silences it for that panel.
5. No console errors. Non-grouped panels + sources with no manifest (sequence /
   chemistry) show no band.

## If something is off
Engine + lever live in `frontend/src/lib/datahub/plot-manifest.ts` +
`plot-spec.ts` (GROUPED_LEGEND / groupedLegendSwatchX / layoutGroupedBar gutter); the UI
is `frontend/src/components/datahub/PlotLayoutAdvisor.tsx` mounted in
`GraphEditor.tsx`. Memory: `project_collision_layout_advisor`.
