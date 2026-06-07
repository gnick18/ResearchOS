# BeakerSearch on Home (exhaustive interaction spec)

This is the build-ready companion to the Home / launchpad story of
`docs/proposals/beakersearch-website-wide.md`. The master doc holds the
architecture (one global `BeakerSearchProvider`, per-page
`useBeakerSearchSource` contributors, the four context signals, the four item
kinds, the always-on global layer). This doc takes Home from concept depth to a
full interaction spec grounded in the real `/` code, so a builder can wire the
source (or deliberately decline to) without rereading the route.

Voice in this doc and in every copy string it specifies: no em-dashes, no
en-dashes, no emojis, no mid-sentence colons. Icons are `<Icon>` from the
verified library (the same constraint the Sequences `CommandPalette` already
enforces), never inline SVG inside palette rows, and the mascot is the real
`<BeakerBot>`.

## 0. The headline truth about Home (read this first)

Home is NOT a dashboard. As of the widget-framework teardown v2 (2026-06-02),
`/` renders no canvas of its own. `src/app/page.tsx` is a pure ROUTER. It
resolves the current user, runs the `?openTask=` / `?openProject=` deep-link
handlers, then bounces to the surface that owns the account type via
`decideLandingRedirect` (`src/app/page-landing-redirect.ts`):

- `accountType === "lab_head"` bounces to `/lab-overview` (the curated
  `LabOverviewPage`).
- everyone else bounces to `/workbench`.
- an explicit non-`/` default landing tab (`useAppStore().defaultLandingTab`)
  wins over the role default.

The only thing `/` paints itself is a login gate (`UserLoginScreen` when there
is no `currentUser`), a light centered spinner while the bounce resolves, and,
when a deep link is active, a single `TaskDetailPopup`. There is no "good
morning, here is today" canvas, no streak widget, no today/upcoming/recent
panels on this route. The brief's mental model of Home as a summary dashboard
describes the OLD widget canvas that was deleted; the streak/today/recent
material now lives either in global chrome (the `StreakBadge` in the AppShell
header) or on the destination routes (`/lab-overview`, `/workbench`), each of
which gets its own page source.

The honest consequence, spelled out in section 7 and the open questions, is that
Home contributes almost nothing PAGE-LOCAL to BeakerSearch. Its job is to be the
launchpad that AMPLIFIES the global layer plus a rich, navigation-first context
card. This doc specifies exactly that, and is deliberate about what NOT to
invent (there are no Home mutating handlers, because Home has no widgets to
mutate).

## 1. ENTITY MODEL (what Home can surface, and from where)

Home owns no entities of its own. It is a router. But by the time the bounce
fires (and during the brief window it is visible, and on a deliberate manual
visit that stayed put via the `?from=` sentinel), `page.tsx` has already kicked
off the two queries every other surface uses, so the SAME cached data is
available to a Home BeakerSearch source at zero extra fetch cost:

| Domain | Fetch | Query key | Already read by `page.tsx` |
| --- | --- | --- | --- |
| Projects | `fetchAllProjectsIncludingShared()` | `["projects", currentUser]` | yes, line 101 |
| Tasks (all types) | `fetchAllTasksIncludingShared()` | `["tasks", currentUser]` | yes, line 106 |

These are the SAME composite-key-aware fetchers Workbench, Gantt, and Purchases
read (`fetchAllProjectsIncludingShared` returns own + shared-into-me with
`owner` / `id` / `name` / `color` / `is_shared_with_me`; `fetchAllTasksIncludingShared`
returns Tasks with `task_type`, `start_date`, `duration_days`, `end_date`,
`is_complete`, `last_edited_at`, `owner`, `is_shared_with_me`). Home reads them
purely to power a context card and a few echoed Suggested rows; it never renders
them as a grid.

Two more signals Home can surface, both from sources OUTSIDE react-query:

- STREAK: `readStreak(currentUser)` from `src/lib/streak/streak-sidecar.ts`
  (a sidecar file, not a query key), the same data the header `StreakBadge`
  reads. This is the only "good morning" style signal that survived the teardown,
  and it lives in global chrome, not on `/`. A Home context card MAY echo it
  ("4 day streak"), but it belongs to the global layer conceptually (see 2.4 and
  7.3), not to a Home page source.
- ACCOUNT TYPE + DEFAULT LANDING TAB: `useAccountType(currentUser)` and
  `useAppStore().defaultLandingTab`. These tell Home WHERE it is about to send
  the user, which is the single most useful thing its context card can say
  ("Heading to your Workbench").

