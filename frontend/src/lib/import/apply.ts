import { fileService } from "@/lib/file-system/file-service";
import {
  methodsApi,
  pcrApi,
  lcGradientApi,
  plateApi,
  cellCultureApi,
  massSpecApi,
  codingWorkflowApi,
  qpcrAnalysisApi,
  projectsApi,
  tasksApi,
  dependenciesApi,
} from "@/lib/local-api";
import { getCurrentUserCached } from "@/lib/storage/json-store";
import { taskNotesBase, taskResultsBase, taskResultsTabBase } from "@/lib/tasks/results-paths";
import type { Dependency, TaskMethodAttachment } from "@/lib/types";
import { pickImportedMethodName, pickImportedProjectName } from "./resolve";
import type {
  ImportMethodEntry,
  ImportNotCarried,
  ImportPayload,
  ImportPlan,
  ImportResult,
} from "./types";

function slugifyForPath(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "method";
}

async function writeBytes(path: string, bytes: ArrayBuffer, mimeHint?: string): Promise<void> {
  const blob = new Blob([bytes], mimeHint ? { type: mimeHint } : undefined);
  await fileService.writeFileFromBlob(path, blob);
}

/**
 * Resolve the project for the new task:
 *  - "use-existing" → return the chosen project id.
 *  - "no-project"   → null (task lives unbound).
 *  - "import-new"   → call projectsApi.create with a name that doesn't
 *                     collide, return the new id.
 */
async function applyProjectResolution(plan: ImportPlan): Promise<number | null> {
  const r = plan.project;
  if (r.decision === "no-project") return null;
  if (r.decision === "use-existing") {
    if (r.existingProjectId == null) {
      throw new Error("Project decision 'use-existing' has no existingProjectId");
    }
    return r.existingProjectId;
  }
  // import-new
  const source = plan.payload.project;
  const newName = await pickImportedProjectName(source.name);
  const project = await projectsApi.create({
    name: newName,
    weekend_active: source.weekend_active,
    tags: source.tags ?? undefined,
    color: source.color ?? undefined,
  });
  return project.id;
}

/**
 * For each method in the plan, resolve into a receiver-side method id (or
 * null for "skip"). Returns a parallel array matching `plan.methods`.
 *
 * "import-new" creates a fresh method via `methodsApi.create` (private, in
 * the receiver's library), then for PDF/markdown methods copies the body
 * file into `methods/{slug}/...` and updates the new record's `source_path`.
 *
 * For PCR methods, "import-new" requires the bundle to have carried the
 * source's `PCRProtocol` record (parsed onto `entry.pcrProtocol`). When
 * present, the protocol is recreated in the receiver's namespace first;
 * the new method's `source_path` is rewritten to point at the receiver's
 * fresh protocol id. When absent, the PCR method is dropped with a warning
 * — the source's `pcr://protocol/{id}` ref means nothing in the receiver's
 * workspace and the resolver should have steered the user away from
 * "import-new" already.
 */
async function applyMethodResolutions(
  plan: ImportPlan,
): Promise<{
  mapping: Record<number, number>;
  resultMethodIds: number[];
}> {
  const mapping: Record<number, number> = {};
  const resultMethodIds: number[] = [];

  for (let i = 0; i < plan.methods.length; i++) {
    const res = plan.methods[i];
    if (res.decision === "skip") continue;
    if (res.decision === "use-existing") {
      if (res.existingMethodId == null) {
        throw new Error(`Method decision 'use-existing' has no existingMethodId for source ${res.sourceMethodId}`);
      }
      mapping[res.sourceMethodId] = res.existingMethodId;
      resultMethodIds.push(res.existingMethodId);
      continue;
    }
    // import-new
    const entry = plan.payload.methods[i];
    if (!entry) {
      console.warn(`[import.apply] resolution index ${i} has no payload method entry`);
      continue;
    }
    const newId = await localizeImportedMethod(entry, res.sourceMethodName);
    if (newId == null) continue; // protocol-less structured method, dropped + warned.
    mapping[res.sourceMethodId] = newId;
    resultMethodIds.push(newId);
  }

  return { mapping, resultMethodIds };
}

