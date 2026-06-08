// sequence editor master (Calendar source sub-bot). BeakerSearch step 3, the
// second per-page SOURCE, the Calendar page.
//
// This module is the PURE builder behind the Calendar's BeakerSearch
// registration. It takes a plain snapshot of the page state (native events,
// external feed events, feeds, the visible frame, the current selection) plus a
// bag of handler callbacks, and returns one BeakerSearchSource (context card +
// commands + suggested ids + nav groups). It reads NO store, holds NO React, and
// calls NO Date.now(), so the context-card copy, the command ids / groups /
// enabled gating, the Suggested ordering, and the nav groups are all unit-tested
// without rendering. The thin useCalendarBeakerSource hook (co-located) wires the
// live hooks + handlers into this builder inside a useMemo.
//
// The spec is docs/proposals/beakersearch-calendar.md. Where that doc's sketch
// uses an older function-based source shape (context() / suggested() /
// entities() / results()), this maps it onto the ACTUAL generic
// BeakerSearchSource contract, contextCard + commands (with stable ids +
// page-defined groups) + suggestedIds + navGroups.
//
// Voice in comments and copy, no em-dashes, no en-dashes, no emojis, no
// mid-sentence colons.

import type { IconName } from "@/components/icons";
import type { BeakerSearchSource } from "@/components/beaker-search/types";
import type {
  EditorCommand,
  PaletteContextCard,
  PaletteNavGroup,
  PaletteNavItem,
} from "@/components/sequences/editor-commands";
import type { CalendarView } from "@/components/calendar/utils";
import type { CalendarFeed, Event, ExternalEvent } from "@/lib/types";

// ── Page-defined command groups ────────────────────────────────────────────
// These print between the page's nav groups and the global "Go to" / "App"
// layer, in first-appearance order (see editor-commands commandGroupOrder).
export const CALENDAR_GROUP_SELECTED_EVENT = "Selected event";
export const CALENDAR_GROUP_CREATE = "Create";
export const CALENDAR_GROUP_NAVIGATE = "Navigate";
export const CALENDAR_GROUP_VIEW = "View";
export const CALENDAR_GROUP_FEEDS = "Feeds";

// ── The visible-frame shape (computed by the caller from view + currentDate) ─
// The builder stays pure, so the caller pre-formats every label and pre-counts
// the on-screen events. The builder never touches a Date.
export interface CalendarFrame {
  /** "month" | "week" | "day", drives the context-card phrasing + the per-view
   *  labels on the Navigate commands. */
  view: CalendarView;
  /** The card TITLE per view (spec 2.4): month "June 2026", week "week of
   *  Jun 7", day "Sunday, June 7, 2026". The page's headingLabel, rephrased. */
  title: string;
  /** The card META per view (spec 2.4): month "31 days in view, 12 events",
   *  week "Jun 7 to Jun 13, 4 events", day "3 events today". Pre-built so the
   *  builder never counts days. */
  meta: string;
  /** "month" / "week" / "day" noun for the Navigate command labels
   *  ("Previous month" vs "Previous week"). */
  unitNoun: string;
  /** The focused day as a local YYYY-MM-DD, the anchor the create-on-this-day
   *  commands target. In day view this is currentDate; in month / week it is the
   *  view's anchor day. */
  focusedDateStr: string;
  /** Today as a local YYYY-MM-DD, so "Go to today" can gate on "not today" and
   *  the create-today command targets the real today. */
  todayStr: string;
  /** Whether the anchor is already today (gates "Go to today"). */
  isOnToday: boolean;
  /** A short human label for the current frame, e.g. "June 2026" / "this week"
   *  / "today", used in the orientation command details ("in June 2026"). */
  frameLabel: string;
}

