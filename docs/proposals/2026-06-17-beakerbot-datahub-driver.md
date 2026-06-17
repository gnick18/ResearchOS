# BeakerBot drives the big-table screen (the Data Hub copilot)

Idea by Dr. Grant Nickles, 2026-06-17. Status: vision, grounded, not yet built.

## The insight

Big Data Hub tables (the 100k+ row DuckDB-WASM lane) will break the page if
BeakerBot ever materializes one into the chat DOM. So the rule is: BeakerBot never
pulls a big table into the chat. When the user asks it to do real data work, it
routes to the Data Hub, docks the chat to the side, picks the table, and shows a
PLAN of what it will do (filter, join, transform, analyze), then executes on the
grid. Never in the chat.

The deeper goal is the high-leverage one. If BeakerBot is a master of this screen,
a non-coder can do in plain English what otherwise needs pandas or SQL: merge two
tables on a shared column, chain a string of transforms, then plot or test the
result. That is the unlock.

## What already exists (most of it)

The engine and the tools are largely built. This is an orchestration project, not
a greenfield engine.

- The transform engine (`lib/datahub/transform/engine.ts`, pure `executePipeline`)
  and the full `TransformOp` union (`transform/pipeline.ts`): filter, JOIN (inner
  / left / right / outer, on keys, with type coercion), groupby + aggregations,
  derive (Custom Calculator formulas), sort, dedupe, union, select, drop, rename,
  plus the five column transforms. Non-destructive, produces a derived table with
  a live-linked, re-runnable recipe (`transform/recipe.ts`, `derived.ts`).
- `wrangle_table` tool (`lib/ai/tools/wrangle-table.ts`): BeakerBot already builds
  a multi-step recipe (joins reference other tables by id) and shows a per-op
  approval block. So the join + chained-transform capability is real today.
- The analysis picker (`suggest_analyses` + `table-capabilities.ts` +
  `AnalysisPickerWidget`) and the graph tool (`make_datahub_graph`), both
  constraint-aware (the engine decides what is valid, the model only narrates).
- The plan card + resumable plan pattern (`propose_plan`, `activePlan`,
  `BeakerBotPlanCard`, gated by `BEAKERBOT_PLAN_STEPS`).
- The navigation bridge (`navigation-bridge.ts`, `requestNavigation`) so a tool
  can soft-navigate to `/datahub`.
- The big-table lane (`config.ts` `BIGTABLE_ENABLED`, `bigtable/` components +
  `isLargeTable()` detection + virtualized grids), partially built behind the flag.

## The gaps (what to build)

1. The dock / chat morph. There is NO layout-mode state today. The chat sits fixed
   in the app shell. We need a `layoutMode` ("docked" beside the route vs the
   normal panel) in the conversation store, a docked chat panel that slides to the
   side, and a way for a tool to set it programmatically (navigate to /datahub AND
   dock) in one action. This is the main net-new UI.

2. The big-table guard. No seam stops BeakerBot from trying to render a large table
   in chat. Add a heuristic: when a tool would return a table over a row threshold
   (or one already in the big-table lane), it must NOT inline it. Instead it docks,
   navigates, and shows a compact preview (first N rows + column stats), never the
   full grid in chat.

3. Plan-before-execute over the recipe. `wrangle_table` is all-or-nothing approve
   today. Wire the recipe into the plan card so the user sees the plain-English
   steps ("Filter rows where yield < 10", "Join with Plate map on Well", "Group by
   Strain and average OD", "Sort by date") and watches each run, with a live
   preview on the grid and pause / resume / cancel. Reuse `propose_plan` +
   `activePlan` + `BeakerBotPlanCard`.

4. The join made human. The engine has `JoinOp` (keys + how). The non-coder magic
   is BeakerBot inferring the join column from the two tables, stating it plainly
   ("I will match these on Well ID"), flagging unmatched rows, and letting the user
   correct the key in one click. This is a thin layer over the existing JoinOp plus
   a clear preview, not new engine work.

## Phased build

- Phase 1, the dock. `layoutMode` in the store + a docked chat panel + a
  `focus_datahub` style action so BeakerBot can navigate-and-dock. Flag-gated.
- Phase 2, the big-table guard. The row-threshold policy + the compact in-chat
  preview component, so large results never hit the chat DOM.
- Phase 3, the plan-preview. Recipe to plan-card adapter (TransformOp[] to step
  labels) + a live grid preview of the in-progress recipe + pause/resume.
- Phase 4, the human join + polish. Join-key inference + the "matched N of M rows"
  preview + one-click key correction. Then suggest_graphs as a sibling of
  suggest_analyses if wanted.

## Locked decisions (2026-06-17, Grant)

1. Dock mechanics: SPLIT VIEW. The chat docks as a real side panel and the grid
   shrinks to fit beside it, so the user watches the table change live as each
   step runs.
2. Routing: AUTO-route + show the plan (the plan card is the consent point). PLUS
   a hard requirement below.
3. Big-table cutoff: any table already in the big-table lane ALWAYS routes to the
   Data Hub, AND any chat result over ~2,000 rows routes there too.
4. Approval: APPROVE ONCE, then watch each step run on the grid with pause /
   cancel. Not per-step micro-approvals.

## Hard requirement: the dock persists across navigation

The dock must NEVER unmount, reload, or flicker when BeakerBot navigates between
pages. It should feel like Beaker is continuously using the site with the user,
never caught by a tab refresh or a loading screen. Implementation: mount the dock
in the PERSISTENT layout, above the route outlet (the same pattern TourHost uses in
providers.tsx, where it drives the router without unmounting itself). Page content
and its loading states render BELOW the dock, so the dock stays pinned on top
throughout every navigation and Suspense fallback. The conversation store is
already module-level, so the chat state survives regardless.

## Why this is tractable

The engine, the tools (`wrangle_table`, `suggest_analyses`, `make_datahub_graph`),
the plan card, the nav bridge, and the big-table lane already exist. The work is
wiring them into one orchestrated flow plus the dock UI. No new transform engine,
no new analysis engine. Mockup-first per the Data Hub convention.
