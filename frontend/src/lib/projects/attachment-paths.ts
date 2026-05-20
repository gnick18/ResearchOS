import type { Project } from "@/lib/types";

/**
 * Canonical on-disk directory for a project's overview attachments (images
 * and arbitrary files dropped onto the Overview editor). Sits alongside the
 * other project sidecar paths under the owner's namespace:
 *
 *   users/{owner}/projects/{id}.json          ← project record
 *   users/{owner}/projects/{id}-overview.md   ← overview prose
 *   users/{owner}/projects/{id}-hosted.json   ← per-receiver hosted state
 *   users/{owner}/projects/{id}-attachments/  ← this directory
 *
 * Always namespaced by the project's owner — receivers with edit permission
 * write to the owner's directory, view-only receivers don't write at all
 * (the OverviewSection UI gates this via the readOnly prop). Mirrors the
 * owner-routing rules already used by `effectiveOwnerOf` in ProjectRoute.
 *
 * Differs from `taskResultsBase` (which lives under top-level `results/`)
 * only because tasks pre-date the per-user namespacing and got migrated;
 * projects are namespaced from day one.
 */
export function projectAttachmentsBase(project: Pick<Project, "id" | "owner">): string {
  return `users/${project.owner}/projects/${project.id}-attachments`;
}

/**
 * Subdirectory for image drops. Matches the `Images/` convention used by
 * tasks, methods, and notes so the blob-url resolver and markdown image
 * snippets (`Images/foo.png`) work without surface-specific code paths.
 */
export function projectImagesBase(project: Pick<Project, "id" | "owner">): string {
  return `${projectAttachmentsBase(project)}/Images`;
}

/**
 * Subdirectory for non-image file drops. Mirrors `projectImagesBase`.
 */
export function projectFilesBase(project: Pick<Project, "id" | "owner">): string {
  return `${projectAttachmentsBase(project)}/Files`;
}