// ── The plain state snapshot the builder reads ─────────────────────────────
export interface CalendarSourceData {
  /** Native (editable) events, the page's ["events"] query. */
  events: Event[];
  /** Read-only external feed events, merged from useExternalEvents(). */
  externalEvents: ExternalEvent[];
  /** The linked calendar feeds, for "Jump to a feed" + the manage count. */
  feeds: CalendarFeed[];
  /** Count of enabled feeds, for the "Manage linked calendars" detail. */
  enabledFeedCount: number;
  /** Count of feeds that failed to sync (errorsByFeedId.size), gates "Retry
   *  failed calendar syncs". */
  externalErrorsCount: number;
  /** Whether the user is in offline mode, also hides the retry (nothing to
   *  retry when external sync is short-circuited). */
  offlineMode: boolean;

  // The frame (ON-SCREEN + OPEN).
  frame: CalendarFrame;
  /** The native + external events whose range intersects the visible frame,
   *  for the empty-query "Jump to an event" nav list (pre-filtered by the
   *  caller using eventCoversDate so it matches the pixels). Native first. */
  onScreenEvents: Event[];
  onScreenExternalEvents: ExternalEvent[];

  // Selection (SELECTED). The native one wins when both are set; the page keeps
  // a last-selected ref so this survives the detail modal closing.
  selectedEvent: Event | null;
  selectedExternal: ExternalEvent | null;

  // Hover (HOVERED). The event the cursor was over when the palette opened,
  // resolved by the hook from the data-beaker-target key (native "event:<id>" or
  // external "external:<id>"). SELECTED always outranks this, so a real open
  // event wins over a stale hover. Null when nothing tagged was under the
  // pointer.
  hovered:
    | { kind: "native"; event: Event }
    | { kind: "external"; event: ExternalEvent }
    | null;

  /** The next ~5 upcoming events (start_date >= today), pre-sorted + capped by
   *  the caller, for the "Next up" nav group (spec 5). Native + external. */
  upcomingEvents: CalendarUpcomingItem[];

  // Pre-computed helpers the builder needs but must not derive itself (keeps
  // the builder pure and the formatting identical to the page's modals).
  /** The detail-modal date line for a native / external event, e.g. "Jun 9 to
   *  Jun 12" or "Jun 9 - 2:00p". The page formats this with formatTime so the
   *  echo matches the modal. */
  eventDateLine: (e: Event | ExternalEvent) => string;
  /** A relative + absolute "Next up" subtitle, e.g. "in 2 days, Jun 9". */
  upcomingDetail: (item: CalendarUpcomingItem) => string;
  /** The feed that owns an external event (for "Show this event's feed"). */
  feedOfExternal: (e: ExternalEvent) => CalendarFeed | null;
}

/** One row in the "Next up" group. The discriminant lets the jump handler pick
 *  the native vs external open path, and the tone the rose vs slate chip. */
export type CalendarUpcomingItem =
  | { kind: "native"; event: Event }
  | { kind: "external"; event: ExternalEvent };

// ── The handler bag (closures over the page's real functions) ──────────────
export interface CalendarSourceHandlers {
  // Selection actions (the page's onEdit / onDelete / reopen paths).
  setEditingEvent: (e: Event | null) => void;
  setSelectedEvent: (e: Event | null) => void;
  setSelectedExternal: (e: ExternalEvent | null) => void;
  setDeleteConfirmEvent: (e: Event | null) => void;
  /** eventsApi.create a copy then invalidate ["events"] (thin page helper). */
  duplicateEvent: (e: Event) => void | Promise<void>;
  /** eventsApi.update is_pto + syncEventPtoChange then invalidate (thin page
   *  helper, gates on currentUser, NEVER writes pto_dates directly). */
  markEventPto: (e: Event, on: boolean) => void | Promise<void>;

  // Create (the page's create flows).
  openCreate: () => void; // setCreating(true)
  openCreateAt: (dateStr: string, startTime: string | null) => void;

  // Navigate (date frame).
  goToToday: () => void;
  stepDate: (dir: -1 | 1) => void;
  /** setCurrentDate(parse(dateStr)) for a jump-to-date (used by the hook's
   *  query-driven nicety; harmless if unused here). */
  goToDate: (dateStr: string) => void;
  openDayView: (dateStr: string) => void;
  setExpandedDate: (dateStr: string) => void;

  // View.
  setView: (v: CalendarView) => void;

