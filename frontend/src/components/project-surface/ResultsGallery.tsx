"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { tasksApi, projectsApi } from "@/lib/local-api";
import { useAppStore } from "@/lib/store";
import {
  taskResultsBase,
  resolveTabAttachmentBase,
} from "@/lib/tasks/results-paths";
import {
  listImagesInFolder,
  type FolderImageEntry,
} from "@/lib/attachments/image-folder";
import { blobUrlResolver } from "@/lib/utils/blob-url-resolver";
import ImageMetadataPopup from "@/components/ImageMetadataPopup";
import AnnotatedImage from "@/components/AnnotatedImage";
import type { Project, Task } from "@/lib/types";

interface ResultsGalleryProps {
  project: Project;
}

interface ExperimentGroup {
  task: Task;
  // Effective per-tab attachment base for the task's Results tab. Passed to
  // ImageMetadataPopup so it can read/write sidecars under the right folder.
  basePath: string;
  // Newest-first.
  images: FolderImageEntry[];
}

// Newest-first by sidecar.receivedAt (the only timestamp listImagesInFolder
// exposes today — no fileService.stat / mtime is available). Falls back to
// filename descending as a stable tiebreaker because Telegram-named files
// embed datetime stamps that correlate with arrival, and lexicographic
// descending preserves "newest first" within that subset.
function sortNewestFirst(entries: FolderImageEntry[]): FolderImageEntry[] {
  return [...entries].sort((a, b) => {
    const ta = a.sidecar?.receivedAt;
    const tb = b.sidecar?.receivedAt;
    if (ta && tb) return tb.localeCompare(ta);
    if (ta) return -1;
    if (tb) return 1;
    return b.name.localeCompare(a.name);
  });
}

