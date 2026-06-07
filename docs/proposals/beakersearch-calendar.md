# BeakerSearch on Calendar (exhaustive)

This is the build-ready interaction spec for the Calendar page source of
BeakerSearch. It takes the Calendar section of the website-wide proposal
(`docs/proposals/beakersearch-website-wide.md`) from concept depth to a full
spec, grounded in the real code at `frontend/src/app/calendar/page.tsx` and its
view components, data hooks, and stores.

Read the master proposal first for the shared architecture (the global
`BeakerSearchProvider`, the four context signals SELECTED / HOVERED / ON-SCREEN /
OPEN, the item kinds COMMAND / NAVIGATE / RESULT / CONTEXT CARD, and the
`useBeakerSearchSource` per-page contract). The Sequences `CommandPalette`
(`frontend/src/components/sequences/CommandPalette.tsx`) plus its data layer
(`frontend/src/components/sequences/editor-commands.ts`) are the reference
implementation; this doc mirrors that shape (`EditorCommand`, `SequenceNavItem`,
`ArtifactNavItem`, `PaletteContext`, `isCommandEnabled`, `scoreCommand`) onto
Calendar's entities.

Calendar is the page where the ON-SCREEN signal is at its clearest. On every
other page "on screen" is fuzzy (which rows scrolled into view). Here it is
literal and exact, the visible date RANGE that the current view (month / week /
day) anchored on `currentDate` is rendering. This doc leans into that.

Voice note for anyone extending this doc, no em-dashes, no en-dashes, no emojis,
no mid-sentence colons. Markdown, specific, build-ready.

## 1. Entity model and data sources

Calendar holds three streams of objects. All three already live on the page; the
source just reads the same hooks the page reads, it does not open new stores.

### Native events (the editable ones)

Type `Event` (`frontend/src/lib/types.ts`, the `Event` interface). The real
shape, verbatim from the type, is

- `id: number`
- `title: string`
- `event_type: "conference" | "deadline" | "meeting" | "other"`
- `start_date: string` (YYYY-MM-DD, local)
- `end_date: string | null` (multi-day when set and different from start)
- `start_time: string | null` (HH:MM 24h; `null` means ALL-DAY, there is no
  separate `is_all_day` boolean, all-day is `start_time === null`)
- `end_time: string | null`
- `location: string | null`
- `url: string | null`
- `notes: string | null`
- `color: string | null` (falls back to `EVENT_TYPE_COLORS[event_type]`)
- `is_pto?: boolean | null` (the streak-system PTO marker, Phase S5; when true
  the event's date(s) mirror into the user's `pto_dates` in `_streak.json`)

There is NO `task_id` on `Event` and NO `duration_minutes` field. The
website-wide proposal's Calendar bullet that says "optional `task_id` link" and
the brief's mention of `duration_minutes` / `is_all_day` describe a shape the
code does not have today. This spec treats "link to a task" and "duration" as
NOT-YET-BUILT and routes them to the open questions in section 8 rather than
inventing handlers that cannot fire. Everything else below is wired to a real
handler.

Loaded by

```ts
const { data: events = [] } = useQuery({
  queryKey: ["events"],
  queryFn: eventsApi.list,
});
```

`eventsApi` (`frontend/src/lib/local-api.ts`) exposes `list`, `get(id)`,
`create(EventCreate)`, `update(id, EventUpdate)`, `delete(id)`. Mutations are
followed on the page by `queryClient.refetchQueries({ queryKey: ["events"] })`,
so the invalidation key for native events is exactly `["events"]`.

### External feeds (the calendar subscriptions)

Type `CalendarFeed`. Read by `useCalendarFeeds()`
(`frontend/src/lib/calendar/use-external-events.ts`) under query key
`["calendar-feeds", currentUser]`. Fields that matter here, `id`, `provider`
("google" / "outlook" / "icloud" / "other"), `label`, `icsUrl`, `color`,
`enabled`, `lastSyncAt`. The page derives `enabledCount` from these for the
"Linked Calendars" badge. Feeds are managed in `CalendarFeedsModal`, opened by
`CalendarFeedsButton`, and the page deep-links it with `?addFeed=1`.

### External events (the read-only pulled events)