  // Feeds.
  openFeeds: () => void;
  addFeed: () => void;
  retryExternal: () => void; // refetchExternal()
}

// ── The view modes, mirrored so the builder can stay pure. ─────────────────
export const CALENDAR_VIEWS: { label: string; value: CalendarView }[] = [
  { label: "month", value: "month" },
  { label: "week", value: "week" },
  { label: "day", value: "day" },
];

/** Resolve the current SELECTED entity (native beats external). */
function resolveSelection(
  data: CalendarSourceData,
):
  | { kind: "native"; event: Event }
  | { kind: "external"; event: ExternalEvent }
  | null {
  if (data.selectedEvent) return { kind: "native", event: data.selectedEvent };
  if (data.selectedExternal) {
    return { kind: "external", event: data.selectedExternal };
  }
  return null;
}

/** Resolve the active context entity by the SELECTED > HOVERED rule. When a real
 *  selection exists, hovered is ignored. When nothing is selected, the event the
 *  cursor was pointing at drives the SAME context-card selection line and the
 *  SAME Suggested action set, only the framing ("pointing at" vs "selected")
 *  changes. `isHovered` lets the copy and the Suggested hint switch voice without
 *  duplicating the per-kind logic. */
function resolveContext(data: CalendarSourceData):
  | { kind: "native"; event: Event; isHovered: boolean }
  | { kind: "external"; event: ExternalEvent; isHovered: boolean }
  | null {
  const sel = resolveSelection(data);
  if (sel?.kind === "native") {
    return { kind: "native", event: sel.event, isHovered: false };
  }
  if (sel?.kind === "external") {
    return { kind: "external", event: sel.event, isHovered: false };
  }

  const hov = data.hovered;
  if (hov?.kind === "native") {
    return { kind: "native", event: hov.event, isHovered: true };
  }
  if (hov?.kind === "external") {
    return { kind: "external", event: hov.event, isHovered: true };
  }
  return null;
}

/** Build the context card (spec 2.4). Title + meta from the frame, plus a
 *  second stacked selection line under a hairline divider when an event is
 *  selected ("Selected, ACS National Meeting, Jun 9 to Jun 12"; external adds
 *  ", read-only"). */
function buildContextCard(data: CalendarSourceData): PaletteContextCard {
  const ctx = resolveContext(data);
  let selection: PaletteContextCard["selection"];

  // The selection line frames a real selection as the open event and a hover as
  // "the event you were pointing at", so the user knows which one drives
  // Suggested.
  if (ctx?.kind === "native") {
    const e = ctx.event;
    const bits = [data.eventDateLine(e)];
    if (e.is_pto === true) bits.push("PTO");
    const lead = ctx.isHovered ? "Pointing at" : "Selected";
    selection = {
      iconName: "list",
      text: `${lead}, ${e.title}, ${bits.join(", ")}`,
    };
  } else if (ctx?.kind === "external") {
    const e = ctx.event;
    const feed = data.feedOfExternal(e);
    const bits = [data.eventDateLine(e), "read-only"];
    if (feed) bits.push(`from ${feed.label}`);
    const lead = ctx.isHovered ? "Pointing at" : "Selected";
    selection = {
      iconName: "import",
      text: `${lead}, ${e.title}, ${bits.join(", ")}`,
    };
  }

  return {
    // No "calendar" glyph exists in the registry, so reuse "history" (the same
    // time-reading substitute the Gantt source picked).
    iconName: "history",
    title: `Calendar, ${data.frame.title}`,
    meta: data.frame.meta,
    selection,
  };
}

/** Build the full command set with stable ids + page-defined groups (spec 3 +
 *  6). The selection-specific rows carry stable ids the Suggested rule names. */
