// Cross-boundary PROJECT sharing (v1), the ALWAYS-NEW project importer.
//
// Materializes a parsed ProjectImportPayload as a FRESH project in the receiver's
// folder, with every id remapped into the receiver's namespace and an
// `imported_from` provenance stamp (design §5, always-new is the only v1 mode,
// NO merge-into-existing). It COMPOSES the existing single-experiment apply
// helpers (localizeImportedMethod / remapMethodIds / remapMethodAttachments /
// writeNotesResultsAttachments / remapDependencies) rather than reimplementing
// them, so the per-experiment unit of work is the SAME tested code the local
// import uses. The single-experiment applyImportPlan path is untouched.
//
// ORDERING (design §4). Create the project once -> localize methods (deduped
// across the whole project, design Q3) -> create every task (collecting the full
// source->new task-id map) -> write notes/results/attachments -> create
// dependencies LAST against the COMPLETE map (so an in-project link whose both
// endpoints are present is RECREATED, the payoff the single-experiment tier
// deferred). notCarried is aggregated into one report across all experiments.
//
// METHOD DEDUP. A method referenced by several of the project's experiments is
// localized ONCE (keyed by source method id), so the receiver gets one library
// method all tasks point at, not a duplicate per experiment (design Q3).

import {
  dependenciesApi,
  projectsApi,
  sequencesApi,
  tasksApi,
} from "@/lib/local-api";
import { sequenceStore } from "@/lib/sequences/sequence-store";
import { getCurrentUserCached } from "@/lib/storage/json-store";
import type { Dependency, ProjectImportedFrom } from "@/lib/types";
import { pickImportedProjectName } from "./resolve";
import {
  localizeImportedMethod,
  remapDependencies,
  remapMethodAttachments,
  remapMethodIds,
  writeNotesResultsAttachments,
} from "./apply";
import type { ProjectImportPayload } from "./project-parse";
import type { ImportNotCarried, ImportResult } from "./types";

export interface ProjectImportResult {
  /** The fresh receiver-side project id every imported task was bound to. */
  newProjectId: number;
  /** The receiver-side username that owns the imported project + tasks. */
  newOwner: string;
  /** Per-experiment results, in import order. Each is the same ImportResult the
   *  single-experiment apply returns (minus project resolution, which is shared). */
  experiments: ImportResult[];
  /** The aggregate of every experiment's notCarried, so the recipient sees one
   *  "here is what did not come over" summary rather than one per experiment. */
  notCarried: ImportNotCarried;
  /** Number of bundled sequences recreated + filed into the new project (v2;
   *  0 when the bundle carried none). */
  sequencesCreated: number;
}

/** Caller-supplied provenance for the imported_from stamp (design §5, Q6). The
 *  inbox passes the sender label it resolved (verified email or hash label). */
export interface ProjectImportProvenance {
  /** Best-known sender label (verified email, else a short key-hash label). */
  sender: string;
}

/**
 * Import a parsed project bundle ALWAYS-NEW. Returns the new project id + the
 * per-experiment results + the aggregated notCarried report.
 */