export default function ResultsGallery({ project }: ResultsGalleryProps) {
  // Owner-routing for reads: receivers of a shared project read tasks
  // from the owner's directory.
  const taskListOwner = project.is_shared_with_me ? project.owner : undefined;

  const { data: ownTasks = [], isLoading: ownLoading } = useQuery({
    queryKey: [
      "tasks",
      project.is_shared_with_me
        ? `${project.owner}:${project.id}`
        : `self:${project.id}`,
    ],
    queryFn: () => tasksApi.listByProject(project.id, taskListOwner),
  });

  // Cross-owner experiments hosted INTO this project (Option C share
  // pattern). Suppress for archived projects.
  const { data: hostedTasks = [], isLoading: hostedLoading } = useQuery({
    queryKey: ["projects", project.owner, project.id, "hosted-tasks"],
    queryFn: () => projectsApi.listHostedTasks(project.owner, project.id),
    enabled: !project.is_archived,
  });

  const experimentTasks: Task[] = useMemo(() => {
    const own = ownTasks.filter((t) => t.task_type === "experiment");
    const hosted = hostedTasks.filter((t) => t.task_type === "experiment");
    return [...own, ...hosted];
  }, [ownTasks, hostedTasks]);

  // Compact dependency key so react-query doesn't refetch on every shallow
  // task-array recreation. Owner + id pair is enough to identify each row.
  const experimentKey = useMemo(
    () => experimentTasks.map((t) => `${t.owner}:${t.id}`).join(","),
    [experimentTasks]
  );

  const { data: groups = [], isLoading: groupsLoading } = useQuery({
    queryKey: [
      "project-results-gallery",
      project.owner,
      project.id,
      experimentKey,
    ],
    queryFn: async (): Promise<ExperimentGroup[]> => {
      const out: ExperimentGroup[] = [];
      for (const task of experimentTasks) {
        const outerBase = taskResultsBase(task);
        const basePath = await resolveTabAttachmentBase(
          task,
          "results",
          outerBase
        );
        let images: FolderImageEntry[] = [];
        try {
          images = await listImagesInFolder(basePath);
        } catch {
          // No Images folder yet — treat as empty and skip below.
        }
        if (images.length === 0) continue;
        out.push({ task, basePath, images: sortNewestFirst(images) });
      }
      return out;
    },
    enabled: experimentTasks.length > 0,
  });

  // Per-section expand/collapse. Default expanded — first-glance "what came
  // out of this project" framing.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleCollapsed = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Blob URL cache for every thumbnail in every group. Resolves once per
  // group set; the resolver itself caches across components.
  const [blobUrls, setBlobUrls] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    if (groups.length === 0) {
      // Functional setState bails out by reference if already empty. The
      // `groups = []` useQuery destructure default produces a new empty
      // array reference each render when data is undefined; without this
      // guard, the effect would loop (new map -> rerender -> new groups
      // ref -> effect fires -> new map -> ...). Keeping the same Map
      // reference short-circuits React's bailout. The eslint rule
      // `react-hooks/set-state-in-effect` doesn't recognize the
      // functional-bailout pattern as safe, so disable inline.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- functional bailout
      setBlobUrls((prev) => (prev.size === 0 ? prev : new Map()));
      return;
    }
    let cancelled = false;
    (async () => {
      const next = new Map<string, string>();
      for (const g of groups) {
        for (const img of g.images) {
          const fullPath = `${g.basePath}/Images/${img.name}`;
          const cached = blobUrlResolver.getCachedUrl(fullPath);
          if (cached) {
            next.set(fullPath, cached);
            continue;
          }
          const url = await blobUrlResolver.getBlobUrl(fullPath);
          if (url) next.set(fullPath, url);
        }
      }
      if (!cancelled) setBlobUrls(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [groups]);

  const [popup, setPopup] = useState<{ basePath: string; filename: string } | null>(
    null
  );

  const totalImages = useMemo(
    () => groups.reduce((acc, g) => acc + g.images.length, 0),
    [groups]
  );

  const stillLoading = ownLoading || hostedLoading || groupsLoading;

  // Opens the new-experiment modal (issue #4 empty-state CTA): results are
  // authored inside experiments, so this is how a user adds them from here.
  const setIsCreatingTask = useAppStore((s) => s.setIsCreatingTask);
  const setNewTaskStartDate = useAppStore((s) => s.setNewTaskStartDate);
  const setRestrictedTaskType = useAppStore((s) => s.setRestrictedTaskType);
  const createExperiment = useCallback(() => {
    setNewTaskStartDate(null);
    setRestrictedTaskType("experiment");
    setIsCreatingTask(true);
  }, [setIsCreatingTask, setNewTaskStartDate, setRestrictedTaskType]);

  return (
    <section id="results" className="scroll-mt-32">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-title font-semibold text-foreground">Results</h2>
        {!stillLoading && totalImages > 0 && (
          <span className="text-meta text-foreground-muted">
            {totalImages} image{totalImages === 1 ? "" : "s"} across{" "}
            {groups.length} experiment{groups.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {/* Read-only aggregation: Project Results rolls up images from child
          experiments. You add results on each experiment, not here. The note
          only shows when there IS content; the empty-state below explains the
          model and gives a path to add results (issue #4). */}
      {!stillLoading && totalImages > 0 && (
        <p className="text-meta text-foreground-muted mb-3">
          A read-only roll-up of images from this project&apos;s experiments. Add results on each experiment.
        </p>
      )}

      {stillLoading ? (
        <p className="text-body text-foreground-muted italic">Loading results…</p>
      ) : groups.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-surface-sunken px-5 py-6 text-center">
          <p className="text-body font-medium text-foreground">No results yet</p>
          <p className="mx-auto mt-1 max-w-md text-meta text-foreground-muted leading-relaxed">
            Results live inside your experiments. Each experiment has its own
            Results tab for images and a results document. This project page just
            rolls them up here once you have some.
          </p>
          <button
            type="button"
            onClick={createExperiment}
            className="ros-btn-raise mt-4 rounded-lg bg-brand-action px-4 py-2 text-meta font-semibold text-white hover:bg-brand-action/90"
          >
            + New experiment
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map((g) => {
            const key = `${g.task.owner}:${g.task.id}`;
            const isCollapsed = collapsed.has(key);
            return (
              <div
                key={key}
                className="border border-border rounded-lg overflow-hidden bg-surface-raised"
              >
                <button
                  type="button"
                  onClick={() => toggleCollapsed(key)}
                  className="w-full px-3 py-2 bg-surface-sunken hover:bg-surface-sunken border-b border-border flex items-center gap-2 text-left transition-colors"
                  aria-expanded={!isCollapsed}
                >
                  <span
                    className={`text-meta text-foreground-muted transition-transform ${
                      isCollapsed ? "" : "rotate-90"
                    }`}
                    aria-hidden
                  >
                    ▶
                  </span>
                  <h3 className="text-body font-medium text-foreground truncate flex-1">
                    {g.task.name}
                  </h3>
                  <span className="text-meta px-2 py-0.5 bg-surface-sunken text-foreground-muted rounded-full flex-shrink-0">
                    {g.images.length} image{g.images.length === 1 ? "" : "s"}
                  </span>
                  {g.task.is_shared_with_me && (
                    <span className="text-meta px-2 py-0.5 bg-blue-50 dark:bg-blue-500/15 text-blue-600 dark:text-blue-300 rounded-full flex-shrink-0">
                      Shared by {g.task.owner}
                    </span>
                  )}
                </button>
                {!isCollapsed && (
                  <div className="px-3 py-3 flex flex-wrap gap-2">
                    {g.images.map((img) => {
                      const fullPath = `${g.basePath}/Images/${img.name}`;
                      const url = blobUrls.get(fullPath);
                      const tooltip = img.sidecar?.caption
                        ? `${img.sidecar.caption} — ${img.name}`
                        : img.name;
                      return (
                        <button
                          key={img.name}
                          type="button"
                          onClick={() =>
                            setPopup({ basePath: g.basePath, filename: img.name })
                          }
                          className="group relative flex-shrink-0 w-24 h-24 rounded-md border border-border bg-surface-raised overflow-hidden hover:border-blue-400 hover:ring-2 hover:ring-blue-200 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                          title={tooltip}
                        >
                          {url ? (
                            <AnnotatedImage
                              src={url}
                              alt={img.sidecar?.caption ?? img.name}
                              basePath={g.basePath}
                              filename={img.name}
                              className="w-full h-full object-cover pointer-events-none"
                            />
                          ) : (
                            <div className="w-full h-full bg-surface-sunken" />
                          )}
                          <span className="absolute inset-x-0 bottom-0 px-1 py-0.5 text-meta text-white bg-black/60 truncate opacity-0 group-hover:opacity-100 transition-opacity" data-force-hover-controls-target>
                            {img.name}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {popup && (
        <ImageMetadataPopup
          basePath={popup.basePath}
          filename={popup.filename}
          inDocument={false}
          onClose={() => setPopup(null)}
        />
      )}
    </section>
  );
}
