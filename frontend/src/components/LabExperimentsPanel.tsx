"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { labApi, LabMethod, LabTask } from "@/lib/local-api";
import { useLabData } from "@/hooks/useLabData";
import ExperimentResultCard, {
  type ExperimentCardMethod,
} from "@/components/experiments/ExperimentResultCard";
import { type FreshnessKind } from "@/components/experiments/FreshnessTag";
import {
  probeTaskResults,
  type TaskResultProbe,
} from "@/lib/experiments/findTaskResultsBase";

interface LabExperimentsPanelProps {
  selectedUsernames: Set<string>;
  onExperimentClick: (experiment: LabTask) => void;
}

const FRESHNESS_WINDOW_DAYS = 7;
const VIEW_MODE_STORAGE_KEY = "researchos:experiments-view-mode";

type ViewMode = "gallery" | "compare";
type SectionKey = "fresh" | "active" | "awaiting" | "earlier";

interface SectionEntry {
  task: LabTask;
  probe: TaskResultProbe;
  section: SectionKey;
  daysFromEnd: number | null;
}

const SECTION_LABEL: Record<SectionKey, string> = {
  fresh: "Fresh results",
  active: "Active",
  awaiting: "Awaiting results",
  earlier: "Earlier",
};

const SECTION_HELP: Record<SectionKey, string> = {
  fresh: `Results posted in the last ${FRESHNESS_WINDOW_DAYS} days`,
  active: "Running right now",
  awaiting: "Completed, but no results.md or images on disk yet",
  earlier: "Older results past the freshness window",
};

function todayIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function daysBetween(aIso: string, bIso: string): number {
  const a = new Date(aIso + "T00:00:00Z").getTime();
  const b = new Date(bIso + "T00:00:00Z").getTime();
  return Math.round((a - b) / 86_400_000);
}

function readStoredViewMode(): ViewMode {
  if (typeof window === "undefined") return "gallery";
  try {
    const v = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY);
    return v === "compare" ? "compare" : "gallery";
  } catch {
    return "gallery";
  }
}

