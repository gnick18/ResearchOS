// sequence editor master (Calendar source sub-bot). Tests for the PURE Calendar
// BeakerSearch source builder. These cover the context-card copy (month / week /
// day + a native vs external selection line), the command set (ids + groups +
// PTO-toggle flip + retry / view-switch / external-open gating), the Suggested
// ordering for a selected native event vs a selected external event vs nothing
// selected, and the nav groups (Jump to an event tones / hint, Next up ordering
// + cap), all without a DOM or a store, mirroring gantt-beaker-source.test.ts.

import { describe, it, expect } from "vitest";
import type { CalendarFeed, Event, ExternalEvent, Task } from "@/lib/types";
import {
  buildCalendarSource,
  parseCalendarDate,
  type CalendarFrame,
  type CalendarSourceData,
  type CalendarSourceHandlers,
  type CalendarUpcomingItem,
} from "./calendar-beaker-source";

// ── Fixtures ───────────────────────────────────────────────────────────────

function makeEvent(over: Partial<Event> = {}): Event {
  return {
    id: 1,
    title: "ACS National Meeting",
    event_type: "conference",
    start_date: "2026-06-09",
    end_date: "2026-06-12",
    start_time: null,
    end_time: null,
    location: "San Francisco, CA",
    url: null,
    notes: null,
    color: null,
    is_pto: false,
    ...over,
  } as Event;
}

function makeExternal(over: Partial<ExternalEvent> = {}): ExternalEvent {
  return {
    id: "feed1-uid-7",
    feedId: 1,
    feedKind: "ics",
    providerEventId: "uid-7",
    title: "Group Meeting",
    start_date: "2026-06-10",
    end_date: null,
    start_time: "10:00",
    end_time: "11:00",
    location: null,
    url: "https://cal.example/event/7",
    notes: null,
    color: "#3b82f6",
    source: "external",
    ...over,
  } as ExternalEvent;
}

function makeTask(over: Partial<Task> = {}): Task {
  return {
    id: 7,
    project_id: 10,
    owner: "self",
    name: "PCR optimization",
    start_date: "2026-06-12",
    duration_days: 7,
    end_date: "2026-06-19",
    is_high_level: false,
    is_complete: false,
    task_type: "experiment",
    tags: ["PCR"],
    ...over,
  } as Task;
}

function makeFeed(over: Partial<CalendarFeed> = {}): CalendarFeed {
  return {
    id: 1,
    provider: "google",
    kind: "ics",
    label: "Lab Google Calendar",
    icsUrl: "https://cal.example/lab.ics",
    color: "#3b82f6",
    enabled: true,
    lastSyncAt: "2026-06-07",
    ...over,
  } as CalendarFeed;
}

const noopHandlers: CalendarSourceHandlers = {
  setEditingEvent: () => {},
  setSelectedEvent: () => {},
  setSelectedExternal: () => {},
  setDeleteConfirmEvent: () => {},
  duplicateEvent: () => {},
  markEventPto: () => {},
  linkEventToTask: () => {},
  unlinkEventTask: () => {},
  openLinkedTask: () => {},
  openCreate: () => {},
  openCreateAt: () => {},
  goToToday: () => {},
  stepDate: () => {},
  goToDate: () => {},
  openDayView: () => {},
  setExpandedDate: () => {},
  setView: () => {},
  openFeeds: () => {},
  addFeed: () => {},
  retryExternal: () => {},
};

function monthFrame(over: Partial<CalendarFrame> = {}): CalendarFrame {
  return {
    view: "month",
    title: "June 2026",
    meta: "30 days in view, 2 events",
    unitNoun: "month",
    focusedDateStr: "2026-06-15",
    todayStr: "2026-06-15",
    isOnToday: true,
    frameLabel: "June 2026",
    ...over,
  };
}