function buildCommands(
  data: CalendarSourceData,
  handlers: CalendarSourceHandlers,
): EditorCommand[] {
  const out: EditorCommand[] = [];
  // SELECTED > HOVERED. A hovered event drives the same action rows as a
  // selection (same ids, same gating), so Suggested can reference them either
  // way.
  const ctx = resolveContext(data);
  const frame = data.frame;

  // ── Selected / hovered native event actions (spec 3.A). ───────────────────
  if (ctx?.kind === "native") {
    const e = ctx.event;
    const dateLine = data.eventDateLine(e);
    const isPto = e.is_pto === true;
    out.push({
      id: "calendar-event-edit",
      label: `Edit "${e.title}"`,
      detail: dateLine,
      group: CALENDAR_GROUP_SELECTED_EVENT,
      iconName: "pencil",
      run: () => {
        handlers.setEditingEvent(e);
        handlers.setSelectedEvent(null);
      },
    });
    out.push({
      id: "calendar-event-delete",
      label: `Delete "${e.title}"`,
      detail: "permanent",
      group: CALENDAR_GROUP_SELECTED_EVENT,
      iconName: "trash",
      run: () => handlers.setDeleteConfirmEvent(e),
    });
    out.push({
      id: "calendar-event-duplicate",
      label: `Duplicate "${e.title}"`,
      detail: "new copy, same day",
      group: CALENDAR_GROUP_SELECTED_EVENT,
      iconName: "copy",
      run: () => void handlers.duplicateEvent(e),
    });
    // PTO toggle, exactly one row showing depending on the current flag.
    if (!isPto) {
      out.push({
        id: "calendar-event-mark-pto",
        label: `Mark "${e.title}" as PTO`,
        detail: `treats ${dateLine} like a weekend`,
        group: CALENDAR_GROUP_SELECTED_EVENT,
        iconName: "alarmClock",
        run: () => void handlers.markEventPto(e, true),
      });
    } else {
      out.push({
        id: "calendar-event-clear-pto",
        label: `Remove PTO from "${e.title}"`,
        detail: "back to a normal day",
        group: CALENDAR_GROUP_SELECTED_EVENT,
        iconName: "alarmClock",
        run: () => void handlers.markEventPto(e, false),
      });
    }
    out.push({
      id: "calendar-event-open",
      label: `Open "${e.title}"`,
      detail: "see details",
      group: CALENDAR_GROUP_SELECTED_EVENT,
      iconName: "eye",
      run: () => handlers.setSelectedEvent(e),
    });
  }

  // ── Selected / hovered external (read-only) event actions (spec 3.B). ─────
  if (ctx?.kind === "external") {
    const e = ctx.event;
    const feed = data.feedOfExternal(e);
    out.push({
      id: "calendar-external-open-source",
      label: "Open in source app",
      detail: e.url ?? "no link on this event",
      group: CALENDAR_GROUP_SELECTED_EVENT,
      iconName: "share",
      enabled: Boolean(e.url),
      run: () => {
        if (e.url) window.open(e.url, "_blank", "noopener,noreferrer");
      },
    });
    out.push({
      id: "calendar-external-show-feed",
      label: "Show this event's feed",
      detail: feed ? `from ${feed.label}` : "linked calendar",
      group: CALENDAR_GROUP_SELECTED_EVENT,
      iconName: "import",
      run: () => handlers.openFeeds(),
    });
    out.push({
      id: "calendar-external-copy",
      label: "Copy event details",
      detail: `${e.title}, ${data.eventDateLine(e)}`,
      group: CALENDAR_GROUP_SELECTED_EVENT,
      iconName: "copy",
      run: () => {
        const line = `${e.title} - ${data.eventDateLine(e)}`;
        void navigator.clipboard?.writeText(line);
      },
    });
  }

  // ── Create (spec 6). ──────────────────────────────────────────────────────
  out.push({
    id: "calendar-new-event",
    label: "New event",
    detail: `in ${frame.frameLabel}`,
    group: CALENDAR_GROUP_CREATE,
    iconName: "plus",
    run: handlers.openCreate,
  });
  out.push({
    id: "calendar-new-event-today",
    label: "New event today",
    detail: frame.todayStr,
    group: CALENDAR_GROUP_CREATE,
    iconName: "plus",
    run: () => handlers.openCreateAt(frame.todayStr, null),
  });
  out.push({
    id: "calendar-new-event-focused-day",
    label: "New event on the focused day",
    detail: frame.focusedDateStr,
    keywords: "create add",
    group: CALENDAR_GROUP_CREATE,
    iconName: "plus",
    run: () => handlers.openCreateAt(frame.focusedDateStr, null),
  });
  out.push({
    id: "calendar-new-all-day-event",
    label: "New all-day event",
    detail: "no time",
    keywords: "create add",
    group: CALENDAR_GROUP_CREATE,
    iconName: "plus",
    run: () => handlers.openCreateAt(frame.focusedDateStr, null),
  });

  // ── Navigate (date) (spec 6). ─────────────────────────────────────────────
  out.push({
    id: "calendar-go-today",
    label: "Go to today",
    detail: `you are on ${frame.title}`,
    group: CALENDAR_GROUP_NAVIGATE,
    iconName: "history",
    enabled: !frame.isOnToday,
    run: handlers.goToToday,
  });
  out.push({
    id: "calendar-prev",
    label: `Previous ${frame.unitNoun}`,
    keywords: "back earlier",
    group: CALENDAR_GROUP_NAVIGATE,
    iconName: "caret",
    run: () => handlers.stepDate(-1),
  });
  out.push({
    id: "calendar-next",
    label: `Next ${frame.unitNoun}`,
    keywords: "forward later",
    group: CALENDAR_GROUP_NAVIGATE,
    iconName: "caret",
    run: () => handlers.stepDate(1),
  });
  out.push({
    id: "calendar-open-focused-day",
    label: "See everything on the focused day",
    detail: frame.focusedDateStr,
    keywords: "day drawer agenda",
    group: CALENDAR_GROUP_NAVIGATE,
    iconName: "list",
    run: () => handlers.setExpandedDate(frame.focusedDateStr),
  });

  // ── View (spec 6). Each switch shown only for the views you are NOT on. ────
  for (const v of CALENDAR_VIEWS) {
    out.push({
      id: `calendar-view-${v.value}`,
      label: `Switch to ${v.label} view`,
      detail: `from ${frame.view} view`,
      keywords: "zoom layout",
      group: CALENDAR_GROUP_VIEW,
      iconName: "layer",
      enabled: frame.view !== v.value,
      run: () => handlers.setView(v.value),
    });
  }

  // ── Feeds (spec 6). ───────────────────────────────────────────────────────
  out.push({
    id: "calendar-add-feed",
    label: "Add a calendar feed",
    detail: "Google, Outlook, iCloud",
    group: CALENDAR_GROUP_FEEDS,
    iconName: "plus",
    run: handlers.addFeed,
  });
  out.push({
    id: "calendar-manage-feeds",
    label: "Manage linked calendars",
    detail: `${data.enabledFeedCount} connected`,
    keywords: "feeds subscriptions",
    group: CALENDAR_GROUP_FEEDS,
    iconName: "import",
    run: handlers.openFeeds,
  });
  out.push({
    id: "calendar-retry-syncs",
    label: "Retry failed calendar syncs",
    detail: "re-fetch the linked calendars",
    keywords: "refresh reload",
    group: CALENDAR_GROUP_FEEDS,
    iconName: "refresh",
    // Twin the amber banner, hide / disable when offline (nothing to retry).
    enabled: !data.offlineMode && data.externalErrorsCount > 0,
    run: handlers.retryExternal,
  });

  return out;
}

