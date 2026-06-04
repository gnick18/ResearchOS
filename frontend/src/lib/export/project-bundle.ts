// Cross-boundary PROJECT sharing (v1), the project-bundle serializer.
//
// A `researchos-project` bundle is the project record + ALL of the project's
// native tasks (each as the existing per-experiment `researchos-experiment`
// bundle) + the de-duplicated, project-scoped task-to-task dependency union +
// a thin manifest stamping `kind: "project"`.
//
// REUSE, not re-pack. Each `experiments/{slug}-raw.zip` is byte-for-byte the
// bundle `raw.ts` already builds (via buildExperimentPayload + buildRawZip), so
// the project layer wraps the experiment foundation rather than re-serializing
// it. The per-experiment bundles each still carry their own task's dependency
// records (Gap 1); the project-level `dependencies.json` is the DEDUPED UNION of
// every in-project link, which is what lets the importer recreate a link whose
// BOTH endpoints are present in the bundle.
//
// SCOPE (design §1). The bundle carries the project's NATIVE tasks only
// (task.project_id === project.id). A task hosted into the project via
// external_project but owned elsewhere is NOT this sender's to share, so it is
// excluded here (and the importer reports any severed link to it under
// notCarried). The sharing-overlay fields and the grant LINK are stripped from
// the project record (design §1, Q4); the grant NAME is preserved in the
// receive-side provenance stamp, not here.
//
// DEFERRED (design §3, P2). v1 ships a SINGLE sealed blob (this one zip) over
// the existing sendRawShare transport, fine for small/medium projects. The
// sealed-manifest + per-file-DEK + chunked-streaming + resumable transport for
// LARGE projects is a Phase B follow-up and is NOT built here.

import JSZip from "jszip";

import { projectsApi, methodsApi, filesApi, dependenciesApi } from "@/lib/local-api";
import type { Dependency, Project, Task } from "@/lib/types";
import { buildExperimentPayload } from "./extract";
import { buildRawZip } from "./raw";
import { resolveCollidingFilenames } from "./slug";
import { slugify } from "./slug";

/** The format marker file at the project-bundle zip root. Disjoint from the
 *  experiment marker (`_export-manifest.json`) so the inbox sniff can tell a
 *  project bundle from an experiment / method bundle by file shape alone. */
export const PROJECT_MANIFEST_FILE = "_project-manifest.json";

/** Bundle format + manifest version for the project tier. v1 = single-blob
 *  transport, the only version this build emits. */
export const PROJECT_BUNDLE_FORMAT = "researchos-project" as const;
export const PROJECT_BUNDLE_VERSION = 1 as const;

/** One entry in the manifest's per-experiment index. Carries no file bytes,
 *  only the in-zip path + source task identity, so a future manifest-first
 *  preview (P2) can read it cheaply. */
export interface ProjectManifestExperiment {
  /** Source-side task id (the sender's id-space). */
  task_id: number;
  /** Display name, for a receive-side inventory line. */
  name: string;
  /** The in-zip path of this experiment's intact per-experiment bundle. */
  path: string;
}

export interface ProjectBundleManifest {
  format: typeof PROJECT_BUNDLE_FORMAT;
  version: typeof PROJECT_BUNDLE_VERSION;
  kind: "project";
  exported_at: string;
  exported_by: string;
  source_owner: string;
  /** Source-side project id (sender's id-space). */
  project_id: number;
  project_name: string;
  /** Per-experiment index (paths + names + source ids). */
  experiments: ProjectManifestExperiment[];
  /** The de-duplicated bundled dependency record ids (convenience index; the
   *  canonical content is `dependencies.json`). */
  dependency_ids: number[];
  /** Counts for a receive-side inventory line. */
  counts: {
    experiments: number;
    dependencies: number;
  };
}

/**
 * Strip the project record down to the carried fields. Drops the sharing-overlay
 * fields (is_shared_with_me / shared_permission / shared_with / last_edited_by /
 * last_edited_at / revert_undo_window), the grant link (funding_account_id,
 * design Q4), and never carries `imported_from` (a re-share starts fresh
 * provenance on the next recipient). Keeps name, tags, color, weekend flag,
 * sort order. The receiver re-mints id + owner, so those are advisory only.
 */
function stripProjectForShare(project: Project): Pick<
  Project,
  "id" | "name" | "weekend_active" | "tags" | "color" | "created_at" | "sort_order"