function makeData(over: Partial<CalendarSourceData> = {}): CalendarSourceData {
  const feeds = over.feeds ?? [makeFeed()];
  return {
    events: [makeEvent()],
    externalEvents: [makeExternal()],
    feeds,
    enabledFeedCount: feeds.filter((f) => f.enabled).length,
    externalErrorsCount: 0,
    offlineMode: false,
    frame: monthFrame(),
    onScreenEvents: [makeEvent()],
    onScreenExternalEvents: [makeExternal()],
    selectedEvent: null,
    selectedExternal: null,
    hovered: null,
    upcomingEvents: [],
    tasks: over.tasks ?? [makeTask()],
    eventDateLine: (e) =>
      e.end_date && e.end_date !== e.start_date
        ? `${e.start_date} to ${e.end_date}`
        : e.start_date,
    upcomingDetail: (item) => `soon, ${item.event.start_date}`,
    feedOfExternal: (e) => feeds.find((f) => f.id === e.feedId) ?? null,
    taskKeyOf: (t) => `${t.is_shared_with_me ? t.owner : "self"}:${t.id}`,
    taskProjectLabel: (t) =>
      t.is_shared_with_me ? `shared by ${t.owner}` : "Mitochondria QC",
    linkedTaskOf: (e) =>
      e.task_id == null
        ? null
        : (over.tasks ?? [makeTask()]).find((t) => t.id === e.task_id) ?? null,
    ...over,
  };
}

// ── Context card ─────────────────────────────────────────────────────────────

describe("buildCalendarSource context card", () => {
  it("is two lines, Calendar + frame title + meta, no selection when nothing selected", () => {
    const card = buildCalendarSource(makeData(), noopHandlers).contextCard!;
    expect(card.title).toBe("Calendar, June 2026");
    expect(card.meta).toBe("30 days in view, 2 events");
    expect(card.selection).toBeUndefined();
  });

  it("phrases the week frame title + meta from the frame", () => {
    const card = buildCalendarSource(
      makeData({
        frame: monthFrame({
          view: "week",
          title: "week of Jun 7",
          meta: "Jun 7 to Jun 13, 4 events",
          unitNoun: "week",
        }),
      }),
      noopHandlers,
    ).contextCard!;
    expect(card.title).toBe("Calendar, week of Jun 7");
    expect(card.meta).toBe("Jun 7 to Jun 13, 4 events");
  });

  it("adds the native selection line with the date echo", () => {
    const data = makeData({ selectedEvent: makeEvent() });
    const card = buildCalendarSource(data, noopHandlers).contextCard!;
    expect(card.selection?.text).toBe(
      "Selected, ACS National Meeting, 2026-06-09 to 2026-06-12",
    );
  });

  it("marks PTO in the native selection line", () => {
    const data = makeData({ selectedEvent: makeEvent({ is_pto: true }) });
    const card = buildCalendarSource(data, noopHandlers).contextCard!;
    expect(card.selection?.text).toContain("PTO");
  });

  it("adds the external selection line with read-only + the feed label", () => {
    const data = makeData({ selectedExternal: makeExternal() });
    const card = buildCalendarSource(data, noopHandlers).contextCard!;
    expect(card.selection?.text).toBe(
      "Selected, Group Meeting, 2026-06-10, read-only, from Lab Google Calendar",
    );
  });
});

// ── Commands ─────────────────────────────────────────────────────────────────