/** The ordered ids of the contextually relevant commands for the current
 *  selection / frame (spec 3, the Suggested rule). These ids must all exist in
 *  buildCommands; ids that are disabled / absent are silently skipped by the
 *  palette. */
function buildSuggestedIds(data: CalendarSourceData): string[] {
  const ids: string[] = [];
  // SELECTED > HOVERED, both lead with the same per-event action ids.
  const ctx = resolveContext(data);

  if (ctx?.kind === "native") {
    const isPto = ctx.event.is_pto === true;
    ids.push(
      "calendar-event-edit",
      "calendar-event-delete",
      "calendar-event-duplicate",
      isPto ? "calendar-event-clear-pto" : "calendar-event-mark-pto",
      "calendar-event-open",
    );
    return ids;
  }

  if (ctx?.kind === "external") {
    ids.push(
      "calendar-external-open-source",
      "calendar-external-show-feed",
      "calendar-external-copy",
    );
    return ids;
  }

  // Nothing selected, the orientation set (spec 3.D). Make the frame shine.
  ids.push("calendar-new-event", "calendar-new-event-today");
  if (!data.frame.isOnToday) ids.push("calendar-go-today");
  // Offer the two views you are not on.
  for (const v of CALENDAR_VIEWS) {
    if (data.frame.view !== v.value) ids.push(`calendar-view-${v.value}`);
  }
  ids.push("calendar-prev", "calendar-next");
  if (!data.offlineMode && data.externalErrorsCount > 0) {
    ids.push("calendar-retry-syncs");
  }
  return ids;
}

