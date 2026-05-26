// VCP R1 trash MVP notes (2026-05-26): path helpers for the trash
// subsystem. Pulled into a separate file so trash-writer, trash-reader,
// and trash-index can all share them without depending on each other.

import type { TrashEntityType } from "./trash-types";

/** Per-user trash root. */
export function trashRootPath(username: string): string {
  return `users/${username}/_trash`;
}

/** Per-entity-type subdirectory under the trash root. */
export function trashTypeDirPath(
  username: string,
  entityType: TrashEntityType,
): string {
  return `${trashRootPath(username)}/${trashTypeDirName(entityType)}`;
}

/** The subdirectory name for an entity type. Centralized here so a
 *  rename (e.g. `purchase_item` → `purchases`) is a one-line change. */
export function trashTypeDirName(entityType: TrashEntityType): string {
  switch (entityType) {
    case "note":
      return "notes";
    case "task":
      return "tasks";
    case "method":
      return "methods";
    case "project":
      return "projects";
    case "purchase_item":
      return "purchase_items";
    case "high_level_goal":
      return "high_level_goals";
    case "lab_link":
      return "lab_links";
    case "mass_spec_protocol":
      return "mass_spec_protocols";
  }
}

/** The index sidecar path. */
export function trashIndexPath(username: string): string {
  return `${trashRootPath(username)}/_index.json`;
}

/** Slugify the human-readable name component of a trash filename. Keeps
 *  alphanumerics + hyphens + underscores, replaces everything else with
 *  hyphens, collapses runs, truncates to 60 chars, strips leading +
 *  trailing hyphens. Pure cosmetic — only the `<id>` prefix is load-
 *  bearing for restore (see `findTrashFileForId`). */
export function slugifyTrashName(name: string | null | undefined): string {
  const raw = (name ?? "").trim();
  if (!raw) return "untitled";
  return (
    raw
      .replace(/[^A-Za-z0-9_-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "untitled"
  );
}

/** Build the on-disk filename for a trashed entity. */
export function trashFilename(id: string | number, name: string | null): string {
  return `${id}-${slugifyTrashName(name)}.json`;
}

/** Build the full path for a trashed entity. */
export function trashFilePath(
  username: string,
  entityType: TrashEntityType,
  id: string | number,
  name: string | null,
): string {
  return `${trashTypeDirPath(username, entityType)}/${trashFilename(id, name)}`;
}

/** Live-disk paths for each entity type. R1 only wires `note`; the rest
 *  return paths that match the existing on-disk layout in `local-api.ts`
 *  so the rest of R2 just plugs in. */
export function liveRecordPath(
  username: string,
  entityType: TrashEntityType,
  id: string | number,
): string {
  switch (entityType) {
    case "note":
      return `users/${username}/notes/${id}.json`;
    case "task":
      return `users/${username}/tasks/${id}.json`;
    case "method":
      return `users/${username}/methods/${id}.json`;
    case "project":
      return `users/${username}/projects/${id}.json`;
    case "purchase_item":
      return `users/${username}/purchase_items/${id}.json`;
    case "high_level_goal":
      return `users/${username}/high_level_goals/${id}.json`;
    case "lab_link":
      return `users/${username}/lab_links/${id}.json`;
    case "mass_spec_protocol":
      return `users/${username}/mass_spec_protocols/${id}.json`;
  }
}