describe("buildCalendarSource commands", () => {
  it("always emits Create / Navigate / View / Feeds commands with stable ids and groups", () => {
    const cmds = buildCalendarSource(makeData(), noopHandlers).commands;
    const byId = new Map(cmds.map((c) => [c.id, c]));
    expect(byId.get("calendar-new-event")?.group).toBe("Create");
    expect(byId.get("calendar-new-event-today")?.group).toBe("Create");
    expect(byId.get("calendar-go-today")?.group).toBe("Navigate");
    expect(byId.get("calendar-prev")?.group).toBe("Navigate");
    expect(byId.get("calendar-view-week")?.group).toBe("View");
    expect(byId.get("calendar-add-feed")?.group).toBe("Feeds");
    expect(byId.get("calendar-manage-feeds")?.group).toBe("Feeds");
    // Three view-switch rows, one per view.
    expect(cmds.filter((c) => c.id.startsWith("calendar-view-")).length).toBe(3);
  });

  it("labels Previous / Next with the frame unit noun", () => {
    const cmds = buildCalendarSource(
      makeData({ frame: monthFrame({ unitNoun: "week" }) }),
      noopHandlers,
    ).commands;
    const byId = new Map(cmds.map((c) => [c.id, c]));
    expect(byId.get("calendar-prev")?.label).toBe("Previous week");
    expect(byId.get("calendar-next")?.label).toBe("Next week");
  });

  it("disables the view switch for the view you are on, enables the others", () => {
    const byId = new Map(
      buildCalendarSource(
        makeData({ frame: monthFrame({ view: "month" }) }),
        noopHandlers,
      ).commands.map((c) => [c.id, c]),
    );
    expect(byId.get("calendar-view-month")?.enabled).toBe(false);
    expect(byId.get("calendar-view-week")?.enabled).toBe(true);
    expect(byId.get("calendar-view-day")?.enabled).toBe(true);
  });

  it("disables Go to today only when already on today", () => {
    const onToday = new Map(
      buildCalendarSource(
        makeData({ frame: monthFrame({ isOnToday: true }) }),
        noopHandlers,
      ).commands.map((c) => [c.id, c]),
    );
    expect(onToday.get("calendar-go-today")?.enabled).toBe(false);
    const notToday = new Map(
      buildCalendarSource(
        makeData({ frame: monthFrame({ isOnToday: false }) }),
        noopHandlers,
      ).commands.map((c) => [c.id, c]),
    );
    expect(notToday.get("calendar-go-today")?.enabled).toBe(true);
  });

  it("enables Retry failed syncs only when there are errors and not offline", () => {
    const clean = new Map(
      buildCalendarSource(makeData({ externalErrorsCount: 0 }), noopHandlers).commands.map(
        (c) => [c.id, c],
      ),
    );
    expect(clean.get("calendar-retry-syncs")?.enabled).toBe(false);
    const withErrors = new Map(
      buildCalendarSource(makeData({ externalErrorsCount: 2 }), noopHandlers).commands.map(
        (c) => [c.id, c],
      ),
    );
    expect(withErrors.get("calendar-retry-syncs")?.enabled).toBe(true);
    const offline = new Map(
      buildCalendarSource(
        makeData({ externalErrorsCount: 2, offlineMode: true }),
        noopHandlers,
      ).commands.map((c) => [c.id, c]),
    );
    expect(offline.get("calendar-retry-syncs")?.enabled).toBe(false);
  });

  it("emits the selected-native-event rows under Selected event and flips the PTO row", () => {
    const notPto = buildCalendarSource(
      makeData({ selectedEvent: makeEvent({ is_pto: false }) }),
      noopHandlers,
    ).commands;
    const notPtoSel = notPto.filter((c) => c.group === "Selected event");
    expect(notPtoSel.map((c) => c.id)).toEqual([
      "calendar-event-edit",
      "calendar-event-delete",
      "calendar-event-duplicate",
      "calendar-event-mark-pto",
      "calendar-event-open",
      "calendar-event-link-task",
    ]);

    const isPto = buildCalendarSource(
      makeData({ selectedEvent: makeEvent({ is_pto: true }) }),
      noopHandlers,
    ).commands;
    const ids = isPto.map((c) => c.id);
    expect(ids).toContain("calendar-event-clear-pto");
    expect(ids).not.toContain("calendar-event-mark-pto");
  });

  it("emits the reduced read-only rows for a selected external event and gates open-in-source on a url", () => {
    const withUrl = buildCalendarSource(
      makeData({ selectedExternal: makeExternal({ url: "https://x.test" }) }),
      noopHandlers,
    ).commands;
    const sel = withUrl.filter((c) => c.group === "Selected event");
    expect(sel.map((c) => c.id)).toEqual([
      "calendar-external-open-source",
      "calendar-external-show-feed",
      "calendar-external-copy",
    ]);
    expect(
      withUrl.find((c) => c.id === "calendar-external-open-source")?.enabled,
    ).toBe(true);

    const noUrl = buildCalendarSource(
      makeData({ selectedExternal: makeExternal({ url: null }) }),
      noopHandlers,
    ).commands;
    expect(
      noUrl.find((c) => c.id === "calendar-external-open-source")?.enabled,
    ).toBe(false);
  });
});

