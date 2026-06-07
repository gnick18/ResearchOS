# BeakerSearch, website-wide

BeakerSearch started as the sequence editor's Cmd-K palette. This proposes turning
it into the app's universal, context-aware command surface: the one thing you
reach for on any page to find anything, jump anywhere, or run any tool, with
recommendations that adapt to what is open, what is on screen, what is under your
mouse, and what is selected.

Status: design proposal. The Sequences implementation is the reference; the other
major pages (Gantt, Calendar, Workbench, Purchases) get a worked section below.
Depth: concept plus concrete examples, not a full interaction spec.

## Why

A power tool nobody can find is a power tool nobody uses, and the same is true
page by page. Today every page has its own scattered buttons and menus; there is
no single, learnable "do anything" entry point. BeakerSearch already proved the
pattern on Sequences (open it, and the Suggested zone orients you and offers the
right next moves). Generalizing it gives the whole app one keyboard-first,
mouse-aware command surface, and one habit to learn.

## The architecture

One GLOBAL palette, fed by per-page CONTRIBUTORS.

- A `BeakerSearchProvider` mounts once at the app shell. It owns the open/close
  state (Cmd-K anywhere, plus the visible front-door pill), the input, the
  ranking, and the keyboard model.
- Each PAGE registers a `PaletteSource` while it is mounted (a hook,
  `useBeakerSearchSource(source)`), contributing four things:
  1. CONTEXT, the "what am I looking at" header (the focused entity + the live
     selection / current view).
  2. SUGGESTED, the right next actions for the current context.
  3. ENTITIES, the navigable objects on/near this page (jump to them).
  4. RESULTS, recent outputs worth reopening.
- GLOBAL sources are always present regardless of page: cross-page navigation
  (go to Gantt / Calendar / Workbench / Purchases / Sequences / Methods / a
  project), global object search (find any task / sequence / note / purchase by
  name), and app-level commands (new project, settings, toggle dark mode).
- When the palette opens it merges the active page source with the global
  sources; the page's own context leads, the global reach lives below and in
  the typed search.

This keeps each page's knowledge IN that page (it knows its entities and
handlers) while the shell owns the one consistent surface.

## The contextual model (the real magic)

"Recommendations driven by mouse, on screen, and selected" resolves to four
context signals, in priority order:

1. SELECTED, the user explicitly picked something (a task, an event, a feature,
   a base range, a purchase row). The strongest signal, drives the top Suggested
   actions ("do this to my selection").
2. HOVERED / UNDER THE MOUSE, the row, cell, or object the cursor was last over
   when the palette opened. A softer signal than a real selection, used to
   pre-bias Suggested and to offer "act on the thing I was pointing at".
3. ON SCREEN, what is currently visible (the date range in view, the collection
   filter, the visible task list, the open project). Scopes navigation and
   suggestions to the user's current frame ("jump to a sequence in THIS
   collection", "add an event in THIS week").
4. OPEN / FOCUSED, the primary entity the page is centered on (the open sequence,
   the open project, today on the calendar). The page's identity, shown in the
   context card.

Each page maps these signals to its own objects. A small shared API, the page
provides `getContext()` returning `{ focused, selected, hovered, onScreen }` as
typed references, and the palette renders + ranks from them. Hover is captured
app-wide (the provider tracks the last hovered `[data-beaker-target]` element so
any page can opt a row/cell in by tagging it), so pages get mouse-awareness for
free by annotating their items.

## Item kinds (one ranked, heterogeneous list)

- COMMAND, run an action (the existing model; carries an optional selection
  `detail` echo and an `enabled` predicate).
- NAVIGATE, jump to an entity or a page (a sequence, a task, a project, an event,
  a purchase, or a top-level route). Switches context.
- RESULT, reopen a saved output (an alignment, a domain scan, a report).
- CONTEXT CARD, the non-selectable "what am I looking at" header.

Empty query: the page renders Context card, then Suggested, then page Entities,
then Recent results, then the page command groups, then a slim Global section.
Typed query: the card slims to a one-line header and everything collapses to a
single fuzzy-ranked list across commands + entities + results + global, grouped
by kind. Enter runs / navigates / reopens based on the highlighted item.

## Shared UX (consistent on every page)

