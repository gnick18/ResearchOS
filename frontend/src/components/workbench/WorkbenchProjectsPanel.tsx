"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useQueries, useQuery } from "@tanstack/react-query";
import {
  fetchAllProjectsIncludingShared,
  fetchAllTasksIncludingShared,
  sequencesApi,
} from "@/lib/local-api";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import NewProjectButton from "@/components/lab-overview/NewProjectButton";
import SharedFromPill from "@/components/workbench/SharedFromPill";
import type { Project, Task } from "@/lib/types";

const DEFAULT_COLORS = [
  "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
  "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#6366f1",
];

/**
 * Workbench "Projects" tab (workbench-projects bot, Phase 3a, 2026-06-02).
 *
 * The default Workbench landing view: a responsive grid of project cards so a
 * member sees their projects first, not a flat task list. Projects were
 * previously only filter pills on the other tabs; this makes them a browsable
 * home. Per-project deep-views still live at /workbench/projects/[id]
 * (ProjectRoute, owned by Phase 3b — untouched here).
 *
 * Each card derives a completion bar + counts from the tasks the user can
 * already fetch (fetchAllTasksIncludingShared), matched to the project by the
 * canonical (project_id, owner) pair — the same rule lib/search/filterKey uses.
 * Notes are project-agnostic in this data model (no project_id link, which is
 * why the Notes tab hides the filter pills), so there is no per-project notes
 * count to show. Sequences come from the sequence-arc seam
 * (sequencesApi.listByProject); the seam returns [] until Sequence Phase 1, so
 * the chip simply renders 0 today and lights up automatically later.
 *
 * Navigation mirrors NewProjectButton.handleCreated: a shared project routes
 * with an `?owner=` suffix; an own project routes plainly.
 *
 * Custom inline SVGs (no emojis), no em-dashes.
 */

const projectKey = (p: Pick<Project, "id" | "owner">) => `${p.owner}:${p.id}`;

interface ProjectCounts {
  experiments: number;
  experimentsComplete: number;
  lists: number;
  total: number;
  totalComplete: number;
}

function countTasksForProject(tasks: Task[], project: Project): ProjectCounts {
  const own = tasks.filter(
    (t) => t.project_id === project.id && t.owner === project.owner,
  );
  let experiments = 0;
  let experimentsComplete = 0;
  let lists = 0;
  let totalComplete = 0;
  for (const t of own) {
    if (t.is_complete) totalComplete += 1;
    if (t.task_type === "experiment") {
      experiments += 1;
      if (t.is_complete) experimentsComplete += 1;
    } else if (t.task_type === "list") {
      lists += 1;
    }
  }
  return {
    experiments,
    experimentsComplete,
    lists,
    total: own.length,
    totalComplete,
  };
}

const ExperimentIcon = (
  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
  </svg>
);

const ListIcon = (
  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
  </svg>
);

const SequenceIcon = (
  /* Circular plasmid ring with a small linearisation notch — instantly reads
     as "sequence / DNA" at small sizes, no ambiguous squiggles. */
  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M12 3a9 9 0 1 0 6.364 2.636" />
  </svg>
);

interface CountChipProps {
  icon: React.ReactNode;
  label: string;
  value: number;
}

function CountChip({ icon, label, value }: CountChipProps) {
  return (
    <span className="inline-flex items-center gap-1 text-meta text-foreground-muted">
      <span className="text-foreground-muted">{icon}</span>
      <span className="font-medium text-foreground">{value}</span>
      {label}
    </span>
  );
}

interface ProjectCardProps {
  project: Project;
  color: string;
  counts: ProjectCounts;
  sequenceCount: number;
  onOpen: () => void;
}

