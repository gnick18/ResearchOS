# Handoff, sequence editor master (BeakerSearch website-wide initiative)

Written 2026-06-07 so a fresh chat (on the other account) can take over cleanly.
This file captures everything this session owns, the current state on `main`, the
open threads, and the working rules to honor. Read it top to bottom, then pick up
at "What to do next".

Sign your work as `sequence editor master` (commit body refs, chat, spawn_task
prompts) so output stays traceable across the orchestrator hierarchy.

---

## Who this session is

The "sequence editor master" orchestrator. It drove the big Sequences-page
redesign (Phases 1 to 5), built the icon system + guard, branded the Cmd-K
command palette as **BeakerSearch**, made it contextual, and is now generalizing
BeakerSearch into a **website-wide, context-aware command palette** across every
major page.

Flat-hierarchy orchestrator model: this session IS the master, it dispatches
sub-bots directly into isolated git worktrees and cherry-picks their commits onto
local `main`.

---

## Current state on `main`

- Branch: `main`. Latest relevant commit at handoff time: `963fe60cd`.
- This session's commits (most recent first):
  - `a0792eeca` link per-page BeakerSearch specs + grounding fixes (master doc)
  - `e295a034a` exhaustive BeakerSearch plan for Purchases
  - `6d5185661` exhaustive BeakerSearch plan for Gantt
  - `edf7fed46` exhaustive BeakerSearch plan for Workbench
  - `ce8f5da74` exhaustive BeakerSearch plan for Calendar
  - `69f5124af` add optional `task_id` link to the Event data model
- `963fe60cd feat(lab-head): canonical useLiveEditSession reader` was landed by
  the **sharing / Loro-collab bot**, not this session, but it directly resolves
  one of our open threads (see Purchases below).
- The working tree at handoff has unrelated modified/untracked files from OTHER
  concurrent sessions (`.gitignore`, `scripts/activity-report/*`, `docs/audits/*`,
  `docs/mockups/freehand-icon-options.html`). DO NOT touch or commit those, they
  belong to other agents.

---

## The active initiative: BeakerSearch website-wide