- Front door: the BeakerBot + "BeakerSearch" pill (visible, clickable) plus Cmd-K
  everywhere; the open palette is branded with the BeakerBot mark.
- Keyboard-complete: up/down (skipping disabled + non-selectable), Enter,
  Escape; focus trap and restore; combobox/listbox aria.
- Calm, dark-mode-aware, icons via the verified `<Icon>` library, the real
  `<BeakerBot>` mascot. No new inline SVG, no emoji, house voice.
- The Suggested zone is the glue on every page: it teaches the page's powers and
  always offers the obvious next move for the current context.

## The per-page contract

To plug a page into BeakerSearch, it implements `useBeakerSearchSource`:

- `context()` -> `{ focused?, selected?, hovered?, onScreen? }` as typed entity
  refs + a render hint for the context card.
- `suggested(ctx)` -> ranked COMMAND items (selection/hover-aware), with detail
  echoes.
- `entities(ctx, query)` -> NAVIGATE items (the page's objects, scoped to
  on-screen when the query is empty, widened when typing).
- `results()` -> RESULT items (recent reopenable outputs, if any).
- `commands()` -> the page's full command set (the long tail).

The provider handles ranking, rendering, keyboard, and the global layer.

## Reference implementation: Sequences (built)

Sequences is the proven template and already implements the contract informally:

- CONTEXT, the open sequence (name, type, topology, length, features, organism)
  + the live base selection (coords, Tm, GC).
- SUGGESTED, selection-aware (region -> Design primers here / Add feature / Copy;
  CDS -> Protein properties / Find domains), with the selection echoed in the
  row ("from 612..632", "21 nt").
- ENTITIES, "Jump to a sequence", the other sequences in the current collection,
  fuzzy by name and organism, selecting one switches the editor.
- RESULTS, "Recent results", saved Align / domain artifacts, reopenable.
- COMMANDS, the full Design / Analyze / Edit / View / Export set.

Generalizing it across pages mostly means lifting this into the shared provider
and having each page supply its own `context / suggested / entities / results /
commands`.

## Per-page sections

The following sections are filled from the page survey: the entities each page
holds, the actions, and the selection / hover / on-screen model, then BeakerSearch's
context card, suggested actions, navigable entities, and recent results for that
page, with concrete examples.

### Gantt (`/gantt`)

The project-task timeline. Holds Tasks (start / duration / end / project / tags /
complete), Projects, High-Level Goals (milestones), and Dependencies. Its context
is a project filter + a tag filter + the visible time window, with one selected
task (or goal) at a time, and dependency edges that light on hover.

BeakerSearch here:
- CONTEXT card: the active scope, e.g. "Gantt, 3 projects, tag PCR, this quarter",
  and the selected task when one is open.
- SUGGESTED (selection / hover aware):
  - a task selected or hovered -> "Mark 'PCR optimization' complete", "Shift its
    dates", "Add a dependency from here", "Open the task".
  - a goal selected -> "Edit the goal", "Add a task under it".
  - a project filter active, nothing selected -> "Add a task to <project>".
  - nothing -> "New task", "New high-level goal", "Clear filters".
- NAVIGATE: jump to a task by name, jump to a project (sets the filter), jump to a
  goal, or pan the timeline to a date.
- RESULTS: no saved artifacts here; instead surface "Recently edited tasks" as
  quick re-opens.

### Calendar (`/calendar`)

Scheduling. Holds Events (title / date / time / duration / location, optional
`task_id` link), external Feeds, and pulled External Events. Its context is the
current date + view mode (month / week / day), so "on screen" is literally the
visible date range, with one selected event and an optionally expanded day.

BeakerSearch here:
- CONTEXT card: "Calendar, week of Jun 7" (or the month / day), and the selected
  event when one is open.
- SUGGESTED (on-screen + selection aware):
  - an event selected -> "Edit", "Delete", "Link to a task", "Mark as PTO".
  - a day hovered / in view -> "New event on Jun 9", "New all-day event".
  - nothing -> "New event", "Go to today", "Switch to week", "Add a calendar
    feed".
- NAVIGATE: jump to an event by title, jump to a date (types "next monday"), jump
  to a feed, or jump to the linked task of an event.