function ProjectCard({ project, color, counts, sequenceCount, onOpen }: ProjectCardProps) {
  const pct =
    counts.total > 0
      ? Math.round((counts.totalComplete / counts.total) * 100)
      : 0;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="relative flex flex-col text-left rounded-xl border border-border bg-surface-raised p-4 shadow-sm transition-all hover:shadow-md hover:border-foreground-muted/40 focus:outline-none focus:ring-2 focus:ring-blue-500"
    >
      {project.is_shared_with_me && (
        <div className="mb-2 flex">
          <SharedFromPill owner={project.owner} />
        </div>
      )}

      <div className="flex items-start gap-2 mb-3">
        <span
          className="mt-1 h-3 w-3 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
          aria-hidden
        />
        <h3 className="text-body font-semibold text-foreground leading-snug line-clamp-2">
          {project.name || "(unnamed project)"}
        </h3>
      </div>

      {/* Completion bar — % of this project's tasks complete. */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-meta text-foreground-muted">
            {counts.total > 0
              ? `${counts.totalComplete} of ${counts.total} complete`
              : "No tasks yet"}
          </span>
          <span className="text-meta font-medium text-foreground-muted">{pct}%</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${pct}%`, backgroundColor: color }}
          />
        </div>
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1">
        <CountChip icon={ExperimentIcon} label="experiments" value={counts.experiments} />
        <CountChip icon={ListIcon} label="list tasks" value={counts.lists} />
        {sequenceCount > 0 && (
          <CountChip icon={SequenceIcon} label="sequences" value={sequenceCount} />
        )}
      </div>
    </button>
  );
}

interface Props {
  /** Projects come from the page-level query so the grid stays in sync with the
   *  filter pills' source. Optional — falls back to its own fetch when absent. */
  projects?: Project[];
}

export default function WorkbenchProjectsPanel({ projects: projectsProp }: Props) {
  const router = useRouter();
  const { currentUser: providerCurrentUser } = useCurrentUser();
  const currentUser = providerCurrentUser ?? "";

  const { data: fetchedProjects = [] } = useQuery({
    queryKey: ["projects", currentUser],
    queryFn: fetchAllProjectsIncludingShared,
    enabled: projectsProp === undefined,
  });
  const projects = projectsProp ?? fetchedProjects;

  const { data: allTasks = [] } = useQuery({
    queryKey: ["tasks", currentUser],
    queryFn: fetchAllTasksIncludingShared,
  });

  const projectColors = useMemo(() => {
    const map: Record<string, string> = {};
    projects.forEach((p, i) => {
      map[projectKey(p)] = p.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length];
    });
    return map;
  }, [projects]);

  const countsByKey = useMemo(() => {
    const map: Record<string, ProjectCounts> = {};
    projects.forEach((p) => {
      map[projectKey(p)] = countTasksForProject(allTasks, p);
    });
    return map;
  }, [projects, allTasks]);

  // Sequence counts via the sequence-arc seam. Returns [] until Sequence
  // Phase 1 fills it, so every chip reads 0 today and lights up later with no
  // change here. Owner-scoped reads aren't exposed by the seam yet, so shared
  // projects simply show 0 until the seam gains a cross-owner read.
  const sequenceQueries = useQueries({
    queries: projects.map((p) => ({
      queryKey: ["project-sequences", projectKey(p)],
      queryFn: () => sequencesApi.listByProject(p.id),
      enabled: !p.is_shared_with_me,
      staleTime: 60_000,
    })),
  });
  const sequenceCountByKey = useMemo(() => {
    const map: Record<string, number> = {};
    projects.forEach((p, i) => {
      map[projectKey(p)] = sequenceQueries[i]?.data?.length ?? 0;
    });
    return map;
  }, [projects, sequenceQueries]);

  const openProject = (project: Project) => {
    const ownerSuffix =
      project.is_shared_with_me && project.owner && project.owner !== currentUser
        ? `?owner=${encodeURIComponent(project.owner)}`
        : "";
    router.push(`/workbench/projects/${project.id}${ownerSuffix}`);
  };

  if (projects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surface-sunken px-6 py-16 text-center">
        <svg
          className="mb-3 h-10 w-10 text-gray-300"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
        </svg>
        <h3 className="text-title font-semibold text-foreground">No projects yet</h3>
        <p className="mt-1 mb-5 max-w-xs text-body text-foreground-muted">
          Projects organize your experiments, list tasks, and sequences. Create
          your first to get going.
        </p>
        {currentUser && <NewProjectButton username={currentUser} />}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-body text-foreground-muted">
          {projects.length} project{projects.length !== 1 ? "s" : ""}
        </p>
        {currentUser && <NewProjectButton username={currentUser} />}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {projects.map((p) => {
          const key = projectKey(p);
          return (
            <ProjectCard
              key={key}
              project={p}
              color={projectColors[key]}
              counts={countsByKey[key]}
              sequenceCount={sequenceCountByKey[key] ?? 0}
              onOpen={() => openProject(p)}
            />
          );
        })}
      </div>
    </div>
  );
}
