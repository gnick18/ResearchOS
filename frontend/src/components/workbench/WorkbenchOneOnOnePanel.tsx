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
import {
  labApi,
  oneOnOnesApi,
  usersApi,
  checkinCompactsApi,
  checkinOnboardingApi,
  checkinRotationsApi,
} from "@/lib/local-api";
import { oneOnOneLabel } from "@/lib/one-on-one/label";
import { normalizeOneOnOne } from "@/lib/one-on-one/normalize";
import { isSkipLevel, directMentorsOf } from "@/lib/checkins/mentorship-tree";
import MentorshipTree from "@/components/workbench/checkins/MentorshipTree";
import {
  CHECKIN_TEMPLATES,
  getCheckinTemplate,
  templateCadence,
} from "@/lib/checkins/templates";
import type {
  Note,
  OneOnOne,
  OneOnOneActionItem,
  WeeklyGoal,
  CheckinCompact,
  CheckinCompactRow,
  CheckinOnboarding,
  CheckinRotation,
} from "@/lib/types";
import { Icon } from "@/components/icons";
import Tooltip from "@/components/Tooltip";
import IdpPanel from "@/components/workbench/idp/IdpPanel";
import ContextMenu from "@/components/ContextMenu";
import NoteDetailPopup from "@/components/NoteDetailPopup";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";
import { useUserColorMap } from "@/hooks/useUserColor";
import { fallbackColorForUsername } from "@/lib/colors";
import type {
  WorkbenchInitialOpen,
  WorkbenchRecentRef,
} from "@/app/workbench/workbench-beaker-source";

type AreaTab =
  | "goals"
  | "meetings"
  | "notes"
  | "agenda"
  | "board"
  | "rotation"
  | "idp"
  | "compact"
  | "onboarding";

// Check-ins Phase 2: a group space (3+ members) gets a "Task board" sub-tab
// with per-assignee bands. Pair spaces keep the Phase 1 four-tab layout.
// Check-ins Phase 3: a MENTORING pair space (pair WITH a mentor) gets an "IDP"
// sub-tab. The trainee (the non-mentor member) sees "My IDP"; the mentor sees a
// review surface. Peer pairs and groups have no IDP tab.
// Check-ins Phase 3b: every space gets an "Expectations" (mentoring compact) and
// an "Onboarding" (checklist) sub-tab. Both are started on demand (lazily) and
// are most relevant to a new-member space, but are exposed generally rather than
// forced on every space.
function areaTabsFor(
  space: OneOnOne | null,
): Array<{ id: AreaTab; label: string }> {
  const base: Array<{ id: AreaTab; label: string }> = [
    { id: "goals", label: "Weekly goals" },
    { id: "meetings", label: "Meeting notes" },
    { id: "notes", label: "Notes" },
    { id: "agenda", label: "Agenda" },
  ];
  if (!space) return base;
  const norm = normalizeOneOnOne(space);
  if (norm.kind === "group") {
    base.push({ id: "board", label: "Task board" });
    // Check-ins Phase 4: a group space carries a presenter / journal-club
    // rotation. Pair spaces have no rotation (it takes 3+ people to rotate).
    base.push({ id: "rotation", label: "Rotation" });
  }
  if (norm.kind === "pair" && norm.mentor) {
    base.push({ id: "idp", label: "IDP" });
  }
  base.push({ id: "compact", label: "Expectations" });
  base.push({ id: "onboarding", label: "Onboarding" });
  return base;
}

/** For a mentoring pair space, the trainee is the member who is NOT the mentor.
 *  Returns null for a peer pair, a group, or a space without a resolvable
 *  counterpart. */
function traineeOf(space: OneOnOne): string | null {
  const norm = normalizeOneOnOne(space);
  if (norm.kind !== "pair" || !norm.mentor) return null;
  return norm.members.find((m) => m !== norm.mentor) ?? null;
}

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
const compactKey = (id: string) => ["one-on-one", id, "compact"] as const;
const onboardingKey = (id: string) =>
  ["one-on-one", id, "onboarding"] as const;
