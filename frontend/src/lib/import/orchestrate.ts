import { applyImportPlan } from "./apply";
import { parseImportBundle } from "./parse";
import { buildImportPlan } from "./resolve";
import type { ImportPayload, ImportPlan, ImportResult } from "./types";

export { ImportParseError } from "./parse";
export { buildImportPlan, pickImportedMethodName, pickImportedProjectName } from "./resolve";
export { applyImportPlan } from "./apply";
export { parseImportBundle } from "./parse";

/**
 * Stage 1: turn a user-supplied .zip into a fully-populated `ImportPlan`
 * with default decisions filled in. The dialog renders these decisions for
 * the user to override before applying.
 */
export async function previewImport(file: Blob): Promise<{
  payload: ImportPayload;
  plan: ImportPlan;
}> {
  const payload = await parseImportBundle(file);
  const plan = await buildImportPlan(payload);
  return { payload, plan };
}

/**
 * Stage 2: write everything to disk. Takes the (possibly user-edited) plan
 * and persists it. Returns the new task id so the caller can deep-link
 * straight to it.
 */
export async function commitImport(plan: ImportPlan): Promise<ImportResult> {
  return applyImportPlan(plan);
}
