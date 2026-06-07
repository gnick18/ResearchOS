// Cross-owner project-sharing reconcile, OWNER-ONLY (Grant, 2026-06-07).
//
// reconcileHostedDrift fixes drift between a hosted task and the project's
// hosted manifest. Run by every member it would write to the HOST's manifest
// (the shared-manifest race). So we scope it owner-only: only the current user's
// OWN hosted manifests, and only tasks whose external_project points at one of
// the current user's OWN projects, so every appendEntry lands in a manifest the
// current user owns. A member never writes another user's manifest.

import {
  fetchAllTasksIncludingShared,
  fetchAllProjectsIncludingShared,
  tasksApi,
} from "@/lib/local-api";
import { fileService } from "@/lib/file-system/file-service";
import {
  reconcileHostedDrift,
  hostedManifestPath,
} from "@/lib/sharing/project-hosting";
import type {
  ProjectHostedManifest,
  ProjectHostedTaskEntry,
} from "@/lib/types";
import type { MigrationContext, MigrationReport } from "./types";

export const RECONCILE_HOSTED_ID = "reconcile-hosted-drift-v1";

export async function reconcileHostedDriftOwnerOnly(
  ctx: MigrationContext,
): Promise<MigrationReport> {
  const me = ctx.username;
  const [allTasks, allProjects] = await Promise.all([
    fetchAllTasksIncludingShared(),
    fetchAllProjectsIncludingShared(),
  ]);

  // Owner-only scope.
  const myProjects = allProjects.filter((p) => p.owner === me);
  const myHostedTasks = allTasks.filter(
    (t) => t.external_project?.owner === me,
  );
  if (myProjects.length === 0 && myHostedTasks.length === 0) {
    return { changed: 0, scanned: 0, failed: 0 };
  }

  const taskIndex = new Map<string, (typeof allTasks)[number]>();
  for (const t of allTasks) taskIndex.set(`${t.owner}:${t.id}`, t);

  const report = await reconcileHostedDrift({
    hostedManifests: myProjects.map((p) => ({
      projectOwner: p.owner,
      projectId: p.id,
    })),
    tasks: myHostedTasks,
    loadTask: async (owner, id) => taskIndex.get(`${owner}:${id}`) ?? null,
    appendEntry: async (projectOwner, projectId, entry) => {
      const path = hostedManifestPath(projectOwner, projectId);
      const current =
        await fileService.readJson<Partial<ProjectHostedManifest>>(path);
      const existing: ProjectHostedTaskEntry[] = Array.isArray(
        current?.hostedTasks,
      )
        ? current!.hostedTasks!
        : [];
      const dedup = existing.some(
        (e) => e.owner === entry.owner && e.taskId === entry.taskId,
      );
      await fileService.writeJson<ProjectHostedManifest>(path, {
        version: 1,
        hostedTasks: dedup ? existing : [...existing, entry],
      });
    },
    saveTask: async (owner, task) => {
      await tasksApi.update(
        task.id,
        { external_project: task.external_project ?? null },
        owner,
      );
    },
    apply: true,
  });

  const changed =
    report.manifestDropped.length + report.mirrorDriftAppended.length;
  return {
    changed,
    scanned: myProjects.length + myHostedTasks.length,
    failed: 0,
  };
}