/** The Suggested heading hint (spec 3). */
function buildSuggestedHint(data: CalendarSourceData): string | undefined {
  const ctx = resolveContext(data);
  if (ctx?.kind === "native") {
    return ctx.isHovered
      ? "for the event you were pointing at"
      : "for the selected event";
  }
  if (ctx?.kind === "external") {
    return ctx.isHovered
      ? "for the linked event you were pointing at"
      : "for the selected linked event";
  }
  return undefined;
}

/** Jump to a native event, anchoring on its start_date + opening the modal. */
function nativeEventNavItem(
  event: Event,
  data: CalendarSourceData,
  handlers: CalendarSourceHandlers,
  detailOverride?: string,
): PaletteNavItem {
  return {
    id: `event-${event.id}`,
    label: event.title,
    detail:
      detailOverride ?? `${data.eventDateLine(event)}, ${event.event_type}`,
    keywords: [event.location ?? "", event.event_type].filter(Boolean).join(" "),
    iconName: "list",
    tone: "event",
    onRun: () => {
      handlers.goToDate(event.start_date);
      handlers.setSelectedEvent(event);
    },
  };
}

/** Jump to an external (read-only) event, anchoring + opening the read-only
 *  modal. */
function externalEventNavItem(
  event: ExternalEvent,
  data: CalendarSourceData,
  handlers: CalendarSourceHandlers,
  detailOverride?: string,
): PaletteNavItem {
  const feed = data.feedOfExternal(event);
  return {
    id: `external-${event.id}`,
    label: event.title,
    detail:
      detailOverride ??
      `${data.eventDateLine(event)}${feed ? `, ${feed.label}` : ""}`,
    keywords: [event.location ?? "", feed?.label ?? "", "linked feed"]
      .filter(Boolean)
      .join(" "),
    iconName: "import",
    tone: "feed",
    onRun: () => {
      handlers.goToDate(event.start_date);
      handlers.setSelectedExternal(event);
    },
  };
}

/** Build the nav groups (spec 4 + 5). Order, Jump to an event (on-screen,
 *  native then external), then Next up (the upcoming events, omitted if
 *  empty). */
function buildNavGroups(
  data: CalendarSourceData,
  handlers: CalendarSourceHandlers,
): PaletteNavGroup[] {
  const groups: PaletteNavGroup[] = [];

  // Jump to an event, scoped to the on-screen set in the resting view (native
  // first, then external). Typing widens across all events via the palette's
  // own fuzzy pass over these items.
  const jumpItems: PaletteNavItem[] = [
    ...data.onScreenEvents.map((e) =>
      nativeEventNavItem(e, data, handlers),
    ),
    ...data.onScreenExternalEvents.map((e) =>
      externalEventNavItem(e, data, handlers),
    ),
  ];
  groups.push({
    title: "Jump to an event",
    hint: `in view (${jumpItems.length})`,
    items: jumpItems,
  });

  // Next up (the freshest-signal substitute, spec 5). Omit the whole group when
  // there is nothing upcoming.
  const upcomingItems: PaletteNavItem[] = data.upcomingEvents.map((item) => {
    const detail = data.upcomingDetail(item);
    return item.kind === "native"
      ? nativeEventNavItem(item.event, data, handlers, detail)
      : externalEventNavItem(item.event, data, handlers, detail);
  });
  if (upcomingItems.length > 0) {
    groups.push({ title: "Next up", items: upcomingItems });
  }

  return groups;
}