**Goal (Grant's words):** build BeakerSearch into "a more website function and not
just to the seq page", with a fully fleshed-out design for EACH major page
(Gantt, Calendar, Workbench, Purchases) whose recommendations react to the user's
mouse, what is on screen, and what is selected.

**Locked structure + depth:** one master doc with per-page sections, at
concept-plus-concrete-examples depth. Then Grant asked for an exhaustive,
build-ready follow-up spec per page (done, see below).

### Deliverables, all on `main` under `docs/proposals/`

- `beakersearch-website-wide.md` (the master proposal). Architecture
  (`BeakerSearchProvider` at the app shell + per-page `useBeakerSearchSource`
  contract contributing Context / Suggested / Entities / Results + a global
  layer), the contextual model (four signals SELECTED > HOVERED > ON-SCREEN >
  OPEN; hover captured app-wide via `[data-beaker-target]`), item kinds
  (COMMAND / NAVIGATE / RESULT / CONTEXT CARD), shared UX, the per-page contract,
  Sequences as the reference, concept-level per-page sections, the global layer
  (its relationship to the existing full-page `/search`, composite `owner:id`
  keys, deep-link param preservation), rollout, open questions. Links out to the
  four companion specs.
- One build-ready companion spec PER top-level nav page, all on `main`:
  `beakersearch-gantt.md` (720), `beakersearch-calendar.md` (~700),
  `beakersearch-workbench.md` (717), `beakersearch-purchases.md` (560),
  `beakersearch-methods.md` (711), `beakersearch-lab-overview.md` (747),
  `beakersearch-home.md` (608), `beakersearch-links.md` (686). Each is the
  build-ready spec for that page: entity model + composite/query keys, the
  four-signal context model mapped to real state vars, every Suggested variant
  wired to its exact real handler + `enabled` predicate, navigable entities,
  results, the long-tail command set, a typed `useBeakerSearchSource`
  implementation sketch, and keyboard / permission / edge-case coverage. The
  whole nav is now covered. Sequences is the built reference (no spec needed),
  and `/search` is the deep faceted page BeakerSearch's inline global search
  complements.

  Grounding corrections the planners surfaced (all folded into the master doc):
  - Home (`/`) is a pure REDIRECT ROUTER now (bounces lab heads to
    `/lab-overview`, everyone else to `/workbench`), not a dashboard, so it
    likely needs no page source, just a global launchpad card.
  - Gantt filter is `"all" | "explicit"` over a custom React grid; window is
    `ganttStartDate` + `viewMode` store state.
  - Lab Overview is lab-head-only and gates every mutating command behind
    `useLiveEditSession` (`isLive && username === currentUser`), EXCEPT the
    Announcements composer which is intentionally ungated.
  - Methods has no persistent type/category filter (only free-text search) and
    no viewer-level fork button (fork lives in `DeviationModal`).
  - Links has a stub `getPreview` and no category-filter state yet (both need a
    small lift).

### Two grounding corrections the planners surfaced (folded into the master doc)

- Gantt's project filter is really a two-state model, `projectFilterMode` is
  `"all" | "explicit"` over a CUSTOM React grid (`GanttChart.tsx`), not an
  explicit/implicit/off triad over frappe-gantt. The visible window is store
  state (`ganttStartDate` + `viewMode`), not a scroll offset.
- The Calendar `Event` type had no `task_id` and no `duration_minutes` /
  `is_all_day`; an all-day event is just `start_time === null`.

---

## Decisions made this session (already actioned)

1. **Calendar event-to-task linking is now REAL.** Grant approved adding the
   field. `Event` / `EventCreate` / `EventUpdate` in `frontend/src/lib/types.ts`
   gained optional `task_id?: number | null` + `task_owner?: string | null` (the
   pair forms the composite `"<owner>:<id>"` key matching `taskKey`, resolving
   shared tasks). Additive, nullable, backward-compatible (same pattern as
   `is_pto`), rides the existing `...data` passthrough in `eventsApi`, no
   migration. The Calendar + master specs were updated to mark "link to a task"
   and "jump to linked task" as LIVE. Commit `69f5124af`.
   - REMAINING UI: the EventModal task picker that actually sets the pair (a task
     typeahead scoped to `fetchAllTasksIncludingShared`) plus a chip in the event
     detail showing the linked task. Not built yet, speced as a small follow-up.

2. **Purchases inline "Approve" is now UNBLOCKED.** The blocker was that the
   lab-head approval action `setPurchaseApproval` (in `src/lib/lab/pi-actions.ts`)
   is gated by `assertLiveSession(actor, sessionId)`, and the Purchases page had
   no session id. This session wrote a handoff message to the sharing/collab bot
   (which owns the lab-head / edit-session surface) asking for a page-agnostic
   reader. The bot delivered `useLiveEditSession()` in
   `frontend/src/hooks/useEditSession.ts`, returning
   `{ isLive, sessionId, username }` (commit `963fe60cd`). So when BeakerSearch
   is built for Purchases, the inline Approve command should:
   - read `useLiveEditSession()`,
   - `enabled` only when `isLive && username === currentUser`,
   - call `setPurchaseApproval({ actor: username, sessionId, ... })`,
   - and (recommended) when NOT live, route to Lab Overview to unlock first.
   - TODO: update `beakersearch-purchases.md` open questions to reflect this is
     resolved (the doc still frames it as "needs wiring").

---

## What to do next (pick up here)

Nothing is mid-build, the initiative is fully in the design/planning phase and
all five docs are committed. Likely next moves, in priority order:

1. **Reflect the two resolutions in the specs.** Update
   `beakersearch-purchases.md` to mark the live-session wiring resolved (point at
   `useLiveEditSession`). The Calendar spec is already updated for `task_id`.
2. **Build is UNDERWAY (Grant said "lets build!!" 2026-06-07).** The locked
   rollout and its status:
   - Step 1, lift the Sequences palette into a shared `BeakerSearchProvider` at
     the app shell with ZERO behavior change. DONE + verified + on `main`
     (commit `d76f1e6e5`): new `frontend/src/components/beaker-search/`
     (`BeakerSearchProvider.tsx` owns open-state + the global Cmd-K listener that
     only acts when a source is registered, `useBeakerSearchSource.ts`,
     `types.ts`), mounted in `lib/providers.tsx` beside `ContextMenuProvider`,
     and `SequenceEditView` now registers its source instead of owning the
     palette. tsc clean, 38 palette/editor-commands tests green. Grant to give a
     10-second live Cmd-K confirm on his running server (orchestrator cannot
     start a competing dev server against his :3000).
   - Step 2a, the always-present global layer (cross-page nav "Go to" + "App"
     commands + the app-chrome pill). DONE + on `main` (commits `b6659a504`,
     `9c713c255`). Lives in `frontend/src/components/beaker-search/`
     (`useGlobalCommands.ts`, `BeakerSearchPill.tsx`).
   - Step 2b, global object search. DESIGN FORK SETTLED. The design doc
     (`docs/proposals/beakersearch-global-search.md`) plus the locked build
     contract (`beakersearch-global-search-decisions.md`, Grant signed off
     2026-06-07) define a cross-app index that is a thin reader over the four
     canonical React Query caches (eager-once prefetch), v1 core = Tasks /
     Projects / Methods / Sequences. Four build chunks.
     - CHUNK 1 DONE + on `main` (commit `5a96bd602`): `global-index.ts`
       (pure `buildGlobalIndex()` + `GlobalIndexEntry`), `useGlobalObjectIndex.ts`
       (the cache reader + shell-mount prefetch, mounted in
       `BeakerSearchProvider`, value unused until chunk 2), the methods query-key
       alignment (decision 5), and 19 unit tests. Grounding fix found during the
       build, the only existing task opener is the home-route `/?openTask=` popup
       (no per-page task route), so that handler was extended to resolve the
       composite `taskKey` (Grant approved pulling the shared-task opener into v1,
       to match methods/projects/sequences which already open shared records).
     - CHUNK 2 DONE + on `main` (commit `864416a79`): the global NAVIGATE source
       is now VISIBLE in the palette. `global-source.ts` (pure `rankGlobalEntries`
       + `activePageTypeForPath`, type-weight + recency ranking, 5-per-type /
       12-overall caps, on-page de-dup, empty-query yields nothing), a new
       `"object"` PaletteItem kind in `editor-commands.ts` spliced between the
       page's own groups and the global Go to / App commands, the palette renders
       + 120ms-debounces the object ranking, and `BeakerSearchProvider` feeds the
       index + active page type + a router-push navigate. 15 new unit tests, tsc
       clean, all green. This is the first chunk Grant can test live (Cmd-K on any
       page, type a task/project/method/sequence name, Enter jumps via its
       deep-link; shared-task jumps exercise the chunk-1 opener).
     - CHUNK 3 DONE + on `main` (commit `c343e3748`): the `/search` handoff. A
       trailing "Search everything for <q>" row (a new `searchAll` PaletteItem
       kind under a "More" heading, always last, only while typing) pushes
       `/search?keywords=<q>`; `/search` reads `?keywords=` once on mount, seeds
       its box, runs the search, strips the param. Additive, the only `/search`
       touch the feature needs. 2 new render tests, tsc clean, 71 tests green.
     - CHUNK 4 DONE + on `main` (commit `8c499fe38`): the per-user Recent-records
       MRU. `recent-records.ts` (pure push/resolve/parse, cap 5, stores only
       {type,key} refs re-resolved against the live index so rows stay fresh and
       deleted records fall off), a per-user `localStorage` MRU in the provider
       (key `beakerSearchRecent:<user>`), a "Recent records" group shown ONLY in
       the empty-query view (the one thing the global source adds before you type).
       13 + 2 tests, tsc clean, 84 tests green.
     - GLOBAL OBJECT SEARCH v1 IS COMPLETE (all four chunks shipped). What is left
       is the rest of the website-wide rollout, Step 3 (per-page sources) and
       Step 4 (mouse-awareness), below.
   - Step 3, add page sources one at a time per the specs (Gantt, Calendar,
     Workbench, Purchases, Methods, Lab Overview, Links). Grant chose the FULL
     per-page contract (context card + Suggested + entities), one page at a time.
     - FOUNDATION DONE + on `main` (commit `86aedc5f7`): the generic per-page
       source contract. `BeakerSearchSource` now accepts `contextCard` +
       `suggestedIds` (+ `suggestedHint`) + `navGroups` (generic entity/result
       groups), the palette renders a `GenericContextCard` + a `"nav"` PaletteItem
       kind, `buildPaletteResultsForQuery` has a generic path (suggestedIds ->
       Suggested, navGroups scored + bucketed under page headings, capped on the
       resting view). Additive, the sequence editor keeps its exact typed path
       unchanged. 6 new unit tests, 90 green. INVISIBLE until a page registers a
       generic source.
     - FOUNDATION FULLY DONE: page-defined command groups (`731e1f8b7`), the
       context-card selection line (`3d09931c9`), and a `goal` PaletteTone +
       teal chip (`eb526fcc8`). The generic contract now covers everything a page
       needs (context card incl. a selection line, suggestedIds, navGroups with
       per-type tones incl. goals, and page-defined command + nav-group headings).
     - GANTT DONE + on `main` (commit `70d6a1a99` cherry-picked): the first real
       page source, Grant approved the mockup
       (`docs/mockups/beakersearch-gantt-palette.html`) then I built it. A pure
       `buildGanttSource()` (`app/gantt/gantt-beaker-source.ts`, 25 unit tests) +
       a `useGanttBeakerSource()` hook reading the live store/queries + one wire in
       `app/gantt/page.tsx`. Context card (scope + selection), selection-aware
       Suggested (task + goal action sets, read-only gated), Jump to task/project/
       goal, Recently opened (session-local), and the Create / Filter and scope /
       Timeline view command groups. tsc clean, 69 tests green. ICON NOTE, the
       registry has no "calendar" glyph, so the build substitutes registered icons
       (history for the timeline/scope card, map for goals, etc.), a minor visual
       deviation from the mockup worth a live glance.
     - CALENDAR DONE + on `main` (commit `feaea6af3`, mockup
       `docs/mockups/beakersearch-calendar-palette.html` approved): pure
       `buildCalendarSource()` (`app/calendar/calendar-beaker-source.ts`, 20 tests)
       + `useCalendarBeakerSource()` hook + page wire. Context card (month/week/day
       frame + selection), selection-aware Suggested (native event edit/duplicate/
       PTO/link/open/delete + external open-in-source/show-feed/copy + day-in-view),
       Jump to an event (native "event"/rose, external "feed"/slate tones), Next up
       (upcoming events), and Create / Navigate / View / Feeds commands. PTO toggles
       reuse syncEventPtoChange + expandDateRange (never raw pto_dates). Added the
       "event" + "feed" PaletteTones. tsc clean, 70 tests green.
       - jump-to-DATE GAP NOW CLOSED (commit `27ca34908`): added a per-source
         `interpretQuery(query)` seam to the contract. A page turns the live typed
         query into LEAD rows that depend on the query text (not fuzzy-scored,
         prepended in the typed branch, absent on empty query). Calendar wires it
         via a pure `parseCalendarDate` (strict YYYY-MM-DD + today/tomorrow + "Jun
         9" style) -> a "Go to <date>" row calling goToDate. General, any page can
         interpret typed input ("Create a task named <query>", etc.). 9 new tests.
     - WORKBENCH DONE + on `main` (commit `839a0eb98`, mockup
       `docs/mockups/beakersearch-workbench-palette.html` approved): the main hub,
       one source spanning all five tabs. Pure `buildWorkbenchSource()`
       (`app/workbench/workbench-beaker-source.ts`, 23 tests) +
       `useWorkbenchBeakerSource()` + the page wire. Context card (tab + filter +
       selection), selection-aware Suggested, the HEADLINE cross-tab jump-to-any
       (experiment "task"/amber, project "project"/violet, note+notebook "note"/
       indigo, 1:1 "person"/pink) + tab switches, Recently opened (cross-tab
       localStorage MRU), Create / Filter / Open-a-notebook commands. Added "note"
       + "person" PaletteTones. The cross-tab jump uses a lifted `pendingOpen`
       intent on the page + a new `initialOpen` prop on all four panels
       (Experiments/Lists/Notes/1:1), modeled on NotesPanel's `initialNotebookId`.
       tsc clean, 76 tests green.
       - SIMPLIFICATIONS (spec-authorized, v1): the focused SELECTION is the page's
         lifted "most recently opened via the palette" entity, NOT a live read of
         each panel's private popup state (lifting all of it is a big rewrite). So
         the context card / Suggested name the last palette-opened entity, not one
         opened by a raw card click. Hover-as-context (spec 3.4, [data-beaker-
         target]) is NOT wired (that is Step 4). Row actions open the entity +
         switch tab rather than re-implementing each mutation. Detail echoes are
         light approximations, not the panel's full assignSection.
     - PURCHASES DONE + on `main` (commit `e23b96bef`, mockup
       `docs/mockups/beakersearch-purchases-palette.html` approved): pure
       `buildPurchasesSource()` (`app/purchases/purchases-beaker-source.ts`, 21
       tests) + `usePurchasesBeakerSource()` + page wire. Context card (scope +
       spend total + lab-head approval line), role/permission-aware Suggested
       (order status, Approve/Decline), Jump to a purchase (tone "task") + Funding
       accounts (tone "funding"/green), the reopenable spending-export result, and
       the Create / Order status / Approval / Filters / Funding / Spending / Order
       management commands. Added the "funding" PaletteTone. tsc clean, 76 tests.
       - SEAM CHANGE (important): my brief said Approve uses `useLiveEditSession`
         (the sharing bot's seam). That was SUPERSEDED by the PI capability revamp
         (also 2026-06-07): no `useEditSession.ts` exists. The current gate is the
         per-record once-per-session confirm, `usePiEditGate` / `pi-edit-guard` /
         `markPiEditConfirmed` (+ `piEditKey`). The build correctly wired
         `hasLiveSession` to the PI edit-confirm state for the focused order's
         owner; approve/decline `markPiEditConfirmed` before `setPurchaseApproval`
         / `declinePurchase`. Approve is enabled only `isLabHead && hasLiveSession`,
         greyed-with-reason for lab-head-not-confirmed, OMITTED for members.
       - Export result uses a window-event bridge (`purchases:export-csv` /
         `purchases:focus-dashboard`) the SpendingDashboard listens for (the export
         handler lives in that component; lifting it would be a big refactor).
       - HOVERED-as-context inert (provider has no hover tracking yet; Step 4).
       - PRE-EXISTING (not ours): 7 failures in `purchases-page.misc-filter` /
         `purchases-page.shared-gate` from a `usePathname` mock gap in SuppliesTabs
         (verified by stash, 7 before + after).
     - METHODS DONE + on `main` (commit `02203f358`, mockup
       `docs/mockups/beakersearch-methods-palette.html` approved): pure
       `buildMethodsSource()` (`app/methods/methods-beaker-source.ts`, 28 tests) +
       `useMethodsBeakerSource()` + page wire. Context card (library scope + open
       method), permission-aware Suggested (Edit/Rename/Move/Fork/Extend/Share/
       Delete/Retire, gated on `useMethodPermissions().canModifyMethod`; fork
       ALWAYS enabled; retire only when is_public; delete/share excluded for
       shared-into-me; shared-with-edit writes owner-routed via ownerScopedMethods
       Api), the TWO navigate kinds (Your methods tone "method"/emerald + Open;
       Template library NEUTRAL chip + library glyph + Use), Recent methods MRU,
       and the Create/Templates/Open-edit/Kits/Share/Copy/Delete/Find commands. No
       new tone (templates icon-distinguished per Grant). Catalog manifest
       prefetched via the existing fetchMethodCatalogManifest. tsc clean, 28 + 53
       tests green. Hovered-as-context inert (Step 4).
     - NEXT pages per the same pattern (mockup -> approve -> build): Lab Overview,
       Links (the last two). Reuse the five built sources as templates.
   - Step 4, app-wide mouse-awareness (`[data-beaker-target]` hover capture) last.
3. **Optional small follow-up:** the EventModal task-picker UI so a user can
   actually create an event-to-task link (the field exists, the UI does not).

### Deferred follow-ups (not requested, low priority)

- Live-verify the Phase 5 artifact deposit on Grant's running `:3000` (the
  Results section scaffolding is present but headless artifact deposit was never
  confirmed). Same for the drag-selection Suggested echo.
- Tree / digest artifacts (Phase 5 model is extensible via the `type` union).
- Edit-on-translation-handle in the sequence editor.
- Migrate remaining inline icons to `<Icon>`.

---

## The sequences redesign context (already DONE, for background)

All shipped + on `main`, validated live via Claude Preview:

- Phases 1 to 5 of the Sequences editor redesign, including Phase 5 "results as
  artifacts" (per-sequence sidecar `sequences/{id}.artifacts.json`, a Results
  section in the History tab). Design doc:
  `docs/proposals/sequences-results-artifacts-phase5.md`.
- The icon system: a verified `<Icon name>` registry in
  `frontend/src/components/icons/`, plus a ratchet guard
  (`icon-guard.test.ts` + `frontend/icon-svg-baseline.json` +
  `scripts/update-icon-baseline.mjs`) that BLOCKS new inline `<svg>`. If the
  guard goes red from a stale baseline after concurrent sessions, regenerate and
  commit the baseline.
- BeakerSearch itself: branded Cmd-K palette
  (`frontend/src/components/sequences/CommandPalette.tsx` +
  `editor-commands.ts`), contextual (context card + selection-echoing Suggested +
  Jump-to-a-sequence + Recent results), mounted in `SequenceEditView.tsx`.
- Translation-on-feature rendering fixes (frame-aware dedup in
  `lib/sequences/translation-tracks.ts`; SeqViz `genPath` chevron tip + duplicate
  React key fixes in `src/vendor/seqviz/Linear/Translations.tsx`).
- A mockup exists at `docs/mockups/beakersearch-suggested.html` (the richer
  Suggested zone).

---

## Working rules to honor (from the orchestrator's standing memory)

- **Voice (strict):** no em-dashes, no en-dashes, no emojis, no mid-sentence
  colons (line-start label terminators like "Goal:" are fine). Applies to all
  prose, docs, commits, chat, AGENTS.md. Put "no em-dashes, no emojis, no
  mid-sentence colons" in every brief you write for a sub-bot.
- **No emojis in production UI.** Every user-facing icon is a custom inline SVG
  component; the project does not depend on lucide-react. Use the `<Icon>`
  registry.
- **Git / origin:** Grant pushes to origin himself, you work on local `main`. DO
  NOT push branches. Commit + merge into local `main` after each coherent change
  so Grant can debug the UI alongside the work. UI-only work can merge on report;
  backend / data-shape / migration work waits for verification.
- **Flag data-shape touches BEFORE committing** (new field / sidecar / new path).
  The `Event.task_id` add was an approved, pre-discussed exception.
- **Sub-bots run in ISOLATED worktrees** (`git worktree add ... main`, or base on
  a known SHA), never edit shared files in a shared tree, then the master
  cherry-picks their commits. Fresh worktrees lack `node_modules`, COW-clone with
  `cp -c -R` (symlink breaks Turbopack), do not `npm install`.
- **Dev server:** never start a 2nd `next dev` against the master `frontend/`
  while Grant's `:3000` runs (shared `.next` corrupts Turbopack's cache).