export default function LabExperimentsPanel({
  selectedUsernames,
  onExperimentClick,
}: LabExperimentsPanelProps) {
  const { tasks, projects } = useLabData();
  const { data: methods = [] } = useQuery<LabMethod[]>({
    queryKey: ["lab", "methods"],
    queryFn: () => labApi.getMethods(),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const [viewMode, setViewMode] = useState<ViewMode>("gallery");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- SSR-safe localStorage hydration: useState seed must match the server-rendered HTML ("gallery"), then we read the persisted value on mount. A lazy useState initializer would cause a hydration mismatch warning since the server has no localStorage.
    setViewMode(readStoredViewMode());
  }, []);
  const setAndPersistMode = (next: ViewMode) => {
    setViewMode(next);
    try {
      window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, next);
    } catch {
      // best-effort
    }
  };

  const experiments = useMemo(
    () =>
      tasks
        .filter((t) => t.task_type === "experiment")
        .filter((t) => selectedUsernames.has(t.username)),
    [tasks, selectedUsernames],
  );

  const projectNameFor = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of projects) map.set(`${p.username}:${p.id}`, p.name);
    return (username: string, projectId: number) =>
      map.get(`${username}:${projectId}`) ?? "Unknown project";
  }, [projects]);

  const methodLookup = useMemo(() => {
    const byOwnerId = new Map<string, LabMethod>();
    for (const m of methods) {
      byOwnerId.set(`${m.username}:${m.id}`, m);
    }
    const byIdOnly = new Map<number, LabMethod>();
    for (const m of methods) {
      if (!byIdOnly.has(m.id)) byIdOnly.set(m.id, m);
    }
    return (task: LabTask, mid: number): LabMethod | null => {
      return (
        byOwnerId.get(`${task.username}:${mid}`) ??
        byOwnerId.get(`public:${mid}`) ??
        byIdOnly.get(mid) ??
        null
      );
    };
  }, [methods]);

  const [probes, setProbes] = useState<Map<string, TaskResultProbe>>(new Map());

  useEffect(() => {
    let cancelled = false;
    const next = new Map<string, TaskResultProbe>();
    (async () => {
      await Promise.all(
        experiments.map(async (t) => {
          const key = `${t.username}:${t.id}`;
          const probe = await probeTaskResults({
            id: t.id,
            owner: t.username,
          });
          next.set(key, probe);
        }),
      );
      if (!cancelled) setProbes(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [experiments]);

  const today = todayIso();

  const entries: SectionEntry[] = useMemo(() => {
    return experiments.map((t) => {
      const key = `${t.username}:${t.id}`;
      const probe =
        probes.get(key) ?? {
          hasResult: false,
          heroImagePath: null,
          resultsPreview: null,
        };
      const daysFromEnd = t.end_date ? daysBetween(today, t.end_date) : null;
      const isFresh =
        probe.hasResult &&
        daysFromEnd !== null &&
        daysFromEnd >= 0 &&
        daysFromEnd <= FRESHNESS_WINDOW_DAYS;
      let section: SectionKey;
      if (!t.is_complete) {
        section = "active";
      } else if (!probe.hasResult) {
        section = "awaiting";
      } else if (isFresh) {
        section = "fresh";
      } else {
        section = "earlier";
      }
      return { task: t, probe, section, daysFromEnd };
    });
  }, [experiments, probes, today]);

  if (experiments.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-foreground-muted text-body bg-surface-raised rounded-xl p-8 border border-border">
        No experiments found for selected users.
      </div>
    );
  }

  // Lab Mode fix manager R1 (2026-05-22): wrap the first card
  // rendered across every section/group in a div carrying
  // `data-tour-target="lab-mode-experiments-first-card"` so the
  // lab-mode-experiments cursor demo can deterministically spot it.
  // Render-scoped, reset on every render.
  let firstCardWrapped = false;

  const cardFor = (entry: SectionEntry) => {
    const t = entry.task;
    const cardMethods: ExperimentCardMethod[] = (t.method_ids ?? [])
      .map((mid) => methodLookup(t, mid))
      .filter((m): m is LabMethod => m !== null)
      .map((m) => ({ id: m.id, name: m.name, color: m.user_color }));

    let freshnessKind: FreshnessKind;
    let freshnessLabel: string | undefined;
    if (entry.section === "active") {
      freshnessKind = "running";
      if (entry.daysFromEnd !== null) {
        if (entry.daysFromEnd < 0) {
          freshnessLabel = `Running • ends in ${-entry.daysFromEnd}d`;
        } else if (entry.daysFromEnd === 0) {
          freshnessLabel = "Running • due today";
        } else {
          freshnessLabel = `Running • ${entry.daysFromEnd}d overdue`;
        }
      }
    } else if (entry.section === "awaiting") {
      freshnessKind = "awaiting";
      freshnessLabel =
        entry.daysFromEnd !== null && entry.daysFromEnd > 0
          ? `Completed ${entry.daysFromEnd}d ago • no write-up`
          : "Completed • no write-up";
    } else if (entry.section === "fresh") {
      freshnessKind = "fresh";
      if (entry.daysFromEnd === 0) freshnessLabel = "Result today";
      else if (entry.daysFromEnd === 1) freshnessLabel = "Result yesterday";
      else if (entry.daysFromEnd !== null)
        freshnessLabel = `Result + ${entry.daysFromEnd}d`;
    } else {
      freshnessKind = "earlier";
      freshnessLabel =
        entry.daysFromEnd !== null ? `${entry.daysFromEnd}d ago` : "Earlier";
    }

    const shouldWrap = !firstCardWrapped;
    if (shouldWrap) firstCardWrapped = true;
    const card = (
      <ExperimentResultCard
        key={`${t.username}-${t.id}`}
        task={{
          id: t.id,
          name: t.name,
          username: t.username,
          experiment_color: t.experiment_color,
          project_name: projectNameFor(t.username, t.project_id),
        }}
        heroImagePath={entry.probe.heroImagePath}
        resultsPreview={entry.probe.resultsPreview}
        methods={cardMethods}
        freshnessKind={freshnessKind}
        freshnessLabel={freshnessLabel}
        onClick={() => onExperimentClick(t)}
      />
    );
    if (!shouldWrap) return card;
    return (
      <div
        key={`first-card-wrapper-${t.username}-${t.id}`}
        data-tour-target="lab-mode-experiments-first-card"
      >
        {card}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h2 className="text-heading font-semibold text-foreground">
            {viewMode === "compare" ? "Comparing by method" : "Experiments"}
          </h2>
          <p className="text-body text-foreground-muted">
            {viewMode === "compare"
              ? "Grouped by method to compare replicates."
              : "Outcome cards led by results.md content or the first image in each task's Images folder."}
          </p>
        </div>

        <div className="inline-flex items-center bg-surface-sunken rounded-lg p-1 text-body ros-seg-track border border-border">
          <button
            type="button"
            onClick={() => setAndPersistMode("gallery")}
            className={
              "px-3 py-1 rounded-md transition " +
              (viewMode === "gallery"
                ? "bg-surface-raised text-foreground ros-seg-active"
                : "text-foreground-muted hover:text-foreground")
            }
          >
            Gallery
          </button>
          <button
            type="button"
            onClick={() => setAndPersistMode("compare")}
            className={
              "px-3 py-1 rounded-md transition " +
              (viewMode === "compare"
                ? "bg-surface-raised text-foreground ros-seg-active"
                : "text-foreground-muted hover:text-foreground")
            }
          >
            Compare
          </button>
        </div>
      </div>

      {viewMode === "gallery" ? (
        <GalleryLayout entries={entries} cardFor={cardFor} />
      ) : (
        <CompareLayout
          entries={entries}
          cardFor={cardFor}
          methodLookup={methodLookup}
        />
      )}
    </div>
  );
}

function GalleryLayout({
  entries,
  cardFor,
}: {
  entries: SectionEntry[];
  cardFor: (entry: SectionEntry) => React.ReactNode;
}) {
  const order: SectionKey[] = ["fresh", "active", "awaiting", "earlier"];
  const grouped = new Map<SectionKey, SectionEntry[]>();
  for (const key of order) grouped.set(key, []);
  for (const e of entries) grouped.get(e.section)!.push(e);

  // Sort fresh / earlier by recency; active by start_date asc; awaiting by recency.
  grouped.get("fresh")!.sort((a, b) => (a.daysFromEnd ?? 0) - (b.daysFromEnd ?? 0));
  grouped
    .get("earlier")!
    .sort((a, b) => (a.daysFromEnd ?? 0) - (b.daysFromEnd ?? 0));
  grouped
    .get("active")!
    .sort((a, b) => a.task.start_date.localeCompare(b.task.start_date));
  grouped
    .get("awaiting")!
    .sort((a, b) => (a.daysFromEnd ?? 0) - (b.daysFromEnd ?? 0));

  return (
    <div className="space-y-8">
      {order.map((key) => {
        const items = grouped.get(key)!;
        if (items.length === 0) return null;
        return (
          <section key={key}>
            <div className="flex items-baseline justify-between mb-3">
              <h3 className="text-body font-semibold text-foreground uppercase tracking-wide">
                {SECTION_LABEL[key]}
                <span className="ml-2 text-foreground-muted normal-case font-normal">
                  ({items.length})
                </span>
              </h3>
              <span className="text-meta text-foreground-muted">{SECTION_HELP[key]}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {items.map(cardFor)}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function CompareLayout({
  entries,
  cardFor,
  methodLookup,
}: {
  entries: SectionEntry[];
  cardFor: (entry: SectionEntry) => React.ReactNode;
  methodLookup: (task: LabTask, mid: number) => LabMethod | null;
}) {
  interface MethodGroup {
    key: string;
    label: string;
    entries: SectionEntry[];
  }
  const groups = new Map<string, MethodGroup>();
  const NO_METHOD_KEY = "__no_method__";
  for (const e of entries) {
    const mids = e.task.method_ids ?? [];
    if (mids.length === 0) {
      if (!groups.has(NO_METHOD_KEY)) {
        groups.set(NO_METHOD_KEY, {
          key: NO_METHOD_KEY,
          label: "Experiments with no attached method",
          entries: [],
        });
      }
      groups.get(NO_METHOD_KEY)!.entries.push(e);
      continue;
    }
    for (const mid of mids) {
      const m = methodLookup(e.task, mid);
      const key = m ? `${m.username}:${m.id}` : `unknown:${mid}`;
      const label = m?.name ?? `Method #${mid}`;
      if (!groups.has(key)) {
        groups.set(key, { key, label, entries: [] });
      }
      groups.get(key)!.entries.push(e);
    }
  }

  const sortedGroups = Array.from(groups.values()).sort((a, b) => {
    if (a.key === NO_METHOD_KEY) return 1;
    if (b.key === NO_METHOD_KEY) return -1;
    if (b.entries.length !== a.entries.length)
      return b.entries.length - a.entries.length;
    return a.label.localeCompare(b.label);
  });

  return (
    <div className="space-y-8">
      {sortedGroups.map((group) => (
        <section key={group.key}>
          <div className="flex items-baseline justify-between mb-3">
            <h3 className="text-body font-semibold text-foreground">
              {group.label}
              <span className="ml-2 text-foreground-muted font-normal">
                {group.entries.length} run
                {group.entries.length === 1 ? "" : "s"}
              </span>
            </h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {group.entries.map(cardFor)}
          </div>
        </section>
      ))}
    </div>
  );
}
