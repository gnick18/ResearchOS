# Handoff — BioRender-class Figure Builder (built) + Data Hub plot fixes

**Date:** 2026-06-15
**Lane:** Figure Composer
**Memory:** `[[project_bioart_icon_library]]`, `[[project_figure_composer_styling]]`, `[[project_plot_artboard]]`
**Proposal + mockup:** `docs/proposals/2026-06-15-figure-builder-biorender-class.md`, `docs/mockups/2026-06-15-figure-builder-biorender-class.html`

## One-paragraph state

The `/figures` Figure Composer was rebuilt into a **BioRender-class diagram tool** this
session, end to end, all **on LOCAL main, UNPUSHED, gate-green** (whole-repo tsc 0, 117
figure tests). The mockup is fully realized: three-zone layout with the signature **left
insert/file rail** (Figures · Icons · Text · Shapes · Connect · Templates · Layers), the
landing hub retired (/figures opens straight into the composer), and it lives **inside the
app shell** (persistent global nav + BeakerSearch). One Data Hub plot fix sits on a
**separate branch** (`datahub-axis-errorbar-fix`, not merged). One piece is **blocked**:
the grouped category sidebar, waiting on the Icon Library lane to lock the taxonomy.

## What shipped to LOCAL main (all merged, gate-green, NOT pushed)

Built on the unified element model `frontend/src/lib/figure/figure-arrange.ts` (pure,
unit-tested: ElementRef over panels/icons/annotations/shapes, elementBox, align/distribute,
computeSnap smart-guide solver, z-order, marquee/hit-test).

- **Phase 1** — multi-select, marquee, smart guides, align/distribute, group drag, z-order.
- **Phase 2** — **smart connectors** (`figure-connectors.ts`): endpoints are element refs
  (`{ref, side}`), so the path re-routes live when an element moves. Connect tool +
  anchor nodes + inspector (straight/elbow/curve, heads, color, weight).
- **Phase 3** — per-fill (multi-part) + bulk icon recolor (`recolorPlacedAsset`,
  `extractFills`, `tintSvg` string|map); cascade placement.
- **Phase 4** — typed text (Heading/Label/Body), **Shapes** (rect/ellipse, first-class
  in the element model: `figure-page.ts` FigureShape + helpers), **Templates** gallery
  (`figure-templates.ts`: Process flow / Two-column / Graphical abstract scaffolds of
  shapes+text+connectors), **drag-drop** icon placement from the rail.
- **Layout** — `FigureLeftRail.tsx` (the signature rail); right rail trimmed to the
  contextual inspector + PAGE + EXPORT; **Layers** panel (lists every element front-first,
  reorder chevrons); `/figures` route retired the hub (opens composer or empty-state).
- **App-shell integration** — `app/figures/page.tsx` + `app/figures/[id]/page.tsx` wrap in
  `AppShell` so the top nav + BeakerSearch persist and there is a clear way out.
- **Polish** — removed the dead AddIconPicker modal (−143 lines); empty-state hides when
  ANY element exists.
- **CDN fixes (on main, important):** `next.config.ts` CSP — added
  `https://assets.research-os.com` to img-src + connect-src; `asset-library.ts` — `?cors=1`
  suffix on the SVG fetch to dodge a Cloudflare CORS-cache-poisoning bug (the `<img>`
  thumbnail caches a header-less response; the cross-origin `fetch()` then fails → icons
  rendered empty). Both VERIFIED live.

Flag: the whole left rail + icon library is gated behind `NEXT_PUBLIC_ASSET_LIBRARY_ENABLED`
(default OFF). Grant set it = 1 in **Vercel** already; it needs a **redeploy** to take
effect (NEXT_PUBLIC is build-time inlined).

Key files: `components/figure/{FigureComposer,FigureLeftRail,ZoomPanCanvas}.tsx`,
`lib/figure/{figure-arrange,figure-connectors,figure-compose,figure-page,figure-templates,asset-library}.ts`.

## HELD on a branch (NOT merged) — `datahub-axis-errorbar-fix` (commit 83bc67644)

Two Data Hub plot issues Grant caught on a figure embedding a datahub plot:
1. **X-axis label overlap FIXED** — `lib/datahub/plot-spec.ts` `layoutPlot` now estimates
   label width vs band width and **auto-angles labels -40deg** (reserving bottom room) only
   when they would collide; short labels stay flat (so the pinned geometry tests are
   unchanged). New `PlotStyle.xLabelMode` ("auto"/"horizontal"/"angled") + an "X labels"
   control in `GraphEditor.tsx`. 5 new tests; verified live (per-panel: 4 narrow groups
   angle, 3 wider groups stay flat).