export async function applyProjectImportPlan(
  payload: ProjectImportPayload,
  provenance: ProjectImportProvenance,
): Promise<ProjectImportResult> {
  const currentUser = await getCurrentUserCached();
  if (!currentUser || currentUser === "_no_user_") {
    throw new Error("No active user — sign in before importing.");
  }

  const notCarried: ImportNotCarried = { dependencies: [], methodRefs: [] };

  // 1. One project, always new, with a collision-safe name + provenance stamp.
  const importedFrom: ProjectImportedFrom = {
    sender: provenance.sender,
    imported_at: new Date().toISOString(),
    source_project_name: payload.project.name,
    // The grant LINK is dropped on share (design Q4); we only have the source
    // project name here, the sender did not carry the grant account, so there is
    // no grant name to preserve in v1. Left null; the field is reserved for a
    // future sender that carries the grant name.
    source_grant: null,
  };
  const newName = await pickImportedProjectName(payload.project.name);
  const newProject = await projectsApi.create({
    name: newName,
    weekend_active: payload.project.weekend_active,
    tags: payload.project.tags ?? undefined,
    color: payload.project.color ?? undefined,
    imported_from: importedFrom,
  });

  // 2. Localize methods ONCE across the whole project (dedup by source method
  //    id, design Q3). methodMapping: source method id -> receiver method id.
  //    A best-effort source-id -> name lookup powers the notCarried report.
  const methodMapping: Record<number, number> = {};
  const methodNameById = new Map<number, string>();
  for (const exp of payload.experiments) {
    for (const m of exp.methods) {
      if (!methodNameById.has(m.record.id)) {
        methodNameById.set(m.record.id, m.record.name);
      }
      if (methodMapping[m.record.id] != null) continue; // already localized.
      const newId = await localizeImportedMethod(m, m.record.name);
      if (newId != null) {
        methodMapping[m.record.id] = newId;
      }
      // A protocol-less structured method returns null; it is left out of the
      // mapping and will surface via remapMethodIds/remapMethodAttachments as a
      // dropped method ref below.
    }
  }

  // 3. Create every task, collecting the full source->new task-id map. The map
  //    keys on the source task id (the inner bundle's manifest.task_id, which
  //    equals task.id in the source namespace).
  const taskIdMap = new Map<number, number>();
  const reportedMethodIds = new Set<number>();
  const experimentResults: ImportResult[] = [];

  // Track each created task so we can write its notes/results/attachments after
  // creation (the write path keys on the new task id).
  const created: Array<{ payload: (typeof payload.experiments)[number]; newTaskId: number }> = [];

  for (const exp of payload.experiments) {
    const sourceTask = exp.task;

    const newMethodIds = remapMethodIds(
      sourceTask.method_ids ?? [],
      methodMapping,
      notCarried,
      methodNameById,
      reportedMethodIds,
    );
    const newMethodAttachments = remapMethodAttachments(
      sourceTask.method_attachments ?? [],
      methodMapping,
      notCarried,
      methodNameById,
      reportedMethodIds,
    );

    const newTask = await tasksApi.create({
      project_id: newProject.id,
      name: sourceTask.name,
      start_date: sourceTask.start_date,
      duration_days: sourceTask.duration_days,
      is_high_level: sourceTask.is_high_level,
      task_type: sourceTask.task_type,
      weekend_override: sourceTask.weekend_override,
      method_ids: newMethodIds,
      tags: sourceTask.tags ?? undefined,
      experiment_color: sourceTask.experiment_color,
      sub_tasks: sourceTask.sub_tasks ?? undefined,
      method_attachments: newMethodAttachments,
    });

    if (sourceTask.deviation_log || sourceTask.is_complete) {
      await tasksApi.update(newTask.id, {
        deviation_log: sourceTask.deviation_log,
        is_complete: sourceTask.is_complete,
      });
    }

    // The inner bundle's manifest.task_id is the source task id (the dependency
    // endpoints are in this same id-space). Map it to the freshly created task.
    taskIdMap.set(exp.manifest.task_id, newTask.id);
    created.push({ payload: exp, newTaskId: newTask.id });

    experimentResults.push({
      newTaskId: newTask.id,
      newTaskOwner: currentUser,
      newProjectId: newProject.id,
      importedMethodIds: methodMapping,
      // The shared notCarried accumulates across experiments; each per-experiment
      // result references the SAME aggregate so callers reading either see the
      // full picture.
      notCarried,
    });
  }

  // 4. Write notes/results/attachments for each created task.
  for (const c of created) {
    await writeNotesResultsAttachments(c.newTaskId, currentUser, c.payload);
  }

  // 5. Dependencies LAST, against the COMPLETE multi-task map. An in-project link
  //    whose both endpoints are present is recreated; any link whose endpoint is
  //    missing (a hosted-foreign or out-of-project task that was not carried) is
  //    dropped + reported. Use the project-scoped deduped union from the bundle.
  const projectDeps: Dependency[] = payload.dependencies ?? [];
  const depsToCreate = remapDependencies(projectDeps, taskIdMap, notCarried);
  for (const dep of depsToCreate) {
    await dependenciesApi.create(dep);
  }

  // 6. Recreate the bundled sequences (v2), each FILED INTO the new project via
  //    project_ids = [String(newProjectId)] (unlike the standalone sequence tier,
  //    which lands Unfiled because it has no project to map). Stamp fresh
  //    cross-boundary provenance from the SAME sender label the project import
  //    uses for tasks/methods (provenance.sender) onto each new sidecar — the
  //    sender stripped its own received_from* on send, so this is always fresh.
  let sequencesCreated = 0;
  const importedAt = new Date().toISOString();
  for (const seq of payload.sequences ?? []) {
    const created = await sequencesApi.create({
      display_name: seq.display_name,
      genbank: seq.genbank,
      seq_type: seq.seq_type,
      project_ids: [String(newProject.id)],
    });
    if (!created) continue;
    // Stamp provenance on the new sidecar (create does not carry it, mirroring
    // the standalone sequence tier). received_from is the project sender label.
    await sequenceStore.updateMeta(
      created.id,
      {
        received_from: provenance.sender,
        received_at: importedAt,
      },
      currentUser,
    );
    sequencesCreated += 1;
  }

  return {
    newProjectId: newProject.id,
    newOwner: currentUser,
    experiments: experimentResults,
    notCarried,
    sequencesCreated,
  };
}