/** Build the whole Calendar BeakerSearch source from a pure state snapshot. */
const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

/** Pure date parse for the "Go to <date>" interpretation row. Given the typed
 *  query and today (a local YYYY-MM-DD, injected so the result is deterministic),
 *  returns the target date + a display label, or null when the query is not a
 *  date. Handles strict YYYY-MM-DD (with a validity round-trip that rejects
 *  2026-02-31, mirroring the page's deep-link check), "today" / "tomorrow", and a
 *  month name plus day with an optional year ("Jun 9", "9 june", "June 9 2026"). */
export function parseCalendarDate(
  query: string,
  todayStr: string,
): { dateStr: string; label: string } | null {
  const q = query.trim().toLowerCase();
  if (q === "") return null;

  const pad = (n: number) => String(n).padStart(2, "0");
  const toStr = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
  const valid = (y: number, m: number, d: number) => {
    const dt = new Date(y, m - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
  };
  const label = (y: number, m: number, d: number) => {
    const name = MONTHS[m - 1];
    return `${name[0].toUpperCase()}${name.slice(1)} ${d}, ${y}`;
  };

  const [ty, tm, td] = todayStr.split("-").map(Number);
  if (q === "today") return { dateStr: todayStr, label: label(ty, tm, td) };
  if (q === "tomorrow") {
    const dt = new Date(ty, tm - 1, td + 1);
    const y = dt.getFullYear(), m = dt.getMonth() + 1, d = dt.getDate();
    return { dateStr: toStr(y, m, d), label: label(y, m, d) };
  }

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(q);
  if (iso) {
    const y = +iso[1], m = +iso[2], d = +iso[3];
    return valid(y, m, d) ? { dateStr: toStr(y, m, d), label: label(y, m, d) } : null;
  }

  const tokens = q.replace(/,/g, " ").split(/\s+/).filter(Boolean);
  let monIdx = -1, day = -1, year = -1;
  for (const t of tokens) {
    const mi = MONTHS.findIndex((mn) => mn === t || mn.slice(0, 3) === t);
    if (mi >= 0 && monIdx < 0) {
      monIdx = mi;
      continue;
    }
    const n = Number(t);
    if (Number.isInteger(n) && t !== "") {
      if (n >= 1 && n <= 31 && day < 0) day = n;
      else if (n >= 1000) year = n;
    }
  }
  if (monIdx >= 0 && day >= 1) {
    const y = year >= 1000 ? year : ty;
    const m = monIdx + 1;
    return valid(y, m, day) ? { dateStr: toStr(y, m, day), label: label(y, m, day) } : null;
  }
  return null;
}

export function buildCalendarSource(
  data: CalendarSourceData,
  handlers: CalendarSourceHandlers,
): BeakerSearchSource {
  return {
    id: "calendar",
    contextCard: buildContextCard(data),
    commands: buildCommands(data, handlers),
    suggestedIds: buildSuggestedIds(data),
    suggestedHint: buildSuggestedHint(data),
    navGroups: buildNavGroups(data, handlers),
    // Query-aware seam (step 3), a "Go to <typed date>" row that leads the typed
    // view when the query parses as a date. goToDate anchors the calendar there.
    interpretQuery: (query: string): PaletteNavGroup[] => {
      const parsed = parseCalendarDate(query, data.frame.todayStr);
      if (!parsed) return [];
      return [
        {
          title: "Go to a date",
          items: [
            {
              id: "calendar-goto-date",
              label: `Go to ${parsed.label}`,
              detail: "jump the calendar there",
              iconName: "history",
              onRun: () => handlers.goToDate(parsed.dateStr),
            },
          ],
        },
      ];
    },
  };
}

// Re-export so the hook / tests can name the icon set without re-deriving it.
export type { IconName };
