"use client";

// Check-ins revamp Phase 1 (checkins-revamp bot, 2026-06-11). See
// docs/proposals/checkins-revamp.md. The generalized check-in surface, mounted
// as a Workbench tab for EVERY account. A left rail of the viewer's spaces,
// grouped by the mentor edge (your mentor / your mentees / peers / groups) and
// labeled by the counterpart via `oneOnOneLabel`, plus a main pane with four
// sub-tabs every member edits: Weekly goals, Meeting notes, Notes, Agenda.
//
// Phase 1: any account can start a space (the lab-head gate is retired); the
// new-check-in dialog picks ONE other person plus a "I am the mentor" checkbox.
// Multi-person groups, per-task assignees, IDP, templates, and the tree view
// are later phases and are NOT built here.
//
// Reads route through `labApi.getOneOnOne*` (sharing-respecting aggregations);
// writes route through `oneOnOnesApi`. House style: `<Icon>` only, brand tokens,
// `<Tooltip>` on icon-only buttons, no em-dashes, no emojis, no mid-sentence
// colons in copy.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { labApi, oneOnOnesApi, usersApi } from "@/lib/local-api";
import { oneOnOneLabel } from "@/lib/one-on-one/label";
import { normalizeOneOnOne } from "@/lib/one-on-one/normalize";
import type {
  Note,
  OneOnOne,
  OneOnOneActionItem,
  WeeklyGoal,
} from "@/lib/types";
import { Icon } from "@/components/icons";
import Tooltip from "@/components/Tooltip";
import ContextMenu from "@/components/ContextMenu";
import NoteDetailPopup from "@/components/NoteDetailPopup";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";
import type {
  WorkbenchInitialOpen,
  WorkbenchRecentRef,
} from "@/app/workbench/workbench-beaker-source";

type AreaTab = "goals" | "meetings" | "notes" | "agenda";

const AREA_TABS: Array<{ id: AreaTab; label: string }> = [
  { id: "goals", label: "Weekly goals" },
  { id: "meetings", label: "Meeting notes" },
  { id: "notes", label: "Notes" },
  { id: "agenda", label: "Agenda" },
];

interface WorkbenchOneOnOnePanelProps {
  /** The signed-in username (drives the role-relative label + perspective). */
  currentUser: string;
  /** True when the viewer is a lab head. Phase 1 no longer gates create/delete
   *  on this (any account can start a space), but it is kept for the
   *  BeakerSearch source + future role-aware copy. */
  isLabHead: boolean;
  /** BeakerSearch cross-tab jump (spec 4.2). A pending {kind:"oneonone", key}
   *  intent selects the matching 1:1 once on mount (or opens the new-dialog for
   *  the "__create__" sentinel), then clears via onInitialOpenConsumed. */
  initialOpen?: WorkbenchInitialOpen;
  onInitialOpenConsumed?: () => void;
  /** BeakerSearch v2 chunk 3, the live-selection lift. Reports the open 1:1 up
   *  to the page so the BeakerSearch context card + Suggested describe the 1:1
   *  the user actually selected. Fires with the open 1:1, null when none. */
  onSelectionChange?: (sel: WorkbenchRecentRef | null) => void;
}

const ooKey = ["one-on-ones"] as const;
const goalsKey = (id: string) => ["one-on-one", id, "goals"] as const;
const notesKeyFor = (id: string) => ["one-on-one", id, "notes"] as const;
const itemsKey = (id: string) => ["one-on-one", id, "action-items"] as const;