// ── Suggested ────────────────────────────────────────────────────────────────

describe("buildCalendarSource suggested ordering", () => {
  it("leads with the native event actions when a native event is selected", () => {
    const src = buildCalendarSource(
      makeData({ selectedEvent: makeEvent({ is_pto: false }) }),
      noopHandlers,
    );
    expect(src.suggestedIds).toEqual([
      "calendar-event-edit",
      "calendar-event-delete",
      "calendar-event-duplicate",
      "calendar-event-mark-pto",
      "calendar-event-open",
      "calendar-event-link-task",
    ]);
    expect(src.suggestedHint).toBe("for the selected event");
    // Every suggested id must exist in commands.
    const ids = new Set(src.commands.map((c) => c.id));
    for (const id of src.suggestedIds ?? []) expect(ids.has(id)).toBe(true);
  });

  it("flips the PTO suggestion when the selected event is already PTO", () => {
    const src = buildCalendarSource(
      makeData({ selectedEvent: makeEvent({ is_pto: true }) }),
      noopHandlers,
    );
    expect(src.suggestedIds).toContain("calendar-event-clear-pto");
    expect(src.suggestedIds).not.toContain("calendar-event-mark-pto");
  });

  it("uses the reduced read-only set when an external event is selected", () => {
    const src = buildCalendarSource(
      makeData({ selectedExternal: makeExternal() }),
      noopHandlers,
    );
    expect(src.suggestedIds).toEqual([
      "calendar-external-open-source",
      "calendar-external-show-feed",
      "calendar-external-copy",
    ]);
    expect(src.suggestedHint).toBe("for the selected linked event");
  });

  it("suggests the orientation set when nothing is selected, with the off-views and no retry", () => {
    const src = buildCalendarSource(
      makeData({ frame: monthFrame({ view: "month", isOnToday: true }) }),
      noopHandlers,
    );
    expect(src.suggestedIds).toEqual([
      "calendar-new-event",
      "calendar-new-event-today",
      "calendar-view-week",
      "calendar-view-day",
      "calendar-prev",
      "calendar-next",
    ]);
    expect(src.suggestedHint).toBeUndefined();
  });

  it("adds Go to today and Retry when off-today and feeds have errors", () => {
    const src = buildCalendarSource(
      makeData({
        frame: monthFrame({ isOnToday: false }),
        externalErrorsCount: 1,
      }),
      noopHandlers,
    );
    expect(src.suggestedIds).toContain("calendar-go-today");
    expect(src.suggestedIds).toContain("calendar-retry-syncs");
  });
});

// ── Hover as context (SELECTED > HOVERED) ────────────────────────────────────

