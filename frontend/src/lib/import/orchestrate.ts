import { applyImportPlan } from "./apply";
import { parseImportBundle } from "./parse";
import { buildImportPlan } from "./resolve";
import type {
  ImportPayload,
  ImportPlan,
  ImportProvenance,
  ImportResult,
} from "./types";

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
 *
 * `provenance` is passed ONLY by the cross-boundary inbox receive path, so the
 * imported experiment + its newly imported methods carry a verified-sender
 * marker on the entity. The LOCAL file-import (settings-page file picker) omits
 * it, leaving locally imported entities native (no provenance, no badge).
 */
export async function commitImport(
  plan: ImportPlan,
  provenance?: ImportProvenance,
): Promise<ImportResult> {
  return applyImportPlan(plan, provenance);
}