/**
 * Localize ONE bundled method entry into a fresh receiver-side method, returning
 * its new id (or null when the method cannot be honestly recreated, a structured
 * method whose protocol record was not bundled). Extracted verbatim from the
 * former import-new branch of applyMethodResolutions so BOTH the single-experiment
 * path and the new project-import path (project-apply.ts) share one localizer —
 * the single-experiment behavior is byte-for-byte unchanged.
 *
 * For structured methods (PCR / LC / plate / cell-culture / mass-spec /
 * coding-workflow / qPCR) it first recreates the canonical protocol record in
 * the receiver's namespace, then mints the method pointing at the fresh protocol
 * id. For markdown / PDF methods it writes the body to a `methods/{slug}/...`
 * path and points source_path there.
 */
export async function localizeImportedMethod(
  entry: ImportMethodEntry,
  sourceMethodName: string,
): Promise<number | null> {
  if (entry.record.method_type === "pcr") {
    if (entry.pcrProtocol == null) {
      console.warn(
        `[import.apply] PCR method '${sourceMethodName}' was marked import-new but the bundle did not carry the protocol record. Skipping.`,
      );
      return null;
    }
    const newName = await pickImportedMethodName(sourceMethodName);
    const newProtocol = await pcrApi.create({
      name: entry.pcrProtocol.name,
      gradient: entry.pcrProtocol.gradient,
      ingredients: entry.pcrProtocol.ingredients,
      notes: entry.pcrProtocol.notes,
      is_public: false,
    });
    const newMethod = await methodsApi.create({
      name: newName,
      source_path: `pcr://protocol/${newProtocol.id}`,
      method_type: "pcr",
      folder_path: entry.record.folder_path,
      tags: entry.record.tags ?? undefined,
      is_public: false,
    });
    return newMethod.id;
  }

  if (entry.record.method_type === "lc_gradient") {
    if (entry.lcGradientProtocol == null) {
      console.warn(
        `[import.apply] LC gradient method '${sourceMethodName}' was marked import-new but the bundle did not carry the protocol record. Skipping.`,
      );
      return null;
    }
    const newName = await pickImportedMethodName(sourceMethodName);
    const newProtocol = await lcGradientApi.create({
      name: entry.lcGradientProtocol.name,
      description: entry.lcGradientProtocol.description,
      gradient_steps: entry.lcGradientProtocol.gradient_steps,
      column: entry.lcGradientProtocol.column,
      detection_wavelength_nm: entry.lcGradientProtocol.detection_wavelength_nm,
      ingredients: entry.lcGradientProtocol.ingredients,
      is_public: false,
    });
    const newMethod = await methodsApi.create({
      name: newName,
      source_path: `lc_gradient://protocol/${newProtocol.id}`,
      method_type: "lc_gradient",
      folder_path: entry.record.folder_path,
      tags: entry.record.tags ?? undefined,
      is_public: false,
    });
    return newMethod.id;
  }

  if (entry.record.method_type === "plate") {
    if (entry.plateProtocol == null) {
      console.warn(
        `[import.apply] Plate method '${sourceMethodName}' was marked import-new but the bundle did not carry the protocol record. Skipping.`,
      );
      return null;
    }
    const newName = await pickImportedMethodName(sourceMethodName);
    const newProtocol = await plateApi.create({
      name: entry.plateProtocol.name,
      description: entry.plateProtocol.description,
      plate_size: entry.plateProtocol.plate_size,
      region_labels: entry.plateProtocol.region_labels,
      is_public: false,
    });
    const newMethod = await methodsApi.create({
      name: newName,
      source_path: `plate://protocol/${newProtocol.id}`,
      method_type: "plate",
      folder_path: entry.record.folder_path,
      tags: entry.record.tags ?? undefined,
      is_public: false,
    });
    return newMethod.id;
  }

  if (entry.record.method_type === "cell_culture") {
    if (entry.cellCultureSchedule == null) {
      console.warn(
        `[import.apply] Cell culture method '${sourceMethodName}' was marked import-new but the bundle did not carry the schedule record. Skipping.`,
      );
      return null;
    }
    const newName = await pickImportedMethodName(sourceMethodName);
    const newSchedule = await cellCultureApi.create({
      name: entry.cellCultureSchedule.name,
      description: entry.cellCultureSchedule.description,
      cell_line: entry.cellCultureSchedule.cell_line,
      media: entry.cellCultureSchedule.media,
      planned_events: entry.cellCultureSchedule.planned_events,
      is_public: false,
    });
    const newMethod = await methodsApi.create({
      name: newName,
      source_path: `cell_culture://protocol/${newSchedule.id}`,
      method_type: "cell_culture",
      folder_path: entry.record.folder_path,
      tags: entry.record.tags ?? undefined,
      is_public: false,
    });
    return newMethod.id;
  }

  if (entry.record.method_type === "mass_spec") {
    if (entry.massSpecProtocol == null) {
      console.warn(
        `[import.apply] Mass spec method '${sourceMethodName}' was marked import-new but the bundle did not carry the protocol record. Skipping.`,
      );
      return null;
    }
    const newName = await pickImportedMethodName(sourceMethodName);
    const newProtocol = await massSpecApi.create({
      name: entry.massSpecProtocol.name,
      description: entry.massSpecProtocol.description,
      ionization_mode: entry.massSpecProtocol.ionization_mode,
      ionization_label: entry.massSpecProtocol.ionization_label,
      instrument: entry.massSpecProtocol.instrument,
      source: entry.massSpecProtocol.source,
      scan: entry.massSpecProtocol.scan,
      calibration: entry.massSpecProtocol.calibration,
      is_public: false,
    });
    const newMethod = await methodsApi.create({
      name: newName,
      source_path: `mass_spec://protocol/${newProtocol.id}`,
      method_type: "mass_spec",
      folder_path: entry.record.folder_path,
      tags: entry.record.tags ?? undefined,
      is_public: false,
    });
    return newMethod.id;
  }

  if (entry.record.method_type === "coding_workflow") {
    if (entry.codingWorkflow == null) {
      console.warn(
        `[import.apply] Coding workflow '${sourceMethodName}' was marked import-new but the bundle did not carry the protocol record. Skipping.`,
      );
      return null;
    }
    const newName = await pickImportedMethodName(sourceMethodName);
    const newProtocol = await codingWorkflowApi.create({
      name: entry.codingWorkflow.name,
      description: entry.codingWorkflow.description,
      language: entry.codingWorkflow.language,
      language_label: entry.codingWorkflow.language_label,
      embedded_code: entry.codingWorkflow.embedded_code,
      external_path: entry.codingWorkflow.external_path,
      output_renderer: entry.codingWorkflow.output_renderer,
      is_public: false,
    });
    const newMethod = await methodsApi.create({
      name: newName,
      source_path: `coding_workflow://protocol/${newProtocol.id}`,
      method_type: "coding_workflow",
      folder_path: entry.record.folder_path,
      tags: entry.record.tags ?? undefined,
      is_public: false,
    });
    return newMethod.id;
  }

  if (entry.record.method_type === "qpcr_analysis") {
    if (entry.qpcrAnalysisProtocol == null) {
      console.warn(
        `[import.apply] qPCR analysis method '${sourceMethodName}' was marked import-new but the bundle did not carry the protocol record. Skipping.`,
      );
      return null;
    }
    const newName = await pickImportedMethodName(sourceMethodName);
    const newProtocol = await qpcrAnalysisApi.create({
      name: entry.qpcrAnalysisProtocol.name,
      description: entry.qpcrAnalysisProtocol.description,
      chemistry: entry.qpcrAnalysisProtocol.chemistry,
      chemistry_label: entry.qpcrAnalysisProtocol.chemistry_label,
      references: entry.qpcrAnalysisProtocol.references,
      standard_curve: entry.qpcrAnalysisProtocol.standard_curve,
      melt_curve: entry.qpcrAnalysisProtocol.melt_curve,
      use_delta_delta_cq: entry.qpcrAnalysisProtocol.use_delta_delta_cq,
      is_public: false,
    });
    const newMethod = await methodsApi.create({
      name: newName,
      source_path: `qpcr_analysis://protocol/${newProtocol.id}`,
      method_type: "qpcr_analysis",
      folder_path: entry.record.folder_path,
      tags: entry.record.tags ?? undefined,
      is_public: false,
    });
    return newMethod.id;
  }

  const newName = await pickImportedMethodName(sourceMethodName);
  const newSlug = slugifyForPath(newName);

  let sourcePath: string | null = null;
  if (entry.record.method_type === "markdown" && entry.bodyMarkdown !== null) {
    sourcePath = `methods/${newSlug}/${newSlug}.md`;
    await fileService.writeFileFromBlob(
      sourcePath,
      new Blob([entry.bodyMarkdown], { type: "text/markdown" }),
    );
  } else if (entry.record.method_type === "pdf" && entry.bytes && entry.pdfFilename) {
    sourcePath = `methods/${newSlug}/${entry.pdfFilename}`;
    await writeBytes(sourcePath, entry.bytes, "application/pdf");
  }

  const newMethod = await methodsApi.create({
    name: newName,
    source_path: sourcePath,
    method_type: entry.record.method_type ?? undefined,
    folder_path: entry.record.folder_path,
    tags: entry.record.tags ?? undefined,
    is_public: false,
  });
  return newMethod.id;
}