### 1.1 Derived "today / upcoming / recent" sets (if a context card wants them)

The brief asks for today's / upcoming / recent summaries. None of these are
stored fields; they are derivable from `["tasks", currentUser]` with the same
date math the Gantt and Workbench panels already use. A Home source that wants a
richer context card can compute, in a `useMemo` over `allTasks` (never a new
fetch):

- TODAY: incomplete tasks whose `[start_date, end_date]` interval contains
  `today` (today is between `start_date` and `computeEndDate`-derived `end_date`
  inclusive), `is_complete === false`.
- UPCOMING: incomplete tasks with `start_date > today`, sorted ascending, take
  the next few.
- RECENT: tasks sorted by `last_edited_at` descending (the freshness signal the
  Workbench experiment cards already surface), take the last few touched.

These are SUMMARY COUNTS for the context card ("3 due today, 5 coming up"), not
navigable entity lists. Home is a launchpad; the navigable lists belong to the
destination page's source (Workbench / Gantt / Calendar). If a builder decides
Home should not even compute these (the lighter option in 7), the context card
falls back to the account-type headline alone, which is still useful.

## 2. CONTEXT MODEL (the four signals on a launchpad)

The master's four signals (SELECTED, HOVERED, ON SCREEN, OPEN/FOCUSED) assume a
page with rendered objects. Home renders none, so the mapping is intentionally
thin. The context object the source returns is still
`{ focused, selected, hovered, onScreen }` plus a render hint for the card, but
most slots are empty by design.

### 2.1 OPEN / FOCUSED -> the destination the user is heading to

Home has no open document. Its identity is "the launchpad, about to send you to
`<role default>`". `focused` resolves to a synthetic landing reference:

```ts
focused: {
  kind: "landing",
  destination: defaultLandingTab && defaultLandingTab !== "/"
    ? defaultLandingTab
    : (accountType === "lab_head" ? "/lab-overview" : "/workbench"),
}
```

This mirrors the exact precedence in `decideLandingRedirect` (explicit landing
tab wins, else role default). It is what the context card headline prints
("Heading to your Workbench" / "Heading to your Lab Overview").

### 2.2 ON SCREEN -> the whole-account summary ("today")

Home has no visible frame (it shows a spinner), so "on screen" cannot mean a
scroll window or a filter the way it does on Gantt / Calendar. Instead Home's
honest "on screen" is the WHOLE-ACCOUNT summary, the closest a launchpad has to
"what am I looking at". `onScreen` resolves to the derived today/upcoming/recent
COUNTS from 1.1:

```ts
onScreen: {
  kind: "account-summary",
  dueToday: number,
  upcoming: number,
  recentlyTouched: Task[],   // small, for the "resume" Suggested rows
}
```

This is the data behind the "good morning, here is today" card content the brief
asks for. It is a SUMMARY, not a navigable list (see 2.5).

### 2.3 SELECTED -> almost always empty (one deep-link exception)

Home has no rows or cards to select, so `selected` is `undefined` in the normal
case. The ONE exception is the deep-link `TaskDetailPopup`: when the user landed
via `/?openTask=<id>` and the popup is open (`selectedTask !== null` in
`page.tsx`), that task IS a real selection and the redirect is suppressed, so the
user is genuinely sitting on `/` with a task open. In that narrow case:

```ts
selected: selectedTask
  ? { kind: "task", task: selectedTask }
  : undefined
```

and SUGGESTED can offer task-scoped moves ("Open in Workbench", "Go to its
project"). This is rare but real, and it is the only page-local selection Home
ever has.

### 2.4 HOVERED -> nothing to tag

Home renders no `[data-beaker-target]` rows (it has no rows). `hovered` is always
`undefined` on Home. There is nothing to annotate, and inventing hover targets
here would be fiction. The header `StreakBadge` and the AppShell nav links are
global chrome, not Home content, so they are NOT Home's to tag (the global layer
owns cross-page nav). This is a deliberate non-feature.

### 2.5 The context card contents (the "good morning" card)

Empty query, the non-selectable header at the top. Home's card is the richest
part of its contribution, because it is the one thing a launchpad CAN say well.
Format, two lines:

- Headline: `Heading to your <destination label>` where the label comes from the
  same route the bounce uses (Workbench / Lab Overview / the explicit landing
  tab's friendly name). When the bounce is suppressed (a deliberate manual visit
  via `?from=`), read it as `Home` with a sub explaining the destination.
- Sub line, the account summary from 2.2, only when it has signal:
  `3 due today, 5 coming up` (omit a zero clause, so `5 coming up` alone, or
  `All clear today` when both are zero). Optionally append the streak echo
  ` + 4 day streak` ONLY if streak is enabled and nonzero (mirror `StreakBadge`'s
  own hide rules so Home never shows a streak the badge would hide).

When the deep-link `selectedTask` is open (2.3), the card gains a second
identity line naming the task ("Miniprep, running, due today"), mirroring the
Sequences context card's "open thing + live detail" two-line shape.

The card is non-selectable and never landable by the keyboard cursor, exactly
like every other page's context card.

## 3. SUGGESTED (the most useful next moves from the launchpad)

Home's Suggested zone is its second-most-valuable contribution after the card.
Because Home is a launchpad, almost every Suggested item is a NAVIGATE (jump
somewhere) or a global COMMAND (create something), echoing real account state.
The list, in priority order, with each row tagged NAVIGATE or COMMAND:

### 3.1 With a deep-link task open (the `selectedTask` case, rare)

1. NAVIGATE, "Open Miniprep in Workbench", jumps to the task on its home surface
   (`/workbench?...` resolving the task, or the cross-tab open seam the Workbench
   doc specifies). Echoes the task name.
2. NAVIGATE, "Go to its project <name>", when `selectedTask.project_id` resolves
   to a project (`/workbench/projects/<id>[?owner=]`, the same owner-suffix rule
   `page.tsx` already implements for `?openProject=`).

These outrank everything else while the popup is open (the strongest signal,
master 1).

### 3.2 The normal launchpad case (no selection)

In priority order, all echoing real state:

1. NAVIGATE, "Go to your Workbench" (or "Go to your Lab Overview" for a lab
   head), the role default, the single most likely move. Pre-highlighted so a
   bare Cmd-K then Enter does the obvious thing.
2. NAVIGATE, "Jump to today's work", when `dueToday > 0`, lands on Gantt / the
   Workbench Experiments tab scoped to today (the destination that best shows
   in-flight work). Detail echo `3 due today`. Hidden when `dueToday === 0`.
3. NAVIGATE (resume), one row per recently touched item (2.2 `recentlyTouched`,
   the top 2 to 3), "Resume Miniprep" / "Resume PCR optimization". Each is a real
   jump to that task on its home surface. Detail echo `edited 2h ago`. This is
   the "resume a recent item" move the brief calls for, and it doubles as the
   RESULTS / MRU content (see 5, they share the source).
4. COMMAND, "New experiment", the most common create from a cold start (the
   global create command, sets the shared `isCreatingTask` / `restrictedTaskType
   = "experiment"` flags `TaskModal` reads). Detail echo none.
5. COMMAND, "New task" / "New note" / "New project", the rest of the create set,
   all global commands (see 6).
6. NAVIGATE, "Go to the page you use most", when an explicit `defaultLandingTab`
   differs from the role default, surface it by name ("Go to Calendar"). This
   echoes the user's own configured preference.

Every Suggested row points at a REAL handler (a route jump, the shared task-
creation flags, or an existing global command). None invents a Home-local
mutation, because Home has none.

## 4. NAVIGATE (Home's strong suit, leaning hardest on the global layer)

Navigation is the entire point of a launchpad, and the master doc says Home
"leans hardest" on the global layer. This section makes that concrete. Home
contributes essentially NO page-local entities; instead it AMPLIFIES the global
NAVIGATE layer so that a Cmd-K on the bare launchpad can reach anything in the
app.

### 4.1 Jump to any top-level page (the global page list, foregrounded)

The master's global layer already offers NAVIGATE to every top-level route. On
most pages that list lives BELOW the page's own entities. On Home, with no page
entities competing, the global page list is PROMOTED to the top of the empty-
query NAVIGATE block. The real routes (from `src/app/`):

Workbench, Lab Overview, Gantt, Calendar, Purchases, Sequences, Methods, Search,
Lab Inbox, Researchers, Profile, Settings, Trash, Open Source, Transparency,
Wiki, Welcome.