2. **Error bars** — were NOT a bug: verified exactly one I-beam per group (not duplicated;
   the alarming `[6,6,6,3]` count was data-series indices colliding across panels). Did a
   cosmetic de-clutter only: cap half-width 7->5px.

Gate on the branch: tsc 0, 83 plot-spec tests. **Data Hub lane was messaged** (the 3 files,
the branch, that it is additive) so the eventual merge is clean. Hold per Grant for a
coordinated merge.

## BLOCKED — grouped category sidebar (the "flat chips don't scale" fix)

Grant flagged that the icon picker's flat category-chip row is meaningless as categories
grow; we want a **BioRender-style collapsible grouped sidebar**. The **Icon Library lane**
shipped the data for it: `listCategoryGroups()` / `CategoryGroup {section, categories[]}` /
`sectionForCategory()` in `asset-library.ts` (their `library-ui` branch, commit 560e0e6a4,
9 sections + Other). **Gate:** I asked them (waiting) whether the section set + the clean
leaf category names are **LOCKED** before I build, so the tree is not rebuilt twice (today's
300-asset batch only partially maps; the rest fall under "Other" until their full-corpus
manifest syncs). NEXT once they confirm + the export is available (their merge, or
cherry-pick 560e0e6a4): rewrite `IconsPanel` in `FigureLeftRail.tsx` to render
`listCategoryGroups` as collapsible sections (section = header, categories = leaves),
calling `searchAssets` with the leaf on select. Their Part 3b (a `verificationStatus` badge
+ "Help review (N)" entry in IconsPanel) is a co-owned follow they will send a diff for.

## Open items (Grant / next picker)

1. **Coordinated PUSH** to origin — the CSP + CORS fixes MUST ride the same deploy as the
   `NEXT_PUBLIC_ASSET_LIBRARY_ENABLED` flip, or the icon library is empty in prod.
2. **Vercel redeploy** — flag is already set to 1; just needs a deploy.
3. **Merge `datahub-axis-errorbar-fix`** (coordinated; Data Hub lane notified).
4. **Scale the icon corpus** — icon-library agent chip `task_ea526000` (300-asset proof
   batch today; full ~14.5k via bumping MAX + re-rclone sync).
5. **Build the grouped sidebar** once the Icon Library lane confirms the taxonomy is locked.

## Shared R2 bucket `researchos-assets` (collision watch)

The icon library is NOT the only tenant of `researchos-assets` anymore. The
Billing/Welcome lane put marketing videos under a **`welcome/`** prefix
(`assets.research-os.com/welcome/<name>.mp4` + `.poster.jpg`); they ride the same
CSP-allows-`assets.research-os.com` change (no new CSP). They are static media,
NOT icon-catalog entries, and never appear in `manifest.json` — so the
asset-library / taxonomy code is unaffected. **HAZARD:** the ingest command
`rclone sync out/bundle/ r2:researchos-assets` makes the bucket MATCH the source,
so a re-sync would DELETE the `welcome/` prefix. The icon-library lane was warned
to guard it (`--exclude "welcome/**"`, sync into an `assets/`/`icons/` sub-prefix,
or `rclone copy`). Anyone doing bucket/CDN/ingest work: account for `welcome/`.

## Environment / coordination

- **Worktree** `/Users/gnickles/Desktop/ROS-fig-diagram` (currently on branch
  `datahub-axis-errorbar-fix`; node_modules installed; dev server on **:3010** with
  `NEXT_PUBLIC_ASSET_LIBRARY_ENABLED=1 NEXT_PUBLIC_DATAHUB_ENABLED=1`). Build figure edits
  in a worktree, not on the shared main checkout (partial edits flash broken to other
  lanes' dev servers).
- **Demo-mode verify:** `/demo` then `/figures` (figure pages persist per-tab; demo is
  flaky on reload — recreate if "not found"). Window resizes between Chrome sessions, so
  re-screenshot to get coordinates.
- **Cohort lanes** (CDD `send_message`): MobileUI `…32511431` (acts as orchestrator/relay),
  Popup Unifier `…5a2732a5`, Billing `…02612cfa`, BeakerAI `…1844b111`, Phylo `…53fbda46`,
  Icon Library/INJEST `…b4a6f688`. Phylo owns `ZoomPanCanvas` (loop them before any
  BEHAVIOR change to it; new consumers are fine — /figures + /datahub consume it read-only).
</content>