/**
 * Remap `method_attachments` from the source's method id space into the
 * receiver's. Entries whose method maps to a receiver-side method carry their
 * variation notes / PCR overrides over, with `owner` reset to null so the
 * reference points at the importer's own freshly localized method (Gap 2, no
 * dangling foreign owner). Entries whose method did NOT map (skipped, or never
 * bundled) are dropped AND recorded on `notCarried.methodRefs` so a future UI
 * can warn the user instead of the link severing silently.
 *
 * `methodNameById` is a best-effort source-id -> name lookup for the report.
 */
export function remapMethodAttachments(
  source: TaskMethodAttachment[],
  mapping: Record<number, number>,
  notCarried: ImportNotCarried,
  methodNameById: Map<number, string>,
  reportedMethodIds: Set<number>,
): TaskMethodAttachment[] {
  const out: TaskMethodAttachment[] = [];
  for (const att of source) {
    const newId = mapping[att.method_id];
    if (newId == null) {
      // Drop + report. Dedupe against method_ids-level reports so the same
      // missing method isn't listed twice.
      if (!reportedMethodIds.has(att.method_id)) {
        reportedMethodIds.add(att.method_id);
        notCarried.methodRefs.push({
          sourceMethodId: att.method_id,
          sourceMethodName: methodNameById.get(att.method_id) ?? "",
          reason:
            "A method attached to this experiment was not included in the bundle (or was skipped during import), so the reference was dropped rather than left pointing at a method the recipient cannot open.",
        });
      }
      continue;
    }
    out.push({
      method_id: newId,
      // Import remaps id-space into the receiver's namespace, so the new
      // method is locally owned by the importing user. `null` = same user
      // as the (newly imported) task.
      owner: null,
      pcr_gradient: att.pcr_gradient,
      pcr_ingredients: att.pcr_ingredients,
      lc_gradient: att.lc_gradient ?? null,
      body_override: att.body_override ?? null,
      plate_annotation: att.plate_annotation ?? null,
      cell_culture_schedule: att.cell_culture_schedule ?? null,
      variation_notes: att.variation_notes,
      compound_snapshots: att.compound_snapshots ?? null,
      qpcr_analysis: att.qpcr_analysis ?? null,
    });
  }
  return out;
}