Each is a plain `router.push("/<route>")` (preserving deep-link params per the
master's rule, e.g. Calendar accepts `?date=` / `?view=`, Workbench `?tab=` /
`?notebook=`). The role-relevant ones lead (Workbench / Lab Overview first), the
utility routes (Settings / Trash / Open Source) sink to the bottom.

### 4.2 Jump to any project

From `["projects", currentUser]`, one NAVIGATE per project (own + shared),
fuzzy on `name` plus the `owner` for shared ("shared from morgan"). Open target
is the canonical project route, reusing the EXACT owner-suffix rule `page.tsx`
already ships for `?openProject=`:

```
/workbench/projects/<id>            // own
/workbench/projects/<id>?owner=<owner>   // is_shared_with_me
```

This is the only entity family Home renders directly, and it is the same data
the deep-link `?openProject=` handler already resolves, so the behavior is
proven.

### 4.3 Jump to any recent item (the MRU, doubles as RESULTS)

Recently touched tasks (2.2 `recentlyTouched`, or the shared MRU store in 5)
appear as NAVIGATE rows that jump to the task on its home surface. On Home these
are both Suggested (3.2 item 3) and the RESULTS block (5), the same source
surfaced twice, because for a launchpad "recent" IS the most useful navigation.

### 4.4 Global object search (handed to the global layer)

Typing a name on Home does NOT need a Home-specific entity scan beyond projects
and recent tasks. The master's global object search (find any task / sequence /
note / method / purchase by name and open it on its home page) does the heavy
lifting, and Home simply lets it through, foregrounded. A typed query on Home is
effectively "search everything", because Home has no page scope to narrow it.
The "Search everything for <query>" handoff to `/search` (the full faceted
surface) is offered at the bottom of the typed list, exactly as the master
specifies.

The takeaway, restated for the builder, on every other page NAVIGATE is "page
entities, then global"; on Home it is "global, foregrounded", because Home has
no page entities. This is the literal meaning of "Home leans hardest on the
global layer".

## 5. RESULTS ("recently opened across the app" as the substitute)

Home has no saved artifacts (no alignments, no domain scans, the way Sequences
does). The master's substitute is "recently opened across the app", and Home is
the most natural place to show it, because a launchpad's whole reason to exist is
"take me back to what I was doing".

Build it as the SAME client-side MRU the Workbench doc proposes (do not build a
second one):

- A per-user MRU list in localStorage, keyed by `currentUser`, of the last ~8
  opened entities across all surfaces (task, note, project, sequence, ...). Every
  surface that opens a thing (`setSelectedTask`, `setSelectedNote`, `openProject`,
  the sequence open, ...) pushes onto it. Home does not WRITE to it (Home opens
  nothing of its own except the deep-link popup, which it MAY record); Home is a
  primary READER.
- On Home, the empty-query RESULTS block renders the MRU as NAVIGATE rows that
  reopen each item on its home surface (the same jump as 4.3). Row examples,
  "PCR optimization (experiment, opened 2h ago)", "Mitochondria QC (project,
  opened Mon)", "pUC19 (sequence, opened yesterday)".
- Empty MRU (a brand-new user) hides the RESULTS block entirely, and the context
  card sub falls back to "All clear today" or just the account-type headline.