- **Screenshots:** fixture data only (`?wikiCapture=1`), never real user data.
  Deliver screenshots by `cp` to `~/Desktop` + `open` (inline Read-image does not
  reach Grant's client).
- **Run vitest / tsc from `frontend/`** (the `@` alias lives in
  `frontend/vitest.config.mts`).
- **Use the `<Tooltip>` component**, not native `title=`. Use dark-mode tokens
  (`bg-surface` / `text-foreground` / `border-border`). Build popups on the
  `LivingPopup` primitive.
- **Standing autonomy:** spawn well-scoped sub-bots without asking; only
  direction / destructive / data-shape decisions need Grant's eye. Full edit
  power over AGENTS.md without asking. Ask Grant via clickable AskUserQuestion
  options, not free-form prose, for design/direction questions.

---

## Key files map

- Master proposal: `docs/proposals/beakersearch-website-wide.md`
- Per-page specs: `docs/proposals/beakersearch-{gantt,calendar,workbench,purchases}.md`
- BeakerSearch UI + data model:
  `frontend/src/components/sequences/CommandPalette.tsx`,
  `frontend/src/components/sequences/editor-commands.ts`,
  `frontend/src/components/sequences/SequenceEditView.tsx`
- Event type (just edited): `frontend/src/lib/types.ts` (search `interface Event`)
- Live edit-session reader (sharing bot's, for Purchases Approve):
  `frontend/src/hooks/useEditSession.ts` (`useLiveEditSession`)
- Lab-head purchase approval action: `frontend/src/lib/lab/pi-actions.ts`
  (`setPurchaseApproval`, `assertLiveSession`)
- Page entry points: `frontend/src/app/{gantt,calendar,workbench,purchases,sequences}/page.tsx`

---

## Outstanding message to pass along (already drafted)

A handoff message to the **sharing / Loro-collab bot** about the Purchases
live-session reader was drafted in chat. It has largely been actioned already
(`useLiveEditSession` exists). If anything else in the lab-head / edit-session
area is needed for Purchases, that bot owns it.