/**
 * Remap the task's `method_ids` (Gap 2). A referenced method survives only
 * when it localized to a receiver-side method (present in `mapping`). Any id
 * that did not map is dropped and reported, so the new task never carries a
 * method id the recipient cannot resolve.
 */
export function remapMethodIds(
  sourceMethodIds: number[],
  mapping: Record<number, number>,
  notCarried: ImportNotCarried,
  methodNameById: Map<number, string>,
  reportedMethodIds: Set<number>,
): number[] {
  const out: number[] = [];
  for (const id of sourceMethodIds) {
    const newId = mapping[id];
    if (newId == null) {
      if (!reportedMethodIds.has(id)) {
        reportedMethodIds.add(id);
        notCarried.methodRefs.push({
          sourceMethodId: id,
          sourceMethodName: methodNameById.get(id) ?? "",
          reason:
            "A method this experiment referenced was not included in the bundle (or was skipped during import), so the reference was dropped rather than left pointing at a method the recipient cannot open.",
        });
      }
      continue;
    }
    out.push(newId);
  }
  return out;
}

/**
 * Remap the carried dependency records (Gap 1). A dependency is recreated ONLY
 * when BOTH of its endpoints are tasks present in this same import (future
 * multi-task / project share). For a single-experiment share the other
 * endpoint is absent, so the link cannot be honestly rebuilt — it is DROPPED
 * and reported, never silently recreated against an invented task.
 *
 * `taskIdMap` maps a SOURCE task id -> the receiver-side task id it was
 * materialized as. In the current single-task import it has exactly one entry
 * (the imported task). The shape already supports multi-task remap so the
 * later tier plugs in without touching this rule.
 *
 * Returns the dependency records to create, in the receiver's id-space.
 */
