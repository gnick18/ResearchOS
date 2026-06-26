"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  dependenciesApi,
  fetchAllMethodsIncludingShared,
  fetchAllTasksIncludingShared,
} from "@/lib/local-api";
import { useAppStore } from "@/lib/store";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { matchesAnyProjectFilter } from "@/lib/search/filterKey";
import TaskDetailPopup from "@/components/TaskDetailPopup";
import ContextMenu from "@/components/ContextMenu";
import TaskModal from "@/components/TaskModal";
import Tooltip from "@/components/Tooltip";
import { Icon } from "@/components/icons";
import { fileService } from "@/lib/file-system/file-service";
import SharedFromPill from "@/components/workbench/SharedFromPill";
import ExperimentResultCard, {
  type ExperimentCardMethod,
} from "@/components/experiments/ExperimentResultCard";
import ExportFormatDialog from "@/components/ExportFormatDialog";
import { useExperimentExport } from "@/components/export/useExperimentExport";
import type { FreshnessKind } from "@/components/experiments/FreshnessTag";
import {
  probeTaskResults,
  type TaskResultProbe,
} from "@/lib/experiments/findTaskResultsBase";
import { taskKey, type Method, type Project, type Task } from "@/lib/types";
import { resolveMethodById } from "@/lib/methods/lookup";
import {
  assignSection,
  computeBlockingParents,
  findNextInChain,
  type WorkbenchSection,
} from "@/lib/workbench/sectionAssignment";
// The BeakerBot demo-lab user is the only owner whose shared tasks are
// filtered out of the real workbench view (they were seeded during the
// deleted v4 onboarding walkthrough). The constant is inlined here; it
// is the sole production consumer.
const BEAKERBOT_LAB_USERNAME = "beakerbot";
import type {
  WorkbenchInitialOpen,
  WorkbenchRecentRef,
} from "@/app/workbench/workbench-beaker-source";

const DEFAULT_COLORS = [
  "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
  "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#6366f1",
];

const projectKey = (p: Pick<Project, "id" | "owner">) => `${p.owner}:${p.id}`;

// The four in-flight pipeline stages rendered as a side-by-side kanban
// row (experiments-kanban density redesign, 2026-06-02). "recent" is NOT
// a board column — it lives in the results zone below the board with its
// project-grouped wide grid.
const BOARD_STAGES: WorkbenchSection[] = [
  "ready",
  "blocked",
  "running",
  "awaiting",
];

const SECTION_LABEL: Record<WorkbenchSection, string> = {
  ready: "Ready to start",
  blocked: "Blocked",
  running: "Running",
  awaiting: "Awaiting writeup",
  recent: "Recent results",
  scheduled: "Scheduled later",
};

const SECTION_HELP: Record<WorkbenchSection, string> = {
  ready: "Started or scheduled to start, dependencies clear",
  blocked: "Waiting on an incomplete parent task",
  running: "Today falls between start and end date",
  awaiting: "Completed, but no results.md or images on disk yet",
  recent: "Completed with results in the last 30 days",
  scheduled: "Future-scheduled experiments",
};

const RECENT_WINDOW_DAYS = 30;
const FRESHNESS_WINDOW_DAYS = 7;

function daysBetween(aIso: string, bIso: string): number {
  const a = new Date(aIso + "T00:00:00Z").getTime();
  const b = new Date(bIso + "T00:00:00Z").getTime();
  return Math.round((a - b) / 86_400_000);
}

interface SectionEntry {
  task: Task;
  section: WorkbenchSection;
  probe: TaskResultProbe;
  daysFromEnd: number | null;
  daysFromStart: number | null;
  blockingParents: Task[];
  nextInChain: Task | null;
}

// Display section for the explorer. Folds "recent" past the 30-day window into
// "earlier"; everything else maps straight through. "scheduled" is filtered out
// of the list (it stays a footer hint).
type DisplaySection =
  | "running"
  | "ready"
  | "blocked"
  | "awaiting"
  | "recent"
  | "earlier"
  | "scheduled";

function displaySectionOf(e: SectionEntry): DisplaySection {
  if (
    e.section === "recent" &&
    (e.daysFromEnd === null || e.daysFromEnd > RECENT_WINDOW_DAYS)
  ) {
    return "earlier";
  }
  return e.section;
}

// The order status bands render in the dense list.
const LIST_SECTION_ORDER: DisplaySection[] = [
  "running",
  "ready",
  "blocked",
  "awaiting",
  "recent",
  "earlier",
];

const DISPLAY_LABEL: Record<DisplaySection, string> = {
  running: "Running",
  ready: "Ready",
  blocked: "Blocked",
  awaiting: "Awaiting write-up",
  recent: "Recent results",
  earlier: "Earlier",
  scheduled: "Scheduled later",
};

// Per-status color tokens, shared by the list bands, row badges, the rail dots,
// and the board column headers so a status looks the same everywhere (Grant:
// "the colors should be retained between list and board for categories").
interface StatusStyle {
  text: string;
  band: string; // band header bg + left accent + text
  badge: string; // pill bg + text
  dot: string; // small square dot bg
  cardAccent: string; // board card left border
}
const STATUS_STYLE: Record<
  "running" | "ready" | "blocked" | "awaiting" | "recent" | "earlier",
  StatusStyle