describe("buildCalendarSource hovered path", () => {
  it("a hovered native event with no selection drives the native Suggested + hint", () => {
    const src = buildCalendarSource(
      makeData({
        selectedEvent: null,
        selectedExternal: null,
        hovered: { kind: "native", event: makeEvent({ is_pto: false }) },
      }),
      noopHandlers,
    );
    expect(src.suggestedIds).toEqual([
      "calendar-event-edit",
      "calendar-event-delete",
      "calendar-event-duplicate",
      "calendar-event-mark-pto",
      "calendar-event-open",
      "calendar-event-link-task",
    ]);
    expect(src.suggestedHint).toBe("for the event you were pointing at");
    // The same rows show up under Selected event, driven by the hover.
    const sel = src.commands.filter((c) => c.group === "Selected event");
    expect(sel.map((c) => c.id)).toEqual([
      "calendar-event-edit",
      "calendar-event-delete",
      "calendar-event-duplicate",
      "calendar-event-mark-pto",
      "calendar-event-open",
      "calendar-event-link-task",
    ]);
  });

  it("frames the hovered native event context line as Pointing at", () => {
    const card = buildCalendarSource(
      makeData({
        hovered: { kind: "native", event: makeEvent() },
      }),
      noopHandlers,
    ).contextCard!;
    expect(card.selection?.text).toBe(
      "Pointing at, ACS National Meeting, 2026-06-09 to 2026-06-12",
    );
  });

  it("a hovered external event with no selection drives the read-only Suggested + hint", () => {
    const src = buildCalendarSource(
      makeData({
        hovered: { kind: "external", event: makeExternal() },
      }),
      noopHandlers,
    );
    expect(src.suggestedIds).toEqual([
      "calendar-external-open-source",
      "calendar-external-show-feed",
      "calendar-external-copy",
    ]);
    expect(src.suggestedHint).toBe("for the linked event you were pointing at");
    const card = src.contextCard!;
    expect(card.selection?.text).toBe(
      "Pointing at, Group Meeting, 2026-06-10, read-only, from Lab Google Calendar",
    );
  });

  it("a selected event outranks a hovered one", () => {
    const src = buildCalendarSource(
      makeData({
        selectedEvent: makeEvent({ id: 1, title: "Selected One" }),
        hovered: {
          kind: "native",
          event: makeEvent({ id: 2, title: "Hovered Two" }),
        },
      }),
      noopHandlers,
    );
    // The card frames the SELECTED event, not the hover.
    expect(src.contextCard!.selection?.text).toContain("Selected, Selected One");
    expect(src.contextCard!.selection?.text).not.toContain("Hovered Two");
    expect(src.suggestedHint).toBe("for the selected event");
  });

  it("a selected external event outranks a hovered native one", () => {
    const src = buildCalendarSource(
      makeData({
        selectedExternal: makeExternal({ id: "x-sel", title: "Selected Feed" }),
        hovered: {
          kind: "native",
          event: makeEvent({ id: 9, title: "Hovered Native" }),
        },
      }),
      noopHandlers,
    );
    expect(src.suggestedIds).toEqual([
      "calendar-external-open-source",
      "calendar-external-show-feed",
      "calendar-external-copy",
    ]);
    expect(src.contextCard!.selection?.text).toContain("Selected, Selected Feed");
    expect(src.suggestedHint).toBe("for the selected linked event");
  });
});

// ── Nav groups ───────────────────────────────────────────────────────────────

describe("buildCalendarSource nav groups", () => {
  it("has Jump to an event (native rose, external slate) with an in-view hint", () => {
    const src = buildCalendarSource(makeData(), noopHandlers);
    const groups = src.navGroups ?? [];
    const jump = groups.find((g) => g.title === "Jump to an event")!;
    expect(jump.hint).toBe("in view (2)");
    // Native first, then external.
    expect(jump.items[0].tone).toBe("event");
    expect(jump.items[0].id).toBe("event-1");
    expect(jump.items[1].tone).toBe("feed");
    expect(jump.items[1].id).toBe("external-feed1-uid-7");
    expect(jump.items[1].keywords).toContain("Lab Google Calendar");
  });

  it("omits Next up when there is nothing upcoming", () => {
    const src = buildCalendarSource(makeData({ upcomingEvents: [] }), noopHandlers);
    expect((src.navGroups ?? []).some((g) => g.title === "Next up")).toBe(false);
  });

  it("includes Next up in the caller's order with the relative detail", () => {
    const upcoming: CalendarUpcomingItem[] = [
      { kind: "native", event: makeEvent({ id: 5, title: "Lab Meeting", start_date: "2026-06-16" }) },
      { kind: "external", event: makeExternal({ id: "x-9", title: "Seminar", start_date: "2026-06-18" }) },
    ];
    const src = buildCalendarSource(
      makeData({ upcomingEvents: upcoming }),
      noopHandlers,
    );
    const next = (src.navGroups ?? []).find((g) => g.title === "Next up")!;
    expect(next.items.map((i) => i.label)).toEqual(["Lab Meeting", "Seminar"]);
    expect(next.items[0].detail).toBe("soon, 2026-06-16");
    expect(next.items[0].tone).toBe("event");
    expect(next.items[1].tone).toBe("feed");
  });
});

// ── Event-to-task linking (the inline link sub-flow + the linked-state flip) ──