export default function WorkbenchOneOnOnePanel({
  currentUser,
  // isLabHead is still accepted (parent passes it) but Phase 1 no longer gates
  // create/delete on it; any account can start a space.
  initialOpen = null,
  onInitialOpenConsumed,
  onSelectionChange,
}: WorkbenchOneOnOnePanelProps) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [area, setArea] = useState<AreaTab>("goals");
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; oo: OneOnOne } | null>(
    null,
  );

  const { data: oneOnOnes = [] } = useQuery<OneOnOne[]>({
    queryKey: ooKey,
    queryFn: () => labApi.getOneOnOnes(),
  });

  // Keep a valid selection: default to the first 1:1, and re-point if the
  // selected one disappears (e.g. after a delete).
  useEffect(() => {
    if (oneOnOnes.length === 0) {
      if (selectedId !== null) setSelectedId(null);
      return;
    }
    if (!selectedId || !oneOnOnes.some((o) => o.id === selectedId)) {
      setSelectedId(oneOnOnes[0].id);
    }
  }, [oneOnOnes, selectedId]);

  const selected = useMemo(
    () => oneOnOnes.find((o) => o.id === selectedId) ?? null,
    [oneOnOnes, selectedId],
  );

  // BeakerSearch cross-tab jump (spec 4.2). Select the pending 1:1 once on mount
  // (or open the new-dialog for the "__create__" sentinel), then clear. The 1:1
  // panel has no popup, the selection IS the open state.
  useEffect(() => {
    if (!initialOpen || initialOpen.kind !== "oneonone") return;
    if (initialOpen.key === "__create__") {
      setShowNewDialog(true);
    } else {
      const id = initialOpen.key.replace(/^oneonone-/, "");
      if (oneOnOnes.some((o) => o.id === id)) setSelectedId(id);
    }
    onInitialOpenConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialOpen, oneOnOnes]);

  // BeakerSearch v2 chunk 3, the live-selection lift. Report the open 1:1 up to
  // the page so the BeakerSearch source names the 1:1 the user actually selected.
  // The key matches the hook's 1:1 resolution (oneonone-<id>). The selection IS
  // the open state here (no popup), so watching selectedId covers every path.
  useEffect(() => {
    onSelectionChange?.(
      selectedId ? { kind: "oneonone", key: `oneonone-${selectedId}` } : null,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => oneOnOnesApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ooKey });
    },
  });

  // Group the spaces by the mentor edge (proposal Part 1, rail grouping).
  // - "Your mentor": pair spaces where someone ELSE is the mentor.
  // - "Your mentees": pair spaces where YOU are the mentor.
  // - "Peers": pair spaces with no mentor.
  // - "Groups": 3+ member spaces (phase 2 builds their UI; here they just list).
  const railGroups = useMemo(
    () => groupSpacesByRelationship(oneOnOnes, currentUser),
    [oneOnOnes, currentUser],
  );

  return (
    <div className="flex gap-4" data-testid="workbench-oneonone-panel">
      {/* Left rail */}
      <aside className="w-64 flex-shrink-0">
        <div className="mb-2 flex items-center justify-between px-1">
          <h3 className="text-meta font-semibold uppercase tracking-wide text-foreground-muted">
            Check-ins
          </h3>
          <Tooltip label="Start a check-in">
            <button
              type="button"
              onClick={() => setShowNewDialog(true)}
              aria-label="Start a check-in"
              data-testid="oneonone-start-rail"
              className="rounded-lg p-1 text-brand-action transition-colors hover:bg-surface-sunken"
            >
              <Icon name="userPlus" className="h-[18px] w-[18px]" />
            </button>
          </Tooltip>
        </div>

        {oneOnOnes.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-surface-sunken/50 px-3 py-3 text-body text-foreground-muted">
            <p>
              No check-ins yet. Start one with anyone to share weekly goals,
              meeting notes, and an agenda.
            </p>
            <button
              type="button"
              onClick={() => setShowNewDialog(true)}
              data-testid="oneonone-start-empty-rail"
              className="btn-brand mt-3 flex items-center gap-1.5 rounded-lg px-3 py-2 text-body font-medium"
            >
              <Icon name="userPlus" className="h-4 w-4" />
              Start a check-in
            </button>
            <Link
              href="/wiki/features/one-on-ones"
              className="mt-3 inline-block text-meta font-medium text-brand-action hover:underline"
            >
              Learn more
            </Link>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {railGroups.map((group) => (
              <div key={group.key} className="flex flex-col gap-1">
                <p className="px-1 text-meta font-semibold uppercase tracking-wide text-foreground-muted">
                  {group.label}
                </p>
                <ul className="flex flex-col gap-1">
                  {group.spaces.map((oo) => {
                    const active = oo.id === selectedId;
                    return (
                      <li key={oo.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedId(oo.id)}
                          onContextMenu={(e) => {
                            const owner =
                              oo.owner === currentUser ||
                              oo.created_by === currentUser;
                            if (!owner) return;
                            e.preventDefault();
                            setMenu({ x: e.clientX, y: e.clientY, oo });
                          }}
                          className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-body transition-colors ${
                            active
                              ? "bg-brand-action/10 text-foreground"
                              : "text-foreground-muted hover:bg-surface-sunken hover:text-foreground"
                          }`}
                        >
                          <Icon
                            name="users"
                            className="h-4 w-4 flex-shrink-0 text-foreground-muted"
                          />
                          <span className="truncate">
                            {oneOnOneLabel(currentUser, oo)}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </aside>

      {/* Main pane */}
      <section className="min-w-0 flex-1">
        {!selected ? (
          oneOnOnes.length === 0 ? (
            <div className="flex h-48 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-surface-sunken/40 px-6 text-center text-body text-foreground-muted">
              <p>
                Check-ins are a shared space for weekly goals, meeting notes, and
                a rolling agenda. Start one with a mentor, a mentee, or a peer.
              </p>
              <button
                type="button"
                onClick={() => setShowNewDialog(true)}
                data-testid="oneonone-start-main"
                className="btn-brand flex items-center gap-1.5 rounded-lg px-3 py-2 text-body font-medium"
              >
                <Icon name="userPlus" className="h-4 w-4" />
                Start a check-in
              </button>
            </div>
          ) : (
            <div className="flex h-48 items-center justify-center rounded-xl border border-dashed border-border bg-surface-sunken/40 text-body text-foreground-muted">
              Select a check-in to view its weekly goals, meeting notes, and
              agenda.
            </div>
          )
        ) : (
          <>
            <div className="mb-4 flex items-center gap-1 border-b border-border pb-2">
              {AREA_TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setArea(t.id)}
                  className={`rounded-lg px-3 py-1.5 text-body font-medium transition-colors ${
                    area === t.id
                      ? "bg-brand-action/10 text-brand-action"
                      : "text-foreground-muted hover:bg-surface-sunken hover:text-foreground"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {area === "goals" && <WeeklyGoalsArea oneOnOne={selected} />}
            {area === "meetings" && (
              <NotesArea oneOnOne={selected} kind="meeting" currentUser={currentUser} />
            )}
            {area === "notes" && (
              <NotesArea oneOnOne={selected} kind="note" currentUser={currentUser} />
            )}
            {area === "agenda" && <AgendaArea oneOnOne={selected} />}
          </>
        )}
      </section>

      {showNewDialog && (
        <NewOneOnOneDialog
          currentUser={currentUser}
          existingPartners={existingPartners(oneOnOnes, currentUser)}
          onClose={() => setShowNewDialog(false)}
          onCreated={(created) => {
            queryClient.invalidateQueries({ queryKey: ooKey });
            setSelectedId(created.id);
            setShowNewDialog(false);
          }}
        />
      )}

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            {
              label: "Delete check-in",
              icon: <Icon name="trash" className="h-4 w-4 text-red-500" />,
              onClick: () => deleteMutation.mutate(menu.oo.id),
            },
          ]}
        />
      )}
    </div>
  );
}

// ── Weekly goals ─────────────────────────────────────────────────────────────

function WeeklyGoalsArea({ oneOnOne }: { oneOnOne: OneOnOne }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState("");

  const { data: goals = [] } = useQuery<WeeklyGoal[]>({
    queryKey: goalsKey(oneOnOne.id),
    queryFn: () => labApi.getOneOnOneWeeklyGoals(oneOnOne.id),
  });

  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey: goalsKey(oneOnOne.id) }),
    [queryClient, oneOnOne.id],
  );

  const [weekDate, setWeekDate] = useState(todayISO());

  const addMutation = useMutation({
    mutationFn: (goalText: string) =>
      oneOnOnesApi.addWeeklyGoal({
        oneOnOneId: oneOnOne.id,
        text: goalText,
        week_of: mondayOfISO(weekDate),
      }),
    onSuccess: invalidate,
  });
  const toggleMutation = useMutation({
    mutationFn: (g: WeeklyGoal) =>
      oneOnOnesApi.setWeeklyGoalComplete(g.id, g.owner, !g.is_complete),
    onSuccess: invalidate,
  });
  const deleteMutation = useMutation({
    mutationFn: (g: WeeklyGoal) =>
      oneOnOnesApi.deleteWeeklyGoal(g.id, g.owner),
    onSuccess: invalidate,
  });

  const byWeek = useMemo(() => {
    const map = new Map<string, WeeklyGoal[]>();
    for (const g of goals) {
      const list = map.get(g.week_of) ?? [];
      list.push(g);
      map.set(g.week_of, list);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [goals]);

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    addMutation.mutate(trimmed);
    setText("");
  };

  return (
    <div className="flex flex-col gap-4">
      <AddRow
        value={text}
        onChange={setText}
        onSubmit={submit}
        placeholder="Add a weekly goal"
        busy={addMutation.isPending}
        date={weekDate}
        onDateChange={setWeekDate}
        dateLabel="Week of"
      />
      {byWeek.length === 0 ? (
        <EmptyArea label="No weekly goals yet. Add the first one above." />
      ) : (
        byWeek.map(([week, list]) => (
          <div key={week} className="flex flex-col gap-1">
            <p className="text-meta font-semibold uppercase tracking-wide text-foreground-muted">
              Week of {week}
            </p>
            <ul className="flex flex-col gap-1">
              {list.map((g) => (
                <li
                  key={`${g.owner}:${g.id}`}
                  className="group flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2"
                >
                  <button
                    type="button"
                    onClick={() => toggleMutation.mutate(g)}
                    aria-label={g.is_complete ? "Mark not done" : "Mark done"}
                    className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border transition-colors ${
                      g.is_complete
                        ? "border-brand-action bg-brand-action text-white"
                        : "border-border text-transparent hover:border-brand-action"
                    }`}
                  >
                    <Icon name="check" className="h-3.5 w-3.5" />
                  </button>
                  <span
                    className={`min-w-0 flex-1 text-body ${
                      g.is_complete
                        ? "text-foreground-muted line-through"
                        : "text-foreground"
                    }`}
                  >
                    {g.text}
                  </span>
                  <DeleteIconButton
                    label="Delete goal"
                    onClick={() => deleteMutation.mutate(g)}
                  />
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </div>
  );
}

// ── Meeting notes + freeform shared notes (shared editor surface) ────────────

function NotesArea({
  oneOnOne,
  kind,
  currentUser,
}: {
  oneOnOne: OneOnOne;
  kind: "meeting" | "note";
  currentUser: string;
}) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [openNote, setOpenNote] = useState<Note | null>(null);

  const { data: notes = [] } = useQuery<Note[]>({
    queryKey: notesKeyFor(oneOnOne.id),
    queryFn: () => labApi.getOneOnOneNotes(oneOnOne.id),
  });

  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey: notesKeyFor(oneOnOne.id) }),
    [queryClient, oneOnOne.id],
  );

  const [meetingDate, setMeetingDate] = useState(todayISO());

  const addMutation = useMutation({
    mutationFn: (noteTitle: string) =>
      kind === "meeting"
        ? oneOnOnesApi.addMeetingNote({
            oneOnOneId: oneOnOne.id,
            title: noteTitle,
            date: meetingDate,
          })
        : oneOnOnesApi.addSharedNote({
            oneOnOneId: oneOnOne.id,
            title: noteTitle,
          }),
    onSuccess: invalidate,
  });

  const visible = useMemo(() => {
    // Meeting notes sort by the chosen meeting date (entry date); freeform
    // notes by creation time. Newest first either way.
    const sortKey = (n: Note) =>
      kind === "meeting"
        ? (n.entries?.[0]?.date ?? n.created_at ?? n.updated_at ?? "")
        : (n.created_at ?? n.updated_at ?? "");
    return notes
      .filter((n) => (n.note_kind ?? "note") === kind)
      .sort((a, b) => sortKey(b).localeCompare(sortKey(a)));
  }, [notes, kind]);

  const submit = () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    addMutation.mutate(trimmed);
    setTitle("");
  };

  return (
    <div className="flex flex-col gap-4">
      <AddRow
        value={title}
        onChange={setTitle}
        onSubmit={submit}
        placeholder={kind === "meeting" ? "New meeting note" : "New shared note"}
        busy={addMutation.isPending}
        {...(kind === "meeting"
          ? {
              date: meetingDate,
              onDateChange: setMeetingDate,
              dateLabel: "Meeting date",
            }
          : {})}
      />
      {visible.length === 0 ? (
        <EmptyArea
          label={
            kind === "meeting"
              ? "No meeting notes yet. Add one for your next meeting."
              : "No shared notes yet. Add one above."
          }
        />
      ) : (
        <ul className="flex flex-col gap-1">
          {visible.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                onClick={() => setOpenNote(n)}
                className="flex w-full items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-left transition-colors hover:bg-surface-sunken"
              >
                <Icon
                  name="file"
                  className="h-4 w-4 flex-shrink-0 text-foreground-muted"
                />
                <span className="min-w-0 flex-1 truncate text-body text-foreground">
                  {n.title || "Untitled"}
                </span>
                {(() => {
                  // Meeting notes show the chosen meeting date (entry date);
                  // freeform notes show their creation date.
                  const shown =
                    kind === "meeting"
                      ? (n.entries?.[0]?.date ?? n.created_at)
                      : n.created_at;
                  return shown ? (
                    <span className="text-meta text-foreground-muted">
                      {shown.slice(0, 10)}
                    </span>
                  ) : null;
                })()}
              </button>
            </li>
          ))}
        </ul>
      )}

      {openNote && (
        <NoteDetailPopup
          note={openNote}
          onClose={() => setOpenNote(null)}
          onUpdate={(updated) => {
            setOpenNote(updated);
            invalidate();
          }}
          onDelete={() => {
            setOpenNote(null);
            invalidate();
          }}
          currentUser={currentUser}
        />
      )}
    </div>
  );
}

// ── Agenda / action items ────────────────────────────────────────────────────

function AgendaArea({ oneOnOne }: { oneOnOne: OneOnOne }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState("");

  const { data: items = [] } = useQuery<OneOnOneActionItem[]>({
    queryKey: itemsKey(oneOnOne.id),
    queryFn: () => labApi.getOneOnOneActionItems(oneOnOne.id),
  });

  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey: itemsKey(oneOnOne.id) }),
    [queryClient, oneOnOne.id],
  );

  const addMutation = useMutation({
    mutationFn: (itemText: string) =>
      oneOnOnesApi.addActionItem({ oneOnOneId: oneOnOne.id, text: itemText }),
    onSuccess: invalidate,
  });
  const toggleMutation = useMutation({
    mutationFn: (item: OneOnOneActionItem) =>
      oneOnOnesApi.toggleActionItem(item.id, item.owner),
    onSuccess: invalidate,
  });
  const deleteMutation = useMutation({
    mutationFn: (item: OneOnOneActionItem) =>
      oneOnOnesApi.deleteActionItem(item.id, item.owner),
    onSuccess: invalidate,
  });

  const sorted = useMemo(
    () =>
      [...items].sort(
        (a, b) =>
          Number(a.is_done) - Number(b.is_done) ||
          b.created_at.localeCompare(a.created_at),
      ),
    [items],
  );

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    addMutation.mutate(trimmed);
    setText("");
  };

  return (
    <div className="flex flex-col gap-4">
      <AddRow
        value={text}
        onChange={setText}
        onSubmit={submit}
        placeholder="Add an agenda item or action item"
        busy={addMutation.isPending}
      />
      {sorted.length === 0 ? (
        <EmptyArea label="No agenda items yet. Add one for your next meeting." />
      ) : (
        <ul className="flex flex-col gap-1">
          {sorted.map((item) => (
            <li
              key={item.id}
              className="group flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2"
            >
              <button
                type="button"
                onClick={() => toggleMutation.mutate(item)}
                aria-label={item.is_done ? "Mark not done" : "Mark done"}
                className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border transition-colors ${
                  item.is_done
                    ? "border-brand-action bg-brand-action text-white"
                    : "border-border text-transparent hover:border-brand-action"
                }`}
              >
                <Icon name="check" className="h-3.5 w-3.5" />
              </button>
              <span
                className={`min-w-0 flex-1 text-body ${
                  item.is_done
                    ? "text-foreground-muted line-through"
                    : "text-foreground"
                }`}
              >
                {item.text}
              </span>
              {!item.is_done && isCarriedOver(item.created_at) && (
                <Tooltip label="Open since your last check-in, still on the agenda">
                  <span className="flex flex-shrink-0 items-center gap-1 rounded-full bg-surface-sunken px-2 py-0.5 text-meta text-foreground-muted">
                    <Icon name="history" className="h-3 w-3" />
                    carried over
                  </span>
                </Tooltip>
              )}
              <DeleteIconButton
                label="Delete item"
                onClick={() => deleteMutation.mutate(item)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Shared little pieces ─────────────────────────────────────────────────────

function AddRow({
  value,
  onChange,
  onSubmit,
  placeholder,
  busy,
  date,
  onDateChange,
  dateLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  placeholder: string;
  busy: boolean;
  /** When set with `onDateChange`, renders a leading date picker (meeting date
   *  or the week a goal belongs to). */
  date?: string;
  onDateChange?: (v: string) => void;
  dateLabel?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      {onDateChange && (
        <input
          type="date"
          value={date ?? ""}
          onChange={(e) => onDateChange(e.target.value)}
          aria-label={dateLabel ?? "Date"}
          className="flex-shrink-0 rounded-lg border border-border bg-surface px-3 py-2 text-body text-foreground focus:border-brand-action focus:outline-none focus:ring-2 focus:ring-brand-action/30"
        />
      )}
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSubmit();
        }}
        placeholder={placeholder}
        className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-body text-foreground focus:border-brand-action focus:outline-none focus:ring-2 focus:ring-brand-action/30"
      />
      <button
        type="button"
        onClick={onSubmit}
        disabled={busy || !value.trim()}
        className="btn-brand flex items-center gap-1.5 rounded-lg px-3 py-2 text-body font-medium disabled:opacity-40"
      >
        <Icon name="plus" className="h-4 w-4" />
        Add
      </button>
    </div>
  );
}

/** ISO date (YYYY-MM-DD) of the Monday on or before `iso`. Matches the server
 *  `mondayOf` grouping so a goal lands in the intended week bucket. */
function mondayOfISO(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  const day = d.getDay(); // 0 = Sun
  const diff = (day + 6) % 7; // days since Monday
  d.setDate(d.getDate() - diff);
  return d.toISOString().slice(0, 10);
}

/** Today as YYYY-MM-DD in local time. */
function todayISO(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

/** How long an unchecked agenda item must sit before it shows the gentle
 *  "carried over" cue. The proposal frames this softly (NOT "overdue"). */
const CARRY_OVER_DAYS = 7;

/** True when `createdAtISO` is older than `CARRY_OVER_DAYS`. Display-only. */
function isCarriedOver(createdAtISO: string): boolean {
  const created = new Date(createdAtISO).getTime();
  if (Number.isNaN(created)) return false;
  const ageMs = Date.now() - created;
  return ageMs > CARRY_OVER_DAYS * 24 * 60 * 60 * 1000;
}

/** A rail section: a relationship group with its spaces. */
interface RailGroup {
  key: "mentor" | "mentees" | "peers" | "groups";
  label: string;
  spaces: OneOnOne[];
}

/**
 * Group the viewer's spaces by the mentor edge (proposal Part 1):
 *   - "Your mentor": pair spaces where someone else is the mentor.
 *   - "Your mentees": pair spaces where YOU are the mentor.
 *   - "Peers": pair spaces with no mentor.
 *   - "Groups": 3+ member spaces (phase 2 owns their UI; here they just list).
 * Empty groups are dropped so the rail only shows sections that have spaces.
 */
function groupSpacesByRelationship(
  spaces: OneOnOne[],
  viewer: string,
): RailGroup[] {
  const buckets: Record<RailGroup["key"], OneOnOne[]> = {
    mentor: [],
    mentees: [],
    peers: [],
    groups: [],
  };
  for (const oo of spaces) {
    const n = normalizeOneOnOne(oo);
    if (n.kind === "group") {
      buckets.groups.push(oo);
    } else if (!n.mentor) {
      buckets.peers.push(oo);
    } else if (n.mentor === viewer) {
      buckets.mentees.push(oo);
    } else {
      buckets.mentor.push(oo);
    }
  }
  const order: Array<{ key: RailGroup["key"]; label: string }> = [
    { key: "mentor", label: "Your mentor" },
    { key: "mentees", label: "Your mentees" },
    { key: "peers", label: "Peers" },
    { key: "groups", label: "Groups" },
  ];
  return order
    .map(({ key, label }) => ({ key, label, spaces: buckets[key] }))
    .filter((g) => g.spaces.length > 0);
}

/** The set of people the viewer already has a PAIR space with (so the new-space
 *  dialog can hide them). Group members are not excluded (phase 1 only creates
 *  pair spaces). */
function existingPartners(spaces: OneOnOne[], viewer: string): string[] {
  const out = new Set<string>();
  for (const oo of spaces) {
    const n = normalizeOneOnOne(oo);
    if (n.kind !== "pair") continue;
    for (const m of n.members) if (m !== viewer) out.add(m);
  }
  return [...out];
}

function EmptyArea({ label }: { label: string }) {
  return (
    <p className="rounded-lg border border-dashed border-border bg-surface-sunken/40 px-3 py-4 text-body text-foreground-muted">
      {label}
    </p>
  );
}

function DeleteIconButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <Tooltip label={label}>
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        className="flex-shrink-0 rounded p-1 text-foreground-muted opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100"
      >
        <Icon name="trash" className="h-4 w-4" />
      </button>
    </Tooltip>
  );
}

// ── New check-in dialog (any account) ────────────────────────────────────────
// Phase 1 keeps it to ONE other person plus a "I am the mentor" checkbox. The
// multi-select group picker is phase 2.

function NewOneOnOneDialog({
  currentUser,
  existingPartners,
  onClose,
  onCreated,
}: {
  currentUser: string;
  existingPartners: string[];
  onClose: () => void;
  onCreated: (created: OneOnOne) => void;
}) {
  const [roster, setRoster] = useState<string[]>([]);
  const [loadingRoster, setLoadingRoster] = useState(true);
  const [selected, setSelected] = useState("");
  const [isMentor, setIsMentor] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEscapeToClose(onClose);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { users, current_user } = await usersApi.list();
        if (cancelled) return;
        const taken = new Set(existingPartners);
        setRoster(
          users.filter((u) => u && u !== current_user && !taken.has(u)).sort(),
        );
      } catch (err) {
        console.error("Failed to load lab roster:", err);
        if (!cancelled) setError("Could not load the lab roster.");
      } finally {
        if (!cancelled) setLoadingRoster(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [existingPartners]);

  const handleCreate = useCallback(async () => {
    if (!selected || busy) return;
    setBusy(true);
    setError(null);
    try {
      const created = await oneOnOnesApi.create({
        members: [currentUser, selected],
        mentor: isMentor ? currentUser : null,
      });
      onCreated(created);
    } catch (err) {
      console.error("Failed to create check-in:", err);
      setError("Could not start the check-in. Please try again.");
      setBusy(false);
    }
  }, [selected, isMentor, currentUser, busy, onCreated]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Start a check-in"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-xl bg-surface-raised shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="text-brand-action">
              <Icon name="userPlus" className="h-[18px] w-[18px]" />
            </span>
            <div>
              <h2 className="text-title font-semibold text-foreground">
                Start a check-in
              </h2>
              <p className="text-meta text-foreground-muted">
                Pick anyone in your folder. You both share its goals, notes, and
                agenda.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex-shrink-0 rounded-lg p-1 text-foreground-muted transition-colors hover:bg-surface-sunken hover:text-foreground"
          >
            <Icon name="close" className="h-[18px] w-[18px]" />
          </button>
        </div>

        <div className="flex flex-col gap-4 px-5 py-4">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="oneonone-new-member"
              className="text-meta font-semibold uppercase tracking-wide text-foreground-muted"
            >
              Person
            </label>
            {loadingRoster ? (
              <p className="text-body italic text-foreground-muted">
                Loading people…
              </p>
            ) : roster.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border bg-surface-sunken/50 px-3 py-3 text-body text-foreground-muted">
                No one else is available. You already have a check-in with
                everyone, or no one else has joined your data folder yet.
              </p>
            ) : (
              <select
                id="oneonone-new-member"
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
                data-testid="oneonone-new-member-select"
                className="w-full rounded-lg border border-border px-3 py-2 text-body focus:border-brand-action focus:outline-none focus:ring-2 focus:ring-brand-action/30"
              >
                <option value="">Pick a person…</option>
                {roster.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            )}
          </div>

          <label className="flex items-start gap-2.5">
            <input
              type="checkbox"
              checked={isMentor}
              onChange={(e) => setIsMentor(e.target.checked)}
              data-testid="oneonone-new-mentor-checkbox"
              className="mt-0.5 h-4 w-4 flex-shrink-0 rounded border-border text-brand-action focus:ring-brand-action/30"
            />
            <span className="text-body text-foreground">
              This is a mentoring relationship (I am the mentor).
              <span className="mt-0.5 block text-meta text-foreground-muted">
                Leave unchecked for a peer check-in.
              </span>
            </span>
          </label>

          {error && <p className="text-body text-red-500">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-body font-medium text-foreground-muted transition-colors hover:bg-surface-sunken"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={!selected || busy}
            data-testid="oneonone-new-member-confirm"
            className="btn-brand rounded-lg px-4 py-2 text-body font-medium disabled:opacity-40"
          >
            {busy ? "Starting…" : "Start check-in"}
          </button>
        </div>
      </div>
    </div>
  );
}
