# Phylo callouts + collision-advisor extensions — handoff (2026-06-16)

**All work is COMMITTED + PUSHED to `origin/main`.** Branch: main. No uncommitted work
of this session remains. Memory: `[[project_collision_layout_advisor]]`,
`[[project_phylo_tree_studio_redesign]]`.

## What this session did (in order)

Started as a takeover of the halted Phylo agent (it ran out of tokens mid-question
after reverting render.ts; Grant's answer to "how to make room for circular track
callouts" was **Right gutter**). Then extended outward.

**1. Circular per-track callouts** `177154622` — each metadata ring's name (CLADE /
FCZ / AMB / MCF) pulled into a RIGHT gutter with a thin elbow leader through the fan's
open gap at 3 o'clock. `PhyloStudio.figWidthFor()` widens the circular figure 620→840;
`layoutCircular` left-anchors the circle (`cx=height/2` when `circularGutter` +
width>height) so the tree keeps its full height-bound radius; `renderFromPanels`
collects ring (name, radius band) and `drawCircularCallouts()` stacks them; legend
capped to 1 far-right column. Flag-gated (`circularGutter`), back-compat.

**2. Tip-label-aware collision manifest** `2be6c160d` — the layout manifest used to
size every tip-label box at the full tip-row height, so the advisor's label fixes did
nothing. Now the box reflects real ink → shrink-font measurably reduces detected
crowding (later superseded by #7's oriented model).

**3. Sequence LINEAR map content-overflow advisor** `7545af4d3` — new surface-agnostic
`content-overflow` collision kind (a non-legend box whose top runs off the canvas);
sequence `figure-source.getLayoutManifest` (linear) emits feature/label/ruler boxes via
a shared `linearMapLayout` (byte-identical draw); `styleForFix(shrink-label-font →
featureScale 0.6)`. CompositionPanelAdvisor lights up for sequence composer panels.

**4. Sequence CIRCULAR (plasmid) map** `f714bd7a2` — content-overflow extended to the
BOTTOM edge too (excludes legend + band-spanning panel kinds; phylo/datahub unchanged);
`circularGeom` + `circularLabelPlacements` lifted out of circularMap (byte-identical) +
`buildCircularMapManifest`; getLayoutManifest now handles circular. (Leader-over-wedge
not covered — needs a line primitive the box engine lacks.)

**5. Interactive linear-map crowding chip** — the editor's Map view GROWS to fit
enzyme/primer tiers (no clip), so the failure is SATURATION. `cutSiteStackTooDeep(tiers
>= 5)` in label-layout.ts → a dismissible amber chip in `LinearMap.tsx` with "Hide cut
sites / Hide primers" (new optional callbacks wired in SequenceEditView) + zoom nudge.
**PROVENANCE NOTE:** a concurrent lane's broad `git add` swept these files into
`fb19a0055` (inventory Room-map) + the chip into another commit. The CODE is correct +
on HEAD; just attributed to the wrong commits. Switched to atomic `git add X && commit`
afterward to avoid it.

**6. Fan + inward-circular callouts** `ba2f3600c` — extended the #1 right-gutter
callouts to the fan + inwardCircular layouts (all three radial layouts have a clear
right gap). Widened 3 gates: figure-to-render `circularGutter`, render `isCircular()`,
PhyloStudio `CALLOUT_GUTTER_LAYOUTS` set (NOT unrooted).

**7. Oriented-strip label overlap** `46a9eb4d2` — replaced the `cos(tilt)` proxy with
TRUE geometry: `PlacedBox.angle` + `labelsOverlap()` runs SAT on the rotated rectangles
when tilted, falls back to the axis-aligned area test when not (untilted detection
byte-identical). Phylo manifest emits real ink (w=name width, h=font) + angle=tilt.
**This surfaced an honest truth:** tilting a VERTICAL tip-label stack rotates each
label about its own anchor without changing the spacing → it does NOT de-collide them
(tilt only helps a HORIZONTAL axis-label row, e.g. Data Hub). So `PhyloLayoutAdvisor`
**no longer offers tilt-tip-labels** (shrink-font is the real phylo lever, taller-canvas
stays the manual suggestion). Data Hub's advisor keeps tilt where it works.

**8. Circular map center-callout backdrop** `0d65a634c` — Grant's insight: a circular
plasmid can be freely ROTATED, so detecting whether a leader/wedge sits behind the
center "name / bp" text is futile (the next rotation re-creates it). Instead the center
callout is now drawn LAST over a rounded white card that masks whatever passes behind
it → legible at every rotation, no detection. Visual-only change to circularMap; also
upgrades the live `/sequences` circular view + every exported/embedded plasmid.
**PHILOSOPHY for the lane: circular seq maps want rotation-proof VISUAL GUARDS
(backdrops), not collision detection.** The `content-overflow` plasmid advisor (#4)
still earns its keep — a label column off the canvas isn't fixed by rotating.

## Verification status

- **Headless / unit:** tsc 0; full figure/phylo/datahub/sequences suites green
  throughout. Each render slice raster-verified via qlmanage (callouts land, overflow
  fires, refactors draw byte-identical).
- **In-app live pass: CLOSED / PASSED (2026-06-16).** Grant ran the Chrome prompt
  `docs/handoffs/CHROME_VERIFY_ADVISOR_EXTENSIONS.md` against `:3000`:
  - **A (fan/inward callouts): PASS** — both radial layouts put the figure left, track
    names in the right gutter with leaders; rectangular swaps back to per-column headers.
  - **B (advisor drops tilt): PASS** — Review menu offered only "Shrink the label font",
    no "Tilt the labels"; auto-fix shrank font without tilting, Undo reverted clean.
  - **C (cut-site crowding chip): PASS** — fired at **9 tiers** on pEGFP-N1-TRAP1; "Hide
    cut sites" flipped the rail toggle and cleared it, × dismissed. `CUT_SITE_TIER_LIMIT`
    (=5) needs NO tuning (it fired well above threshold).
  - **D (composer overflow): BLOCKED-acceptable** — `/figures` has no add-panel UI to
    insert a sequence map (the known flag-gated caveat); engine + seam are unit-verified.
- **Advisor discoverability follow-up (`03008d775`).** The verifier's confusion ("only
  fires with a Page frame/artboard") was a MISATTRIBUTION: the advisor lives inside the
  Shape inspector, so the firing was only noticed after navigating to that tab (where
  the artboard toggle also is). Detection is artboard- and zoom-independent (the
  artboard only uniformly scales the same figure SVG, which preserves overlaps; the real
  trigger is the tip-labels layer being ON). Fix: lifted detection into PhyloStudio
  (`phyloLayoutIssues`, shared with the card), added an **amber dot on the Shape tab**
  (`RailOperation.badge`) so the warning is noticeable from any tab, and made the card a
  controlled component with host-owned shared silence. +3 unit tests. The visual dot
  itself is the one item still worth an in-app glance (uses the rail's existing,
  tested badge mechanism).

## Open follow-ups (none blocking; all noted in memory)

- In-app glance at the new Shape-tab amber dot (`03008d775`) — low risk, rail badge is
  already tested; just confirm it shows when tip labels crowd and clears on dismiss.
- Sequence editor view tabs (Map/Sequence/...) sit under the floating BeakerBot
  chat-search bar (found in the Chrome pass) — spun off as a separate background task.
- Sequence circular leader-over-wedge crossings (needs a line-overlap primitive).
- Phylo circular callout aesthetics on the real 305-tip demo (levers
  `RADIAL_CALLOUT_GUTTER`=220, `gap`=15 in drawCircularCallouts).

## Hazard for the next session

The shared main checkout is hot — multiple concurrent lanes run broad `git add`.
Commit path-scoped and ATOMIC (`git add <files> && git commit` in one shell call) to
avoid your staged work being swept into another lane's commit. See
`[[feedback_integrate_from_worktree]]`.