Type `ExternalEvent`. Read by `useExternalEvents()`, which fans one React Query
per enabled feed (key `[FEED_EVENTS_PREFIX, currentUser, feed.id, feed.kind,
feed.icsUrl]`) and merges them. Same date fields as `Event` plus `feedId`,
`providerEventId`, and a non-null `color`. These are READ-ONLY (ICS
subscriptions cannot be edited in-app); their detail modal is
`ExternalEventModal` and its footer says "Edit it in the source app". The hook
also returns `errorsByFeedId`, `isFetching`, and `refetch`, which the page
surfaces as the amber "Some linked calendars couldn't be fetched" banner with a
"Retry now" button (`refetchExternal`).

### Query keys for invalidation (the contract's `invalidate` targets)

| Stream | Read hook | Query key | Invalidate after |
| --- | --- | --- | --- |
| Native events | `useQuery` inline | `["events"]` | create / update / delete event, mark PTO |
| Feeds | `useCalendarFeeds()` | `["calendar-feeds", currentUser]` | add / edit / remove / toggle feed |
| External events | `useExternalEvents()` | `[FEED_EVENTS_PREFIX, currentUser, feed.id, ...]` | re-sync a feed (or `refetchExternal()`) |

The Calendar source's mutating commands all end by invalidating `["events"]`
(matching the page's `refetchQueries`). PTO-mirroring is a SIDE-effect of event
create/update/delete and is not its own query key; it calls
`syncEventPtoChange(currentUser, prev, next)` from
`frontend/src/lib/streak/calendar-pto-sync.ts`, exactly as the page does today
in its `onSave` / `onCreate` / delete handlers.

## 2. Context model (what each signal maps to on Calendar)

The page's relevant React state, all in `CalendarPage`

- `view: CalendarView` from `useAppStore((s) => s.calendarViewMode)` ("month" |
  "week" | "day"), set with `setView` (`setCalendarViewMode`).
- `currentDate: Date` (the anchor), set with `setCurrentDate`. `goToToday` resets
  it to `new Date()`. `stepDate(dir)` moves it by one month / week / day
  depending on `view`.
- `selectedEvent: Event | null` (the native event whose detail modal is open).
- `selectedExternal: ExternalEvent | null` (the read-only external detail modal).
- `expandedDate: string | null` (the day whose `DayDetailDrawer` is open).
- `editingEvent`, `creating`, `prefilledStartDate`, `prefilledStartTime`,
  `deleteConfirmEvent` (modal / form plumbing).

The four BeakerSearch signals map as follows.

### OPEN / FOCUSED

The page's identity is the calendar itself, anchored on `currentDate` with
"today" highlighted in the views. There is no single focused entity the way a
sequence editor has one open sequence; the focused thing is the date the user is
parked on. Use `currentDate` plus `view` as the focused reference, and compute
`today` (local) so the context card can say whether the anchor is today.

### ON-SCREEN (the star of this page)

The visible date RANGE, derived from `view` + `currentDate`. This is exact, not
heuristic.

- month, the 42-cell grid from `MonthView`, Sunday-start, including leading /
  trailing days. The visible range is the first to last cell date. The
  user-meaningful range is the calendar month (`new Date(year, month, 1)` to
  `new Date(year, month + 1, 0)`); use the month for "in view" scoping and the
  full 42-cell span only when you need pixel-accurate membership.
- week, the 7 days from `getWeekDays(currentDate)` in
  `frontend/src/components/calendar/utils.ts` (Sunday-start). Range is
  `weekDays[0]` to `weekDays[6]`.
- day, the single `currentDate`.

ON-SCREEN events are the events (native and external) whose
`[start_date, end_date || start_date]` range intersects the visible range, the
same `dateStr >= start && dateStr <= end` test the views and the day-drawer use
(see `eventCoversDate` in utils, and the inline filters in
`MonthView.getEventsForDate` and the page's `DayDetailDrawer` filter). The source
should reuse `eventCoversDate` so its notion of "on screen" matches the pixels
exactly.

### HOVERED

The day cell or event chip the cursor was last over when the palette opened.
Calendar has no hover state in its own React tree today (the views fire on click,
not hover), so this rides entirely on the app-wide hover capture described in the
master proposal, the provider tracks the last hovered `[data-beaker-target]`
element. To light up HOVERED on Calendar, tag the rendered items with a
`data-beaker-target` carrying a typed payload

- each month / week / day CELL gets `data-beaker-target` with
  `{ kind: "calendar-day", dateStr }` (the cell already computes `dateStr` via
  `toLocalDateString(day.date)`).
- each native event chip gets `{ kind: "calendar-event", eventId }`.
- each external chip gets `{ kind: "calendar-external", externalId }`.

This is purely additive markup on the existing buttons / cells (a `data-`
attribute and a small serializer), no behavior change, and it is the only code
that needs to touch the view components. Per the master proposal's rollout,
hover-as-context is the LAST thing to wire and is opt-in; ship Calendar's
SELECTED + ON-SCREEN first, then add the `data-beaker-target` tags.

When the hovered target is a day cell, HOVERED resolves to that date. When it is
an event chip, HOVERED resolves to that event (and its date), which is a softer
echo of SELECTED.

### SELECTED

The strongest signal. On Calendar the explicit selection is the event whose
detail modal is open, `selectedEvent` (native) or `selectedExternal`
(read-only). A native `selectedEvent` drives the full edit / delete / PTO /
duplicate suggested set; a `selectedExternal` drives a reduced read-only set
(open source app, copy details) because the page itself offers no mutations on
external events.

Note, opening the palette while a modal is open is an explicit product decision,
see section 8. The cleaner model is that BeakerSearch reads the LAST selected
event even after its modal closes (a "recently acted on" selection), so "Edit the
event I just looked at" still works. The source should keep a small
`lastSelectedEvent` ref so SELECTED survives the modal close, matching how the
Sequences palette keeps the base selection alive.

### The context card contents

Non-selectable header, top of the empty-query list. Rendered like the Sequences
`ContextCard`, calm, dark-mode-aware, BeakerBot-marked.

- month, "Calendar, June 2026" (the `headingLabel` the page already computes for
  month) plus a meta line "31 days in view, 12 events" (count of on-screen
  events).
- week, "Calendar, week of Jun 7" plus "Jun 7 to Jun 13, 4 events". Use the
  page's existing week `headingLabel` ("Jun 7 to Jun 13, 2026") rephrased without
  the en-dash, the card builds "week of {weekDays[0] short}".
- day, "Calendar, Sunday, June 7, 2026" plus "3 events today" (or "2 events,
  1 all-day").
- when an event is selected, append a second line echoing it, "Selected, ACS
  National Meeting, Jun 9 to Jun 12" (title + the same date string the detail
  modal renders via `formatTime`). For an external selection add the "Read-only,
  from {feed.label}" tag.

The card slims to one line while typing, exactly like Sequences' slim
`ContextCard` (Calendar icon + the heading label + "{n} events in view").

## 3. SUGGESTED (every contextual variant)

Ranked COMMAND items, selection / hover / on-screen aware, each with an
`enabled` predicate and a `detail` echo of the thing it acts on. Listed by
context, strongest first. Handler column names the EXACT page function or the
state setter the command calls.

### A native event is SELECTED (or hovered)

`ctx.selected` is an `Event` (or HOVERED resolves to one). Echo the event title +
its date in `detail`.

| Label | detail echo | Handler |
| --- | --- | --- |
| Edit "ACS National Meeting" | "Jun 9 to Jun 12" | `setEditingEvent(ev); setSelectedEvent(null)` (the page's `onEdit`) |
| Delete "ACS National Meeting" | "permanent" | `setDeleteConfirmEvent(ev)` (the page's `onDelete`, which opens the confirm dialog, not a raw delete) |
| Duplicate "ACS National Meeting" | "new copy, same day" | `eventsApi.create({ ...stripId(ev), title: ev.title + " (copy)" })` then invalidate `["events"]` (NEW thin handler, see section 7) |
| Mark "ACS National Meeting" as PTO | "treats Jun 9 to Jun 12 like a weekend" | `eventsApi.update(ev.id, { is_pto: true })` + `syncEventPtoChange(currentUser, {isPto:false,...}, {isPto:true, dates: expandDateRange(ev.start_date, ev.end_date)})` then invalidate. `enabled` only when `ev.is_pto !== true` |
| Remove PTO from "ACS National Meeting" | "back to a normal day" | symmetric, `update(... { is_pto:false })` + `syncEventPtoChange(..., {isPto:true,dates}, {isPto:false,dates:[]})`. Shown instead of the above when `ev.is_pto === true` |
| Open "ACS National Meeting" | "see details" | `setSelectedEvent(ev)` (reopens the detail modal) |
| Link "ACS National Meeting" to a task | "not yet available" | DISABLED, `enabled: false` until the `task_id` field exists (section 8). Present but greyed so the power is discoverable |

PTO mirroring must reuse `expandDateRange` and `syncEventPtoChange` from
`frontend/src/lib/streak/calendar-pto-sync.ts` and gate on `currentUser`, exactly
as the page's `onSave` / `onCreate` / delete paths do. Never write `pto_dates`
directly.

### An external (read-only) event is SELECTED

`ctx.selected` is an `ExternalEvent`. No mutations exist for these.

| Label | detail echo | Handler |
| --- | --- | --- |
| Open in source app | the event url, if any | `window.open(ev.url, "_blank")` when `ev.url` is set; else DISABLED |
| Show this event's feed | "from {feed.label}" | open `CalendarFeedsModal` scrolled to that feed (reuse `?addFeed` plumbing or a feed-focus prop) |
| Copy event details | title + date | clipboard write of `${title} · ${dateLine}` |

A small inline note (non-command context line) explains "This event is from a
linked calendar and is read-only here", mirroring `ExternalEventModal`'s footer
copy.

### A day is HOVERED or simply IN VIEW (no event selected)

`ctx.hovered` is a `{ kind: "calendar-day", dateStr }`, or fall back to
`currentDate` in day view / the first on-screen day.

| Label | detail echo | Handler |
| --- | --- | --- |
| New event on Jun 9 | "timed or all-day" | `openCreateAt("2026-06-09", null)` (the page's `openCreateAt(dateStr, startTime)`, which sets `prefilledStartDate` + opens `CreateEventModal`) |
| New all-day event on Jun 9 | "no time" | `openCreateAt("2026-06-09", null)`; the create modal already treats empty times as all-day ("Leave times empty for an all-day event") |
| Open Jun 9 in day view | "see the hour grid" | `openDayView("2026-06-09")` (the page's `openDayView`, which sets `currentDate` and `setView("day")`) |
| See everything on Jun 9 | "{n} events" | `setExpandedDate("2026-06-09")` (opens `DayDetailDrawer`) |

The date in the labels is the HOVERED cell when present, otherwise `currentDate`.
In WEEK view a sensible default is the hovered column; in MONTH view the hovered
cell; in DAY view always `currentDate`.

### Nothing selected, nothing hovered (the orientation set)

This is what a cold Cmd-K shows. Make ON-SCREEN shine, the labels name the
current frame.

| Label | detail echo | Handler |
| --- | --- | --- |
| New event | "in {June 2026 / this week / today}" | `setCreating(true)` (page's "+ New Event") |
| New event today | today's date | `openCreateAt(toLocalDateString(new Date()), null)` |
| Go to today | "you are on {headingLabel}" | `goToToday()`; `enabled` only when `currentDate` is not already today |
| Switch to week view | "from {current view}" | `setView("week")`; shown for the two views you are NOT on |
| Switch to month view | as above | `setView("month")` |
| Switch to day view | as above | `setView("day")` |
| Previous {month/week/day} | the target label | `stepDate(-1)` |
| Next {month/week/day} | the target label | `stepDate(1)` |
| Add a calendar feed | "Google / Outlook / iCloud" | navigate `/calendar?addFeed=1` (or call the modal open path); this is the same deep-link `CalendarFeedsButton` honors |
| Manage linked calendars | "{enabledCount} connected" | open `CalendarFeedsModal` |

`stepDate` and the heading label are view-aware already, so "Previous month" vs
"Previous week" is just reading `view` to format the label; the handler is the
same `stepDate(-1)`.

## 4. NAVIGATE entities

NAVIGATE items jump to an object or change the frame. They are the `entities()`
output of the contract, ranked by fuzzy match on the typed query, scoped to
ON-SCREEN when the query is empty and widened across all events when typing
(mirroring how Sequences scopes "jump to a sequence" to the current collection
then widens).

### Jump to an event by title

Across `events` (and `externalEvents`), fuzzy on `title` (widen the match with
`location` as a keyword, like Sequences widens with `organism`). Selecting one

- sets the anchor to the event's `start_date` (`setCurrentDate(parse(start))`),
- if not visible in the current view, also switches view sensibly (a timed
  single-day event to day or week; a multi-day event to month),
- opens the detail modal, `setSelectedEvent(ev)` for native or
  `setSelectedExternal(ev)` for external.

`detail` sub for the row, the date line + type, "Jun 9 to Jun 12 · conference".
Empty query shows ONLY on-screen events (the ones already in the visible range);
typing widens to all events regardless of date.

### Jump to a DATE (the date-parsing nicety)

A typed query that parses as a date becomes a NAVIGATE-to-date item at the top.
Parse, in order

- strict `YYYY-MM-DD` (the page's own deep-link regex `^(\d{4})-(\d{2})-(\d{2})$`
  with the same round-trip validity check that rejects `2026-02-31`),
- "today", "tomorrow", "yesterday",
- "next monday" / "this friday" / weekday names (next occurrence),
- "jun 9" / "june 9" / "9 jun" (current year, or next year if the date already
  passed this year),
- "jun 9 2027" with an explicit year.

The parser is a small pure helper, `parseCalendarDate(query, today): string |
null` returning a local YYYY-MM-DD or null. It reuses `toLocalDateString` for
formatting and must NOT use `new Date(string)` on free text (the page comments
warn that a stray `?date=tomorrow` must never reach the Date constructor). Build
it as a dedicated, unit-tested module
(`frontend/src/lib/calendar/parse-calendar-date.ts`) so the garbage-in cases are
covered.

Selecting the date item runs `setCurrentDate(parsed)` and keeps the current view
(or offers a sibling "Open {date} in day view" item that also calls
`setView("day")`). Row label "Go to Jun 9, 2026", detail "{weekday}, {n} events".

### Jump to a feed

Across `feeds`, fuzzy on `label` + `provider`. Selecting opens
`CalendarFeedsModal` focused on that feed (reuse the modal, add a focus prop or
scroll-to). detail, "{provider} · {enabled ? "on" : "off"} · last synced
{lastSyncAt}".

### Jump to an event's linked task

Present but DISABLED today (no `task_id` on `Event`). Keep it in the NAVIGATE
list as a greyed item with detail "linking events to tasks is coming" so the
intent is discoverable. When the field lands, the handler navigates to
`/workbench?...` or `/gantt?...` carrying the composite `"{owner}:{id}"` task key
the master proposal requires. Tracked in section 8.

### Switch view mode (navigation, not a command, when typed)

"month" / "week" / "day" typed as a query surfaces a "Switch to {view} view"
NAVIGATE-style item calling `setView`. It also appears in COMMANDS (section 6);
surfacing it under NAVIGATE on a matching query is a ranking nicety.

### Deep-link preservation

Every NAVIGATE that changes date or view should keep the URL honest so a copied
link reproduces the state, mirror the page's `?date=YYYY-MM-DD&view=...`
contract. Two options, pick per the global provider's policy

- in-app state only (call `setCurrentDate` / `setView`), the lightest, matches
  what the sidebar `useCalendarNavStore.jumpTo` does today (state, no URL), or
- `router.replace("/calendar?date=...&view=...")`, which the page's deep-link
  effect already consumes idempotently (the `appliedDeepLinkRef` keys off the
  param string, so a programmatic param change re-applies cleanly, and a no-op
  param is ignored).

Recommendation, use the state path for in-page jumps (no history spam) and the
URL path only for the GLOBAL "go to Calendar on Jun 9" cross-page item, so a
cross-page jump lands the visitor on the right frame via the existing deep-link
reader. This matches the master proposal's rule that a NAVIGATE item should
preserve / set `?date=` / `?view=` rather than dropping the user on a bare route.

## 5. RESULTS (the freshest-signal substitute)

Calendar saves no reopenable artifacts (no alignments, no scans), so the RESULTS
slot is repurposed, exactly as the master proposal suggests, to "Next up", the
UPCOMING events.

- Source, `events` (and optionally `externalEvents`) with
  `start_date >= todayLocal`, sorted by `(start_date, start_time)` ascending
  using the page's `eventTimeOrder` for the time tiebreak, take the next 5.
- Each row is a NAVIGATE-flavored RESULT, label = title, detail = "in 2 days ·
  Jun 9" (relative + absolute). Selecting it does the same jump-to-event as the
  NAVIGATE entity (anchor + view + open modal).
- Group title "Next up" (not "Recent results"), shown only on the empty query,
  below SUGGESTED and above the page command groups, matching the empty-query
  order in the master proposal (Context, Suggested, Entities, Results, Commands,
  Global).

This reuses the same data the sidebar's upcoming-events list already walks
(`DailyTasksSidebar` calls `useCalendarNavStore.jumpTo("day", dateStr)` for the
same purpose), so "Next up" in BeakerSearch is the keyboard-first twin of that
sidebar affordance.

## 6. COMMANDS (the full long tail, grouped)

The complete command set, the tail that does not need to be in SUGGESTED but must
be reachable by typing. Grouped the way Sequences groups (Design / Analyze / Edit
/ View / Export); Calendar's natural groups are Create, Navigate, View, Feeds.
Each row names its handler.

### Create

| Command | Handler | enabled |
| --- | --- | --- |
| New event | `setCreating(true)` | always |
| New event today | `openCreateAt(todayLocal, null)` | always |
| New event on the focused day | `openCreateAt(currentDateStr, null)` | always |
| New all-day event | `openCreateAt(focusedDateStr, null)` (empty times = all-day) | always |

### Navigate (date)

| Command | Handler | enabled |
| --- | --- | --- |
| Go to today | `goToToday()` | only when not already today |
| Previous {month/week/day} | `stepDate(-1)` | always |
| Next {month/week/day} | `stepDate(1)` | always |
| Go to date ... | opens the date-parse field / runs `parseCalendarDate` then `setCurrentDate` | always |

### View

| Command | Handler | enabled |
| --- | --- | --- |
| Switch to month view | `setView("month")` | only when `view !== "month"` |
| Switch to week view | `setView("week")` | only when `view !== "week"` |
| Switch to day view | `setView("day")` | only when `view !== "day"` |

The view-mode change updates the Zustand store in-session only; it does NOT write
back to `settings.json` (the page comment is explicit, "in-session changes update
the store but don't write back to disk, use Settings to change the persisted
default"). The command's detail should not imply it changes the default.

### Feeds

| Command | Handler | enabled |
| --- | --- | --- |
| Add a calendar feed | navigate `/calendar?addFeed=1` (the deep-link `CalendarFeedsButton` consumes) or open `CalendarFeedsModal` directly | always |
| Manage linked calendars | open `CalendarFeedsModal` | always |
| Retry failed calendar syncs | `refetchExternal()` | only when `errorsByFeedId.size > 0` |

`Retry failed calendar syncs` is a nice power, it mirrors the amber banner's
"Retry now" button and is `enabled` exactly when that banner is showing.

## 7. `useBeakerSearchSource` implementation sketch (Calendar)

A typed source object the page registers while mounted, mirroring the Sequences
`PaletteInput` / `editor-commands` shape. The page passes in its live hooks and
handlers; the source is otherwise pure. New helpers it introduces are
`parseCalendarDate`, `duplicateEvent`, and the `markEventPto` / `clearEventPto`
wrappers around the existing `eventsApi` + `syncEventPtoChange` flow.

```ts
// frontend/src/lib/calendar/beaker-search-source.ts (NEW)
// Mirrors the EditorCommand / NavItem / PaletteContext contract from
// components/sequences/editor-commands.ts, retargeted onto Calendar.

import type { Event, ExternalEvent, CalendarFeed } from "@/lib/types";
import type { CalendarView } from "@/components/calendar/utils";
import {
  eventCoversDate,
  eventTimeOrder,
  getWeekDays,
  toLocalDateString,
} from "@/components/calendar/utils";
import { expandDateRange } from "@/lib/streak/calendar-pto-sync";

export interface CalendarBeakerDeps {
  // live data
  events: Event[];
  externalEvents: ExternalEvent[];
  feeds: CalendarFeed[];
  externalErrorsCount: number;
  currentUser: string | null;

  // frame
  view: CalendarView;
  currentDate: Date;
  selectedEvent: Event | null;      // last-selected, survives modal close
  selectedExternal: ExternalEvent | null;
  hovered:                          // from the app-wide data-beaker-target
    | { kind: "calendar-day"; dateStr: string }
    | { kind: "calendar-event"; eventId: number }
    | { kind: "calendar-external"; externalId: string }
    | null;

  // handlers (the page's real functions, passed straight in)
  setView: (v: CalendarView) => void;
  setCurrentDate: (d: Date) => void;
  goToToday: () => void;
  stepDate: (dir: -1 | 1) => void;
  openCreateAt: (dateStr: string, startTime: string | null) => void;
  openCreate: () => void;                // setCreating(true)
  openDayView: (dateStr: string) => void;
  setExpandedDate: (dateStr: string) => void;
  setSelectedEvent: (e: Event | null) => void;
  setSelectedExternal: (e: ExternalEvent | null) => void;
  setEditingEvent: (e: Event | null) => void;       // -> Edit
  setDeleteConfirmEvent: (e: Event | null) => void;  // -> Delete (confirm dialog)
  openFeedsModal: (focusFeedId?: number) => void;
  retryExternal: () => void;             // refetchExternal()

  // thin new mutating helpers (defined alongside, invalidate ["events"])
  duplicateEvent: (e: Event) => Promise<void>;
  markEventPto: (e: Event, on: boolean) => Promise<void>;
}

// The four contract functions:
export function calendarContext(d: CalendarBeakerDeps): PaletteContext { ... }
export function calendarSuggested(d: CalendarBeakerDeps): EditorCommand[] { ... }
export function calendarEntities(
  d: CalendarBeakerDeps,
  query: string,
): NavItem[] { ... }            // events + date + feeds, on-screen-first
export function calendarResults(d: CalendarBeakerDeps): NavItem[] { ... } // "Next up"
export function calendarCommands(d: CalendarBeakerDeps): EditorCommand[] { ... }
```

Wiring on the page (inside `CalendarPage`, after the existing hooks)

```ts
const source = useMemo<CalendarBeakerDeps>(() => ({
  events, externalEvents, feeds,
  externalErrorsCount: externalErrors.size,
  currentUser: currentUser?.username ?? null,
  view, currentDate,
  selectedEvent: lastSelectedEventRef.current,  // survives modal close
  selectedExternal,
  hovered: useBeakerHover(),                     // provider-supplied
  setView, setCurrentDate, goToToday, stepDate,
  openCreateAt, openCreate: () => setCreating(true),
  openDayView, setExpandedDate, setSelectedEvent, setSelectedExternal,
  setEditingEvent, setDeleteConfirmEvent,
  openFeedsModal, retryExternal: () => void refetchExternal(),
  duplicateEvent, markEventPto,
}), [/* the above */]);

useBeakerSearchSource({
  id: "calendar",
  context: () => calendarContext(source),
  suggested: () => calendarSuggested(source),
  entities: (q) => calendarEntities(source, q),
  results: () => calendarResults(source),
  commands: () => calendarCommands(source),
});
```

The two thin mutating helpers, defined on the page (or in the source module
bound to `queryClient`), reuse the page's existing flow exactly

```ts
const duplicateEvent = useCallback(async (e: Event) => {
  const { id, ...rest } = e;
  await eventsApi.create({ ...rest, title: `${e.title} (copy)` });
  await queryClient.refetchQueries({ queryKey: ["events"] });
}, [queryClient]);

const markEventPto = useCallback(async (e: Event, on: boolean) => {
  const prevIsPto = e.is_pto === true;
  const dates = expandDateRange(e.start_date, e.end_date);
  await eventsApi.update(e.id, { is_pto: on });
  await queryClient.refetchQueries({ queryKey: ["events"] });
  if (currentUser && (prevIsPto || on)) {
    void syncEventPtoChange(
      currentUser,
      { isPto: prevIsPto, dates: prevIsPto ? dates : [] },
      { isPto: on, dates: on ? dates : [] },
    );
  }
}, [queryClient, currentUser]);
```

Both end on `refetchQueries({ queryKey: ["events"] })`, the same invalidation the
page's own create / update / delete handlers use, so BeakerSearch mutations and
modal mutations are indistinguishable to the cache.

Date-parse helper (its own tested module)

```ts
// frontend/src/lib/calendar/parse-calendar-date.ts (NEW, pure + unit tested)
export function parseCalendarDate(
  query: string,
  today: Date,
): string | null { /* strict YYYY-MM-DD w/ round-trip check, today/tomorrow/
   yesterday, weekday names, "jun 9", explicit year; NEVER new Date(freeText) */ }
```

## 8. Keyboard, states, edge cases, open questions

### Keyboard

Inherited whole from the shared provider (the Sequences `CommandPalette` model),
Cmd-K / the front-door pill to open, up / down skipping disabled +
non-selectable rows, Enter runs / navigates / reopens the highlighted item,
Escape closes, focus trap and restore, combobox / listbox aria. Calendar adds no
new keys. Note the page's own modals already bind Escape-to-close; the provider's
focus trap must coexist with an open `EventModal` (see the modal-open edge case
below).

### Empty vs typed states

- Empty query, render order Context card ("Calendar, week of Jun 7"), Suggested
  (the context-appropriate set from section 3), NAVIGATE entities scoped to
  on-screen events, RESULTS as "Next up", then the Create / Navigate / View /
  Feeds command groups, then the slim global section.
- Typed query, the card slims to one line, and everything collapses into a single
  fuzzy-ranked list across commands + entities + date-parse + global, grouped by
  kind, exactly the master-proposal behavior. A query that `parseCalendarDate`
  resolves floats a "Go to {date}" item to the top.

### The date-parsing nicety

Covered in section 4. The headline, typing "next monday" or "jun 9" jumps the
calendar, and typing a strict `YYYY-MM-DD` reuses the page's own validated
deep-link path. This is the single most Calendar-specific delight in the source.

### Edge cases

- All-day vs timed, all-day is `start_time === null`, there is no `is_all_day`
  flag. The "New all-day event" command just opens the create modal with no
  prefilled time (the modal already says "Leave times empty for an all-day
  event"). Suggested labels must not promise an `is_all_day` toggle that does not
  exist.
- Multi-day events, ON-SCREEN membership and "jump to event" use the inclusive
  `start_date..(end_date || start_date)` range via `eventCoversDate`. A multi-day
  event is "on screen" if ANY of its days intersect the visible range. Jumping to
  it anchors on its `start_date`.
- External (read-only) events, never offer edit / delete / PTO / duplicate on an
  `ExternalEvent`; its suggested set is the reduced read-only one. Respect the
  per-user cache namespace, external events are strictly personal (the
  `currentUser`-prefixed query key), so the source must read them through
  `useExternalEvents()` and never cache them itself across an account switch.
- Offline mode, `useExternalEvents` returns no external events when
  `useAppStore.getState().offlineMode` is on (the fetch is short-circuited). The
  "Retry failed syncs" command should be hidden / disabled in offline mode (there
  is nothing to retry), gate it on `!offlineMode && errorsByFeedId.size > 0`.
- Feed errors, when `errorsByFeedId.size > 0` the "Retry failed calendar syncs"
  command appears, twinning the amber banner.
- "Go to today" when already on today, disabled (and the context card already
  says you are on today), so the command does not no-op confusingly.
- PTO on a multi-day event, `expandDateRange(start, end)` produces every day in
  the span; the mark / clear helpers pass the full span to `syncEventPtoChange`,
  matching the page's edit path.
- Account switch mid-session, `currentUser` flows into the feed query keys and
  the PTO sync; the source must read `currentUser` live (not capture a stale
  value) so a switched-to user never acts on the prior user's data.

### Open questions (Calendar-specific)

1. Palette over an open modal. Does Cmd-K work while `EventModal` /
   `CreateEventModal` / `DayDetailDrawer` is open, and if so does SELECTED point
   at that modal's event? Recommendation, allow it and keep a `lastSelectedEvent`
   ref so SELECTED survives the modal closing, but confirm the focus-trap
   interaction (two trapped layers) before shipping.
2. The missing `task_id`. The website-wide proposal and the brief both describe
   linking an event to a task, but `Event` has no `task_id` today. Decision
   needed, add the field (and a NAVIGATE "jump to linked task" carrying the
   composite `"{owner}:{id}"` key) as a prerequisite, or ship Calendar's source
   with the link command present-but-disabled. This doc assumes the latter and
   tracks the field as a follow-up.
3. The missing duration. The brief mentions `duration_minutes`; the real shape
   uses `start_time` + `end_time`. Confirm no duration field is expected; the
   source computes any "how long" display from the two times.
4. Deep-link writes vs in-page state. Should date / view jumps push `?date=` /
   `?view=` to the URL (shareable, but history noise) or stay in-state (quiet,
   matches the sidebar `jumpTo`)? Recommendation in section 4, state for in-page,
   URL for the cross-page global "go to Calendar on {date}" item.
5. External events in "Next up". Include read-only external events in the
   upcoming list, or keep "Next up" to editable native events only? Including
   them is more useful; excluding them keeps every "Next up" row actionable
   (edit-able). Default, include both, label external rows with the linked-feed
   mark.
6. Should "New event on {hovered day}" prefer the hovered COLUMN in week view and
   the hovered CELL in month view, with a clear fallback to `currentDate` in day
   view? This doc assumes yes; verify the hover payload carries enough to
   distinguish.
