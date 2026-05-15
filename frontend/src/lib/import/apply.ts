import { fileService } from "@/lib/file-system/file-service";
import { methodsApi, pcrApi, lcGradientApi, plateApi, projectsApi, tasksApi } from "@/lib/local-api";
import { getCurrentUserCached } from "@/lib/storage/json-store";
import { taskNotesBase, taskResultsBase, taskResultsTabBase } from "@/lib/tasks/results-paths";
import type { TaskMethodAttachment } from "@/lib/types";
import { pickImportedMethodName, pickImportedProjectName } from "./resolve";
import type {
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

    if (entry.record.method_type === "pcr") {
      if (entry.pcrProtocol == null) {
        console.warn(
          `[import.apply] PCR method '${res.sourceMethodName}' was marked import-new but the bundle did not carry the protocol record. Skipping.`,
        );
        continue;
      }
      const newName = await pickImportedMethodName(res.sourceMethodName);
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
      mapping[res.sourceMethodId] = newMethod.id;
      resultMethodIds.push(newMethod.id);
      continue;
    }

    if (entry.record.method_type === "lc_gradient") {
      if (entry.lcGradientProtocol == null) {
        console.warn(
          `[import.apply] LC gradient method '${res.sourceMethodName}' was marked import-new but the bundle did not carry the protocol record. Skipping.`,
        );
        continue;
      }
      const newName = await pickImportedMethodName(res.sourceMethodName);
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
      mapping[res.sourceMethodId] = newMethod.id;
      resultMethodIds.push(newMethod.id);
      continue;
    }

    if (entry.record.method_type === "plate") {
      if (entry.plateProtocol == null) {
        console.warn(
          `[import.apply] Plate method '${res.sourceMethodName}' was marked import-new but the bundle did not carry the protocol record. Skipping.`,
        );
        continue;
      }
      const newName = await pickImportedMethodName(res.sourceMethodName);
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
      mapping[res.sourceMethodId] = newMethod.id;
      resultMethodIds.push(newMethod.id);
      continue;
    }

    const newName = await pickImportedMethodName(res.sourceMethodName);
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

    mapping[res.sourceMethodId] = newMethod.id;
    resultMethodIds.push(newMethod.id);
  }

  return { mapping, resultMethodIds };
}

/**
 * Remap `method_attachments` from the source's method id space into the
 * receiver's. Entries whose method was skipped get dropped; entries whose
 * method maps to an existing receiver method carry their variation notes /
 * PCR overrides over.
 */
function remapMethodAttachments(
  source: TaskMethodAttachment[],
  mapping: Record<number, number>,
): TaskMethodAttachment[] {
  const out: TaskMethodAttachment[] = [];
  for (const att of source) {
    const newId = mapping[att.method_id];
    if (newId == null) continue;
    out.push({
      method_id: newId,
      pcr_gradient: att.pcr_gradient,
      pcr_ingredients: att.pcr_ingredients,
      lc_gradient: att.lc_gradient ?? null,
      plate_annotation: att.plate_annotation ?? null,
      variation_notes: att.variation_notes,
    });
  }
  return out;
}

async function writeNotesResultsAttachments(
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

export async function applyImportPlan(plan: ImportPlan): Promise<ImportResult> {
  const currentUser = await getCurrentUserCached();
  if (!currentUser || currentUser === "_no_user_") {
    throw new Error("No active user — sign in before importing.");
  }

  const newProjectId = await applyProjectResolution(plan);
  const { mapping, resultMethodIds } = await applyMethodResolutions(plan);

  const sourceTask = plan.payload.task;
  const newTask = await tasksApi.create({
    project_id: newProjectId,
    name: sourceTask.name,
    start_date: sourceTask.start_date,
    duration_days: sourceTask.duration_days,
    is_high_level: sourceTask.is_high_level,
    task_type: sourceTask.task_type,
    weekend_override: sourceTask.weekend_override,
    method_ids: resultMethodIds,
    tags: sourceTask.tags ?? undefined,
    experiment_color: sourceTask.experiment_color,
    sub_tasks: sourceTask.sub_tasks ?? undefined,
    method_attachments: remapMethodAttachments(
      sourceTask.method_attachments ?? [],
      mapping,
    ),
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

  return {
    newTaskId: newTask.id,
    newTaskOwner: currentUser,
    newProjectId,
    importedMethodIds: mapping,
  };
}