- RESULTS: none; the freshest signal is upcoming events, which the context can
  surface as "Next up".

### Workbench (`/workbench`)

The hub. A tabbed view (Projects / Experiments / Lists / Notes / 1:1s) over Tasks
by type, Projects, Notes + Notebooks, and lab 1:1s. Its context is the active tab
+ the project filter, with hoverable cards/rows. This page is mostly NAVIGATION,
so BeakerSearch is its most natural surface.

BeakerSearch here:
- CONTEXT card: "Workbench, Experiments, filtered to <project>".
- SUGGESTED (tab + filter aware):
  - Projects tab -> "New project".
  - Experiments / Lists tab -> "New experiment", "Filter by project", and on a
    hovered row "Open <experiment>".
  - Notes tab -> "New note", "Open <notebook>".
  - 1:1s tab -> "New 1:1".
- NAVIGATE (the strong suit): jump to any project, experiment, list, note /
  notebook, or 1:1 by name, and jump between the tabs themselves (deep-linked via
  `?tab=` / `?notebook=`).
- RESULTS: "Recently opened" projects / notes.

### Purchases (`/purchases`)

Ordering + budget. Holds purchase Tasks, Purchase Items (title / price / approved
/ order status), Projects (including the hidden `_misc_purchases`), and Funding
Accounts. Its context is a category filter + an order-status filter, with one
selected purchase, plus a lab-head approval queue.

BeakerSearch here:
- CONTEXT card: "Purchases, needs ordering, 12 items, $3,420" (the active filters
  + a spending snapshot), and the selected purchase when open.
- SUGGESTED (selection / role aware):
  - a purchase selected or hovered -> "Mark 'Pipette tips' ordered", "Mark
    received", "Approve" (lab head), "Add a line item", "Open it".
  - the awaiting-approval filter active (lab head) -> "Approve all pending".
  - nothing -> "New purchase", "Manage funding accounts", "Export selected", "Open
    the spending dashboard".
- NAVIGATE: jump to a purchase by title, jump to a funding account, jump to a
  project's purchases, switch the status filter.
- RESULTS: a generated spending export / report can land here as a reopenable
  result (the Phase 5 artifact idea, generalized beyond sequences).

## Global layer (always available)

- NAVIGATE between top-level pages (Gantt, Calendar, Workbench, Purchases,
  Sequences, Methods, Search, Settings) and into a specific project.
- SEARCH any object across the app by name (task, sequence, note, method,
  purchase, event), opening it on its home page.
- APP COMMANDS, new project, switch user, toggle dark mode, open Settings,
  open the wiki for the current page.

Two findings from the survey shape the global layer:
- There is ALREADY a full-page faceted search at `/search` (tasks / experiments,
  with type / project / method / date / status filters + export). BeakerSearch's
  global object search is the INLINE, instant, cross-type version (find anything
  by name and jump to it); `/search` stays the deep faceted query + bulk export
  surface. BeakerSearch should offer "Search everything for <query>" that hands
  off to `/search` when the user wants the full filter set.
- Records use a composite `"{owner}:{id}"` key to keep own vs shared-with-me
  objects distinct (tasks, projects, methods, purchases). A cross-page jump MUST
  carry that key so a shared record opens in the right owner namespace.
  Sequences are the exception (page-scoped, no owner). And pages already accept
  deep-link params (`?date=`, `?view=`, `?tab=`, `?notebook=`, `?collection=`),
  so a NAVIGATE item should preserve / set them rather than dropping the user on
  a bare route.

## Rollout (suggested, not for sign-off here)

1. Extract the Sequences palette into the shared `BeakerSearchProvider` + the
   per-page contract, with Sequences as the first source (no behavior change).
2. Add the GLOBAL layer (cross-page navigation + global object search) so Cmd-K
   does something useful on every page immediately.
3. Add page sources one at a time (Workbench, Gantt, Calendar, Purchases), each
   contributing its context / suggested / entities / results.
4. Mouse-awareness, the `[data-beaker-target]` hover capture, opted into per page.

## Open questions

- Global object search needs an index across the local data folder; cheap to
  build incrementally (name + type + route per object) but worth a deliberate
  pass.
- Hover-as-context is powerful but subtle; we should prototype it on one page
  (Workbench rows) before committing it everywhere.