> {
  return {
    id: project.id,
    name: project.name,
    weekend_active: project.weekend_active,
    tags: project.tags ?? null,
    color: project.color ?? null,
    created_at: project.created_at,
    sort_order: project.sort_order,
  };
}

/**
 * Build the `researchos-project` bundle as raw bytes, ready for sendRawShare to
 * seal as one blob.
 *
 * @param project     the project to share (its record is carried, stripped).
 * @param nativeTasks the project's NATIVE tasks (task.project_id === project.id,
 *                    owned by the sender). The caller resolves these off disk
 *                    (tasksApi.listByProject); hosted-foreign tasks must already
 *                    be filtered out before this point.
 * @param currentUser the folder-local owner, threaded into the per-experiment
 *                    export so it reads each task's content off disk.
 * @returns the project-bundle zip as raw bytes.
 */
export async function buildProjectBundle(
  project: Project,
  nativeTasks: Task[],
  currentUser: string | null,
): Promise<Uint8Array> {
  if (nativeTasks.length === 0) {
    throw new Error(
      "Nothing to share: this project has no experiments of your own to send.",
    );
  }

  const deps = { projectsApi, methodsApi, filesApi, dependenciesApi };
  const exportedAt = new Date().toISOString();

  // Build each experiment's payload (which carries that task's dependency
  // records, Gap 1) then serialize it to the SAME per-experiment bundle the
  // experiment export produces. Names are collision-resolved so two tasks named
  // alike get distinct `{slug}-raw.zip` entries.
  const payloads = await Promise.all(
    nativeTasks.map((t) => buildExperimentPayload(t, currentUser, deps)),
  );
  const baseNames = resolveCollidingFilenames(payloads);

  const zip = new JSZip();

  const experimentsIndex: ProjectManifestExperiment[] = [];
  for (let i = 0; i < payloads.length; i++) {
    const result = await buildRawZip(payloads[i], baseNames[i]);
    const path = `experiments/${result.filename}`;
    const innerBytes = await result.blob.arrayBuffer();
    zip.file(path, innerBytes);
    experimentsIndex.push({
      task_id: payloads[i].task.id,
      name: payloads[i].task.name,
      path,
    });
  }

  // Project-scoped dependency union, DEDUPED by record id across every carried
  // experiment's dependencies. The per-experiment bundles already carry their
  // own task's links; this top-level set is the union the importer remaps once
  // it has the full multi-task id map (so an in-project link is RECREATED rather
  // than dropped-and-reported, design §4). We carry ONLY links whose BOTH
  // endpoints are native tasks in this bundle, a link to a hosted-foreign or
  // out-of-project task cannot be honestly recreated and is left for the
  // importer to report as not-carried.
  const carriedTaskIds = new Set(nativeTasks.map((t) => t.id));
  const depById = new Map<number, Dependency>();
  for (const payload of payloads) {
    for (const dep of payload.dependencies ?? []) {
      if (carriedTaskIds.has(dep.parent_id) && carriedTaskIds.has(dep.child_id)) {
        depById.set(dep.id, dep);
      }
    }
  }
  const dependencies = [...depById.values()];

  const strippedProject = stripProjectForShare(project);
  zip.file("project.json", JSON.stringify(strippedProject, null, 2));
  if (dependencies.length > 0) {
    zip.file("dependencies.json", JSON.stringify(dependencies, null, 2));
  }

  const manifest: ProjectBundleManifest = {
    format: PROJECT_BUNDLE_FORMAT,
    version: PROJECT_BUNDLE_VERSION,
    kind: "project",
    exported_at: exportedAt,
    exported_by: "ResearchOS",
    source_owner: project.owner,
    project_id: project.id,
    project_name: project.name,
    experiments: experimentsIndex,
    dependency_ids: dependencies.map((d) => d.id),
    counts: {
      experiments: experimentsIndex.length,
      dependencies: dependencies.length,
    },
  };
  zip.file(PROJECT_MANIFEST_FILE, JSON.stringify(manifest, null, 2));

  // Deterministic outer-zip mtimes (mirror raw.ts / orchestrate.ts). The inner
  // per-experiment zips already carry their own per-payload export date.
  const wrapperDate = new Date(exportedAt);
  for (const entry of Object.values(zip.files)) {
    entry.date = wrapperDate;
  }

  const out = await zip.generateAsync({ type: "uint8array" });
  return out;
}

/** Slug for the bundle filename (cosmetic; the manifest is the source of truth). */
export function projectBundleSlug(project: Project): string {
  return slugify(project.name) || "project";
}