export function remapDependencies(
  dependencies: Dependency[],
  taskIdMap: Map<number, number>,
  notCarried: ImportNotCarried,
): Array<{ parent_id: number; child_id: number; dep_type: Dependency["dep_type"] }> {
  const out: Array<{ parent_id: number; child_id: number; dep_type: Dependency["dep_type"] }> = [];
  for (const dep of dependencies) {
    const newParent = taskIdMap.get(dep.parent_id);
    const newChild = taskIdMap.get(dep.child_id);
    if (newParent != null && newChild != null) {
      out.push({ parent_id: newParent, child_id: newChild, dep_type: dep.dep_type });
      continue;
    }
    // At least one endpoint is not in this import. Drop + report; do not
    // invent the missing endpoint.
    notCarried.dependencies.push({
      sourceParentId: dep.parent_id,
      sourceChildId: dep.child_id,
      depType: dep.dep_type,
      reason:
        "This experiment had a link to another experiment that was not included in what was shared. The link was not carried over.",
    });
  }
  return out;
}

export async function writeNotesResultsAttachments(
  newTaskId: number,
  currentUser: string,
  payload: ImportPayload,
): Promise<void> {
  const base = taskResultsBase({ id: newTaskId, owner: currentUser });
  if (payload.notesMarkdown !== null) {
    await fileService.writeFileFromBlob(
      `${base}/notes.md`,
      new Blob([payload.notesMarkdown], { type: "text/markdown" }),
    );
  }
  if (payload.resultsMarkdown !== null) {
    await fileService.writeFileFromBlob(
      `${base}/results.md`,
      new Blob([payload.resultsMarkdown], { type: "text/markdown" }),
    );
  }

  const notesBase = taskNotesBase({ id: newTaskId, owner: currentUser });
  const resultsTabBase = taskResultsTabBase({ id: newTaskId, owner: currentUser });

  for (const att of payload.attachments) {
    if (att.origin === "notes" && att.sub) {
      await writeBytes(`${notesBase}/${att.sub}/${att.filename}`, att.bytes);
    } else if (att.origin === "results" && att.sub) {
      await writeBytes(`${resultsTabBase}/${att.sub}/${att.filename}`, att.bytes);
    }
    // origin === "methods" attachments are handled inside the method
    // creation path (applyMethodResolutions). Unattached method files
    // (parsed from methods/unattached/) get dropped — the receiver has
    // no clean place to land them.
  }
}

/**
 * Apply path for a standalone METHOD bundle (cross-boundary method sharing).
 *
 * A shared method rides inside a synthetic "envelope" experiment so the
 * unchanged experiment parser can read it, but on receive only the method
 * should land. This path reuses applyMethodResolutions verbatim (protocol
 * recreation, source_path rewrite, body-file copy, is_public:false) and stops
 * there. It deliberately creates NO task (the envelope task), NO results
 * subtree, NO project (the synthetic "(method share)" placeholder), and NO
 * dependencies, none of which a standalone method has. So a received method
 * lands as just the method record + its body / protocol / source PDF, with no
 * phantom experiment alongside it.
 *
 * Routed from applyImportPlan when manifest.kind === "method".
 */