> = {
  running: {
    text: "text-blue-700 dark:text-blue-300",
    band: "bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300 border-l-blue-500",
    badge: "bg-blue-50 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300",
    dot: "bg-blue-500",
    cardAccent: "border-l-blue-500",
  },
  ready: {
    text: "text-blue-700 dark:text-blue-300",
    band: "bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300 border-l-blue-500",
    badge: "bg-blue-50 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300",
    dot: "bg-blue-500",
    cardAccent: "border-l-blue-500",
  },
  blocked: {
    text: "text-amber-700 dark:text-amber-300",
    band: "bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border-l-amber-500",
    badge: "bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300",
    dot: "bg-amber-500",
    cardAccent: "border-l-amber-500",
  },
  awaiting: {
    text: "text-amber-700 dark:text-amber-300",
    band: "bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border-l-amber-500",
    badge: "bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300",
    dot: "bg-amber-500",
    cardAccent: "border-l-amber-500",
  },
  recent: {
    text: "text-emerald-700 dark:text-emerald-300",
    band: "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-l-emerald-500",
    badge: "bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    dot: "bg-emerald-500",
    cardAccent: "border-l-emerald-500",
  },
  earlier: {
    text: "text-foreground-muted",
    band: "bg-surface-sunken text-foreground-muted border-l-gray-300 dark:border-l-gray-600",
    badge: "bg-surface-sunken text-foreground-muted",
    dot: "bg-gray-400",
    cardAccent: "border-l-gray-400",
  },
};

/** A green "has results" marker that reveals the result image (or text
 *  preview) on hover. The blob resolves lazily on first hover so the list
 *  doesn't read every experiment's image up front. */
function ResultHoverThumb({
  path,
  preview,
}: {
  path: string | null;
  preview: string | null;
}) {
  const [hover, setHover] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!hover || !path) return;
    let cancelled = false;
    let revoke: string | null = null;
    (async () => {
      const blob = await fileService.readFileAsBlob(path);
      if (cancelled || !blob) return;
      const objectUrl = URL.createObjectURL(blob);
      revoke = objectUrl;
      setUrl(objectUrl);
    })();
    return () => {
      cancelled = true;
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [hover, path]);
  return (
    <span
      className="relative flex-none"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <span className="grid place-items-center w-6 h-6 rounded-md bg-emerald-50 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-300">
        <Icon name="camera" className="w-3.5 h-3.5" />
      </span>
      {hover && (path || preview) && (
        <span className="absolute right-8 top-1/2 -translate-y-1/2 z-50 w-48 rounded-lg border border-border bg-surface-overlay ros-popover-shadow overflow-hidden">
          {path ? (
            url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={url} alt="" className="w-full h-24 object-cover" />
            ) : (
              <span className="block w-full h-24 bg-surface-sunken" />
            )
          ) : null}
          {preview && (
            <span className="block p-2 text-meta text-foreground-muted line-clamp-3">
              {preview}
            </span>
          )}
        </span>
      )}
    </span>
  );
}

function freshnessFor(entry: SectionEntry): {
  kind: FreshnessKind;
  label?: string;
} {
  const { section, daysFromEnd, daysFromStart, task } = entry;
  if (section === "ready") {
    if (daysFromStart === null) return { kind: "running", label: "Ready" };
    if (daysFromStart === 0) return { kind: "running", label: "Starts today" };
    if (daysFromStart > 0)
      return { kind: "running", label: `Should have started ${daysFromStart}d ago` };
    return { kind: "running", label: `Starts in ${-daysFromStart}d` };
  }
  if (section === "blocked") {
    return { kind: "awaiting", label: "Blocked" };
  }
  if (section === "running") {
    const dayN = Math.max(
      1,
      Math.min(task.duration_days, (daysFromStart ?? 0) + 1),
    );
    return { kind: "running", label: `Day ${dayN} of ${task.duration_days}` };
  }
  if (section === "awaiting") {
    if (daysFromEnd !== null && daysFromEnd > 0)
      return { kind: "awaiting", label: `Completed ${daysFromEnd}d ago • no write-up` };
    return { kind: "awaiting", label: "Completed • no write-up" };
  }
  if (section === "recent") {
    if (daysFromEnd === 0) return { kind: "fresh", label: "Result today" };
    if (daysFromEnd === 1) return { kind: "fresh", label: "Result yesterday" };
    if (daysFromEnd !== null && daysFromEnd <= FRESHNESS_WINDOW_DAYS)
      return { kind: "fresh", label: `Result + ${daysFromEnd}d` };
    return {
      kind: "earlier",
      label: daysFromEnd !== null ? `${daysFromEnd}d ago` : "Earlier",
    };
  }
  return { kind: "earlier" };
}

interface Props {
  projects: Project[];
  /** BeakerSearch cross-tab jump (spec 4.2). A pending {kind:"experiment", key}
   *  intent opens the matching experiment popup once on mount, then clears via
   *  onInitialOpenConsumed (modeled on NotesPanel's initialNotebookId). */
  initialOpen?: WorkbenchInitialOpen;
  onInitialOpenConsumed?: () => void;
  /** BeakerSearch v2 chunk 3, the live-selection lift. Reports this panel's own
   *  open experiment up to the page so the BeakerSearch context card + Suggested
   *  describe the card the user actually clicked, not the last palette-opened
   *  proxy. Fires with the open experiment, null when the popup closes. */
  onSelectionChange?: (sel: WorkbenchRecentRef | null) => void;
}