describe("buildCalendarSource event-to-task link sub-flow", () => {
  it("an unlinked native event carries the link command with an INLINE sub-flow", () => {
    const cmds = buildCalendarSource(
      makeData({ selectedEvent: makeEvent({ task_id: null }) }),
      noopHandlers,
    ).commands;
    const link = cmds.find((c) => c.id === "calendar-event-link-task")!;
    expect(link).toBeDefined();
    expect(link.group).toBe("Selected event");
    expect(link.subflow).toBeDefined();
    const sf = link.subflow!();
    // Single stage, no explicit presentation (renders inline by inference).
    expect(sf.presentation).toBeUndefined();
    expect(sf.title).toBe('Link "ACS National Meeting" to a task');
  });

  it("the picker lists the user's tasks (name, project detail, task tone)", () => {
    const tasks = [
      makeTask({ id: 7, name: "PCR optimization" }),
      makeTask({ id: 8, name: "Cloning run" }),
    ];
    const cmds = buildCalendarSource(
      makeData({ selectedEvent: makeEvent({ task_id: null }), tasks }),
      noopHandlers,
    ).commands;
    const sf = cmds.find((c) => c.id === "calendar-event-link-task")!.subflow!();
    expect(sf.items.map((i) => i.label)).toEqual(["PCR optimization", "Cloning run"]);
    expect(sf.items[0].id).toBe("self:7");
    expect(sf.items[0].tone).toBe("task");
    expect(sf.items[0].detail).toContain("Mitochondria QC");
  });

  it("picking a task calls eventsApi.update with task_id + the composite owner then completes", () => {
    const linked: Array<[number, number, string | undefined]> = [];
    const handlers: CalendarSourceHandlers = {
      ...noopHandlers,
      linkEventToTask: (event, task) => {
        linked.push([event.id, task.id, task.is_shared_with_me ? task.owner : "self"]);
      },
    };
    const shared = makeTask({
      id: 9,
      owner: "alex",
      is_shared_with_me: true,
      name: "Shared run",
    });
    const cmds = buildCalendarSource(
      makeData({
        selectedEvent: makeEvent({ id: 1, task_id: null }),
        tasks: [shared],
      }),
      handlers,
    ).commands;
    const sf = cmds.find((c) => c.id === "calendar-event-link-task")!.subflow!();
    // The picked item id is the composite owner key for the shared task.
    expect(sf.items[0].id).toBe("alex:9");
    const next = sf.onPick(sf.items[0]);
    expect(next).toBeUndefined();
    // Carries the composite owner (alex) so the shared task links correctly.
    expect(linked).toEqual([[1, 9, "alex"]]);
  });

  it("disables the link row when there is no task to link to", () => {
    const cmds = buildCalendarSource(
      makeData({ selectedEvent: makeEvent({ task_id: null }), tasks: [] }),
      noopHandlers,
    ).commands;
    expect(cmds.find((c) => c.id === "calendar-event-link-task")?.enabled).toBe(false);
  });

  it("a linked native event flips to a Jump (navigate, no sub-flow) plus an Unlink", () => {
    const linkedTask = makeTask({ id: 7, name: "PCR optimization" });
    const cmds = buildCalendarSource(
      makeData({
        selectedEvent: makeEvent({ task_id: 7, task_owner: "self" }),
        tasks: [linkedTask],
      }),
      noopHandlers,
    ).commands;
    const ids = cmds.filter((c) => c.group === "Selected event").map((c) => c.id);
    // The link row is gone, replaced by jump + unlink.
    expect(ids).not.toContain("calendar-event-link-task");
    expect(ids).toContain("calendar-event-jump-task");
    expect(ids).toContain("calendar-event-unlink-task");

    const jump = cmds.find((c) => c.id === "calendar-event-jump-task")!;
    // Jump is a plain NAVIGATE, no sub-flow.
    expect(jump.subflow).toBeUndefined();
    expect(jump.label).toBe('Jump to linked task "PCR optimization"');
  });

  it("the Jump row opens the linked task via the openTask key", () => {
    const opened: string[] = [];
    const handlers: CalendarSourceHandlers = {
      ...noopHandlers,
      openLinkedTask: (key) => {
        opened.push(key);
      },
    };
    const linkedTask = makeTask({ id: 7 });
    const cmds = buildCalendarSource(
      makeData({
        selectedEvent: makeEvent({ task_id: 7, task_owner: "self" }),
        tasks: [linkedTask],
      }),
      handlers,
    ).commands;
    cmds.find((c) => c.id === "calendar-event-jump-task")!.run();
    expect(opened).toEqual(["self:7"]);
  });

  it("the Unlink row clears the link via eventsApi.update(null)", () => {
    const unlinked: number[] = [];
    const handlers: CalendarSourceHandlers = {
      ...noopHandlers,
      unlinkEventTask: (e) => {
        unlinked.push(e.id);
      },
    };
    const cmds = buildCalendarSource(
      makeData({ selectedEvent: makeEvent({ id: 3, task_id: 7, task_owner: "self" }) }),
      handlers,
    ).commands;
    cmds.find((c) => c.id === "calendar-event-unlink-task")!.run();
    expect(unlinked).toEqual([3]);
  });

  it("suggests jump + unlink for a linked event and the link row for an unlinked one", () => {
    const linkedSrc = buildCalendarSource(
      makeData({ selectedEvent: makeEvent({ task_id: 7, task_owner: "self" }) }),
      noopHandlers,
    );
    expect(linkedSrc.suggestedIds).toContain("calendar-event-jump-task");
    expect(linkedSrc.suggestedIds).toContain("calendar-event-unlink-task");
    expect(linkedSrc.suggestedIds).not.toContain("calendar-event-link-task");

    const unlinkedSrc = buildCalendarSource(
      makeData({ selectedEvent: makeEvent({ task_id: null }) }),
      noopHandlers,
    );
    expect(unlinkedSrc.suggestedIds).toContain("calendar-event-link-task");
    expect(unlinkedSrc.suggestedIds).not.toContain("calendar-event-jump-task");
  });

  it("offers no link row for an external (read-only) event", () => {
    const cmds = buildCalendarSource(
      makeData({ selectedExternal: makeExternal() }),
      noopHandlers,
    ).commands;
    const ids = cmds.filter((c) => c.group === "Selected event").map((c) => c.id);
    expect(ids).not.toContain("calendar-event-link-task");
    expect(ids).not.toContain("calendar-event-jump-task");
  });
});

