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
    case "sequence":
      return "sequences";
    case "molecule":
      // chem-trash bot: matches the live store dir `users/<u>/molecules/`.
      return "molecules";
    case "inventory_item":
      return "inventory_items";
    case "inventory_stock":
      return "inventory_stocks";
    case "storage_node":
      return "storage_nodes";
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

/** Live-disk paths for each entity type. The dirname here MUST match
 *  the JsonStore prefix wired in `local-api.ts` (e.g. goalsStore is
 *  `new JsonStore<HighLevelGoal>("goals")` so the live path is
 *  `users/<u>/goals/<id>.json`, not `high_level_goals/`). The trash
 *  subdir under `_trash/` is independent and kept descriptive
 *  (`high_level_goals`, `mass_spec_protocols`) via `trashTypeDirName`.
 *
 *  R2 wires every entity type's delete through here; the corrections
 *  for `high_level_goal` (`goals/` on disk) and `mass_spec_protocol`
 *  (`mass_spec_methods/` on disk) were dormant in R1 because only Notes
 *  were exercised. */
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
      // Store prefix is "goals", not "high_level_goals". Keep the
      // trash subdir name descriptive but match disk layout here.
      return `users/${username}/goals/${id}.json`;
    case "lab_link":
      return `users/${username}/lab_links/${id}.json`;
    case "mass_spec_protocol":
      // Store prefix is "mass_spec_methods" (legacy name from before
      // the protocol rename). Trash subdir stays "mass_spec_protocols".
      return `users/${username}/mass_spec_methods/${id}.json`;
    case "sequence":
      // seq delete trash bot: sequences have NO single `.json` record —
      // they are a `{id}.gb` + `{id}.meta.json` pair. We anchor the
      // "live record path" on the `.meta.json` sidecar (the file the live
      // list scans). The `.gb` companion is derived from this by swapping
      // the suffix; see `sequenceGenbankPathFor`. The trash writer / reader
      // never read this path as a single JSON record for sequences — they
      // take the sequence-aware branch instead.
      return `users/${username}/sequences/${id}.meta.json`;
    case "molecule":
      // chem-trash bot: same two-file shape as sequences. Anchor on the
      // `.meta.json` sidecar (the file the live library scans). The `.mol`
      // companion is derived via `moleculeMolfilePathFor`. Molecule ids are
      // STRING — do not coerce to Number.
      return `users/${username}/molecules/${id}.meta.json`;
    case "inventory_item":
      return `users/${username}/inventory_items/${id}.json`;
    case "inventory_stock":
      return `users/${username}/inventory_stocks/${id}.json`;
    case "storage_node":
      return `users/${username}/storage_nodes/${id}.json`;
  }
}

/** seq delete trash bot: given a sequence's `.meta.json` live path, derive
 *  its `.gb` companion (the GenBank source of truth). Centralized so the
 *  writer + reader agree on the pair layout. */
export function sequenceGenbankPathFor(metaPath: string): string {
  return metaPath.replace(/\.meta\.json$/, ".gb");
}

/** chem-trash bot (2026-06-11): given a molecule's `.meta.json` live path,
 *  derive its `.mol` companion (the MDL Molfile source of truth). Centralized
 *  so the writer + reader agree on the pair layout. Mirrors
 *  `sequenceGenbankPathFor`. */
export function moleculeMolfilePathFor(metaPath: string): string {
  return metaPath.replace(/\.meta\.json$/, ".mol");
}