If the MRU store is judged out of scope for the first cut (it is shared
infrastructure, see the Workbench doc's open question 3), Home's RESULTS
gracefully degrades to the derived `recentlyTouched` from `["tasks"]` alone
(2.2), which needs no new store and still gives a useful "resume" list, just
tasks-only rather than all entity kinds.

## 6. COMMANDS (a near-empty page set, heavy reliance on global)

Home's page-local command set is essentially EMPTY, and this doc states that
plainly rather than padding it. Home renders no widgets, so it owns no page
mutations. Everything below is a GLOBAL command that the master's global layer
already provides; Home merely surfaces them prominently because it has nothing of
its own to compete with them.

### 6.1 The global create set (surfaced, not owned)

| Command | Handler (shared, global) | Notes |
| --- | --- | --- |
| New project | the global `NewProjectButton` / `ProjectCreateModal` open flow (`onCreated -> /workbench/projects/<id>`) | same flow Workbench uses |
| New experiment | shared task-creation flags (`isCreatingTask(true)`, `restrictedTaskType("experiment")`, `newTaskStartDate(null)`) that `TaskModal` reads | sends the user into the create modal; the modal lives globally |
| New list task | shared flags with `restrictedTaskType("list")` | |
| New note | the global note-create flow | |

These set the SAME Zustand flags the Workbench create commands set
(`isCreatingTask`, `restrictedTaskType`, `newTaskStartDate`), so `TaskModal`
opens pre-scoped with no Home-specific modal code. The `restrictedTaskType` union
is `"experiment" | "purchase" | "list" | null`.

### 6.2 The global app commands (surfaced, not owned)

| Command | Handler |
| --- | --- |
| Switch user | the global switch-user flow (returns to `UserLoginScreen` / the login gate `page.tsx` already renders) |
| Toggle dark mode | the global theme toggle (the AppShell header control) |
| Open Settings | `router.push("/settings")` |
| Open the wiki | `router.push("/wiki")` (the master's "open the wiki for the current page" degrades to the wiki home on Home, which has no page-specific wiki anchor) |

### 6.3 No page-local commands

There is deliberately no "6.3 page commands" table, because Home has none. The
deep-link `?openTask=` / `?openProject=` handlers are URL-driven side effects,
not user-invokable commands, so they are NOT palette items. Stating this absence
is the point, the master's expectation that Home is "light on page-local
mutations" is not just light, it is empty.

## 7. `useBeakerSearchSource` implementation sketch for Home

The honest implementation is small. It reads the two queries `page.tsx` already
holds (no new fetch), reads account type / default landing tab / streak for the
card, and returns a source whose `entities` / `results` / `commands` mostly defer
to the global layer. The builder's decision (see 7.1) is whether Home even needs
a page source at all, or whether the global layer plus a global "launchpad
context card" suffices.

```ts
// In src/app/page.tsx (or a co-located useHomeBeakerSource hook).
// Reads ONLY the queries page.tsx already holds. No new fetch.
function useHomeBeakerSource(args: {
  currentUser: string;
  accountType: AccountType | null | undefined;
  selectedTask: Task | null;        // the deep-link popup, the one real selection
}): BeakerSearchSource {
  const router = useRouter();
  const defaultLandingTab = useAppStore((s) => s.defaultLandingTab);

  const { data: projects = [] } = useQuery({
    queryKey: ["projects", args.currentUser],
    queryFn: fetchAllProjectsIncludingShared,
  });
  const { data: allTasks = [] } = useQuery({
    queryKey: ["tasks", args.currentUser],
    queryFn: fetchAllTasksIncludingShared,
  });

  // Derived summary (counts only, never a navigable grid). See 1.1 / 2.2.
  const summary = useMemo(() => deriveAccountSummary(allTasks), [allTasks]);

  // The destination the bounce WOULD pick, mirroring decideLandingRedirect.
  const destination = useMemo(
    () =>
      defaultLandingTab && defaultLandingTab !== "/"
        ? defaultLandingTab
        : args.accountType === "lab_head"
          ? "/lab-overview"
          : "/workbench",
    [defaultLandingTab, args.accountType],
  );

  // --- the four contract pieces -------------------------------------------

  const context = useCallback((): HomeContext => ({
    focused: { kind: "landing", destination },
    onScreen: {
      kind: "account-summary",
      dueToday: summary.dueToday,
      upcoming: summary.upcoming,
      recentlyTouched: summary.recentlyTouched,
    },
    selected: args.selectedTask
      ? { kind: "task", task: args.selectedTask }
      : undefined,
    hovered: undefined,                 // Home has no [data-beaker-target] rows
    card: {
      title: `Heading to your ${friendlyRouteLabel(destination)}`,
      sub: summarySubLine(summary, args.currentUser), // "3 due today, 5 coming up"
    },
  }), [destination, summary, args.selectedTask, args.currentUser]);

  const suggested = useCallback((ctx: HomeContext): BeakerItem[] => {
    const out: BeakerItem[] = [];
    if (ctx.selected?.kind === "task") {
      out.push(navTaskOnHome(ctx.selected.task, router));      // 3.1
      const proj = projects.find(
        (p) => p.id === ctx.selected!.task.project_id
          && p.owner === ctx.selected!.task.owner,
      );
      if (proj) out.push(navProject(proj, router, args.currentUser));
      return out;
    }
    out.push(navRoute(destination, router, { primary: true }));   // 3.2.1
    if (summary.dueToday > 0)
      out.push(navTodayWork(router, summary.dueToday));           // 3.2.2
    for (const t of summary.recentlyTouched.slice(0, 3))
      out.push(navResume(t, router));                             // 3.2.3
    out.push(globalCreate("experiment"));                         // 3.2.4
    return out;
  }, [destination, summary, projects, router, args.currentUser]);

  const entities = useCallback((_ctx: HomeContext, _query: string): BeakerItem[] => {
    // Home contributes only projects + recent tasks; everything else is the
    // GLOBAL layer (the page list + global object search), foregrounded by the
    // provider because Home supplies no competing page entities. See 4.
    const items: BeakerItem[] = [];
    for (const p of projects) items.push(navProject(p, router, args.currentUser));
    for (const t of summary.recentlyTouched) items.push(navResume(t, router));
    return items;
  }, [projects, summary, router, args.currentUser]);

  const results = useCallback((): BeakerItem[] =>
    // The shared MRU (5), degrading to recentlyTouched when the MRU is absent.
    readGlobalMru(args.currentUser).map((m) => mruToNav(m, router)), [args.currentUser, router]);

  const commands = useCallback((): BeakerItem[] =>
    // Home owns NO page commands. It surfaces the GLOBAL create + app set (6),
    // which the provider already merges in. Returning [] here is valid; listing
    // them is only to FOREGROUND them on the launchpad.
    [], []);

  return { context, suggested, entities, results, commands };
}
```

Notes on the sketch:

- It is a pure READER over `["projects", currentUser]` and `["tasks", currentUser]`,
  the exact two queries `page.tsx` already runs (lines 101 and 106). No new fetch,
  no new invalidation, no new mutation. Home has nothing to invalidate because
  Home mutates nothing.
- `entities` returns ONLY projects + recent tasks. The page list and global
  object search come from the global layer; Home does not duplicate them, it just
  lets the provider foreground them (4.1, 4.4).
- `commands` returns `[]`. Home owns no page commands (6.3). The global create /
  app commands are merged by the provider regardless; Home's only influence is
  that Suggested foregrounds "New experiment" (3.2.4).
- `hovered` is permanently `undefined` (2.4). Do not add `[data-beaker-target]`
  to the spinner or the login gate; there is nothing meaningful to point at.
- `selected` is non-empty ONLY in the deep-link `?openTask=` case (2.3), wired
  straight from `page.tsx`'s existing `selectedTask` state.
- `deriveAccountSummary` / `summarySubLine` are pure helpers over `allTasks`
  (today / upcoming counts, recent-by-`last_edited_at`); they never fetch and can
  be unit-tested like `decideLandingRedirect` already is.

## 8. Keyboard, states, edge cases, and Home-specific open questions

### 8.1 Keyboard

Inherited entirely from the shared provider (the Sequences `CommandPalette`
model): Cmd-K (and the visible BeakerSearch pill) opens; up/down move the cursor
SKIPPING the non-selectable context card; Enter runs / navigates / reopens by
`kind`; Escape closes and restores focus; combobox / listbox aria. Home adds no
keyboard behavior; it only supplies items. On Home the default-highlighted row is
the role-default NAVIGATE (3.2.1), so a bare Cmd-K then Enter sends the user where
the page was about to bounce them anyway, a pleasant fast path.

### 8.2 Empty vs typed states

- Empty query: Context card (the "good morning" launchpad card, 2.5) -> Suggested
  (role default, today's work, resume rows, New experiment) -> Entities (projects
  + recent, then the global page list foregrounded) -> Recently opened (the MRU,
  5) -> a slim global command section (create / switch user / dark mode /
  settings). Because Home has no page entities of its own, the list is
  global-heavy by construction.
- Typed query: the card slims to a one-line muted header
  (`Heading to your Workbench` -> one line); everything collapses to ONE
  fuzzy-ranked list across projects + recent tasks + the global object search +
  global commands, grouped by kind, with "Search everything for <query>"
  (hand-off to `/search`) pinned at the bottom (4.4). Enter runs the highlighted
  item.

### 8.3 Edge cases

- The bounce races the palette. `/` actively redirects on mount. If the user
  somehow opens BeakerSearch on `/` before the bounce lands (or during the
  suppressed-redirect window), the source must tolerate `accountType ===
  undefined` (account-type read in flight) by falling back the same way
  `decideLandingRedirect` does, treat `undefined` as "not yet known", so the
  destination defaults to `/workbench` only once a real non-`lab_head` resolves.
  Practically, BeakerSearch on `/` is a brief window, which is itself the core
  open question (8.4.1).
- Signed-out / no user. When `!currentUser`, `page.tsx` renders
  `UserLoginScreen`, not `AppShell`. The BeakerSearch provider mounts at the app
  shell, so on the login gate there is no shell and no palette. Home's source must
  guard on `currentUser` and contribute nothing when signed out (the queries key
  on `currentUser === ""` and return empty anyway). No "switch user" suggestion
  is needed on the login screen, the screen IS the switch-user surface.
- Deep-link popup open. When `?openTask=` opened a `TaskDetailPopup`, the redirect
  is suppressed and the user is really on `/`. The palette can open over the
  popup; `selected` is the task (2.3) and Suggested is task-scoped (3.1). After
  the popup closes, the bounce fires (the effect re-runs with `selectedTask ===
  null`), so the palette would close with the route change, expected.
- Explicit landing tab equals a non-existent / utility route. `defaultLandingTab`
  is a stored string; if it is stale, the destination label falls back to a plain
  route name and the jump still works (it is a `router.push`). No crash, just a
  generic label.
- Empty account (new user, zero tasks / projects). Summary counts are all zero,
  the card sub reads "All clear today", RESULTS hides, and Suggested degrades to
  the role-default jump plus the create commands. Still useful, never blank.
- Shared project id collisions (`alex:1` vs `morgan:1`). The project jump reuses
  `page.tsx`'s owner-suffix rule (`?owner=<owner>` when `is_shared_with_me`), so
  a shared project opens in the owner namespace, never the viewer's colliding id.

### 8.4 Home-specific open questions

1. DOES HOME NEED A PAGE SOURCE AT ALL? This is the central question. Home is a
   redirect router that is visible for a fraction of a second. Three options, in
   ascending effort:
   - (a) No Home source. Cmd-K on `/` shows ONLY the global layer (page list +
     object search + global commands) plus a generic launchpad context card the
     PROVIDER supplies (not a page source). Cheapest, and arguably correct given
     how briefly `/` is on screen. The "good morning" card becomes a global
     feature keyed off `accountType` + the streak sidecar, available on `/` and
     anywhere the user pauses.
   - (b) A thin Home source. Adds only the context card (2.5) and the role-default
     / resume Suggested rows (3.2), reading the two existing queries. No new MRU,
     no new store. This doc's default recommendation if Home gets a source at all.
   - (c) A full Home source. (b) plus the shared MRU-backed RESULTS (5). Only
     worth it once the MRU store exists for Workbench anyway (shared
     infrastructure), at which point Home is its best showcase.
   Recommendation, build (a) first (the global launchpad card lives in the
   provider, so EVERY brief visit to `/` and every "I paused, what now" moment is
   covered), and graduate to (b) only if the role-default / resume Suggested rows
   prove worth a per-page source. Confirm this with the master.
2. WHERE DOES THE "GOOD MORNING" CARD LIVE? Tied to question 1. If it is a global
   provider feature (option a), it can show on every page's empty-query card as a
   slim global footer, not just `/`. If it is a Home page source (option b), it
   shows only on `/`. The streak echo, the today/upcoming counts, and the
   account-type headline are the card's three ingredients; decide whether they are
   global chrome or Home-local.
3. THE MRU STORE. RESULTS on Home (5) depends on the SAME client-side
   localStorage MRU the Workbench doc proposes (open question 3 there). Home is
   the strongest argument FOR building it, because "resume what I was doing" is a
   launchpad's headline job. Confirm one shared MRU (written by every open-a-thing
   surface, read by Home + Workbench), not two. Until it exists, Home's RESULTS
   degrades to `recentlyTouched` from `["tasks"]` (tasks-only), which needs no
   store.
4. THE DESTINATION-MIRRORING RISK. The Home source recomputes the bounce
   destination (the `decideLandingRedirect` precedence) to label the context card
   and the role-default Suggested row. That logic is already centralized in
   `page-landing-redirect.ts`. The source should IMPORT and reuse a shared
   destination helper (extract one from `decideLandingRedirect` if needed), not
   re-implement the precedence, so the card never disagrees with where the bounce
   actually goes.
5. STREAK OWNERSHIP. The streak sidecar (`readStreak`) is already surfaced by the
   header `StreakBadge` (global chrome). If the Home card also echoes it, mirror
   `StreakBadge`'s exact hide rules (no user / streaks disabled / count zero) so
   the two never disagree. Alternatively, treat streak as purely the badge's job
   and leave it OFF the BeakerSearch card. Confirm which.
