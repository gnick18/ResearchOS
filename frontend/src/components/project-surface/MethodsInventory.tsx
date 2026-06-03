"use client";

import { useMemo } from "react";
import Link from "@/components/FixtureLink";
import { useQuery } from "@tanstack/react-query";
import { tasksApi, projectsApi, methodsApi } from "@/lib/local-api";
import { getMethodTypeMeta } from "@/lib/methods/method-type-registry";
import type { Project, Task, Method } from "@/lib/types";

interface MethodsInventoryProps {
  project: Project;
}

// One (method_id, owner) composite + the experiments it appeared in. `owner`
// is normalized to a string ("" when the attachment's owner was null, meaning
// "same user as the task" — see TaskMethodAttachment doc on types.ts:179).
// Dedupe key is `${owner}:${method_id}` so per-user id collisions stay
// distinct (a user's private method 2 ≠ public method 2).
interface MethodUsage {
  methodId: number;
  // Empty string sentinel = local/legacy attachment with null owner.
  owner: string;
  count: number;
  // True when at least one usage came from a hosted (cross-owner) experiment.
  // Drives the "via <owner>" tag so it's clear the usage didn't originate
  // from a native experiment on this project.
  hostedSources: Set<string>;
}

interface ResolvedMethodRow {
  usage: MethodUsage;
  method: Method | null;
}

export default function MethodsInventory({ project }: MethodsInventoryProps) {
  // Same owner-routing pattern as ResultsGallery: a receiver of a shared
  // project reads tasks from the owner's directory.
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

  const { data: hostedTasks = [], isLoading: hostedLoading } = useQuery({
    queryKey: ["projects", project.owner, project.id, "hosted-tasks"],
    queryFn: () => projectsApi.listHostedTasks(project.owner, project.id),
    enabled: !project.is_archived,
  });

  const usages: MethodUsage[] = useMemo(() => {
    const map = new Map<string, MethodUsage>();
    const ingest = (tasks: Task[], isHosted: boolean) => {
      for (const task of tasks) {
        if (task.task_type !== "experiment") continue;
        for (const att of task.method_attachments ?? []) {
          const ownerKey = att.owner ?? "";
          const key = `${ownerKey}:${att.method_id}`;
          const existing = map.get(key);
          if (existing) {
            existing.count += 1;
            if (isHosted) existing.hostedSources.add(task.owner);
          } else {
            map.set(key, {
              methodId: att.method_id,
              owner: ownerKey,
              count: 1,
              hostedSources: isHosted ? new Set([task.owner]) : new Set(),
            });
          }
        }
      }
    };
    ingest(ownTasks, false);
    ingest(hostedTasks, true);
    return Array.from(map.values());
  }, [ownTasks, hostedTasks]);

  // Compact key — keeps react-query stable across shallow re-renders of the
  // usages array. Same pattern as ResultsGallery's experimentKey.
  const usagesKey = useMemo(
    () => usages.map((u) => `${u.owner}:${u.methodId}`).join(","),
    [usages]
  );

  const { data: rows = [], isLoading: rowsLoading } = useQuery({
    queryKey: [
      "project-methods-inventory",
      project.owner,
      project.id,
      usagesKey,
    ],
    queryFn: async (): Promise<ResolvedMethodRow[]> => {
      const out: ResolvedMethodRow[] = [];
      for (const usage of usages) {
        // Empty-string owner sentinel collapses back to undefined: methodsApi.get
        // falls through to the current user's private store and then public.
        // Matches the legacy null-owner attachment behavior.
        const ownerArg = usage.owner === "" ? undefined : usage.owner;
        const method = await methodsApi.get(usage.methodId, ownerArg);
        out.push({ usage, method });
      }
      // Usage count desc, then method name asc (alphabetical tiebreaker).
      out.sort((a, b) => {
        if (a.usage.count !== b.usage.count) return b.usage.count - a.usage.count;
        const an = a.method?.name ?? `Method ${a.usage.methodId}`;
        const bn = b.method?.name ?? `Method ${b.usage.methodId}`;
        return an.localeCompare(bn);
      });
      return out;
    },
    enabled: usages.length > 0,
  });

  const stillLoading = ownLoading || hostedLoading || rowsLoading;

  return (
    <section id="methods" className="scroll-mt-32">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-title font-semibold text-gray-900">Methods</h2>
        {!stillLoading && rows.length > 0 && (
          <span className="text-meta text-gray-400">
            {rows.length} method{rows.length === 1 ? "" : "s"} across{" "}
            {rows.reduce((acc, r) => acc + r.usage.count, 0)} experiment-attachment
            {rows.reduce((acc, r) => acc + r.usage.count, 0) === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {stillLoading ? (
        <p className="text-body text-gray-400 italic">Loading methods…</p>
      ) : rows.length === 0 ? (
        <p className="text-body text-gray-400 italic">
          No methods linked yet. Methods attached to this project&apos;s experiments
          will appear here.
        </p>
      ) : (
        <div className="flex flex-col divide-y divide-gray-100 border border-gray-100 rounded-lg overflow-hidden bg-white">
          {rows.map((row) => {
            const { usage, method } = row;
            const key = `${usage.owner}:${usage.methodId}`;
            const meta = getMethodTypeMeta(method?.method_type);
            // Owner query param is forward-compatible — the /methods page
            // currently resolves the deep link via id-then-public fallback,
            // but threading owner keeps the URL self-describing for the
            // shared-method case.
            const ownerForLink = usage.owner === "" ? null : usage.owner;
            const href = ownerForLink
              ? `/methods?openMethod=${usage.methodId}&owner=${encodeURIComponent(ownerForLink)}`
              : `/methods?openMethod=${usage.methodId}`;
            const hostedTag =
              usage.hostedSources.size > 0
                ? Array.from(usage.hostedSources).join(", ")
                : null;
            return (
              <Link
                key={key}
                href={href}
                className="px-3 py-2 flex items-center gap-2 hover:bg-gray-50 transition-colors"
              >
                <span className="text-body font-medium text-gray-800 truncate flex-1 min-w-0">
                  {method?.name ?? `Method #${usage.methodId} (unavailable)`}
                </span>
                <span
                  className={`text-meta px-2 py-0.5 rounded-full flex-shrink-0 ${meta.color.bg} ${meta.color.text}`}
                >
                  {meta.label}
                </span>
                {hostedTag && (
                  <span className="text-meta px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full flex-shrink-0">
                    via {hostedTag}
                  </span>
                )}
                <span className="text-meta px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full flex-shrink-0">
                  used in {usage.count} experiment{usage.count === 1 ? "" : "s"}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