describe("parseCalendarDate", () => {
  const today = "2026-06-15";
  it("parses strict YYYY-MM-DD and rejects an invalid day", () => {
    expect(parseCalendarDate("2026-07-01", today)).toEqual({
      dateStr: "2026-07-01",
      label: "July 1, 2026",
    });
    expect(parseCalendarDate("2026-02-31", today)).toBeNull();
  });
  it("parses today and tomorrow against the injected today", () => {
    expect(parseCalendarDate("today", today)?.dateStr).toBe("2026-06-15");
    expect(parseCalendarDate("tomorrow", today)?.dateStr).toBe("2026-06-16");
  });
  it("parses a month name plus day, inferring the current year, with an optional year", () => {
    expect(parseCalendarDate("Jun 9", today)).toEqual({ dateStr: "2026-06-09", label: "June 9, 2026" });
    expect(parseCalendarDate("9 june", today)?.dateStr).toBe("2026-06-09");
    expect(parseCalendarDate("June 9 2027", today)?.dateStr).toBe("2027-06-09");
  });
  it("returns null for a non-date query", () => {
    expect(parseCalendarDate("lab meeting", today)).toBeNull();
    expect(parseCalendarDate("jun", today)).toBeNull();
  });
});

describe("interpretQuery (the Go to date row)", () => {
  it("returns a Go to <date> row that jumps when the query is a date", () => {
    let jumped: string | null = null;
    const src = buildCalendarSource(makeData(), { ...noopHandlers, goToDate: (d) => { jumped = d; } });
    const groups = src.interpretQuery!("2026-07-01");
    expect(groups[0].title).toBe("Go to a date");
    expect(groups[0].items[0].label).toBe("Go to July 1, 2026");
    groups[0].items[0].onRun();
    expect(jumped).toBe("2026-07-01");
  });
  it("returns no rows when the query is not a date", () => {
    const src = buildCalendarSource(makeData(), noopHandlers);
    expect(src.interpretQuery!("lab meeting")).toEqual([]);
  });
});
