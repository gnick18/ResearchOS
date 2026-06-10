"use client";

import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Icon, type IconName } from "@/components/icons";
import {
  readProjectActivity,
  type ProjectActivityEvent,
} from "@/lib/project-activity/event-log";
import type { Project } from "@/lib/types";

interface ActivityFeedProps {
  project: Project;
}

// "2 hours ago" / "3 days ago" — small inline helper. The repo doesn't
// have a shared relative-time util; pulling in date-fns for one component
// isn't worth the bundle hit.
function relativeTime(iso: string, now: number): string {
  const ts = Date.parse(iso);
  if (!isFinite(ts)) return "";
  const diffSec = Math.max(0, Math.round((now - ts) / 1000));
  if (diffSec < 60) return "just now";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? "" : "s"} ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hour${diffHr === 1 ? "" : "s"} ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 30) return `${diffDay} day${diffDay === 1 ? "" : "s"} ago`;
  const diffMo = Math.round(diffDay / 30);
  if (diffMo < 12) return `${diffMo} month${diffMo === 1 ? "" : "s"} ago`;
  const diffYr = Math.round(diffMo / 12);
  return `${diffYr} year${diffYr === 1 ? "" : "s"} ago`;
}

// Per-event-type human-readable summary. The actor prefix is rendered
// separately (see render below) so the summary text describes the action
// only — not who took it.
function summarize(event: ProjectActivityEvent): ReactNode {
  switch (event.type) {
    case "task_completed":
      return (
        <>
          Completed <em className="text-foreground">{event.task_name}</em>
        </>
      );
    case "image_added": {
      const where =
        event.surface === "overview"
          ? "the overview"
          : event.surface === "task_results"
            ? event.task_name
              ? (
                <>
                  <em className="text-foreground">{event.task_name}</em>
                  &apos;s results
                </>
              )
              : "an experiment's results"
            : event.task_name
              ? (
                <>
                  <em className="text-foreground">{event.task_name}</em>
                  &apos;s lab notes
                </>
              )
              : "an experiment's lab notes";
      return (
        <>
          Added image <code className="text-meta bg-surface-sunken px-1 py-0.5 rounded">{event.image_name}</code> to{" "}
          {where}
        </>
      );
    }
    case "method_added":
      return (
        <>
          Attached{" "}
          <em className="text-foreground">
            {event.method_name ?? `method #${event.method_id}`}
          </em>{" "}
          to{" "}
          <em className="text-foreground">
            {event.task_name ?? `task #${event.task_id}`}
          </em>
        </>
      );
    case "method_removed":
      return (
        <>
          Removed{" "}
          <em className="text-foreground">
            {event.method_name ?? `method #${event.method_id}`}
          </em>{" "}
          from{" "}
          <em className="text-foreground">
            {event.task_name ?? `task #${event.task_id}`}
          </em>
        </>
      );
    case "prose_edited":
      return <>Edited the project overview</>;
    case "project_shared":
      return (
        <>
          Shared with <em className="text-foreground">{event.recipient}</em> ({event.permission})
        </>
      );
    case "project_archived":
      return event.archived ? (
        <>Archived the project</>
      ) : (
        <>Unarchived the project</>
      );
  }
}

// Per-event-type icon, drawn from the verified ICONS registry via <Icon>.
function eventIcon(type: ProjectActivityEvent["type"]): IconName {
  switch (type) {
    case "task_completed":
      return "check";
    case "image_added":
      return "camera";
    case "method_added":
      return "plus";
    case "method_removed":
      return "minus";
    case "prose_edited":
      return "pencil";
    case "project_shared":
      return "share";
    case "project_archived":
      return "box";
  }
}

export default function ActivityFeed({ project }: ActivityFeedProps) {
  const { data: events = [], isLoading } = useQuery({
    queryKey: [
      "project-activity",
      project.owner,
      project.id,
    ],
    queryFn: () => readProjectActivity(project.owner, project.id),
  });

  // Mount-time anchor for relative time. Captured once via lazy-init so
  // every row computes the same delta within a single render pass and the
  // value stays stable across re-renders. Not refreshed on a timer: a
  // stale "5 minutes ago" sliding to "6 minutes ago" while the panel is
  // open isn't worth a re-render loop.
  const [now] = useState(() => Date.now());

  return (
    <section id="activity" className="scroll-mt-32">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-title font-semibold text-foreground">Activity</h2>
        {!isLoading && events.length > 0 && (
          <span className="text-meta text-foreground-muted">
            {events.length} event{events.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-2" aria-label="Loading activity">
          <div className="h-10 animate-pulse rounded-lg bg-surface-sunken" />
          <div className="h-10 animate-pulse rounded-lg bg-surface-sunken" />
          <div className="h-10 animate-pulse rounded-lg bg-surface-sunken" />
        </div>
      ) : events.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface-sunken px-4 py-6 text-center">
          <p className="text-body text-foreground-muted">No activity yet.</p>
        </div>
      ) : (
        <ol className="flex flex-col divide-y divide-border border border-border rounded-lg overflow-hidden bg-surface-raised">
          {events.map((event) => {
            const showActor = event.actor !== project.owner;
            return (
              <li
                key={event.id}
                className="px-3 py-2 flex items-start gap-2 text-body"
              >
                <span
                  className="flex-shrink-0 w-5 h-5 inline-flex items-center justify-center text-foreground-muted"
                  aria-hidden
                >
                  <Icon name={eventIcon(event.type)} className="w-4 h-4" />
                </span>
                <div className="flex-1 min-w-0 text-foreground">
                  {showActor && (
                    <>
                      <span className="font-medium text-foreground">
                        {event.actor}
                      </span>
                      <span>{" "}</span>
                    </>
                  )}
                  <span>{summarize(event)}</span>
                </div>
                <span
                  className="flex-shrink-0 text-meta text-foreground-muted"
                  title={event.ts}
                >
                  {relativeTime(event.ts, now)}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