async function applyMethodOnlyImportPlan(plan: ImportPlan): Promise<ImportResult> {
  const currentUser = await getCurrentUserCached();
  if (!currentUser || currentUser === "_no_user_") {
    throw new Error("No active user — sign in before importing.");
  }

  const { mapping } = await applyMethodResolutions(plan);

  return {
    // A method import materializes no task — the envelope is dropped, never
    // created. null is the method-only marker the success UI branches on.
    newTaskId: null,
    newTaskOwner: currentUser,
    // No project either; the envelope's "(method share)" placeholder is never
    // created on the receiver side.
    newProjectId: null,
    importedMethodIds: mapping,
    // A standalone method has no task links or foreign method references to
    // drop, so nothing is ever "not carried" on this path.
    notCarried: { dependencies: [], methodRefs: [] },
  };
}

export async function applyImportPlan(plan: ImportPlan): Promise<ImportResult> {
  // A standalone method bundle is experiment-shaped on the wire (a synthetic
  // envelope task carrying the one method) so the unchanged parser can read
  // it. On receive, branch to the method-only apply BEFORE any task or project
  // is created, so the method lands alone with no phantom experiment.
  if (plan.payload.manifest.kind === "method") {
    return applyMethodOnlyImportPlan(plan);
  }

  const currentUser = await getCurrentUserCached();
  if (!currentUser || currentUser === "_no_user_") {
    throw new Error("No active user — sign in before importing.");
  }

  const notCarried: ImportNotCarried = { dependencies: [], methodRefs: [] };

  const newProjectId = await applyProjectResolution(plan);
  const { mapping, resultMethodIds } = await applyMethodResolutions(plan);
  void resultMethodIds; // method_ids is recomputed below from the source task.

  // Best-effort source-method-id -> name lookup for the notCarried report.
  // Pull from both the resolution list and the parsed records so a method
  // that was dropped before resolution still gets a name when available.
  const methodNameById = new Map<number, string>();
  for (const r of plan.methods) {
    methodNameById.set(r.sourceMethodId, r.sourceMethodName);
  }
  for (const m of plan.payload.methods) {
    if (!methodNameById.has(m.record.id)) {
      methodNameById.set(m.record.id, m.record.name);
    }
  }

  const sourceTask = plan.payload.task;

  // Gap 2: remap both reference surfaces (method_ids + method_attachments)
  // through the localized-method mapping. A shared report set dedupes a
  // method that appears in both surfaces so the user sees it once.
  const reportedMethodIds = new Set<number>();
  const newMethodIds = remapMethodIds(
    sourceTask.method_ids ?? [],
    mapping,
    notCarried,
    methodNameById,
    reportedMethodIds,
  );
  const newMethodAttachments = remapMethodAttachments(
    sourceTask.method_attachments ?? [],
    mapping,
    notCarried,
    methodNameById,
    reportedMethodIds,
  );

  const newTask = await tasksApi.create({
    project_id: newProjectId,
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

  // Persist deviation_log + is_complete via a follow-up update — create()
  // doesn't accept these directly.
  if (sourceTask.deviation_log || sourceTask.is_complete) {
    await tasksApi.update(newTask.id, {
      deviation_log: sourceTask.deviation_log,
      is_complete: sourceTask.is_complete,
    });
  }

  await writeNotesResultsAttachments(newTask.id, currentUser, plan.payload);

  // Gap 1: carry dependencies. The only source task present in this import is
  // the one we just materialized, so the task-id map has exactly one entry.
  // A dependency is recreated only when both endpoints are in that map; the
  // common single-experiment case drops + reports the link.
  const taskIdMap = new Map<number, number>([
    [plan.payload.manifest.task_id, newTask.id],
  ]);
  const depsToCreate = remapDependencies(
    plan.payload.dependencies ?? [],
    taskIdMap,
    notCarried,
  );
  for (const dep of depsToCreate) {
    await dependenciesApi.create(dep);
  }

  return {
    newTaskId: newTask.id,
    newTaskOwner: currentUser,
    newProjectId,
    importedMethodIds: mapping,
    notCarried,
  };
}