export default function WorkbenchExperimentsPanel({
  projects,
  initialOpen = null,
  onInitialOpenConsumed,
  onSelectionChange,
}: Props) {
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  // Right-click "Add a comment": opens the popup with the comments rail expanded.
  const [commentIntent, setCommentIntent] = useState(false);
  const [tileMenu, setTileMenu] = useState<{ x: number; y: number; task: Task } | null>(null);
  // Right-click "Open results" / "Add a comment" intents: open the popup on the
  // results tab / with the comments rail expanded.
  const [resultsIntent, setResultsIntent] = useState(false);
  const openTaskComments = (t: Task) => {
    setSelectedTask(t);
    setCommentIntent(true);
  };
  const openTaskResults = (t: Task) => {
    setSelectedTask(t);
    setResultsIntent(true);
  };

  // Explorer navigation. `view` toggles the dense list vs the Kanban board.
  // `activeNav` scopes the list: "all", a status ("inflight"/"awaiting"/
  // "recent"/"earlier"), or a project ("proj:<owner>:<id>"). `activeMethod` /
  // `activeOwner` are the rail filter chips.
  const [view, setView] = useState<"list" | "board">("list");
  const [activeNav, setActiveNav] = useState<string>("all");
  const [activeMethod, setActiveMethod] = useState<number | null>(null);
  const [activeOwner, setActiveOwner] = useState<"mine" | "shared" | null>(null);

  const selectedProjectIds = useAppStore((s) => s.selectedProjectIds);
  const setIsCreatingTask = useAppStore((s) => s.setIsCreatingTask);
  const setNewTaskStartDate = useAppStore((s) => s.setNewTaskStartDate);
  const setRestrictedTaskType = useAppStore((s) => s.setRestrictedTaskType);

  const { currentUser: providerCurrentUser } = useCurrentUser();
  const currentUser = providerCurrentUser ?? "";

  const { data: allTasks = [] } = useQuery({
    queryKey: ["tasks", currentUser],
    queryFn: fetchAllTasksIncludingShared,
    enabled: projects.length > 0,
  });

  const { data: dependencies = [] } = useQuery({
    queryKey: ["dependencies", currentUser],
    queryFn: () => dependenciesApi.list(),
  });

  const { data: methods = [] } = useQuery({
    queryKey: ["methods", currentUser, "with-shared"],
    queryFn: fetchAllMethodsIncludingShared,
  });

  // Local-tz YYYY-MM-DD (mirrors the off-by-one fix on /experiments).
  const today = new Date().toLocaleDateString("en-CA");

  // All experiment tasks, with the project-pill filter scoped to the
  // current user's OWN experiments. Tasks shared INTO the current user
  // (`is_shared_with_me`) live in a different namespace — they belong to
  // the sharer's project, which the recipient never has in their own
  // `selectedProjectIds` set, so blindly applying the filter would hide
  // every shared card (Onboarding v4 §6.16 cursor-demo regression, HR
  // 2026-05-22). Shared cards always render; owned cards stay subject to
  // the project pill selector.
  const experiments = useMemo(() => {
    const all = allTasks.filter((t) => t.task_type === "experiment");
    return all.filter((t) => {
      if (t.is_shared_with_me) return true;
      return matchesAnyProjectFilter(t, selectedProjectIds);
    });
  }, [allTasks, selectedProjectIds]);

  // Multi-select experiment export, relocated here from the retired `/search`
  // page (it was the one capability `/search` had that the Cmd-K palette did
  // not). Drives the shared ExportFormatDialog with the SAME handlers: select
  // experiments, then zip / save-to-disk / combined-PDF. The hook owns the
  // selection + dialog state; the universe of experiments is this panel's.
  const exportCtl = useExperimentExport(experiments, currentUser);

  const blockingMap = useMemo(
    () => computeBlockingParents(allTasks, dependencies),
    [allTasks, dependencies],
  );

  // Probe each experiment for results.md / Images/ presence.
  // Mirrors LabExperimentsPanel: one probe per task, batched in a single effect.
  const [probes, setProbes] = useState<Map<string, TaskResultProbe>>(new Map());
  useEffect(() => {
    let cancelled = false;
    const next = new Map<string, TaskResultProbe>();
    (async () => {
      await Promise.all(
        experiments.map(async (t) => {
          const probe = await probeTaskResults({ id: t.id, owner: t.owner });
          next.set(taskKey(t), probe);
        }),
      );
      if (!cancelled) setProbes(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [experiments]);

  // Assemble per-task entries with section assignment.
  const entries: SectionEntry[] = useMemo(() => {
    return experiments.map((t) => {
      const key = taskKey(t);
      const probe = probes.get(key) ?? {
        hasResult: false,
        heroImagePath: null,
        resultsPreview: null,
      };
      // Shared-into-me tasks don't participate in this user's dep graph,
      // so they get an empty blockers list and never land in "blocked".
      const blockingParents = t.is_shared_with_me
        ? []
        : blockingMap.get(key) ?? [];
      const section = assignSection(t, {
        today,
        hasResult: probe.hasResult,
        blockingParents,
      });
      const daysFromEnd = t.end_date ? daysBetween(today, t.end_date) : null;
      const daysFromStart = t.start_date
        ? daysBetween(today, t.start_date)
        : null;
      const nextInChain =
        section === "running" ? findNextInChain(t, allTasks, dependencies) : null;
      return {
        task: t,
        section,
        probe,
        daysFromEnd,
        daysFromStart,
        blockingParents,
        nextInChain,
      };
    });
  }, [experiments, probes, blockingMap, today, allTasks, dependencies]);

  const scheduledCount = useMemo(
    () => entries.filter((e) => e.section === "scheduled").length,
    [entries],
  );

  // Project lookup tables.
  const projectColors = useMemo(() => {
    const map: Record<string, string> = {};
    projects.forEach((p, i) => {
      map[projectKey(p)] = p.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length];
    });
    return map;
  }, [projects]);

  const projectNameFor = useCallback(
    (task: Task): string => {
      // A falsy project_id (0/null) means standalone, not a dangling reference.
      // Render it as "Standalone" rather than "Unknown project (#0)".
      if (!task.project_id) return "Standalone";
      const hit = projects.find(
        (p) => p.id === task.project_id && p.owner === task.owner,
      );
      return hit?.name ?? `Unknown project (#${task.project_id})`;
    },
    [projects],
  );

  // Method lookup: route through each task's `method_attachments` so per-
  // attachment `owner` disambiguates against per-user id collisions (e.g.
  // alex's task attaching public method 2 when alex also owns a private
  // method id 2). Bare `method_ids` entries without a matching attachment
  // (newly-created tasks pre-attachment-backfill) fall through to task-
  // owner-first byId resolution via `resolveMethodById`. Mirrors the
  // pattern landed at MethodTabs.tsx in 3f8b42d2.
  const methodLookup = useCallback(
    (task: Task, mid: number): Method | null =>
      resolveMethodById(mid, task.method_attachments, methods, task.owner) ??
      null,
    [methods],
  );

  // ── Explorer computed data ──────────────────────────────────────────────
  const projNavKey = useCallback(
    (t: Task) => `proj:${t.owner}:${t.project_id ?? 0}`,
    [],
  );

  // Universe for the explorer: every experiment entry except future-scheduled
  // ones (those stay a footer hint), narrowed by the rail's method / owner
  // chips. The status-nav and project-nav selections are applied per consumer
  // so the rail counts stay stable as you click around.
  const baseFiltered = useMemo(() => {
    return entries.filter((e) => {
      if (displaySectionOf(e) === "scheduled") return false;
      if (activeOwner === "mine" && e.task.is_shared_with_me) return false;
      if (activeOwner === "shared" && !e.task.is_shared_with_me) return false;
      if (
        activeMethod != null &&
        !(e.task.method_ids ?? []).includes(activeMethod)
      )
        return false;
      return true;
    });
  }, [entries, activeOwner, activeMethod]);

  const statusCounts = useMemo(() => {
    const c = { all: 0, inflight: 0, awaiting: 0, recent: 0, earlier: 0 };
    for (const e of baseFiltered) {
      c.all += 1;
      const ds = displaySectionOf(e);
      if (ds === "ready" || ds === "blocked" || ds === "running") c.inflight += 1;
      else if (ds === "awaiting") c.awaiting += 1;
      else if (ds === "recent") c.recent += 1;
      else if (ds === "earlier") c.earlier += 1;
    }
    return c;
  }, [baseFiltered]);

  const railProjects = useMemo(() => {
    const m = new Map<string, { name: string; color: string; count: number }>();
    for (const e of baseFiltered) {
      const k = projNavKey(e.task);
      if (!m.has(k)) {
        m.set(k, {
          name: projectNameFor(e.task),
          color:
            projectColors[`${e.task.owner}:${e.task.project_id}`] ??
            DEFAULT_COLORS[0],
          count: 0,
        });
      }
      m.get(k)!.count += 1;
    }
    return Array.from(m.entries())
      .map(([key, v]) => ({ key, ...v }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [baseFiltered, projNavKey, projectNameFor, projectColors]);

  const railMethods = useMemo(() => {
    const m = new Map<number, { name: string; count: number }>();
    for (const e of baseFiltered) {
      for (const mid of e.task.method_ids ?? []) {
        const meth = methodLookup(e.task, mid);
        if (!meth) continue;
        if (!m.has(meth.id)) m.set(meth.id, { name: meth.name, count: 0 });
        m.get(meth.id)!.count += 1;
      }
    }
    return Array.from(m.entries())
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [baseFiltered, methodLookup]);

  const matchesNav = useCallback(
    (e: SectionEntry) => {
      if (activeNav === "all") return true;
      const ds = displaySectionOf(e);
      if (activeNav === "inflight")
        return ds === "ready" || ds === "blocked" || ds === "running";
      if (activeNav === "awaiting") return ds === "awaiting";
      if (activeNav === "recent") return ds === "recent";
      if (activeNav === "earlier") return ds === "earlier";
      if (activeNav.startsWith("proj:")) return projNavKey(e.task) === activeNav;
      return true;
    },
    [activeNav, projNavKey],
  );

  // Dense-list rows, grouped by status band. A single-status nav selection
  // shows a flat list (one band); All and per-project views show every band.
  const listGrouped = useMemo(() => {
    const items = baseFiltered.filter(matchesNav);
    const m = new Map<DisplaySection, SectionEntry[]>();
    for (const sec of LIST_SECTION_ORDER) m.set(sec, []);
    for (const e of items) {
      const ds = displaySectionOf(e);
      if (ds === "scheduled") continue;
      m.get(ds)?.push(e);
    }
    m.get("ready")?.sort((a, b) =>
      a.task.start_date.localeCompare(b.task.start_date),
    );
    m.get("blocked")?.sort((a, b) =>
      a.task.start_date.localeCompare(b.task.start_date),
    );
    m.get("running")?.sort((a, b) =>
      b.task.start_date.localeCompare(a.task.start_date),
    );
    m.get("awaiting")?.sort((a, b) => (b.daysFromEnd ?? 0) - (a.daysFromEnd ?? 0));
    m.get("recent")?.sort((a, b) => (a.daysFromEnd ?? 0) - (b.daysFromEnd ?? 0));
    m.get("earlier")?.sort(
      (a, b) => (a.daysFromEnd ?? Infinity) - (b.daysFromEnd ?? Infinity),
    );
    return m;
  }, [baseFiltered, matchesNav]);

  const listCount = useMemo(
    () =>
      Array.from(listGrouped.values()).reduce((n, arr) => n + arr.length, 0),
    [listGrouped],
  );

  // Board view: the four in-flight stages, respecting the method/owner chips
  // and a project-nav selection (a status-nav selection does not apply to the
  // board, which spans all in-flight statuses by definition).
  const boardGrouped = useMemo(() => {
    const m = new Map<WorkbenchSection, SectionEntry[]>();
    for (const key of BOARD_STAGES) m.set(key, []);
    for (const e of baseFiltered) {
      if (activeNav.startsWith("proj:") && projNavKey(e.task) !== activeNav)
        continue;
      if (BOARD_STAGES.includes(e.section)) m.get(e.section)?.push(e);
    }
    m.get("ready")?.sort((a, b) =>
      a.task.start_date.localeCompare(b.task.start_date),
    );
    m.get("blocked")?.sort((a, b) =>
      a.task.start_date.localeCompare(b.task.start_date),
    );
    m.get("running")?.sort((a, b) =>
      b.task.start_date.localeCompare(a.task.start_date),
    );
    m.get("awaiting")?.sort((a, b) => (b.daysFromEnd ?? 0) - (a.daysFromEnd ?? 0));
    return m;
  }, [baseFiltered, activeNav, projNavKey]);

  const handleCreateExperiment = useCallback(() => {
    setNewTaskStartDate(null);
    setRestrictedTaskType("experiment");
    setIsCreatingTask(true);
    // Onboarding v4 §6.5: the new workbench-create-experiment-open
    // sub-step waits for this DOM event to advance. Cheap no-op when no
    // tour is active (one ignored dispatch).
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("tour:workbench-experiment-modal-opened"),
      );
    }
  }, [setIsCreatingTask, setNewTaskStartDate, setRestrictedTaskType]);

  // Open a task by id (own-namespace lookup). Used by the "next in chain"
  // and "blocked-by parent" click-throughs.
  const handleOpenTaskById = useCallback(
    (id: number) => {
      const t = allTasks.find(
        (x) => x.id === id && !x.is_shared_with_me && x.owner === currentUser,
      );
      if (t) setSelectedTask(t);
    },
    [allTasks, currentUser],
  );

  // BeakerSearch cross-tab jump (spec 4.2). Once the experiment list is loaded,
  // resolve the pending taskKey to the full Task (owner-correct, not a bare-id
  // lookup) and open its popup, then clear the intent. Runs once per intent.
  useEffect(() => {
    if (!initialOpen || initialOpen.kind !== "experiment") return;
    if (allTasks.length === 0) return;
    const t = allTasks.find((x) => taskKey(x) === initialOpen.key);
    if (t) setSelectedTask(t);
    onInitialOpenConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialOpen, allTasks]);

  // BeakerSearch v2 chunk 3, the live-selection lift. Report whatever experiment
  // is open (or null when the popup closes) up to the page so the BeakerSearch
  // source names the card the user actually clicked. Watching selectedTask covers
  // every open path (click, chain navigation, comment intent, the cross-tab jump)
  // and the close-to-null path with one thin effect.
  useEffect(() => {
    onSelectionChange?.(
      selectedTask
        ? { kind: "experiment", key: taskKey(selectedTask) }
        : null,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTask]);

  // Whole-panel empty state fires only when there are no experiments at all
  // (scheduled-only still shows the explorer with a footer hint).
  const hasAnyExperiments = entries.length > 0;

  // All four board stages empty (given current filters) -> a single quiet
  // message in place of the 4-column board.
  const boardAllEmpty = useMemo(
    () => BOARD_STAGES.every((key) => (boardGrouped.get(key)?.length ?? 0) === 0),
    [boardGrouped],
  );

  const renderCard = (entry: SectionEntry, compact = false) => {
    const t = entry.task;
    const cardMethods: ExperimentCardMethod[] = (t.method_ids ?? [])
      .map((mid) => methodLookup(t, mid))
      .filter((m): m is Method => m !== null)
      .map((m) => ({ id: m.id, name: m.name, color: null }));
    const fresh = freshnessFor(entry);
    const projectName = projectNameFor(t);
    const sharedIndicator = t.is_shared_with_me ? (
      <SharedFromPill owner={t.owner} />
    ) : undefined;

    // Onboarding v4 §6.16 (HR 2026-05-22): stamp the BeakerBot-shared
    // experiment cards so the lab-permission-practice step's cursor demo
    // can target the EDIT card vs the VIEW card distinctly. Only fires
    // for `BEAKERBOT_LAB_USERNAME` shares so an unrelated teammate's
    // shares with matching `shared_permission` never collide.
    const labTourTarget =
      t.is_shared_with_me && t.owner === BEAKERBOT_LAB_USERNAME
        ? t.shared_permission === "edit"
          ? "workbench-shared-edit-experiment"
          : t.shared_permission === "view"
            ? "workbench-shared-view-experiment"
            : undefined
        : undefined;

    const isSelected = exportCtl.selectedKeys.has(taskKey(t));

    return (
      <div
        key={taskKey(t)}
        className="relative flex flex-col gap-2"
        data-tour-target={labTourTarget}
        data-testid="experiment-board-card"
        data-beaker-target={`experiment:${taskKey(t)}`}
        onContextMenu={(e) => {
          e.preventDefault();
          setTileMenu({ x: e.clientX, y: e.clientY, task: t });
        }}
      >
        {/* Select-mode checkbox overlay (export relocation). Sits above the
            card so a tap toggles selection without opening the popup. */}
        {exportCtl.selectMode && (
          <span
            className={`absolute top-2 right-2 z-10 grid place-items-center w-5 h-5 rounded border-2 transition-colors ${
              isSelected
                ? "bg-brand-action border-brand-action text-white"
                : "border-border bg-surface-raised"
            }`}
          >
            {isSelected && <Icon name="check" className="w-3 h-3" />}
          </span>
        )}
        <ExperimentResultCard
          task={{
            id: t.id,
            name: t.name,
            username: t.owner,
            experiment_color: t.experiment_color,
            project_name: projectName,
            // VCP R3 attribution stamps — surface last-editor + when in
            // the experiment card footer. Self-hides on pre-R3 tasks.
            last_edited_by: t.last_edited_by,
            last_edited_at: t.last_edited_at,
          }}
          heroImagePath={entry.probe.heroImagePath}
          resultsPreview={entry.probe.resultsPreview}
          methods={cardMethods}
          freshnessKind={fresh.kind}
          freshnessLabel={fresh.label}
          onClick={() =>
            exportCtl.selectMode
              ? exportCtl.toggleSelection(t)
              : setSelectedTask(t)
          }
          sharedIndicator={sharedIndicator}
          compact={compact}
        />
        {entry.section === "blocked" && entry.blockingParents.length > 0 && (
          <div className="text-meta text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-500/30 rounded-md px-1.5 py-0.5 leading-snug flex items-center gap-1 min-w-0">
            <svg
              aria-hidden
              className="w-3 h-3 flex-shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15 19l-7-7 7-7"
              />
            </svg>
            <span className="font-medium flex-shrink-0">Blocked:</span>
            <span className="flex-1 min-w-0 truncate">
              {entry.blockingParents.map((p, i) => (
                <span key={p.id}>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleOpenTaskById(p.id);
                    }}
                    className="underline cursor-pointer hover:text-amber-900 hover:bg-amber-100 dark:hover:bg-amber-500/20 rounded"
                  >
                    {p.name}
                  </button>
                  {i < entry.blockingParents.length - 1 ? ", " : ""}
                </span>
              ))}
            </span>
          </div>
        )}
        {entry.section === "running" && entry.nextInChain && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setSelectedTask(entry.nextInChain!);
            }}
            className="text-meta text-foreground-muted hover:text-foreground text-left bg-surface-raised border border-border rounded-md px-1.5 py-0.5 leading-snug flex items-center gap-1 min-w-0 cursor-pointer hover:bg-surface-sunken"
          >
            <span className="font-medium flex-shrink-0">Next:</span>
            <span className="flex-1 min-w-0 truncate">{entry.nextInChain.name}</span>
            <svg
              aria-hidden
              className="w-3 h-3 flex-shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 5l7 7-7 7"
              />
            </svg>
          </button>
        )}
      </div>
    );
  };

  // Dense list row. Status badge (colored by section), name, method chips,
  // project, and a results marker that reveals the image on hover. Click opens
  // the detail popup; right-click opens the row menu.
  const renderRow = (entry: SectionEntry) => {
    const t = entry.task;
    const ds = displaySectionOf(entry);
    const style = STATUS_STYLE[ds === "scheduled" ? "earlier" : ds];
    const fresh = freshnessFor(entry);
    const badgeText =
      ds === "awaiting" ? "No write-up" : fresh.label ?? DISPLAY_LABEL[ds];
    const rowMethods = (t.method_ids ?? [])
      .map((mid) => methodLookup(t, mid))
      .filter((m): m is Method => m !== null);
    const isSelected = exportCtl.selectedKeys.has(taskKey(t));
    return (
      <div
        key={taskKey(t)}
        data-beaker-target={`experiment:${taskKey(t)}`}
        data-testid="experiment-row"
        data-tour-target={
          t.is_shared_with_me && t.owner === BEAKERBOT_LAB_USERNAME
            ? t.shared_permission === "edit"
              ? "workbench-shared-edit-experiment"
              : t.shared_permission === "view"
                ? "workbench-shared-view-experiment"
                : undefined
            : undefined
        }
        onClick={() =>
          exportCtl.selectMode
            ? exportCtl.toggleSelection(t)
            : setSelectedTask(t)
        }
        onContextMenu={(e) => {
          e.preventDefault();
          setTileMenu({ x: e.clientX, y: e.clientY, task: t });
        }}
        className="group flex items-center gap-3 px-4 py-2 border-b border-border cursor-pointer hover:bg-surface-sunken transition-colors"
      >
        {/* Select-mode checkbox (export relocation). */}
        {exportCtl.selectMode && (
          <span
            className={`flex-none grid place-items-center w-4 h-4 rounded border-2 transition-colors ${
              isSelected
                ? "bg-brand-action border-brand-action text-white"
                : "border-border bg-surface-raised"
            }`}
          >
            {isSelected && <Icon name="check" className="w-2.5 h-2.5" />}
          </span>
        )}
        <span
          className={`flex-none text-meta font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${style.badge}`}
        >
          {badgeText}
        </span>
        <span className="text-body font-medium text-foreground truncate">
          {t.name}
        </span>
        {rowMethods.length > 0 && (
          <span className="hidden md:flex items-center gap-1 flex-none">
            {rowMethods.slice(0, 2).map((m) => (
              <span
                key={m.id}
                className="text-meta text-purple-600 dark:text-purple-300 bg-purple-50 dark:bg-purple-500/15 rounded-full px-2 py-0.5 whitespace-nowrap"
              >
                {m.name}
              </span>
            ))}
            {rowMethods.length > 2 && (
              <span className="text-meta text-foreground-muted">
                +{rowMethods.length - 2}
              </span>
            )}
          </span>
        )}
        <span className="flex-1 min-w-[8px]" />
        {t.is_shared_with_me && <SharedFromPill owner={t.owner} />}
        <span className="hidden lg:inline flex-none text-meta text-foreground-muted">
          {projectNameFor(t)}
        </span>
        {entry.probe.hasResult ? (
          <ResultHoverThumb
            path={entry.probe.heroImagePath}
            preview={entry.probe.resultsPreview}
          />
        ) : (
          <span className="w-6 flex-none" aria-hidden />
        )}
      </div>
    );
  };

  const renderNavItem = (
    key: string,
    label: string,
    dotClass: string,
    count: number,
  ) => {
    const active = activeNav === key;
    return (
      <button
        key={key}
        type="button"
        onClick={() => setActiveNav(key)}
        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-body text-left transition-colors ${
          active
            ? "bg-brand-action text-white font-medium"
            : "text-foreground hover:bg-surface-raised"
        }`}
      >
        <span
          className={`w-2.5 h-2.5 rounded-sm flex-none ${active ? "bg-white/80" : dotClass}`}
        />
        <span className="flex-1 truncate">{label}</span>
        <span
          className={`text-meta tabular-nums ${active ? "text-white/80" : "text-foreground-muted"}`}
        >
          {count}
        </span>
      </button>
    );
  };

  const crumbLabel =
    activeNav === "all"
      ? "All experiments"
      : activeNav.startsWith("proj:")
        ? railProjects.find((p) => p.key === activeNav)?.name ?? "Project"
        : (
            {
              inflight: "In flight",
              awaiting: "Awaiting write-up",
              recent: "Recent results",
              earlier: "Earlier",
            } as Record<string, string>
          )[activeNav] ?? "Experiments";

  const railSecH =
    "px-1.5 mt-4 mb-1.5 text-meta font-bold uppercase tracking-wider text-foreground-muted";

  return (
    <div data-current-tab="experiments" data-tour-target="workbench-shared-experiments">
      {!hasAnyExperiments ? (
        <div className="text-center py-12 rounded-xl border border-border bg-surface-sunken">
          <p className="text-title text-foreground mb-2">No experiments yet</p>
          <p className="text-body text-foreground-muted mb-6">
            Create an experiment task to see it here
          </p>
          <button
            onClick={handleCreateExperiment}
            data-tour-target="workbench-new-experiment"
            className="ros-btn-raise px-6 py-3 text-body bg-brand-action text-white rounded-lg hover:bg-brand-action/90"
          >
            + New Experiment
          </button>
        </div>
      ) : (
        <>
          <div className="flex border border-border rounded-xl overflow-hidden bg-surface-raised min-h-[480px]">
            {/* Rail: status + project navigation, owner + method filters. */}
            <aside className="w-56 flex-none border-r border-border bg-surface-sunken p-3 overflow-y-auto">
              <p className="px-1.5 mb-1.5 text-meta font-bold uppercase tracking-wider text-foreground-muted">
                Status
              </p>
              <div className="space-y-0.5">
                {renderNavItem("all", "All experiments", "bg-foreground-muted", statusCounts.all)}
                {renderNavItem("inflight", "In flight", "bg-blue-500", statusCounts.inflight)}
                {renderNavItem("awaiting", "Awaiting write-up", "bg-amber-500", statusCounts.awaiting)}
                {renderNavItem("recent", "Recent results", "bg-emerald-500", statusCounts.recent)}
                {renderNavItem("earlier", "Earlier", "bg-gray-400", statusCounts.earlier)}
              </div>

              {railProjects.length > 0 && (
                <>
                  <p className={railSecH}>By project</p>
                  <div className="space-y-0.5">
                    {railProjects.map((p) => {
                      const active = activeNav === p.key;
                      return (
                        <button
                          key={p.key}
                          type="button"
                          onClick={() => setActiveNav(p.key)}
                          className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-body text-left transition-colors ${
                            active
                              ? "bg-brand-action text-white font-medium"
                              : "text-foreground hover:bg-surface-raised"
                          }`}
                        >
                          <span
                            className={`w-2.5 h-2.5 rounded-full flex-none ${active ? "bg-white/80" : ""}`}
                            style={active ? undefined : { backgroundColor: p.color }}
                          />
                          <span className="flex-1 truncate">{p.name}</span>
                          <span
                            className={`text-meta tabular-nums ${active ? "text-white/80" : "text-foreground-muted"}`}
                          >
                            {p.count}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}

              <p className={railSecH}>Owner</p>
              <div className="flex flex-wrap gap-1.5 px-1">
                {(["mine", "shared"] as const).map((o) => (
                  <button
                    key={o}
                    type="button"
                    onClick={() => setActiveOwner(activeOwner === o ? null : o)}
                    className={`text-meta font-medium px-2.5 py-1 rounded-full border transition-colors ${
                      activeOwner === o
                        ? "bg-brand-action border-brand-action text-white"
                        : "border-border text-foreground-muted hover:bg-surface-raised"
                    }`}
                  >
                    {o === "mine" ? "Mine" : "Shared with me"}
                  </button>
                ))}
              </div>

              {railMethods.length > 0 && (
                <>
                  <p className={railSecH}>Filter by method</p>
                  <div className="flex flex-wrap gap-1.5 px-1">
                    {railMethods.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() =>
                          setActiveMethod(activeMethod === m.id ? null : m.id)
                        }
                        className={`text-meta font-medium px-2.5 py-1 rounded-full border transition-colors ${
                          activeMethod === m.id
                            ? "bg-brand-action border-brand-action text-white"
                            : "border-border text-foreground-muted hover:bg-surface-raised"
                        }`}
                      >
                        {m.name}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </aside>

            {/* List / Board pane. */}
            <div className="flex-1 min-w-0 flex flex-col">
              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border">
                <span className="text-title font-semibold text-foreground truncate">
                  {crumbLabel}
                </span>
                <span className="flex-1" />
                {view === "list" && (
                  <span className="text-meta text-foreground-muted hidden sm:inline">
                    {listCount} {listCount === 1 ? "experiment" : "experiments"}
                  </span>
                )}
                <span className="inline-flex rounded-lg border border-border overflow-hidden">
                  {(["list", "board"] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setView(v)}
                      className={`text-meta font-semibold px-3 py-1 ${
                        view === v
                          ? "bg-brand-action text-white"
                          : "bg-surface-raised text-foreground-muted hover:bg-surface-sunken"
                      }`}
                    >
                      {v === "list" ? "List" : "Board"}
                    </button>
                  ))}
                </span>
                {/* Multi-select experiment export (relocated from /search). */}
                {exportCtl.selectMode ? (
                  <>
                    <span className="text-meta text-foreground-muted whitespace-nowrap">
                      {exportCtl.selectedCount} selected
                    </span>
                    <button
                      type="button"
                      onClick={exportCtl.openDialog}
                      disabled={exportCtl.selectedCount === 0}
                      className="ros-btn-raise px-3 py-1.5 text-meta bg-brand-action text-white rounded-lg hover:bg-brand-action/90 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Export selected
                    </button>
                    <button
                      type="button"
                      onClick={exportCtl.cancelSelectMode}
                      className="px-3 py-1.5 text-meta text-foreground-muted hover:bg-surface-sunken rounded-lg"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={exportCtl.enterSelectMode}
                    className="ros-btn-neutral px-3 py-1.5 text-meta text-foreground-muted"
                  >
                    Select
                  </button>
                )}
                <button
                  onClick={handleCreateExperiment}
                  data-tour-target="workbench-new-experiment"
                  className="ros-btn-raise px-3 py-1.5 text-body bg-brand-action text-white rounded-lg hover:bg-brand-action/90"
                >
                  + New Experiment
                </button>
              </div>

              <div className="flex-1 overflow-y-auto">
                {view === "board" ? (
                  boardAllEmpty ? (
                    <p className="text-body text-foreground-muted text-center py-12">
                      No in-flight experiments
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 p-4">
                      {BOARD_STAGES.map((key) => {
                        const items = boardGrouped.get(key) ?? [];
                        const style = STATUS_STYLE[key as keyof typeof STATUS_STYLE];
                        return (
                          <div key={key} className="flex flex-col">
                            <Tooltip label={SECTION_HELP[key]} placement="top">
                              <div
                                className={`flex items-center justify-between mb-3 px-2 py-1 rounded-md border-l-[3px] ${style.band}`}
                              >
                                <h3 className="text-meta font-bold uppercase tracking-wide">
                                  {SECTION_LABEL[key]}
                                </h3>
                                <span className="text-meta font-normal opacity-70">
                                  {items.length}
                                </span>
                              </div>
                            </Tooltip>
                            {items.length === 0 ? (
                              key === "awaiting" ? (
                                <div className="text-meta text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-200 dark:border-emerald-500/30 rounded-md px-3 py-2">
                                  All recent experiments have results logged.
                                </div>
                              ) : (
                                <p className="text-meta text-foreground-muted">
                                  Nothing here
                                </p>
                              )
                            ) : (
                              <div className="space-y-3 max-h-[34rem] overflow-y-auto pr-1">
                                {items.map((e) => renderCard(e, true))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )
                ) : (
                  (() => {
                    const bands = LIST_SECTION_ORDER.filter(
                      (sec) => (listGrouped.get(sec)?.length ?? 0) > 0,
                    );
                    if (bands.length === 0) {
                      return (
                        <p className="text-body text-foreground-muted text-center py-12">
                          No experiments match this view.
                        </p>
                      );
                    }
                    return bands.map((sec) => {
                      const items = listGrouped.get(sec)!;
                      const style = STATUS_STYLE[sec as keyof typeof STATUS_STYLE];
                      return (
                        <div key={sec}>
                          <div
                            className={`px-4 py-1.5 border-b border-border border-l-[3px] text-meta font-bold uppercase tracking-wider ${style.band}`}
                          >
                            {DISPLAY_LABEL[sec]} &middot; {items.length}
                          </div>
                          {items.map((e) => renderRow(e))}
                        </div>
                      );
                    });
                  })()
                )}
              </div>
            </div>
          </div>

          {scheduledCount > 0 && (
            <div className="text-meta text-foreground-muted pt-2">
              <span>{scheduledCount} scheduled later</span>
            </div>
          )}
        </>
      )}

      {tileMenu && (
        <ContextMenu
          x={tileMenu.x}
          y={tileMenu.y}
          onClose={() => setTileMenu(null)}
          items={[
            {
              label: "Open",
              icon: <Icon name="eye" className="h-4 w-4" />,
              onClick: () => setSelectedTask(tileMenu.task),
            },
            {
              label: "Open results",
              icon: <Icon name="camera" className="h-4 w-4" />,
              onClick: () => openTaskResults(tileMenu.task),
            },
            {
              label: tileMenu.task.comments?.length
                ? "View / add comment"
                : "Add a comment",
              icon: <Icon name="ask" className="h-4 w-4" />,
              onClick: () => openTaskComments(tileMenu.task),
            },
          ]}
        />
      )}

      {selectedTask && (
        <TaskDetailPopup
          task={selectedTask}
          project={projects.find(
            (p) =>
              p.id === selectedTask.project_id &&
              p.owner === selectedTask.owner,
          )}
          onClose={() => {
            setSelectedTask(null);
            setCommentIntent(false);
            setResultsIntent(false);
          }}
          onNavigateToTask={(task) => {
            setSelectedTask(task);
            setCommentIntent(false);
            setResultsIntent(false);
          }}
          initialTab={resultsIntent ? "results" : undefined}
          initialCommentsOpen={commentIntent}
        />
      )}

      <TaskModal projects={projects} />

      {/* Multi-select experiment export dialog (relocated from /search). Same
          shared component + handlers: zip / save-to-disk / combined-PDF. */}
      <ExportFormatDialog
        isOpen={exportCtl.dialogOpen}
        taskCount={exportCtl.selectedCount}
        isExporting={exportCtl.exporting}
        sizeEstimate={exportCtl.sizeEstimate}
        progress={exportCtl.progress}
        onClose={exportCtl.closeDialog}
        onExport={exportCtl.exportSelected}
        onExportToFile={exportCtl.exportSelectedToFile}
        onExportCombined={exportCtl.exportSelectedCombined}
      />
    </div>
  );
}