const rotationKey = (id: string) => ["one-on-one", id, "rotation"] as const;

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
  // Check-ins Phase 4: the "View lab tree" full-pane view. When on, the main
  // pane shows the mentorship forest instead of a selected space.
  const [showTree, setShowTree] = useState(false);
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

  // The sub-tabs available for the selected space (the Task board only exists
  // for a group). Reset the active tab if the selection no longer offers it
  // (e.g. switching from a group to a pair while "board" was open).
  const areaTabs = useMemo(() => areaTabsFor(selected), [selected]);
  useEffect(() => {
    if (!areaTabs.some((t) => t.id === area)) setArea(areaTabs[0].id);
  }, [areaTabs, area]);

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
          <div className="flex items-center gap-1">
            <Tooltip label="View lab tree">
              <button
                type="button"
                onClick={() => {
                  setShowTree(true);
                  setSelectedId(null);
                }}
                aria-label="View lab tree"
                data-testid="oneonone-view-tree-rail"
                className={`rounded-lg p-1 transition-colors hover:bg-surface-sunken ${
                  showTree ? "text-brand-action" : "text-foreground-muted"
                }`}
              >
                <Icon name="labTree" className="h-[18px] w-[18px]" />
              </button>
            </Tooltip>
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
                          onClick={() => {
                            setSelectedId(oo.id);
                            setShowTree(false);
                          }}
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
        {showTree ? (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-2 border-b border-border pb-2">
              <h3 className="flex items-center gap-2 text-body font-semibold text-foreground">
                <Icon name="labTree" className="h-4 w-4 text-foreground-muted" />
                Lab tree
              </h3>
              <button
                type="button"
                onClick={() => setShowTree(false)}
                data-testid="oneonone-tree-close"
                className="rounded-lg px-2.5 py-1.5 text-body font-medium text-foreground-muted transition-colors hover:bg-surface-sunken"
              >
                Back to check-ins
              </button>
            </div>
            <MentorshipTree spaces={oneOnOnes} currentUser={currentUser} />
          </div>
        ) : !selected ? (
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
            <SpaceHeader
              space={selected}
              allSpaces={oneOnOnes}
              currentUser={currentUser}
              onInvalidateSpaces={() =>
                queryClient.invalidateQueries({ queryKey: ooKey })
              }
            />
            <div className="mb-4 flex items-center gap-1 border-b border-border pb-2">
              {areaTabs.map((t) => (
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
            {area === "board" && (
              <TaskBoardArea oneOnOne={selected} currentUser={currentUser} />
            )}
            {area === "rotation" && (
              <RotationArea oneOnOne={selected} currentUser={currentUser} />
            )}
            {area === "idp" &&
              (() => {
                const trainee = traineeOf(selected);
                const mentor = normalizeOneOnOne(selected).mentor;
                if (!trainee) {
                  return (
                    <EmptyArea label="An IDP lives on a mentoring check-in. Set a mentor for this space to open it." />
                  );
                }
                return (
                  <IdpPanel
                    trainee={trainee}
                    currentUser={currentUser}
                    mentor={mentor}
                  />
                );
              })()}
            {area === "compact" && (
              <CompactArea oneOnOne={selected} currentUser={currentUser} />
            )}
            {area === "onboarding" && (
              <OnboardingArea oneOnOne={selected} currentUser={currentUser} />
            )}
          </>
        )}
      </section>

      {showNewDialog && (
        <NewOneOnOneDialog
          currentUser={currentUser}
          existingPartners={existingPartners(oneOnOnes, currentUser)}
          allSpaces={oneOnOnes}
          onClose={() => setShowNewDialog(false)}
          onCreated={(created) => {
            queryClient.invalidateQueries({ queryKey: ooKey });
            setSelectedId(created.id);
            setShowTree(false);
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
                    <Icon name="hourglass" className="h-3 w-3" />
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

// ── Task board (group spaces) ────────────────────────────────────────────────
// Check-ins Phase 2 (D2/D3/D4). A dense per-assignee board over the SAME action
// items the Agenda tab shows, surfaced for a group space. A "Shared" band holds
// unassigned items (anyone owns them, D2); each assigned member gets their own
// band with an assignee chip + due-date chip per row. The Everyone / Mine
// toggle filters to the viewer's own assignments. Any member can check any item
// (D2); only the assignee or the item creator may delete (D2/D3). An item with
// both an assignee and a due date materializes a real Task in that member's
// Lists view (D4), wired in `oneOnOnesApi.addActionItem` / `updateActionItem`.

function TaskBoardArea({
  oneOnOne,
  currentUser,
}: {
  oneOnOne: OneOnOne;
  currentUser: string;
}) {
  const queryClient = useQueryClient();
  const members = useMemo(
    () => normalizeOneOnOne(oneOnOne).members,
    [oneOnOne],
  );
  const [scope, setScope] = useState<"everyone" | "mine">("everyone");
  const [editing, setEditing] = useState<OneOnOneActionItem | null>(null);
  // Per-member swatch from `_user_metadata` so a member's band matches their
  // color everywhere else (login avatar, Gantt), not a positional palette.
  const colorMap = useUserColorMap();

  const { data: items = [] } = useQuery<OneOnOneActionItem[]>({
    queryKey: itemsKey(oneOnOne.id),
    queryFn: () => labApi.getOneOnOneActionItems(oneOnOne.id),
  });

  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey: itemsKey(oneOnOne.id) }),
    [queryClient, oneOnOne.id],
  );

  const addMutation = useMutation({
    mutationFn: (params: {
      text: string;
      assignee: string | null;
      due_date: string | null;
    }) =>
      oneOnOnesApi.addActionItem({ oneOnOneId: oneOnOne.id, ...params }),
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
  const editMutation = useMutation({
    mutationFn: (params: {
      id: string;
      owner: string;
      patch: { text?: string; assignee?: string | null; due_date?: string | null };
    }) => oneOnOnesApi.updateActionItem(params.id, params.patch, params.owner),
    onSuccess: () => {
      invalidate();
      setEditing(null);
    },
  });

  // Bands: a "Shared" band (assignee null) first, then one per member, in the
  // space's member order. Scope "mine" keeps the Shared band (unassigned work is
  // everyone's) plus the viewer's own band.
  const bands = useMemo(() => {
    const filtered =
      scope === "mine"
        ? items.filter((i) => i.assignee === currentUser || !i.assignee)
        : items;
    const byAssignee = new Map<string, OneOnOneActionItem[]>();
    const shared: OneOnOneActionItem[] = [];
    for (const i of filtered) {
      if (i.assignee) {
        const list = byAssignee.get(i.assignee) ?? [];
        list.push(i);
        byAssignee.set(i.assignee, list);
      } else {
        shared.push(i);
      }
    }
    const sortBand = (list: OneOnOneActionItem[]) =>
      [...list].sort(
        (a, b) =>
          Number(a.is_done) - Number(b.is_done) ||
          (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999") ||
          b.created_at.localeCompare(a.created_at),
      );
    const out: Array<{
      key: string;
      label: string;
      accent: string;
      items: OneOnOneActionItem[];
    }> = [];
    out.push({
      key: "__shared__",
      label: "Shared",
      accent: "var(--color-foreground-muted)",
      items: sortBand(shared),
    });
    members.forEach((m) => {
      const list = byAssignee.get(m) ?? [];
      if (scope === "mine" && m !== currentUser) return;
      out.push({
        key: m,
        label: m === currentUser ? `${m} (you)` : m,
        accent: colorMap[m]?.primary ?? fallbackColorForUsername(m),
        items: sortBand(list),
      });
    });
    return out;
  }, [items, members, scope, currentUser, colorMap]);

  return (
    <div className="flex flex-col gap-4">
      <BoardAddRow members={members} busy={addMutation.isPending} onAdd={(p) => addMutation.mutate(p)} />

      <div className="flex items-center gap-1">
        {(["everyone", "mine"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setScope(s)}
            data-testid={`oneonone-board-scope-${s}`}
            className={`rounded-lg px-3 py-1 text-meta font-medium transition-colors ${
              scope === s
                ? "bg-brand-action/10 text-brand-action"
                : "text-foreground-muted hover:bg-surface-sunken hover:text-foreground"
            }`}
          >
            {s === "everyone" ? "Everyone" : "Mine"}
          </button>
        ))}
      </div>

      {bands.every((b) => b.items.length === 0) ? (
        <EmptyArea label="No tasks yet. Add one above and assign it to a member with a due date to send it to their to-do list." />
      ) : (
        <div className="flex flex-col gap-4">
          {bands.map((band) => (
            <div key={band.key} className="flex flex-col gap-1">
              <div className="flex items-center gap-2 px-1">
                <span
                  aria-hidden="true"
                  className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                  style={{ background: band.accent }}
                />
                <p className="text-meta font-semibold uppercase tracking-wide text-foreground-muted">
                  {band.label}
                </p>
                <span className="text-meta text-foreground-muted">
                  {band.items.length}
                </span>
              </div>
              {band.items.length === 0 ? (
                <p className="px-3 py-2 text-meta italic text-foreground-muted">
                  Nothing assigned yet.
                </p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {band.items.map((item) => (
                    <BoardRow
                      key={item.id}
                      item={item}
                      currentUser={currentUser}
                      onToggle={() => toggleMutation.mutate(item)}
                      onEdit={() => setEditing(item)}
                      onDelete={() => deleteMutation.mutate(item)}
                    />
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}

      {editing && (
        <EditTaskDialog
          item={editing}
          members={members}
          busy={editMutation.isPending}
          onClose={() => setEditing(null)}
          onSave={(patch) =>
            editMutation.mutate({
              id: editing.id,
              owner: editing.owner,
              patch,
            })
          }
        />
      )}
    </div>
  );
}

function BoardRow({
  item,
  currentUser,
  onToggle,
  onEdit,
  onDelete,
}: {
  item: OneOnOneActionItem;
  currentUser: string;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  // D2/D3: only the assignee or the creator may delete; anyone can check.
  const canDelete =
    item.created_by === currentUser || item.assignee === currentUser;
  return (
    <li className="group flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2">
      <button
        type="button"
        onClick={onToggle}
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
      {item.assignee ? (
        <Tooltip label={`Assigned to ${item.assignee}`}>
          <span className="flex flex-shrink-0 items-center gap-1 rounded-full bg-surface-sunken px-2 py-0.5 text-meta text-foreground-muted">
            <Icon name="users" className="h-3 w-3" />
            {item.assignee}
          </span>
        </Tooltip>
      ) : null}
      {item.due_date ? (
        <span className="flex flex-shrink-0 items-center gap-1 rounded-full bg-surface-sunken px-2 py-0.5 text-meta text-foreground-muted">
          <Icon name="today" className="h-3 w-3" />
          {item.due_date}
        </span>
      ) : null}
      <Tooltip label="Edit task">
        <button
          type="button"
          onClick={onEdit}
          aria-label="Edit task"
          className="flex-shrink-0 rounded p-1 text-foreground-muted opacity-0 transition-opacity hover:text-brand-action group-hover:opacity-100"
        >
          <Icon name="pencil" className="h-4 w-4" />
        </button>
      </Tooltip>
      {canDelete && (
        <DeleteIconButton label="Delete task" onClick={onDelete} />
      )}
    </li>
  );
}

/** The board's add row: text + assignee picker + due-date picker. Assigning a
 *  member AND a due date materializes a real Task in that member's Lists (D4). */
function BoardAddRow({
  members,
  busy,
  onAdd,
}: {
  members: string[];
  busy: boolean;
  onAdd: (p: { text: string; assignee: string | null; due_date: string | null }) => void;
}) {
  const [text, setText] = useState("");
  const [assignee, setAssignee] = useState<string>("");
  const [due, setDue] = useState<string>("");

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onAdd({
      text: trimmed,
      assignee: assignee || null,
      due_date: due || null,
    });
    setText("");
    setAssignee("");
    setDue("");
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
        placeholder="Add a task"
        data-testid="oneonone-board-add-text"
        className="min-w-[10rem] flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-body text-foreground focus:border-brand-action focus:outline-none focus:ring-2 focus:ring-brand-action/30"
      />
      <select
        value={assignee}
        onChange={(e) => setAssignee(e.target.value)}
        aria-label="Assign to"
        data-testid="oneonone-board-add-assignee"
        className="flex-shrink-0 rounded-lg border border-border bg-surface px-3 py-2 text-body text-foreground focus:border-brand-action focus:outline-none focus:ring-2 focus:ring-brand-action/30"
      >
        <option value="">Shared</option>
        {members.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      <input
        type="date"
        value={due}
        onChange={(e) => setDue(e.target.value)}
        aria-label="Due date"
        data-testid="oneonone-board-add-due"
        className="flex-shrink-0 rounded-lg border border-border bg-surface px-3 py-2 text-body text-foreground focus:border-brand-action focus:outline-none focus:ring-2 focus:ring-brand-action/30"
      />
      <button
        type="button"
        onClick={submit}
        disabled={busy || !text.trim()}
        className="btn-brand flex items-center gap-1.5 rounded-lg px-3 py-2 text-body font-medium disabled:opacity-40"
      >
        <Icon name="plus" className="h-4 w-4" />
        Add
      </button>
    </div>
  );
}

/** Edit an existing board task: text, assignee, due date. Clearing the assignee
 *  or due date detaches the synced Task (D4), handled server-side. */
function EditTaskDialog({
  item,
  members,
  busy,
  onClose,
  onSave,
}: {
  item: OneOnOneActionItem;
  members: string[];
  busy: boolean;
  onClose: () => void;
  onSave: (patch: {
    text: string;
    assignee: string | null;
    due_date: string | null;
  }) => void;
}) {
  const [text, setText] = useState(item.text);
  const [assignee, setAssignee] = useState<string>(item.assignee ?? "");
  const [due, setDue] = useState<string>(item.due_date ?? "");

  useEscapeToClose(onClose);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Edit task"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-xl bg-surface-raised shadow-xl">
        <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
          <h2 className="text-title font-semibold text-foreground">Edit task</h2>
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
              htmlFor="oneonone-edit-text"
              className="text-meta font-semibold uppercase tracking-wide text-foreground-muted"
            >
              Task
            </label>
            <input
              id="oneonone-edit-text"
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-body text-foreground focus:border-brand-action focus:outline-none focus:ring-2 focus:ring-brand-action/30"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="oneonone-edit-assignee"
              className="text-meta font-semibold uppercase tracking-wide text-foreground-muted"
            >
              Assignee
            </label>
            <select
              id="oneonone-edit-assignee"
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-body text-foreground focus:border-brand-action focus:outline-none focus:ring-2 focus:ring-brand-action/30"
            >
              <option value="">Shared (no assignee)</option>
              {members.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="oneonone-edit-due"
              className="text-meta font-semibold uppercase tracking-wide text-foreground-muted"
            >
              Due date
            </label>
            <input
              id="oneonone-edit-due"
              type="date"
              value={due}
              onChange={(e) => setDue(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-body text-foreground focus:border-brand-action focus:outline-none focus:ring-2 focus:ring-brand-action/30"
            />
          </div>
          <p className="text-meta text-foreground-muted">
            Assign a member and set a due date to send this to their to-do list.
            Clear either one to keep it here only.
          </p>
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
            onClick={() =>
              onSave({
                text: text.trim() || item.text,
                assignee: assignee || null,
                due_date: due || null,
              })
            }
            disabled={busy}
            className="btn-brand rounded-lg px-4 py-2 text-body font-medium disabled:opacity-40"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
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

// ── Template picker tile (new check-in dialog) ───────────────────────────────

function TemplateTile({
  label,
  description,
  initial,
  selected,
  onSelect,
  testId,
}: {
  label: string;
  description: string;
  initial: string;
  selected: boolean;
  onSelect: () => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      data-testid={testId}
      className={`flex flex-col gap-1 rounded-lg border px-2.5 py-2 text-left transition-colors ${
        selected
          ? "border-brand-action bg-brand-action/10"
          : "border-border bg-surface hover:bg-surface-sunken"
      }`}
    >
      <span className="flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className={`flex h-5 w-5 flex-none items-center justify-center rounded-full text-[11px] font-semibold ${
            selected
              ? "bg-brand-action text-white"
              : "bg-surface-sunken text-foreground-muted"
          }`}
        >
          {initial}
        </span>
        <span className="text-body font-medium text-foreground">{label}</span>
      </span>
      <span className="line-clamp-2 text-meta text-foreground-muted">
        {description}
      </span>
    </button>
  );
}

// ── Mentoring compact (expectations agreement) ───────────────────────────────
// A one-time structured expectations doc per space. Both members edit the row
// values and each acknowledges; "Acknowledged by both" shows when everyone has.
// Editing the rows clears prior acknowledgements (re-agree the revision). It is
// started lazily, so the tab opens with a Start affordance until one exists.

function CompactArea({
  oneOnOne,
  currentUser,
}: {
  oneOnOne: OneOnOne;
  currentUser: string;
}) {
  const queryClient = useQueryClient();
  const members = useMemo(
    () => normalizeOneOnOne(oneOnOne).members,
    [oneOnOne],
  );
  const [draft, setDraft] = useState<CheckinCompactRow[] | null>(null);

  const { data: compact, isLoading } = useQuery<CheckinCompact | null>({
    queryKey: compactKey(oneOnOne.id),
    queryFn: () => checkinCompactsApi.getForSpace(oneOnOne.id),
  });

  const invalidate = useCallback(
    () =>
      queryClient.invalidateQueries({ queryKey: compactKey(oneOnOne.id) }),
    [queryClient, oneOnOne.id],
  );

  const startMutation = useMutation({
    mutationFn: () => checkinCompactsApi.createForSpace(oneOnOne.id),
    onSuccess: invalidate,
  });
  const saveMutation = useMutation({
    mutationFn: (rows: CheckinCompactRow[]) =>
      checkinCompactsApi.updateRows(compact!.id, rows, compact!.owner),
    onSuccess: () => {
      setDraft(null);
      invalidate();
    },
  });
  const ackMutation = useMutation({
    mutationFn: () =>
      checkinCompactsApi.acknowledge(compact!.id, compact!.owner),
    onSuccess: invalidate,
  });

  const acknowledgedAll =
    !!compact &&
    members.length > 0 &&
    members.every((m) =>
      compact.acknowledged.some((a) => a.username === m),
    );
  const iAcknowledged =
    !!compact && compact.acknowledged.some((a) => a.username === currentUser);

  if (isLoading) {
    return <p className="text-body italic text-foreground-muted">Loading…</p>;
  }

  if (!compact) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-border bg-surface-sunken/40 px-4 py-5 text-body text-foreground-muted">
        <p>
          A compact is a short expectations agreement, working hours, authorship,
          communication, and time off, that you both write together and
          acknowledge. Misaligned expectations is the most common cause of
          mentoring friction, so naming them up front heads it off.
        </p>
        <button
          type="button"
          onClick={() => startMutation.mutate()}
          disabled={startMutation.isPending}
          data-testid="compact-start"
          className="btn-brand flex items-center gap-1.5 rounded-lg px-3 py-2 text-body font-medium disabled:opacity-40"
        >
          <Icon name="check" className="h-4 w-4" />
          Start the compact
        </button>
      </div>
    );
  }

  const editing = draft !== null;
  const rows = draft ?? compact.rows;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-meta text-foreground-muted">
          You both edit these and each acknowledge. Editing the agreement asks
          everyone to acknowledge the revision again.
        </p>
        {editing ? (
          <div className="flex flex-none items-center gap-2">
            <button
              type="button"
              onClick={() => setDraft(null)}
              className="rounded-lg px-2.5 py-1.5 text-body font-medium text-foreground-muted transition-colors hover:bg-surface-sunken"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => saveMutation.mutate(rows)}
              disabled={saveMutation.isPending}
              data-testid="compact-save"
              className="btn-brand rounded-lg px-2.5 py-1.5 text-body font-medium disabled:opacity-40"
            >
              Save
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setDraft(compact.rows.map((r) => ({ ...r })))}
            data-testid="compact-edit"
            className="flex flex-none items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-body font-medium text-foreground-muted transition-colors hover:bg-surface-sunken"
          >
            <Icon name="pencil" className="h-4 w-4" />
            Edit
          </button>
        )}
      </div>

      <ul className="flex flex-col divide-y divide-border rounded-xl border border-border bg-surface">
        {rows.map((row, idx) => (
          <li
            key={row.id}
            className="flex flex-col gap-1 px-3 py-2.5 sm:flex-row sm:items-start sm:gap-3"
          >
            <span className="flex-none pt-0.5 text-body font-semibold text-foreground-muted sm:w-44">
              {row.label}
            </span>
            {editing ? (
              <textarea
                value={row.value}
                onChange={(e) => {
                  const next = rows.map((r, i) =>
                    i === idx ? { ...r, value: e.target.value } : r,
                  );
                  setDraft(next);
                }}
                rows={2}
                placeholder="Write what you have agreed."
                className="min-h-[2.25rem] w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-body text-foreground focus:border-brand-action focus:outline-none focus:ring-2 focus:ring-brand-action/30"
              />
            ) : (
              <span className="text-body text-foreground">
                {row.value.trim() ? (
                  row.value
                ) : (
                  <span className="italic text-foreground-muted">
                    Not filled in yet.
                  </span>
                )}
              </span>
            )}
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface-sunken/40 px-3 py-3">
        <div className="flex items-center gap-2 text-body">
          {acknowledgedAll ? (
            <span className="flex items-center gap-1.5 font-medium text-green-600">
              <Icon name="check" className="h-4 w-4" />
              Acknowledged by both, revisit annually
            </span>
          ) : (
            <span className="text-foreground-muted">
              {compact.acknowledged.length === 0
                ? "No one has acknowledged yet."
                : `Acknowledged by ${compact.acknowledged
                    .map((a) => a.username)
                    .join(", ")}.`}
            </span>
          )}
        </div>
        {!iAcknowledged && !editing && (
          <button
            type="button"
            onClick={() => ackMutation.mutate()}
            disabled={ackMutation.isPending}
            data-testid="compact-acknowledge"
            className="btn-brand flex flex-none items-center gap-1.5 rounded-lg px-3 py-1.5 text-body font-medium disabled:opacity-40"
          >
            <Icon name="check" className="h-4 w-4" />
            Acknowledge
          </button>
        )}
      </div>
    </div>
  );
}

// ── Onboarding checklist ─────────────────────────────────────────────────────
// A first-check-in checklist (access, safety, data management, the norms doc,
// the cadence). Any member may check an item off. Started lazily like the
// compact.

function OnboardingArea({
  oneOnOne,
  currentUser,
}: {
  oneOnOne: OneOnOne;
  currentUser: string;
}) {
  // currentUser is accepted for symmetry + future per-checker attribution UI;
  // the toggle records done_by server-side from the signed-in user.
  void currentUser;
  const queryClient = useQueryClient();

  const { data: onboarding, isLoading } = useQuery<CheckinOnboarding | null>({
    queryKey: onboardingKey(oneOnOne.id),
    queryFn: () => checkinOnboardingApi.getForSpace(oneOnOne.id),
  });

  const invalidate = useCallback(
    () =>
      queryClient.invalidateQueries({ queryKey: onboardingKey(oneOnOne.id) }),
    [queryClient, oneOnOne.id],
  );

  const startMutation = useMutation({
    mutationFn: () => checkinOnboardingApi.createForSpace(oneOnOne.id),
    onSuccess: invalidate,
  });
  const toggleMutation = useMutation({
    mutationFn: (itemId: string) =>
      checkinOnboardingApi.toggleItem(onboarding!.id, itemId, onboarding!.owner),
    onSuccess: invalidate,
  });

  if (isLoading) {
    return <p className="text-body italic text-foreground-muted">Loading…</p>;
  }

  if (!onboarding) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-border bg-surface-sunken/40 px-4 py-5 text-body text-foreground-muted">
        <p>
          A short onboarding checklist for a new member, access and keys, safety
          training, data-management practices, the lab norms doc, and setting the
          check-in cadence. Most labs have no formal onboarding, so this gives a
          new person a clear first week.
        </p>
        <button
          type="button"
          onClick={() => startMutation.mutate()}
          disabled={startMutation.isPending}
          data-testid="onboarding-start"
          className="btn-brand flex items-center gap-1.5 rounded-lg px-3 py-2 text-body font-medium disabled:opacity-40"
        >
          <Icon name="list" className="h-4 w-4" />
          Start the checklist
        </button>
      </div>
    );
  }

  const doneCount = onboarding.items.filter((i) => i.done).length;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-meta text-foreground-muted">
        {doneCount} of {onboarding.items.length} done. Anyone in the space can
        check an item off.
      </p>
      <ul className="flex flex-col gap-1">
        {onboarding.items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => toggleMutation.mutate(item.id)}
              data-testid={`onboarding-item-${item.id}`}
              className="flex w-full items-center gap-2.5 rounded-lg border border-border bg-surface px-3 py-2 text-left transition-colors hover:bg-surface-sunken"
            >
              <span
                aria-hidden="true"
                className={`flex h-5 w-5 flex-none items-center justify-center rounded-md border ${
                  item.done
                    ? "border-brand-action bg-brand-action text-white"
                    : "border-border bg-surface"
                }`}
              >
                {item.done && <Icon name="check" className="h-3.5 w-3.5" />}
              </span>
              <span
                className={`text-body ${
                  item.done
                    ? "text-foreground-muted line-through"
                    : "text-foreground"
                }`}
              >
                {item.label}
              </span>
              {item.done && item.done_by && (
                <span className="ml-auto flex-none text-meta text-foreground-muted">
                  {item.done_by}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Space header (Phase 4: skip-level cue + committee next-meeting date) ──────
// A small header above the sub-tabs for the selected space. Shows two Phase 4
// signals when they apply: a "Skip-level" badge (this mentor is checking in with
// a trainee who reports through someone else) and, for a committee / annual-
// cadence space, a "Next committee meeting" line with a pre-circulate reminder
// and an inline date editor. Renders nothing extra for an ordinary space.

/** True when the space reads as a committee / annual-cadence space: a group on
 *  a "month" cadence, the shape the thesis-committee template seeds. Advisory,
 *  it only decides whether to show the committee meeting line. */
function isCommitteeSpace(space: OneOnOne): boolean {
  const norm = normalizeOneOnOne(space);
  return norm.kind === "group" && norm.cadence?.every === "month";
}

function SpaceHeader({
  space,
  allSpaces,
  currentUser,
  onInvalidateSpaces,
}: {
  space: OneOnOne;
  allSpaces: OneOnOne[];
  currentUser: string;
  onInvalidateSpaces: () => void;
}) {
  const skip = useMemo(
    () => isSkipLevel(space, allSpaces),
    [space, allSpaces],
  );
  const committee = useMemo(() => isCommitteeSpace(space), [space]);
  const nextDate = normalizeOneOnOne(space).next_meeting_date;
  const isMember = normalizeOneOnOne(space).members.includes(currentUser);

  const [editingDate, setEditingDate] = useState(false);
  const [dateDraft, setDateDraft] = useState(nextDate ?? "");

  const setDateMutation = useMutation({
    mutationFn: (date: string | null) =>
      oneOnOnesApi.setNextMeetingDate(space.id, date),
    onSuccess: () => {
      setEditingDate(false);
      onInvalidateSpaces();
    },
  });

  if (!skip && !committee) return null;

  return (
    <div className="mb-3 flex flex-col gap-2">
      {skip && (
        <Tooltip
          label="Skip-level check-in"
          body="A skip-level check-in reaches a trainee who reports through someone else, so the closer mentor stays in the loop on the relationship."
        >
          <span
            className="inline-flex w-fit items-center gap-1.5 rounded-md bg-amber-100 px-2 py-1 text-meta font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
            data-testid="space-skip-level-badge"
          >
            <Icon name="skip" className="h-3.5 w-3.5" />
            Skip-level
          </span>
        </Tooltip>
      )}
      {committee && (
        <div
          className="flex flex-col gap-1 rounded-lg border border-border bg-surface-sunken/40 px-3 py-2"
          data-testid="space-committee-header"
        >
          <div className="flex flex-wrap items-center gap-2">
            <Icon name="today" className="h-4 w-4 flex-none text-foreground-muted" />
            <span className="text-body text-foreground">
              Next committee meeting
              {": "}
              {nextDate ? (
                <span className="font-medium">
                  {new Date(`${nextDate}T00:00:00`).toLocaleDateString()}
                </span>
              ) : (
                <span className="text-foreground-muted">not set</span>
              )}
            </span>
            {isMember && !editingDate && (
              <button
                type="button"
                onClick={() => {
                  setDateDraft(nextDate ?? "");
                  setEditingDate(true);
                }}
                data-testid="committee-date-edit"
                className="ml-auto rounded px-2 py-0.5 text-meta font-medium text-foreground-muted transition-colors hover:bg-surface-sunken"
              >
                {nextDate ? "Change" : "Set date"}
              </button>
            )}
          </div>
          {editingDate && (
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="date"
                value={dateDraft}
                onChange={(e) => setDateDraft(e.target.value)}
                data-testid="committee-date-input"
                className="rounded-md border border-border bg-surface-raised px-2 py-1 text-body text-foreground"
              />
              <button
                type="button"
                onClick={() =>
                  setDateMutation.mutate(dateDraft ? dateDraft : null)
                }
                disabled={setDateMutation.isPending}
                data-testid="committee-date-save"
                className="btn-brand rounded-md px-2.5 py-1 text-meta font-medium disabled:opacity-40"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => setEditingDate(false)}
                className="rounded-md px-2 py-1 text-meta font-medium text-foreground-muted transition-colors hover:bg-surface-sunken"
              >
                Cancel
              </button>
            </div>
          )}
          <p className="text-meta text-foreground-muted">
            Pre-circulate the progress report and Specific Aims so the committee
            reads them before you meet.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Presenter / journal-club rotation (Phase 4, group spaces) ─────────────────
// A group space carries an auto-rotating schedule of who presents data and who
// leads journal club. Started lazily, so the tab opens with a Start affordance
// until one exists. Each track shows "Up next" with an Advance control and a
// reorder / skip affordance (move someone to the front, or send the current
// presenter to the back).

function RotationArea({
  oneOnOne,
  currentUser,
}: {
  oneOnOne: OneOnOne;
  currentUser: string;
}) {
  const queryClient = useQueryClient();
  const isMember = useMemo(
    () => normalizeOneOnOne(oneOnOne).members.includes(currentUser),
    [oneOnOne, currentUser],
  );

  const { data: rotation, isLoading } = useQuery<CheckinRotation | null>({
    queryKey: rotationKey(oneOnOne.id),
    queryFn: () => checkinRotationsApi.getForSpace(oneOnOne.id),
  });

  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey: rotationKey(oneOnOne.id) }),
    [queryClient, oneOnOne.id],
  );

  const startMutation = useMutation({
    mutationFn: () => checkinRotationsApi.createForSpace(oneOnOne.id),
    onSuccess: invalidate,
  });
  const advanceMutation = useMutation({
    mutationFn: (trackId: string) =>
      checkinRotationsApi.advance(rotation!.id, trackId, rotation!.owner),
    onSuccess: invalidate,
  });
  const setOrderMutation = useMutation({
    mutationFn: (vars: { trackId: string; order: string[] }) =>
      checkinRotationsApi.setOrder(
        rotation!.id,
        vars.trackId,
        vars.order,
        rotation!.owner,
      ),
    onSuccess: invalidate,
  });

  if (isLoading) {
    return <p className="text-body italic text-foreground-muted">Loading…</p>;
  }

  if (!rotation) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-border bg-surface-sunken/40 px-4 py-5 text-body text-foreground-muted">
        <p>
          A rotation tracks who presents data and who leads journal club, so the
          schedule lives next to the rest of the lab&apos;s work instead of on a
          whiteboard. The person up next is the one to prep.
        </p>
        <button
          type="button"
          onClick={() => startMutation.mutate()}
          disabled={startMutation.isPending || !isMember}
          data-testid="rotation-start"
          className="btn-brand flex items-center gap-1.5 rounded-lg px-3 py-2 text-body font-medium disabled:opacity-40"
        >
          <Icon name="refresh" className="h-4 w-4" />
          Start a rotation
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="rotation-area">
      {rotation.tracks.map((track) => {
        const len = track.order.length;
        const upNext =
          len > 0 ? track.order[track.current_index % len] : null;
        const onDeck =
          len > 1 ? track.order[(track.current_index + 1) % len] : null;
        return (
          <div
            key={track.id}
            className="rounded-xl border border-border bg-surface-raised px-4 py-3"
            data-testid={`rotation-track-${track.id}`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-body font-semibold text-foreground">
                {track.name}
              </h4>
              {upNext ? (
                <span className="inline-flex items-center gap-1.5 rounded-md bg-brand-action/10 px-2 py-1 text-meta font-medium text-brand-action">
                  <Icon name="alarmClock" className="h-3.5 w-3.5" />
                  Up next {upNext}
                </span>
              ) : (
                <span className="text-meta text-foreground-muted">
                  No one in the rotation
                </span>
              )}
              {isMember && len > 0 && (
                <button
                  type="button"
                  onClick={() => advanceMutation.mutate(track.id)}
                  disabled={advanceMutation.isPending}
                  data-testid={`rotation-advance-${track.id}`}
                  className="ml-auto flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-meta font-medium text-foreground transition-colors hover:bg-surface-sunken disabled:opacity-40"
                >
                  <Icon name="chevronRight" className="h-3.5 w-3.5" />
                  Advance
                </button>
              )}
            </div>
            {onDeck && (
              <p className="mt-1 text-meta text-foreground-muted">
                On deck {onDeck}
              </p>
            )}
            <ol className="mt-2 flex flex-col gap-1">
              {track.order.map((member, i) => {
                const current = i === track.current_index % Math.max(len, 1);
                return (
                  <li
                    key={`${member}-${i}`}
                    className={`flex items-center gap-2 rounded-lg px-2 py-1 text-body ${
                      current
                        ? "bg-brand-action/10 text-foreground"
                        : "text-foreground-muted"
                    }`}
                  >
                    <span className="w-5 flex-none text-right text-meta tabular-nums text-foreground-muted">
                      {i + 1}
                    </span>
                    <span className="truncate">{member}</span>
                    {current && (
                      <span className="rounded bg-brand-action/15 px-1.5 py-0.5 text-meta font-semibold text-brand-action">
                        Now
                      </span>
                    )}
                    {isMember && !current && (
                      <Tooltip label="Move to the front">
                        <button
                          type="button"
                          onClick={() => {
                            const rest = track.order.filter(
                              (m, j) => !(m === member && j === i),
                            );
                            setOrderMutation.mutate({
                              trackId: track.id,
                              order: [member, ...rest],
                            });
                          }}
                          aria-label={`Move ${member} to the front`}
                          data-testid={`rotation-move-front-${track.id}-${i}`}
                          className="ml-auto flex-none rounded p-1 text-foreground-muted transition-colors hover:bg-surface-sunken hover:text-foreground"
                        >
                          <Icon name="skip" className="h-3.5 w-3.5" />
                        </button>
                      </Tooltip>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        );
      })}
    </div>
  );
}

// ── New check-in dialog (any account) ────────────────────────────────────────
// Phase 2: a multi-select roster. Pick ONE person for a pair check-in (the "I
// am the mentor" checkbox makes it a mentoring relationship), or pick TWO or
// more for a group check-in (3+ members total). The mentor option only applies
// to a pair, so it is hidden once a group is selected.

function NewOneOnOneDialog({
  currentUser,
  existingPartners,
  allSpaces,
  onClose,
  onCreated,
}: {
  currentUser: string;
  existingPartners: string[];
  /** Every readable space, used to flag a skip-level mentoring relationship in
   *  advance (the picked trainee already reports through a different mentor). */
  allSpaces: OneOnOne[];
  onClose: () => void;
  onCreated: (created: OneOnOne) => void;
}) {
  const [roster, setRoster] = useState<string[]>([]);
  const [loadingRoster, setLoadingRoster] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [isMentor, setIsMentor] = useState(false);
  const [title, setTitle] = useState("");
  // Check-ins Phase 3b: an optional career-stage template. "" = Blank (no
  // template). Picking one sets the cadence default and seeds starter agenda
  // items after the space is created.
  const [templateId, setTemplateId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEscapeToClose(onClose);

  // A pair (one other person) supports the mentor flag; a group does not.
  const isGroup = selected.length >= 2;

  // Check-ins Phase 4: when this would be a mentoring pair and the picked
  // trainee ALREADY reports through a different mentor (in another readable
  // space), name it as a skip-level check-in so the creator goes in with eyes
  // open. Computed from the readable spaces' direct mentor edges.
  const wouldBeSkipLevel = useMemo(() => {
    if (isGroup || !isMentor || selected.length !== 1) return false;
    const trainee = selected[0];
    const closer = directMentorsOf(allSpaces).get(trainee);
    if (!closer) return false;
    for (const m of closer) {
      if (m !== currentUser) return true;
    }
    return false;
  }, [isGroup, isMentor, selected, allSpaces, currentUser]);

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

  const toggle = useCallback((u: string) => {
    setSelected((prev) =>
      prev.includes(u) ? prev.filter((x) => x !== u) : [...prev, u],
    );
  }, []);

  const handleCreate = useCallback(async () => {
    if (selected.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const group = selected.length >= 2;
      const template = templateId ? getCheckinTemplate(templateId) : undefined;
      const created = await oneOnOnesApi.create({
        members: [currentUser, ...selected],
        // The mentor edge only makes sense for a pair (one mentor, one mentee).
        mentor: !group && isMentor ? currentUser : null,
        title: group && title.trim() ? title.trim() : null,
        // A picked template carries a suggested cadence; Blank leaves it null.
        cadence: template ? templateCadence(template) : null,
      });
      // Seed the picked template's starter agenda prompts as undone, unassigned
      // action items, so a new space opens with a real agenda rather than blank.
      if (template) {
        for (const seed of template.agenda_seeds) {
          await oneOnOnesApi.addActionItem({
            oneOnOneId: created.id,
            text: seed,
          });
        }
      }
      onCreated(created);
    } catch (err) {
      console.error("Failed to create check-in:", err);
      setError("Could not start the check-in. Please try again.");
      setBusy(false);
    }
  }, [selected, isMentor, title, templateId, currentUser, busy, onCreated]);

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
      <div className="flex max-h-[85vh] w-full max-w-md flex-col rounded-xl bg-surface-raised shadow-xl">
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
                Pick one person for a one-on-one, or several for a group. Everyone
                shares its goals, notes, and task board.
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

        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 py-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-meta font-semibold uppercase tracking-wide text-foreground-muted">
              People
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
              <ul
                className="flex max-h-56 flex-col gap-1 overflow-y-auto rounded-lg border border-border bg-surface p-1"
                data-testid="oneonone-new-member-list"
              >
                {roster.map((u) => {
                  const checked = selected.includes(u);
                  return (
                    <li key={u}>
                      <label
                        className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-body transition-colors ${
                          checked
                            ? "bg-brand-action/10 text-foreground"
                            : "text-foreground hover:bg-surface-sunken"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggle(u)}
                          data-testid={`oneonone-new-member-${u}`}
                          className="h-4 w-4 flex-shrink-0 rounded border-border text-brand-action focus:ring-brand-action/30"
                        />
                        <Icon
                          name="users"
                          className="h-4 w-4 flex-shrink-0 text-foreground-muted"
                        />
                        <span className="truncate">{u}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-meta font-semibold uppercase tracking-wide text-foreground-muted">
              Template (optional)
            </label>
            <p className="text-meta text-foreground-muted">
              A template sets a cadence and seeds the agenda for a career stage or
              relationship. Start from Blank to set everything up yourself.
            </p>
            <div
              className="grid grid-cols-2 gap-1.5"
              data-testid="oneonone-template-gallery"
            >
              <TemplateTile
                label="Blank"
                description="No preset. An empty space."
                initial="—"
                selected={templateId === ""}
                onSelect={() => setTemplateId("")}
              />
              {CHECKIN_TEMPLATES.map((t) => (
                <TemplateTile
                  key={t.id}
                  label={t.name}
                  description={t.description}
                  initial={t.name[0]}
                  selected={templateId === t.id}
                  onSelect={() => setTemplateId(t.id)}
                  testId={`oneonone-template-${t.id}`}
                />
              ))}
            </div>
          </div>

          {isGroup ? (
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="oneonone-new-title"
                className="text-meta font-semibold uppercase tracking-wide text-foreground-muted"
              >
                Group name (optional)
              </label>
              <input
                id="oneonone-new-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Aim 2 team"
                data-testid="oneonone-new-title"
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-body text-foreground focus:border-brand-action focus:outline-none focus:ring-2 focus:ring-brand-action/30"
              />
            </div>
          ) : (
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
          )}

          {wouldBeSkipLevel && (
            <div
              className="flex items-start gap-2 rounded-lg bg-amber-100 px-3 py-2 text-meta text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
              data-testid="oneonone-new-skip-level-note"
            >
              <Icon name="skip" className="mt-0.5 h-4 w-4 flex-none" />
              <span>
                This is a skip-level check-in. A skip-level check-in reaches a
                trainee who reports through someone else, so it can catch a
                student struggling under another mentor who has not said so.
              </span>
            </div>
          )}

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
            disabled={selected.length === 0 || busy}
            data-testid="oneonone-new-member-confirm"
            className="btn-brand rounded-lg px-4 py-2 text-body font-medium disabled:opacity-40"
          >
            {busy
              ? "Starting…"
              : isGroup
                ? "Start group check-in"
                : "Start check-in"}
          </button>
        </div>
      </div>
    </div>
  );
}
